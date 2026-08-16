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
import threading
import uuid
from dataclasses import replace
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from functools import wraps
from typing import Any

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
from ..store import Store, StoreLeaseError
from .base import Broker, BrokerError, InsufficientFunds, MarketData, OrderRejected

log = logging.getLogger(__name__)

CENT = Decimal("0.01")
BPS = Decimal("10000")


def _round_cash(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _serialized_broker(method: Any) -> Any:
    """검증·예약·DB 커밋·메모리 반영을 한 주문 임계구역으로 묶는다."""

    @wraps(method)
    def locked(self: PaperBroker, *args: Any, **kwargs: Any) -> Any:
        with self._lock:
            return method(self, *args, **kwargs)

    return locked


class PaperBroker(Broker):
    def __init__(self, market: MarketData, store: Store, settings: Settings) -> None:
        self._market = market
        self._store = store
        self._settings = settings
        self._slippage = settings.paper_slippage_bps / BPS
        self._commission = settings.paper_commission_bps / BPS
        self._lock = threading.RLock()
        self._closed = False
        try:
            store.acquire_paper_lease()
            self._cash = store.get_cash(default=settings.paper_cash)
            self._positions = store.load_positions()
            self._open_orders: dict[str, tuple[Order, OrderRequest]] = {}
            store.set_cash(self._cash)
            self._restore_open_orders()
        except StoreLeaseError as exc:
            raise BrokerError(str(exc)) from exc
        except Exception:
            store.release_paper_lease()
            raise

    # --- 시세는 그대로 위임 -------------------------------------------------

    def get_quote(self, symbol: str) -> Quote:
        return self._market.get_quote(symbol)

    def get_candles(self, symbol: str, interval: str, count: int) -> list[Candle]:
        return self._market.get_candles(symbol, interval, count)

    # --- 계좌 ---------------------------------------------------------------

    @_serialized_broker
    def get_positions(self) -> dict[str, Position]:
        return dict(self._positions)

    @_serialized_broker
    def get_account(self) -> Account:
        return Account(cash=self._cash, positions=dict(self._positions))

    @property
    def is_live(self) -> bool:
        return False

    # --- 주문 ---------------------------------------------------------------

    @_serialized_broker
    def place_order(
        self,
        request: OrderRequest,
        *,
        cash_envelope: Decimal | None = None,
    ) -> Order:
        self._ensure_open()
        self._sync_pending_orders()
        replayed = self._replay_persisted_request(request)
        if replayed is not None:
            return replayed
        quote = self.get_quote(request.symbol)
        if cash_envelope is not None:
            if (
                request.side is not Side.BUY
                or not isinstance(cash_envelope, Decimal)
                or not cash_envelope.is_finite()
                or cash_envelope <= 0
            ):
                raise ValueError("cash_envelope는 BUY 주문의 유한한 양수여야 합니다")
            needed = self.estimate_cash_required(request, quote)
            if needed > cash_envelope:
                raise InsufficientFunds(needed, cash_envelope, request)
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
            try:
                self._store.save_pending_paper_order(order, request)
            except BaseException:
                # INSERT가 커밋된 직후 호출자가 끊겼을 수 있다. 권위 DB를 즉시
                # 다시 읽어 예약을 메모리에 반영한 뒤 원래 예외를 전달한다.
                self._sync_pending_orders()
                raise
            self._open_orders[order.order_id] = (order, request)
            log.info(
                "지정가 미체결 대기 %s %s x%d @ %s",
                request.symbol, request.side.value, request.quantity, request.limit_price,
            )
            return order

        return self._execute(order, request, fill_price)

    @_serialized_broker
    def cancel_order(self, order_id: str) -> Order:
        self._ensure_open()
        entry = self._open_orders.get(order_id)
        if entry is None:
            raise OrderRejected(
                f"unknown or already-filled order {order_id}",
                OrderRequest(symbol="?", side=Side.BUY, quantity=1),
            )
        order, _ = entry
        canceled = replace(order, status=OrderStatus.CANCELED)
        self._store.save_order(canceled, origin="paper")
        self._open_orders.pop(order_id, None)
        return canceled

    @_serialized_broker
    def poll_open_orders(self) -> list[Order]:
        """미체결 지정가를 현재 시세로 재평가한다. 엔진이 매 사이클 호출한다."""
        self._ensure_open()
        filled: list[Order] = []
        for order_id, (order, request) in list(self._open_orders.items()):
            quote = self.get_quote(request.symbol)
            fill_price = self._fill_price(request, quote)
            if fill_price is None:
                continue
            settled = self._execute(order, request, fill_price)
            self._open_orders.pop(order_id, None)
            filled.append(settled)
        return filled

    # --- 내부 ---------------------------------------------------------------

    def _restore_open_orders(self) -> None:
        ambiguous = self._store.ambiguous_pending_orders()
        if ambiguous:
            ids = ", ".join(row["order_id"] for row in ambiguous[:10])
            raise BrokerError(
                "origin 정보가 없어 라이브/페이퍼 미확정 주문을 복구할 수 "
                f"없습니다: {ids}. DB 백업 후 브로커 원장과 대사해 origin을 "
                "확정하거나 주문을 정리하세요."
            )
        self._sync_pending_orders()
        if self._open_orders:
            log.info("미체결 페이퍼 주문 %d건 복구", len(self._open_orders))

    def _sync_pending_orders(self) -> None:
        rows = self._store.pending_paper_orders()
        restored: dict[str, tuple[Order, OrderRequest]] = {}
        for row in rows:
            order, request = self._decode_pending_row(row)
            restored[order.order_id] = (order, request)

        if set(restored) != set(self._open_orders):
            # DB가 FILLED/CANCELED로 앞서 나간 경우까지 포함해 계좌 캐시를 같은
            # 권위 스냅샷으로 맞춘다. 누락된 DB 주문도 restored에 즉시 들어온다.
            self._cash = self._store.get_cash(default=self._cash)
            self._positions = self._store.load_positions()
        self._open_orders = restored
        self._validate_restored_reservations()

    def _replay_persisted_request(self, request: OrderRequest) -> Order | None:
        """같은 client_order_id 재시도는 원장을 다시 적용하지 않고 대사한다."""
        row = self._store.paper_order_by_client_id(request.client_order_id)
        if row is None:
            return None
        try:
            order = Order(
                order_id=row["order_id"],
                client_order_id=row["client_order_id"],
                symbol=row["symbol"],
                side=Side(row["side"]),
                quantity=row["quantity"],
                filled_quantity=row["filled_quantity"],
                avg_fill_price=Decimal(row["avg_fill_price"]),
                status=OrderStatus(row["status"]),
                ts=datetime.fromisoformat(row["ts"]),
                reject_reason=row["reason"],
            )
            self._store._validate_order_state(order)  # noqa: SLF001 - 원장 경계 재사용

            raw_order_type = row["order_type"]
            # 구버전 즉시체결 행에는 request metadata가 없다. 미체결 LIMIT은
            # 예전부터 order_type을 저장했으므로 NULL terminal만 MARKET으로
            # 안전하게 해석할 수 있다.
            stored_order_type = (
                OrderType(raw_order_type)
                if raw_order_type is not None
                else OrderType.MARKET
            )
            raw_limit = row["limit_price"]
            stored_limit = Decimal(raw_limit) if raw_limit is not None else None
            if stored_limit is not None and (
                not stored_limit.is_finite() or stored_limit <= 0
            ):
                raise ValueError("저장된 limit_price가 유한한 양수가 아닙니다")
        except (ArithmeticError, KeyError, TypeError, ValueError) as exc:
            raise BrokerError(
                f"페이퍼 주문 {row['order_id']}의 idempotency 원장을 읽을 수 "
                f"없습니다: {exc}. DB 백업 후 주문을 대사하세요."
            ) from exc

        same_identity = (
            order.client_order_id == request.client_order_id
            and order.symbol == request.symbol
            and order.side is request.side
            and order.quantity == request.quantity
            and stored_order_type is request.order_type
            and (
                stored_order_type is OrderType.MARKET
                or stored_limit == request.limit_price
            )
        )
        if not same_identity:
            raise BrokerError(
                f"client_order_id {request.client_order_id!r}가 다른 페이퍼 "
                f"주문 {order.order_id}에 이미 사용됐습니다"
            )

        if order.status is OrderStatus.NEW:
            if order.order_id not in self._open_orders:
                raise BrokerError(
                    f"미체결 페이퍼 주문 {order.order_id}가 복구 큐에 없습니다. "
                    "DB 백업 후 주문을 대사하세요."
                )
        elif order.status is OrderStatus.PARTIALLY_FILLED:
            raise BrokerError(
                f"페이퍼 주문 {order.order_id}에 지원하지 않는 부분체결이 남았습니다"
            )
        else:
            # settle_fill 커밋 직후 호출자가 끊겼다면 메모리 계좌가 뒤처져 있다.
            self._cash = self._store.get_cash(default=self._cash)
            self._positions = self._store.load_positions()
        return order

    @staticmethod
    def _decode_pending_row(row: Any) -> tuple[Order, OrderRequest]:
        try:
            if row["origin"] != "paper":
                raise ValueError(f"origin이 paper가 아닙니다: {row['origin']!r}")
            if row["status"] != OrderStatus.NEW.value:
                raise ValueError(f"unsupported status {row['status']!r}")
            if row["filled_quantity"] != 0:
                raise ValueError("NEW order has a nonzero filled quantity")
            if row["order_type"] != OrderType.LIMIT.value:
                raise ValueError("order_type LIMIT 정보가 없습니다")
            if row["limit_price"] is None:
                raise ValueError("limit_price 정보가 없습니다")
            limit_price = Decimal(row["limit_price"])
            if not limit_price.is_finite() or limit_price <= 0:
                raise ValueError("limit_price가 유한한 양수가 아닙니다")
            request = OrderRequest(
                symbol=row["symbol"],
                side=Side(row["side"]),
                quantity=row["quantity"],
                order_type=OrderType.LIMIT,
                limit_price=limit_price,
                client_order_id=row["client_order_id"],
            )
            order = Order(
                order_id=row["order_id"],
                client_order_id=row["client_order_id"],
                symbol=row["symbol"],
                side=Side(row["side"]),
                quantity=row["quantity"],
                filled_quantity=row["filled_quantity"],
                avg_fill_price=Decimal(row["avg_fill_price"]),
                status=OrderStatus(row["status"]),
                ts=datetime.fromisoformat(row["ts"]),
                reject_reason=row["reason"],
            )
        except (ArithmeticError, KeyError, TypeError, ValueError) as exc:
            raise BrokerError(
                f"미체결 페이퍼 주문 {row['order_id']}을 복구할 수 없습니다: "
                f"{exc}. DB 백업 후 해당 주문을 취소/정리하세요."
            ) from exc
        return order, request

    def _validate_restored_reservations(self) -> None:
        reserved_cash = sum(
            (
                self._buy_cash_required(request)
                for _, request in self._open_orders.values()
                if request.side is Side.BUY
            ),
            Decimal("0"),
        )
        if reserved_cash > self._cash:
            raise BrokerError(
                f"복구한 페이퍼 매수 주문 예약액 {reserved_cash}이 "
                f"현금 {self._cash}을 초과합니다. 주문 DB를 확인하세요."
            )

        sell_reservations: dict[str, int] = {}
        for _, request in self._open_orders.values():
            if request.side is Side.SELL:
                sell_reservations[request.symbol] = (
                    sell_reservations.get(request.symbol, 0) + request.quantity
                )
        for symbol, reserved in sell_reservations.items():
            position = self._positions.get(symbol)
            held = position.quantity if position else 0
            if reserved > held:
                raise BrokerError(
                    f"복구한 {symbol} 페이퍼 매도 예약 {reserved}주가 "
                    f"보유 {held}주를 초과합니다. 주문 DB를 확인하세요."
                )

    def _validate(self, request: OrderRequest, quote: Quote) -> None:
        if quote.last <= 0:
            raise OrderRejected(f"no valid price for {request.symbol}", request)
        if request.side is Side.BUY:
            reserved = sum(
                self._buy_cash_required(open_request)
                for _, open_request in self._open_orders.values()
                if open_request.side is Side.BUY
            )
            needed = self.estimate_cash_required(request, quote)
            available = self._cash - reserved
            if needed > available:
                raise InsufficientFunds(needed, max(available, Decimal("0")), request)
        else:
            held = self._positions.get(request.symbol)
            held_qty = held.quantity if held else 0
            reserved_qty = sum(
                open_request.quantity
                for _, open_request in self._open_orders.values()
                if open_request.side is Side.SELL
                and open_request.symbol == request.symbol
            )
            available_qty = held_qty - reserved_qty
            if available_qty < request.quantity:
                raise OrderRejected(
                    f"cannot sell {request.quantity} of {request.symbol}, holding {held_qty} "
                    f"reserved {reserved_qty}, available {available_qty} "
                    "(공매도는 지원하지 않습니다)",
                    request,
                )

    def _cash_required(self, price: Decimal, quantity: int) -> Decimal:
        notional = price * quantity
        return notional + _round_cash(notional * self._commission)

    def estimate_cash_required(
        self,
        request: OrderRequest,
        quote: Quote | None = None,
    ) -> Decimal:
        """BUY 주문의 체결 모델·수수료를 포함한 현금 필요액.

        백테스트 배치 예약과 실제 주문 검증이 같은 가격·반올림 경계를 쓰도록
        공개한 순수 추정 경계다. 아직 시장가에 닿지 않은 지정가는 지정가 전액을
        예약한다.
        """
        if request.side is not Side.BUY:
            raise ValueError("현금 필요액은 BUY 주문에만 계산할 수 있습니다")
        resolved_quote = quote or self.get_quote(request.symbol)
        fill_price = self._fill_price(request, resolved_quote)
        if fill_price is None:
            assert request.limit_price is not None
            fill_price = _round_cash(request.limit_price)
        if not fill_price.is_finite() or fill_price <= 0:
            raise OrderRejected(
                f"invalid computed fill price {fill_price}", request
            )
        return self._cash_required(fill_price, request.quantity)

    def max_affordable_quantity(
        self,
        request: OrderRequest,
        cash_budget: Decimal,
        quote: Quote | None = None,
    ) -> int:
        """현재 체결 모델에서 ``cash_budget`` 안에 드는 최대 정수 수량.

        RiskManager가 정한 결정 시점 예산을 바꾸지 않고, 알려진 현재
        스프레드·슬리피지·수수료 때문에 그대로는 넘치는 수량만 줄인다.
        """
        if request.side is not Side.BUY:
            raise ValueError("BUY 주문 수량만 현금 예산에 맞출 수 있습니다")
        if (
            not isinstance(cash_budget, Decimal)
            or not cash_budget.is_finite()
            or cash_budget <= 0
        ):
            raise ValueError("cash_budget은 유한한 양수 Decimal이어야 합니다")
        resolved_quote = quote or self.get_quote(request.symbol)
        low = 0
        high = request.quantity
        while low < high:
            middle = (low + high + 1) // 2
            candidate = replace(request, quantity=middle)
            if self.estimate_cash_required(candidate, resolved_quote) <= cash_budget:
                low = middle
            else:
                high = middle - 1
        return low

    def _buy_cash_required(self, request: OrderRequest) -> Decimal:
        # _open_orders에는 현재가에 닿지 않은 LIMIT만 들어간다. 체결 모델이
        # 가격을 센트로 반올림하므로 같은 반올림을 거친 limit+수수료를 예약한다.
        assert request.limit_price is not None
        return self._cash_required(
            _round_cash(request.limit_price), request.quantity
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
        # 허용 범위 안의 슬리피지라도 아주 작은 가격을 센트로 반올림하면 0이 될
        # 수 있다. 0/음수 체결은 포지션을 없애면서 현금을 주지 않거나 오히려
        # 차감하므로 상태를 바꾸기 전에 마지막 경계에서 거부한다.
        if not price.is_finite() or price <= 0:
            raise OrderRejected(f"invalid computed fill price {price}", request)
        notional = price * request.quantity
        commission = self._cash_required(price, request.quantity) - notional

        if request.side is Side.BUY:
            total = notional + commission
            if total > self._cash:
                raise InsufficientFunds(total, self._cash, request)
            settled_cash = _round_cash(self._cash - total)
            existing = self._positions.get(request.symbol)
            if existing is None:
                settled_position = Position(
                    symbol=request.symbol,
                    quantity=request.quantity,
                    avg_price=price,
                )
            else:
                total_qty = existing.quantity + request.quantity
                total_cost = existing.cost_basis + price * request.quantity
                settled_position = Position(
                    symbol=request.symbol,
                    quantity=total_qty,
                    avg_price=_round_cash(total_cost / total_qty),
                )
        else:
            existing = self._positions.get(request.symbol)
            held_qty = existing.quantity if existing else 0
            if existing is None or held_qty < request.quantity:
                raise OrderRejected(
                    f"cannot settle sale of {request.quantity} {request.symbol}; "
                    f"holding {held_qty}",
                    request,
                )
            settled_cash = _round_cash(self._cash + notional - commission)
            remaining = existing.quantity - request.quantity
            settled_position = Position(
                symbol=request.symbol,
                quantity=remaining,
                avg_price=existing.avg_price if remaining else Decimal("0"),
            )

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
        settlement = self._store.settle_fill(
            filled,
            request=request,
            commission=commission,
            cash=settled_cash,
            position=settled_position,
            expected_cash=self._cash,
            expected_position=existing,
        )
        if settlement.applied:
            # DB 커밋 이후에만 메모리 스냅샷을 바꾼다. 커밋 전 예외면 양쪽
            # 모두 주문 전 상태다.
            self._cash = settled_cash
            if settled_position.quantity:
                self._positions[request.symbol] = settled_position
            else:
                self._positions.pop(request.symbol, None)
        else:
            # 커밋 직후 프로세스/호출자가 끊겨 메모리와 pending 큐만 뒤처진
            # 재시도다. 원장을 다시 적용하지 않고 DB를 권위 상태로 재동기화한다.
            self._cash = self._store.get_cash(default=self._cash)
            self._positions = self._store.load_positions()
            filled = settlement.order
        log.info(
            "[PAPER] 체결 %s %s x%d @ %s (수수료 %s, 현금 %s)",
            filled.symbol, filled.side.value, request.quantity, price, commission, self._cash,
        )
        return filled

    def _ensure_open(self) -> None:
        if self._closed:
            raise BrokerError("닫힌 페이퍼 브로커는 주문을 처리할 수 없습니다")

    @_serialized_broker
    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._store.release_paper_lease()

    @_serialized_broker
    def __enter__(self) -> PaperBroker:
        self._ensure_open()
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
