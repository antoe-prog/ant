"""페이퍼 트레이딩 브로커.

시세는 실제 토스 API에서 받고 체결만 가상으로 처리한다. 실주문으로 넘어갈 때
전략·리스크·엔진 코드는 그대로 두고 이 클래스만 TossClient로 바꾸면 된다.

체결 모델:
  - 시장가: 매수는 ask, 매도는 bid에 슬리피지를 얹어 즉시 전량 체결
  - 지정가: 시세가 지정가를 지나가면 체결, 아니면 미체결로 남아 다음
    poll_open_orders() 호출에서 다시 평가
  - 수수료는 체결 금액 대비 bps로 부과

일부러 낙관적이지 않게 잡았다. 실제 체결은 호가 잔량·거래량 영향을 받으므로
페이퍼 성과는 여전히 상단 추정치로 봐야 한다.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import replace
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from ..config import Settings
from ..models import (
    Account,
    Candle,
    Order,
    OrderRequest,
    OrderStatus,
    OrderType,
    Position,
    Quote,
    Side,
)
from ..store import Store
from .base import Broker, InsufficientFunds, MarketData, OrderRejected

log = logging.getLogger(__name__)

CENT = Decimal("0.01")
BPS = Decimal("10000")


def _round_cash(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


class PaperBroker(Broker):
    def __init__(self, market: MarketData, store: Store, settings: Settings) -> None:
        self._market = market
        self._store = store
        self._settings = settings
        self._slippage = settings.paper_slippage_bps / BPS
        self._commission = settings.paper_commission_bps / BPS
        self._cash = store.get_cash(default=settings.paper_cash)
        self._positions = store.load_positions()
        self._open_orders: dict[str, tuple[Order, OrderRequest]] = {}
        store.set_cash(self._cash)

    # --- 시세는 그대로 위임 -------------------------------------------------

    def get_quote(self, symbol: str) -> Quote:
        return self._market.get_quote(symbol)

    def get_candles(self, symbol: str, interval: str, count: int) -> list[Candle]:
        return self._market.get_candles(symbol, interval, count)

    # --- 계좌 ---------------------------------------------------------------

    def get_positions(self) -> dict[str, Position]:
        return dict(self._positions)

    def get_account(self) -> Account:
        return Account(cash=self._cash, positions=dict(self._positions))

    @property
    def is_live(self) -> bool:
        return False

    # --- 주문 ---------------------------------------------------------------

    def place_order(self, request: OrderRequest) -> Order:
        quote = self.get_quote(request.symbol)
        self._validate(request, quote)

        order = Order(
            order_id=f"paper-{uuid.uuid4().hex[:12]}",
            client_order_id=request.client_order_id,
            symbol=request.symbol,
            side=request.side,
            quantity=request.quantity,
            filled_quantity=0,
            avg_fill_price=Decimal("0"),
            status=OrderStatus.NEW,
            ts=datetime.now(timezone.utc),
        )

        fill_price = self._fill_price(request, quote)
        if fill_price is None:
            self._open_orders[order.order_id] = (order, request)
            self._store.save_order(order)
            log.info(
                "지정가 미체결 대기 %s %s x%d @ %s",
                request.symbol, request.side.value, request.quantity, request.limit_price,
            )
            return order

        return self._execute(order, request, fill_price)

    def cancel_order(self, order_id: str) -> Order:
        entry = self._open_orders.pop(order_id, None)
        if entry is None:
            raise OrderRejected(
                f"unknown or already-filled order {order_id}",
                OrderRequest(symbol="?", side=Side.BUY, quantity=1),
            )
        order, _ = entry
        canceled = replace(order, status=OrderStatus.CANCELED)
        self._store.save_order(canceled)
        return canceled

    def poll_open_orders(self) -> list[Order]:
        """미체결 지정가를 현재 시세로 재평가한다. 엔진이 매 사이클 호출한다."""
        filled: list[Order] = []
        for order_id, (order, request) in list(self._open_orders.items()):
            quote = self.get_quote(request.symbol)
            fill_price = self._fill_price(request, quote)
            if fill_price is None:
                continue
            self._open_orders.pop(order_id, None)
            filled.append(self._execute(order, request, fill_price))
        return filled

    # --- 내부 ---------------------------------------------------------------

    def _validate(self, request: OrderRequest, quote: Quote) -> None:
        if quote.last <= 0:
            raise OrderRejected(f"no valid price for {request.symbol}", request)
        if request.side is Side.SELL:
            held = self._positions.get(request.symbol)
            held_qty = held.quantity if held else 0
            if held_qty < request.quantity:
                raise OrderRejected(
                    f"cannot sell {request.quantity} of {request.symbol}, holding {held_qty} "
                    "(공매도는 지원하지 않습니다)",
                    request,
                )

    def _fill_price(self, request: OrderRequest, quote: Quote) -> Decimal | None:
        """체결가를 계산한다. 지정가가 아직 도달하지 않았으면 None."""
        if request.order_type is OrderType.MARKET:
            base = quote.ask if request.side is Side.BUY else quote.bid
            if base <= 0:
                base = quote.last
            drift = base * self._slippage
            return _round_cash(base + drift if request.side is Side.BUY else base - drift)

        limit = request.limit_price
        assert limit is not None  # OrderRequest.__post_init__ 에서 보장
        if request.side is Side.BUY:
            market = quote.ask if quote.ask > 0 else quote.last
            return _round_cash(min(limit, market)) if market <= limit else None
        market = quote.bid if quote.bid > 0 else quote.last
        return _round_cash(max(limit, market)) if market >= limit else None

    def _execute(self, order: Order, request: OrderRequest, price: Decimal) -> Order:
        notional = price * request.quantity
        commission = _round_cash(notional * self._commission)

        if request.side is Side.BUY:
            total = notional + commission
            if total > self._cash:
                raise InsufficientFunds(total, self._cash, request)
            self._cash = _round_cash(self._cash - total)
            self._apply_buy(request.symbol, request.quantity, price)
        else:
            self._cash = _round_cash(self._cash + notional - commission)
            self._apply_sell(request.symbol, request.quantity)

        filled = Order(
            order_id=order.order_id,
            client_order_id=order.client_order_id,
            symbol=order.symbol,
            side=order.side,
            quantity=order.quantity,
            filled_quantity=request.quantity,
            avg_fill_price=price,
            status=OrderStatus.FILLED,
            ts=datetime.now(timezone.utc),
        )
        self._store.save_order(filled)
        self._store.record_fill(
            filled.order_id, filled.symbol, filled.side,
            request.quantity, price, commission, filled.ts,
        )
        self._store.set_cash(self._cash)
        log.info(
            "[PAPER] 체결 %s %s x%d @ %s (수수료 %s, 현금 %s)",
            filled.symbol, filled.side.value, request.quantity, price, commission, self._cash,
        )
        return filled

    def _apply_buy(self, symbol: str, quantity: int, price: Decimal) -> None:
        existing = self._positions.get(symbol)
        if existing is None:
            updated = Position(symbol=symbol, quantity=quantity, avg_price=price)
        else:
            total_qty = existing.quantity + quantity
            total_cost = existing.cost_basis + price * quantity
            updated = Position(
                symbol=symbol,
                quantity=total_qty,
                avg_price=_round_cash(total_cost / total_qty),
            )
        self._positions[symbol] = updated
        self._store.save_position(updated)

    def _apply_sell(self, symbol: str, quantity: int) -> None:
        existing = self._positions[symbol]
        remaining = existing.quantity - quantity
        updated = Position(
            symbol=symbol,
            quantity=remaining,
            avg_price=existing.avg_price if remaining else Decimal("0"),
        )
        if remaining:
            self._positions[symbol] = updated
        else:
            self._positions.pop(symbol, None)
        self._store.save_position(updated)
