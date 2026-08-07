"""매매 루프.

한 사이클 = 시세 수집 → 전략 신호 → 리스크 심사 → 주문. 사이클 하나는
run_once()로 떼어 두어 테스트에서 시간을 직접 넣어 돌릴 수 있게 했다.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from .broker.base import Broker, BrokerError, OrderRejected
from .broker.paper import PaperBroker
from .calendar_us import describe, is_market_open, minutes_to_close, to_ny
from .config import Settings
from .models import (
    Candle,
    Order,
    OrderRequest,
    OrderType,
    Position,
    Side,
    Signal,
    SignalAction,
)
from .notify import Level, Notification, Notifier, NullNotifier
from .regime import RegimeFilter
from .risk import RiskManager
from .stops import StopManager
from .store import Store
from .strategy.base import Strategy

log = logging.getLogger(__name__)

# 워밍업에 여유를 둬서 휴장일·결측 캔들로 신호가 안 나오는 상황을 피한다.
CANDLE_BUFFER = 20


@dataclass
class SignalBatch:
    """이번 사이클의 신호와, 국면 필터가 걷어낸 진입 수."""

    signals: list[Signal]
    suppressed_entries: int = 0


def collect_signals(
    symbols: list[str],
    strategy: Strategy,
    stops: StopManager,
    positions: dict[str, Position],
    marks: dict[str, Decimal],
    candles: dict[str, list[Candle]],
    now: datetime,
    *,
    allow_entries: bool = True,
) -> SignalBatch:
    """이번 사이클에 처리할 신호 목록.

    실시간 엔진과 백테스트가 **같은 함수**를 쓴다. 신호 우선순위가 두 곳에서
    갈리면 백테스트 결과를 믿을 수 없게 되므로 여기 한 곳에만 둔다.

    우선순위:
    1. 보호 청산이 전략보다 앞선다. 손절이 걸린 종목은 그 사이클에 전략 신호를
       아예 묻지 않는다 — 같은 봉에서 손절과 전략 매수가 동시에 나오는 걸 막는다.
    2. `allow_entries=False`(시장 국면 위험)면 **신규 진입만** 걷어낸다.
       청산은 국면과 무관하게 통과시킨다 — 하락장에서 못 빠져나오게 막는 건
       정확히 반대로 가는 짓이다.
    """
    protective = stops.exits(positions, marks, now)
    stopped = {signal.symbol for signal in protective}
    signals = list(protective)
    suppressed = 0

    for symbol in symbols:
        if symbol in stopped:
            continue
        rows = candles.get(symbol)
        if not rows:
            continue
        try:
            signal = strategy.on_bar(symbol, rows, positions.get(symbol))
        except Exception:  # 전략 버그가 루프 전체를 죽이지 않게 한다
            log.exception("%s 전략 평가 중 오류", symbol)
            continue
        if signal is None:
            continue
        if not allow_entries and signal.action is SignalAction.ENTER_LONG:
            suppressed += 1
            continue
        signals.append(signal)

    return SignalBatch(signals=signals, suppressed_entries=suppressed)


class TradingEngine:
    def __init__(
        self,
        broker: Broker,
        strategy: Strategy,
        risk: RiskManager,
        store: Store,
        settings: Settings,
        stops: StopManager | None = None,
        notifier: Notifier | None = None,
        regime: RegimeFilter | None = None,
    ) -> None:
        self.broker = broker
        self.strategy = strategy
        self.risk = risk
        self.store = store
        self.settings = settings
        self.notifier = notifier or NullNotifier()
        self.stops = stops or StopManager(
            store,
            stop_loss_pct=settings.stop_loss_pct,
            trailing_stop_pct=settings.trailing_stop_pct,
            take_profit_pct=settings.take_profit_pct,
            max_holding_days=settings.max_holding_days,
            cooldown_days=settings.stop_cooldown_days,
        )
        self.regime = regime or RegimeFilter(
            settings.regime_symbol,
            settings.regime_ma_bars,
            enabled=settings.regime_enabled,
        )
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
        # 신호가 없는 날에도 매 사이클 호출해야 당일 기준선이 장 시작 시점
        # 평가액으로 잡힌다. 첫 신호가 뜰 때까지 미루면 기준선이 그날 중간
        # 어딘가로 잡혀 일일 손실 한도가 헐거워진다.
        baseline = self.risk.day_baseline(equity, moment)
        self._notify_daily_loss(equity, baseline, moment)
        self._notify_daily_summary(equity, baseline, moment)

        state = self.regime.evaluate(self._regime_candles())
        if not state.risk_on:
            log.info("시장 국면 위험 — 신규 진입 차단 (%s)", state.reason)
        self._notify_regime(state, moment)

        batch = collect_signals(
            list(candles),
            self.strategy,
            self.stops,
            account.positions,
            marks,
            candles,
            moment,
            allow_entries=state.risk_on,
        )
        if batch.suppressed_entries:
            log.info("국면 필터가 진입 신호 %d건을 걷어냈습니다", batch.suppressed_entries)

        executed: list[Order] = []
        for signal in batch.signals:
            order = self._act(signal, account, marks, moment)
            if order is not None:
                executed.append(order)
                # 체결로 현금·포지션이 바뀌었으므로 다음 신호 심사 전에 갱신.
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

    def _regime_candles(self) -> list[Candle] | None:
        """국면 판정용 지수 캔들. 매매 대상이 아니라 데이터로만 쓴다."""
        if not self.regime.enabled:
            return None
        try:
            return self.broker.get_candles(
                self.regime.symbol,
                self.settings.candle_interval,
                self.regime.warmup_bars + CANDLE_BUFFER,
            )
        except BrokerError as exc:
            # fail-open: 조회 실패로 매수를 막으면 봇이 멈춘 이유가 드러나지 않는다.
            log.warning("%s 지수 캔들 조회 실패: %s", self.regime.symbol, exc)
            return None

    def _exec_price(self, signal: Signal) -> Decimal | None:
        """주문이 실제로 체결될 가격. 사이징 기준을 종가가 아닌 현재 호가로 잡는다.

        신호가 났을 때만 호출되므로 시세 한도를 크게 먹지 않는다. 조회에 실패하면
        None을 돌려 리스크 계층이 종가로 폴백하게 둔다 — 사이징이 조금 어긋나는
        편이 매매를 통째로 거르는 것보다 낫다.
        """
        try:
            quote = self.broker.get_quote(signal.symbol)
        except BrokerError as exc:
            log.warning("%s 호가 조회 실패, 종가로 사이징합니다: %s", signal.symbol, exc)
            return None
        return quote.ask if signal.action is SignalAction.ENTER_LONG else quote.bid

    def _act(
        self,
        signal: Signal,
        account,
        marks: dict[str, Decimal],
        moment: datetime,
    ) -> Order | None:
        if signal.action is SignalAction.ENTER_LONG and self.stops.is_blocked(
            signal.symbol, moment
        ):
            log.info("신호 기각 %s ENTER_LONG — 보호 청산 쿨다운 중", signal.symbol)
            return None

        decision = self.risk.evaluate(
            signal, account, marks, moment, exec_price=self._exec_price(signal)
        )
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
            order = self.broker.place_order(request)
        except OrderRejected as exc:
            log.error("주문 거부: %s", exc)
            self._notify_order_problem("주문 거부", signal, exc)
            return None
        except BrokerError as exc:
            log.error("주문 실패: %s", exc)
            self._notify_order_problem("주문 실패", signal, exc)
            return None

        if signal.action is SignalAction.EXIT:
            self.stops.on_exit(signal.symbol, moment, protective=signal.protective)
        self._notify_fill(order, signal)
        return order

    # --- 알림 ---------------------------------------------------------------

    def _notify_fill(self, order: Order, signal: Signal) -> None:
        if not self.settings.notify_fills:
            return
        kind = "보호 청산" if signal.protective else signal.action.value
        notional = order.avg_fill_price * order.filled_quantity
        self.notifier.notify(
            Notification(
                title=f"{order.symbol} {order.side.value} {order.filled_quantity}주 체결",
                lines=[
                    f"체결가 {order.avg_fill_price:,.2f} USD (총 {notional:,.2f})",
                    f"사유 [{kind}] {signal.reason}",
                    f"모드 {'실주문' if self.broker.is_live else '페이퍼'}",
                ],
                level=Level.WARN if signal.protective else Level.INFO,
            )
        )

    def _notify_order_problem(self, title: str, signal: Signal, exc: Exception) -> None:
        self.notifier.notify(
            Notification(
                title=f"{title}: {signal.symbol}",
                lines=[str(exc)],
                level=Level.ERROR,
                # 같은 종목의 같은 문제가 매 사이클 반복되는 걸 막는다.
                dedup_key=f"order-problem:{signal.symbol}:{title}",
            )
        )

    def _notify_regime(self, state, moment: datetime) -> None:
        """국면이 바뀔 때만 알린다.

        매 사이클 보내면 하루 종일 같은 메시지가 쌓인다. 전환은 드물게 일어나고
        일어날 때는 반드시 알아야 하는 사건이라 SQLite에 직전 상태를 남긴다.
        """
        if not self.regime.enabled:
            return
        previous = self.store.get_state("regime.risk_on")
        if previous is not None and previous == state.risk_on:
            return
        self.store.set_state("regime.risk_on", state.risk_on)
        if previous is None:
            return  # 첫 관측은 전환이 아니다

        self.notifier.notify(
            Notification(
                title=(
                    "시장 국면 → 위험 (신규 진입 차단)"
                    if not state.risk_on
                    else "시장 국면 → 정상 (신규 진입 재개)"
                ),
                lines=[state.reason, "보유 포지션 청산은 국면과 무관하게 계속됩니다."],
                level=Level.WARN if not state.risk_on else Level.INFO,
            )
        )

    def _notify_daily_loss(
        self, equity: Decimal, baseline: Decimal, moment: datetime
    ) -> None:
        """일일 손실 한도 도달을 하루 한 번만 알린다.

        한도는 한번 걸리면 그날 내내 유지되는 조건이라 스로틀(기본 5분)로는
        온종일 알림이 반복된다. 전송 여부를 날짜와 함께 SQLite에 남겨서 하루
        한 번을 보장하고, 재시작해도 중복되지 않게 한다.
        """
        if baseline <= 0 or equity >= baseline:
            return
        drawdown = (baseline - equity) / baseline
        if drawdown < self.settings.max_daily_loss_pct:
            return

        today = to_ny(moment).date().isoformat()
        if self.store.get_state("notify.daily_loss_date") == today:
            return
        self.store.set_state("notify.daily_loss_date", today)

        self.notifier.notify(
            Notification(
                title="일일 손실 한도 도달 — 신규 진입 차단",
                lines=[
                    f"평가액 {equity:,.2f} / 기준 {baseline:,.2f} ({-drawdown * 100:.2f}%)",
                    f"한도 {self.settings.max_daily_loss_pct * 100:.2f}%",
                    "보유 포지션 청산은 계속 허용됩니다.",
                ],
                level=Level.WARN,
            )
        )

    def _notify_daily_summary(
        self, equity: Decimal, baseline: Decimal, moment: datetime
    ) -> None:
        """폐장 직전에 하루를 정리해 보낸다.

        시세가 있어야 하므로 장중(폐장 5분 전)에 보낸다. 폴링 주기가 1분이면
        기회가 다섯 번 있으므로 한 사이클을 놓쳐도 괜찮다. 전송 여부를 날짜와
        함께 SQLite에 남겨 하루 한 번을 보장한다 — 재시작해도 중복되지 않는다.
        """
        if not self.settings.notify_daily_summary:
            return
        remaining = minutes_to_close(moment)
        if remaining is None or remaining > 5:
            return

        today = to_ny(moment).date().isoformat()
        if self.store.get_state("notify.summary_date") == today:
            return

        change = (equity - baseline) / baseline * 100 if baseline > 0 else Decimal("0")
        positions = self.broker.get_positions()
        holdings = (
            [f"{p.symbol} {p.quantity}주 @ {p.avg_price:,.2f}" for p in positions.values()]
            if positions
            else ["보유 없음"]
        )

        self.store.set_state("notify.summary_date", today)
        self.notifier.notify(
            Notification(
                title=f"{today} 장 마감 요약",
                lines=[
                    f"평가액 {equity:,.2f} USD ({change:+.2f}%)",
                    *holdings,
                ],
                level=Level.INFO,
            )
        )

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
        startup = [
            f"전략 {self.strategy.name} (SMA {self.settings.sma_fast}/{self.settings.sma_slow})",
            f"종목 {', '.join(self.settings.symbols)}",
            f"손절 {self._protection_line()}",
        ]
        # 키 만료는 시작할 때 알려야 의미가 있다. 만료되고 나면 토큰 발급부터
        # 실패해서 봇이 통째로 멈추고, 그때는 이미 늦다.
        expiry = self.settings.key_expiry_warning()
        if expiry:
            startup.append(f"⚠ {expiry}")
            log.warning(expiry)
        self.notifier.notify(
            Notification(
                title=f"봇 시작 [{mode}]",
                lines=startup,
                level=Level.WARN if expiry else Level.INFO,
            )
        )

        failures = 0
        while not self._stopped:
            try:
                self.run_once()
                failures = 0
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                # 한 사이클 실패로 봇이 죽으면 안 된다. 다음 주기에 재시도.
                failures += 1
                log.exception("사이클 실패 — 다음 주기에 재시도합니다")
                self.notifier.notify(
                    Notification(
                        title=f"사이클 실패 ({failures}회 연속)",
                        lines=[f"{type(exc).__name__}: {exc}", "다음 주기에 재시도합니다."],
                        level=Level.ERROR,
                        dedup_key="cycle-failure",
                    )
                )
            sleep(self.settings.poll_seconds)

        log.info("엔진 종료")
        self.notifier.notify(Notification(title="봇 종료", level=Level.WARN))

    def _protection_line(self) -> str:
        s = self.settings
        if s.stop_loss_pct <= 0:
            return "없음 (!)"
        parts = [f"{float(s.stop_loss_pct) * 100:g}%"]
        if s.trailing_stop_pct > 0:
            parts.append(f"트레일링 {float(s.trailing_stop_pct) * 100:g}%")
        return " / ".join(parts)
