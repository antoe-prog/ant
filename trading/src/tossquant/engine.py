"""매매 루프.

한 사이클 = 시세 수집 → 전략 신호 → 리스크 심사 → 주문. 사이클 하나는
run_once()로 떼어 두어 테스트에서 시간을 직접 넣어 돌릴 수 있게 했다.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from decimal import Decimal

from .broker.base import Broker, BrokerError, OrderRejected
from .broker.paper import PaperBroker
from .calendar_us import describe, is_market_open
from .config import Settings
from .models import Candle, Order, OrderRequest, OrderType, Side, Signal, SignalAction
from .risk import RiskManager
from .store import Store
from .strategy.base import Strategy

log = logging.getLogger(__name__)

# 워밍업에 여유를 둬서 휴장일·결측 캔들로 신호가 안 나오는 상황을 피한다.
CANDLE_BUFFER = 20


class TradingEngine:
    def __init__(
        self,
        broker: Broker,
        strategy: Strategy,
        risk: RiskManager,
        store: Store,
        settings: Settings,
    ) -> None:
        self.broker = broker
        self.strategy = strategy
        self.risk = risk
        self.store = store
        self.settings = settings
        self._stopped = False

    # --- 한 사이클 ----------------------------------------------------------

    def run_once(self, now: datetime | None = None) -> list[Order]:
        moment = now or datetime.now(timezone.utc)

        if not is_market_open(moment):
            log.debug("장외 — 건너뜀 (%s)", describe(moment))
            return []

        if isinstance(self.broker, PaperBroker):
            for order in self.broker.poll_open_orders():
                log.info("미체결 지정가 체결됨: %s", order.order_id)

        candles = self._collect_candles()
        if not candles:
            log.warning("사용 가능한 캔들이 없어 이번 사이클을 건너뜁니다")
            return []

        marks = {
            symbol: rows[-1].close for symbol, rows in candles.items() if rows
        }
        account = self.broker.get_account()
        equity = account.equity(marks)
        self.store.record_equity(equity, account.cash, moment)

        executed: list[Order] = []
        for symbol, rows in candles.items():
            signal = self._signal_for(symbol, rows, account)
            if signal is None:
                continue
            order = self._act(signal, account, marks, moment)
            if order is not None:
                executed.append(order)
                # 체결로 현금·포지션이 바뀌었으므로 다음 종목 심사 전에 갱신.
                account = self.broker.get_account()

        return executed

    def _collect_candles(self) -> dict[str, list[Candle]]:
        need = self.strategy.warmup_bars + CANDLE_BUFFER
        collected: dict[str, list[Candle]] = {}
        for symbol in self.settings.symbols:
            try:
                rows = self.broker.get_candles(symbol, self.settings.candle_interval, need)
            except BrokerError as exc:
                log.error("%s 캔들 조회 실패: %s", symbol, exc)
                continue
            if len(rows) < self.strategy.warmup_bars:
                log.warning(
                    "%s 캔들 부족: %d개 (필요 %d개)",
                    symbol, len(rows), self.strategy.warmup_bars,
                )
                continue
            collected[symbol] = rows
        return collected

    def _signal_for(self, symbol: str, rows: list[Candle], account) -> Signal | None:
        try:
            return self.strategy.on_bar(symbol, rows, account.positions.get(symbol))
        except Exception:  # 전략 버그가 루프 전체를 죽이지 않게 한다
            log.exception("%s 전략 평가 중 오류", symbol)
            return None

    def _act(
        self,
        signal: Signal,
        account,
        marks: dict[str, Decimal],
        moment: datetime,
    ) -> Order | None:
        decision = self.risk.evaluate(signal, account, marks, moment)
        if not decision.approved:
            log.info("신호 기각 %s %s — %s", signal.symbol, signal.action.value, decision.reason)
            return None

        request = OrderRequest(
            symbol=signal.symbol,
            side=Side.BUY if signal.action is SignalAction.ENTER_LONG else Side.SELL,
            quantity=decision.quantity,
            order_type=OrderType.MARKET,
        )
        log.info(
            "주문 %s %s x%d — 신호: %s / 사이징: %s",
            request.symbol, request.side.value, request.quantity,
            signal.reason, decision.reason,
        )
        try:
            return self.broker.place_order(request)
        except OrderRejected as exc:
            log.error("주문 거부: %s", exc)
        except BrokerError as exc:
            log.error("주문 실패: %s", exc)
        return None

    # --- 상시 루프 ----------------------------------------------------------

    def stop(self) -> None:
        self._stopped = True

    def run_forever(self, sleep=time.sleep) -> None:
        mode = "실주문" if self.broker.is_live else "페이퍼"
        log.info(
            "엔진 시작 [%s] 전략=%s 종목=%s 주기=%ds",
            mode, self.strategy.name, ",".join(self.settings.symbols),
            self.settings.poll_seconds,
        )
        while not self._stopped:
            try:
                self.run_once()
            except KeyboardInterrupt:
                raise
            except Exception:
                # 한 사이클 실패로 봇이 죽으면 안 된다. 다음 주기에 재시도.
                log.exception("사이클 실패 — 다음 주기에 재시도합니다")
            sleep(self.settings.poll_seconds)
        log.info("엔진 종료")
