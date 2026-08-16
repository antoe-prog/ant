"""백테스트 시뮬레이터.

실시간 엔진과 전략·리스크 규칙은 공유하지만 체결 시점과 주문 생명주기는 다르다.
백테스트는 PaperBroker와 다음 봉 시가, 결정 시점 예약 장부를 쓰는 근사치다.
실거래는 TossClient의 실제 호가·주문 상태를 따르므로 두 결과는 어긋날 수 있다.

한 봉의 처리 순서:
  1. 현재 봉 종가로 평가액 기록
  2. 전략에 현재 봉까지의 캔들을 넘겨 신호를 받음
  3. 리스크 계층이 수량 결정
  4. **다음 봉 시가**에 체결

마지막 봉에서는 체결할 다음 봉이 없으므로 주문을 내지 않는다.
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from ..broker.base import OrderRejected
from ..broker.paper import PaperBroker
from ..calendar_us import to_ny
from ..config import Settings
from ..engine import collect_signals
from ..models import (
    Account,
    Candle,
    Order,
    OrderRequest,
    OrderStatus,
    OrderType,
    Position,
    Side,
    Signal,
    SignalAction,
)
from ..regime import RegimeFilter
from ..risk import CASH_BUFFER, RiskManager
from ..stops import StopManager
from ..store import Store
from ..strategy.base import Strategy
from .corporate import (
    MAX_ORDINARY_DAILY_GAP_DAYS,
    MIN_ORDINARY_DAILY_GAP_DENOMINATOR,
    MIN_ORDINARY_DAILY_GAP_NUMERATOR,
)
from .metrics import EquityPoint, Metrics, Trade, compute
from .replay import ReplayMarket

log = logging.getLogger(__name__)

CANDLE_LOOKBACK_SLACK = 20


def _validate_daily_cadence(label: str, session_dates: list[date]) -> None:
    """corporate-action 검증과 같은 1~4일/80% 일봉 cadence 증거."""
    gaps = [
        (current - previous).days
        for previous, current in zip(session_dates, session_dates[1:])
    ]
    ordinary = sum(
        1 <= gap <= MAX_ORDINARY_DAILY_GAP_DAYS for gap in gaps
    )
    if gaps and (
        ordinary * MIN_ORDINARY_DAILY_GAP_DENOMINATOR
        < len(gaps) * MIN_ORDINARY_DAILY_GAP_NUMERATOR
    ):
        raise ValueError(
            f"{label}: 1d 일일 손실 기준에 필요한 일봉 주기 증거가 "
            f"부족합니다 (1~{MAX_ORDINARY_DAILY_GAP_DAYS}일 간격 "
            f"{ordinary}/{len(gaps)})"
        )


def _validate_daily_session_inputs(history: dict[str, list[Candle]]) -> None:
    """원본과 실제 공통 timeline이 세션 시가 기준선을 증명하는지 검증한다."""
    common_stamps: set[datetime] | None = None
    for symbol, candles in history.items():
        sessions: set[date] = set()
        session_dates: list[date] = []
        stamps: set[datetime] = set()
        for candle in candles:
            if candle.ts.tzinfo is None or candle.ts.utcoffset() is None:
                raise ValueError(
                    f"{symbol}: 1d 일일 손실 기준에는 timezone-aware 시각이 필요합니다"
                )
            if (
                not isinstance(candle.open, Decimal)
                or not candle.open.is_finite()
                or candle.open <= 0
            ):
                raise ValueError(
                    f"{symbol}: 1d 세션 시가는 유한한 양수여야 합니다"
                )
            session = to_ny(candle.ts).date()
            if session in sessions:
                raise ValueError(
                    f"{symbol}: 1d인데 NY 세션 {session}에 봉이 여러 개라 "
                    "일일 손실 기준선을 정할 수 없습니다"
                )
            sessions.add(session)
            session_dates.append(session)
            stamps.add(candle.ts)

        # 파일명이나 설정의 ``1d`` 문자열만으로 실제 일봉임을 주장하지 않는다.
        # 검증된 corporate-action 조정과 같은 cadence 증거를 요구해, 주봉을 1d로
        # 잘못 붙인 입력에서 일일 손실 보호가 켜졌다고 조용히 표시하지 않는다.
        _validate_daily_cadence(symbol, sorted(session_dates))
        common_stamps = (
            stamps if common_stamps is None else common_stamps & stamps
        )

    # ReplayMarket은 exact timestamp 교집합만 사용한다. 각 원본이 80%를 통과해도
    # 서로 다른 결측일이 겹치면 실제 평가 timeline은 주봉처럼 희소해질 수 있다.
    if common_stamps is not None:
        common_sessions = [to_ny(ts).date() for ts in sorted(common_stamps)]
        _validate_daily_cadence("정렬 후 공통 timeline", common_sessions)


@dataclass
class BacktestResult:
    strategy_name: str
    symbols: list[str]
    interval: str
    curve: list[EquityPoint]
    trades: list[Trade]
    metrics: Metrics
    benchmark_curve: list[EquityPoint]
    benchmark_metrics: Metrics
    rejections: Counter[str]
    # 어떤 보호 장치를 켜고 돌렸는지. 여러 설정을 비교할 때 결과만 보고
    # 조건을 되짚을 수 있어야 한다.
    protection: list[str] = field(default_factory=list)

    @property
    def excess_return(self) -> float:
        """벤치마크 대비 초과 수익률. 이게 음수면 전략을 쓸 이유가 없다."""
        return self.metrics.total_return - self.benchmark_metrics.total_return


@dataclass
class _Lot:
    """보유 중인 포지션의 진입 정보. 라운드트립 손익 계산용."""

    entry_ts: datetime
    entry_bar: int
    quantity: int
    price: Decimal
    commission: Decimal

    def merge(self, quantity: int, price: Decimal, commission: Decimal) -> None:
        total = self.quantity + quantity
        self.price = (self.price * self.quantity + price * quantity) / total
        self.quantity = total
        self.commission += commission


class Backtester:
    def __init__(
        self,
        history: dict[str, list[Candle]],
        strategy: Strategy,
        settings: Settings,
        regime: RegimeFilter | None = None,
        *,
        liquidate_at_end: bool = False,
    ) -> None:
        self._daily_loss_pct = settings.max_daily_loss_pct
        if self._daily_loss_pct > 0:
            if settings.candle_interval.lower() == "1d":
                _validate_daily_session_inputs(history)
            else:
                log.warning(
                    "백테스트 일일 손실 한도 비활성 — %s 데이터는 실제 세션 "
                    "시작 봉의 완전성을 확인할 수 없습니다",
                    settings.candle_interval,
                )
                self._daily_loss_pct = Decimal("0")
        self.regime = regime or RegimeFilter(
            settings.regime_symbol,
            settings.regime_ma_bars,
            enabled=settings.regime_enabled,
        )
        # 지수는 정렬에 참여시키되 매매 대상에서는 뺀다. 같은 커서를 타야
        # 지수도 미래를 보지 못한다.
        data_only = (
            frozenset({self.regime.symbol})
            if self.regime.enabled and self.regime.symbol in history
            else frozenset()
        )
        if self.regime.enabled and not data_only:
            log.warning(
                "국면 필터가 켜져 있지만 %s 캔들이 없습니다 — 신규 진입을 차단합니다",
                self.regime.symbol,
            )
        self.market = ReplayMarket(
            history, spread_bps=settings.backtest_spread_bps, data_only=data_only
        )
        if not self.market.symbols:
            raise ValueError("백테스트할 매매 대상 없음")
        self.strategy = strategy
        self.settings = settings
        self.liquidate_at_end = liquidate_at_end

    def run(self) -> BacktestResult:
        warmup = self.strategy.warmup_bars
        # 국면 필터가 켜져 있으면 지수 이동평균도 채워져야 한다. 전략 워밍업만
        # 보면 앞부분이 '필터가 판단 불가라 통과'로 흘러가 필터 효과가
        # 과소평가된다 — 200일선을 쓰는데 전략이 60봉이면 140봉이 무필터다.
        effective_warmup = warmup
        if self.regime.enabled and self.regime.symbol in self.market.all_symbols:
            effective_warmup = max(warmup, self.regime.warmup_bars)

        first_bar = effective_warmup - 1
        if first_bar >= self.market.length - 1:
            raise ValueError(
                f"캔들이 부족합니다: {self.market.length}개 수신, "
                f"워밍업에 {effective_warmup}개 + 체결용 1개가 필요합니다"
                + (
                    f" (전략 {warmup}, 국면 필터 {self.regime.warmup_bars})"
                    if effective_warmup != warmup
                    else ""
                )
            )

        # 인메모리 SQLite — 백테스트가 실거래 상태 파일을 건드리지 않게 한다.
        store = Store(":memory:")
        broker = PaperBroker(self.market, store, self.settings)
        risk = RiskManager(
            store,
            max_position_pct=self.settings.max_position_pct,
            max_positions=self.settings.max_positions,
            max_daily_loss_pct=self._daily_loss_pct,
            max_order_notional=self.settings.max_order_notional,
        )
        stops = StopManager(
            store,
            stop_loss_pct=self.settings.stop_loss_pct,
            trailing_stop_pct=self.settings.trailing_stop_pct,
            take_profit_pct=self.settings.take_profit_pct,
            max_holding_days=self.settings.max_holding_days,
            cooldown_days=self.settings.stop_cooldown_days,
        )

        curve: list[EquityPoint] = []
        trades: list[Trade] = []
        lots: dict[str, _Lot] = {}
        rejections: Counter[str] = Counter()
        benchmark = _BuyAndHold(self.settings.paper_cash)

        for index in range(first_bar, self.market.length):
            self.market.seek(index)
            ts = self.market.timestamp()
            marks = self.market.marks()

            account = broker.get_account()
            equity = account.equity(marks)
            if self._daily_loss_pct > 0:
                # 첫 평가 세션은 아직 주문이 없으므로 현재 시가로 기준선을 잡는다.
                # 이후 세션은 직전 루프가 주문 체결 전에 미리 고정해 두며, 이 호출은
                # 같은 날짜의 저장값을 반환할 뿐 손실 난 종가로 덮어쓰지 않는다.
                session_open_equity = account.equity(self.market.open_marks())
                risk.day_baseline(session_open_equity, ts)
            curve.append(
                EquityPoint(
                    ts=ts, equity=equity, cash=account.cash, invested=equity - account.cash
                )
            )
            end_liquidation_bar = (
                self.liquidate_at_end and index == self.market.length - 2
            )
            benchmark.observe(
                self.market,
                index == first_bar,
                liquidate_at_end=end_liquidation_bar,
            )

            if not self.market.has_next():
                break  # 체결할 다음 봉이 없다

            candles = {
                symbol: self.market.get_candles(
                    symbol, self.settings.candle_interval, warmup + CANDLE_LOOKBACK_SLACK
                )
                for symbol in self.market.symbols
            }
            state = self.regime.evaluate(
                self.market.get_candles(
                    self.regime.symbol,
                    self.settings.candle_interval,
                    self.regime.warmup_bars + CANDLE_LOOKBACK_SLACK,
                )
                if self.regime.enabled and self.regime.symbol in self.market.all_symbols
                else None
            )
            if end_liquidation_bar:
                # 독립 워크포워드 fold의 마지막 상태를 다음 fold의 새 현금과
                # 이어붙이려면 묵시적 무료 청산이 없어야 한다. 끝에서 두 번째
                # 종가에서 전량 청산을 결정해 마지막 봉 시가에 체결하고, 이 봉의
                # 신규 진입은 아예 평가하지 않는다.
                signals = [
                    Signal(
                        symbol=symbol,
                        action=SignalAction.EXIT,
                        reason="구간 종료 강제 청산",
                        ref_price=marks[symbol],
                    )
                    for symbol, position in account.positions.items()
                    if position.quantity > 0
                ]
            else:
                batch = collect_signals(
                    self.market.symbols,
                    self.strategy,
                    stops,
                    account.positions,
                    marks,
                    candles,
                    ts,
                    allow_entries=state.risk_on,
                )
                signals = batch.signals
                if batch.suppressed_entries > 0:
                    code = "regime_unknown" if not state.known else "regime_risk_off"
                    rejections[code] += batch.suppressed_entries

            # 같은 봉의 모든 주문 수량을 먼저 고정한다. 첫 종목을 다음 시가에
            # 체결한 뒤 갱신된 현금으로 두 번째 종목을 사이징하면, 첫 종목의 아직
            # 보이지 않은 다음 시가가 두 번째 주문을 바꾸는 교차종목 look-ahead다.
            # 심볼 순서를 정규화한다. shadow는 현재 종가 기준 경제적 계좌라 예약
            # 때문에 평가액이 사라지지 않고, available_cash만 요청별 envelope를
            # 차감해 뒤 주문이 이미 예약한 현금을 다시 쓰지 못하게 한다.
            planned: list[tuple[Signal, OrderRequest, int, Decimal | None]] = []
            shadow = Account(cash=account.cash, positions=dict(account.positions))
            available_cash = account.cash
            ordered_signals = sorted(
                signals,
                key=lambda item: (
                    0 if item.action is SignalAction.EXIT else 1,
                    item.symbol,
                ),
            )
            for signal in ordered_signals:
                symbol = signal.symbol
                if signal.action is SignalAction.ENTER_LONG and stops.is_blocked(
                    symbol, ts
                ):
                    rejections["stop_cooldown"] += 1
                    continue

                # 주문 예산은 신호 시점의 계좌·현재 봉 종가로 고정한다. 알려진 현재
                # 스프레드·슬리피지·수수료만 반영해 그 예산 안의 정수 수량으로 낮추고,
                # 다음 봉 시가를 미리 보고 수량이나 예산을 다시 맞추지는 않는다.
                decision = risk.evaluate(
                    signal,
                    shadow,
                    marks,
                    ts,
                    exec_price=marks.get(symbol),
                    available_cash=available_cash,
                )
                if not decision.approved:
                    rejections[decision.code] += 1
                    continue

                side = (
                    Side.BUY
                    if signal.action is SignalAction.ENTER_LONG
                    else Side.SELL
                )
                request = OrderRequest(
                    symbol=symbol,
                    side=side,
                    quantity=decision.quantity,
                    order_type=OrderType.MARKET,
                )
                if signal.action is SignalAction.ENTER_LONG:
                    reserve_price = marks[symbol]
                    cash_envelope = decision.cash_budget
                    assert cash_envelope is not None
                    try:
                        fitted_quantity = broker.max_affordable_quantity(
                            request,
                            cash_envelope,
                            self.market.current_quote(symbol),
                        )
                    except OrderRejected as exc:
                        rejections[f"broker:{exc.reason.split(',')[0]}"] += 1
                        continue
                    if fitted_quantity < 1:
                        rejections["budget_below_one_share"] += 1
                        continue
                    if fitted_quantity != request.quantity:
                        request = OrderRequest(
                            symbol=request.symbol,
                            side=request.side,
                            quantity=fitted_quantity,
                            order_type=request.order_type,
                            client_order_id=request.client_order_id,
                        )
                    positions = dict(shadow.positions)
                    positions[symbol] = Position(
                        symbol=symbol,
                        quantity=request.quantity,
                        avg_price=reserve_price,
                    )
                    shadow = Account(
                        cash=(
                            shadow.cash
                            - reserve_price * request.quantity
                        ),
                        positions=positions,
                    )
                    available_cash -= cash_envelope
                else:
                    cash_envelope = None
                    position = shadow.positions.get(symbol)
                    if position is not None:
                        remaining = position.quantity - decision.quantity
                        positions = dict(shadow.positions)
                        if remaining > 0:
                            positions[symbol] = Position(
                                symbol=symbol,
                                quantity=remaining,
                                avg_price=position.avg_price,
                            )
                        else:
                            positions.pop(symbol, None)
                        # 같은 봉 회전은 미래 체결값이 아니라 결정 봉 종가만으로
                        # 슬롯과 예상 매도대금을 푼다. 실제 다음 시가가 부족하면
                        # 뒤 BUY가 브로커에서 자연스럽게 거부된다.
                        shadow = Account(
                            cash=(
                                shadow.cash
                                + marks[symbol] * decision.quantity
                            ),
                            positions=positions,
                        )
                        available_cash += marks[symbol] * decision.quantity

                planned.append(
                    (signal, request, request.quantity, cash_envelope)
                )

            if self._daily_loss_pct > 0:
                # 다음 세션 시가로 기존 보유분을 평가해, 신규 주문을 체결하기 전
                # 기준선을 고정한다. 체결 비용과 이후 종가 손익은 이 값과 비교된다.
                next_open_equity = account.equity(self.market.next_open_marks())
                risk.day_baseline(next_open_equity, self.market.next_timestamp())

            # 결정 배치를 완성한 뒤에만 다음 시가로 체결한다. 청산은 먼저 실제로
            # 반영하되, 매수는 하나씩 체결하면서 남은 현금을 먼저 온 심볼이 차지하게
            # 두지 않는다. 모든 매수의 고정 수량을 순수 preflight하고 총액이 실제
            # 현금을 넘으면 배치 전체를 거부한다.
            exits = [item for item in planned if item[0].action is SignalAction.EXIT]
            buys = [
                item for item in planned
                if item[0].action is SignalAction.ENTER_LONG
            ]

            for signal, request, requested_quantity, _ in exits:
                symbol = signal.symbol
                try:
                    order = broker.place_order(request)
                except OrderRejected as exc:
                    rejections[f"broker:{exc.reason.split(',')[0]}"] += 1
                    continue

                self._record(order, store, lots, trades, index + 1)
                if (
                    signal.action is SignalAction.EXIT
                    and order.status is OrderStatus.FILLED
                    and order.filled_quantity >= requested_quantity
                ):
                    # 청산 신호 봉이 아니라 실제 다음-시가 체결 시점부터 쿨다운을
                    # 센다. 거부·미체결·부분체결은 포지션이 남으므로 시작하지 않는다.
                    stops.on_exit(
                        symbol,
                        self.market.next_timestamp(),
                        protective=signal.protective,
                    )

            post_exit_account = broker.get_account()
            planned_exit_symbols = {item[0].symbol for item in exits}
            exit_dependency_failed = any(
                symbol in planned_exit_symbols and position.quantity > 0
                for symbol, position in post_exit_account.positions.items()
            )

            eligible_buys: list[
                tuple[Signal, OrderRequest, int, Decimal, Decimal]
            ] = []
            for signal, request, requested_quantity, cash_envelope in buys:
                assert cash_envelope is not None
                try:
                    needed = broker.estimate_cash_required(request)
                except OrderRejected as exc:
                    rejections[f"broker:{exc.reason.split(',')[0]}"] += 1
                    continue
                if needed > cash_envelope:
                    rejections[
                        f"broker:need {needed:.2f} USD but only "
                        f"{cash_envelope:.2f} available"
                    ] += 1
                    continue
                eligible_buys.append(
                    (
                        signal,
                        request,
                        requested_quantity,
                        cash_envelope,
                        needed,
                    )
                )

            total_needed = sum(
                (item[4] for item in eligible_buys), Decimal("0")
            )
            actual_position_symbols = {
                symbol
                for symbol, position in post_exit_account.positions.items()
                if position.quantity > 0
            }
            planned_buy_symbols = {item[1].symbol for item in eligible_buys}
            position_limit_breached = (
                len(actual_position_symbols | planned_buy_symbols)
                > self.settings.max_positions
            )
            if eligible_buys and (
                exit_dependency_failed or position_limit_breached
            ):
                # shadow가 EXIT 성공을 가정해 풀었던 슬롯이 실제로는 남아 있으면
                # 심볼 순서대로 일부 BUY만 실행하지 않는다. 고정된 BUY 배치 전체를
                # fail-closed해 hard max_positions를 보존한다.
                rejections["batch_exit_dependency"] += len(eligible_buys)
                eligible_buys = []
            elif total_needed > post_exit_account.cash:
                rejections["batch_cash_shortfall"] += len(eligible_buys)
                eligible_buys = []

            for signal, request, _, cash_envelope, _ in eligible_buys:
                try:
                    order = broker.place_order(
                        request,
                        cash_envelope=cash_envelope,
                    )
                except OrderRejected as exc:
                    rejections[f"broker:{exc.reason.split(',')[0]}"] += 1
                    continue
                self._record(order, store, lots, trades, index + 1)

        if self.liquidate_at_end:
            remaining = {
                symbol: position.quantity
                for symbol, position in broker.get_positions().items()
                if position.quantity > 0
            }
            if remaining:
                store.close()
                raise ValueError(
                    "구간 종료 강제 청산 뒤 포지션이 남았습니다: "
                    + ", ".join(
                        f"{symbol} {quantity}주"
                        for symbol, quantity in sorted(remaining.items())
                    )
                )

        store.close()

        if len(curve) < 2:
            raise ValueError("평가 구간이 너무 짧아 지표를 계산할 수 없습니다")

        benchmark_curve = benchmark.curve
        return BacktestResult(
            strategy_name=self.strategy.name,
            symbols=self.market.symbols,
            interval=self.settings.candle_interval,
            curve=curve,
            trades=trades,
            metrics=compute(curve, trades),
            benchmark_curve=benchmark_curve,
            benchmark_metrics=compute(benchmark_curve),
            rejections=rejections,
            protection=self._protection_summary(),
        )

    def _protection_summary(self) -> list[str]:
        """켜져 있는 보호 장치 목록. 여러 설정을 비교할 때 조건을 되짚기 위한 것."""
        s = self.settings
        active: list[str] = []
        if s.stop_loss_pct > 0:
            active.append(f"손절 {float(s.stop_loss_pct) * 100:g}%")
        if s.trailing_stop_pct > 0:
            active.append(f"트레일링 {float(s.trailing_stop_pct) * 100:g}%")
        if s.take_profit_pct > 0:
            active.append(f"익절 {float(s.take_profit_pct) * 100:g}%")
        if s.max_holding_days > 0:
            active.append(f"최대보유 {s.max_holding_days}일")
        if active and s.stop_cooldown_days > 0:
            active.append(f"쿨다운 {s.stop_cooldown_days}일")
        if s.regime_enabled:
            active.append(f"국면필터 {s.regime_symbol} {s.regime_ma_bars}일선")
        return active

    def _record(
        self,
        order: Order,
        store: Store,
        lots: dict[str, _Lot],
        trades: list[Trade],
        fill_bar: int,
    ) -> None:
        """체결을 라운드트립 장부에 반영한다."""
        commission = store.order_commission(order.order_id)
        fill_ts = self.market.next_timestamp()
        quantity = order.filled_quantity
        if quantity <= 0:
            return

        if order.side is Side.BUY:
            lot = lots.get(order.symbol)
            if lot is None:
                lots[order.symbol] = _Lot(
                    entry_ts=fill_ts,
                    entry_bar=fill_bar,
                    quantity=quantity,
                    price=order.avg_fill_price,
                    commission=commission,
                )
            else:
                lot.merge(quantity, order.avg_fill_price, commission)
            return

        lot = lots.get(order.symbol)
        if lot is None:
            log.warning("진입 기록 없는 매도: %s", order.symbol)
            return

        # 부분 청산이면 진입 수수료를 수량 비례로 배분한다.
        share = Decimal(quantity) / lot.quantity
        entry_commission = lot.commission * share
        gross = (order.avg_fill_price - lot.price) * quantity

        trades.append(
            Trade(
                symbol=order.symbol,
                entry_ts=lot.entry_ts,
                exit_ts=fill_ts,
                quantity=quantity,
                entry_price=lot.price,
                exit_price=order.avg_fill_price,
                pnl=gross - entry_commission - commission,
                bars_held=fill_bar - lot.entry_bar,
            )
        )

        remaining = lot.quantity - quantity
        if remaining <= 0:
            lots.pop(order.symbol, None)
        else:
            lot.quantity = remaining
            lot.commission -= entry_commission


class _BuyAndHold:
    """동일가중 바이앤홀드 벤치마크.

    전략과 같은 시점·같은 자본으로 시작해 끝까지 들고 간다. 전략이 이걸 못 이기면
    수수료와 복잡성만 더한 셈이다.
    """

    def __init__(self, cash: Decimal) -> None:
        self.start_cash = cash
        self.cash = cash
        self.shares: dict[str, int] = {}
        self.curve: list[EquityPoint] = []

    def observe(
        self,
        market: ReplayMarket,
        is_first: bool,
        *,
        liquidate_at_end: bool = False,
    ) -> None:
        symbols = market.symbols
        if not symbols:
            raise ValueError("바이앤홀드 매매 대상 없음")
        # 전략과 동일한 순서: 먼저 현재 보유 기준으로 평가액을 찍고, 매수는
        # 다음 봉 시가에 체결된다. 그래야 벤치마크가 한 봉 앞서지 않는다.
        invested = sum(
            (market.close_price(s) * q for s, q in self.shares.items()), Decimal("0")
        )
        self.curve.append(
            EquityPoint(
                ts=market.timestamp(),
                equity=self.cash + invested,
                cash=self.cash,
                invested=invested,
            )
        )

        if liquidate_at_end and market.has_next():
            proceeds = sum(
                (
                    market.get_quote(symbol).bid * quantity
                    for symbol, quantity in self.shares.items()
                ),
                Decimal("0"),
            )
            self.cash += proceeds
            self.shares.clear()
            return

        if is_first and market.has_next():
            # 전략 주문과 같은 현금 버퍼가 없으면 가격이 그대로여도 다음 시가의
            # 반스프레드만으로 전액 주문이 거부된다.
            allocation = self.start_cash / len(symbols)
            budget = allocation * CASH_BUFFER
            # 전략과 같은 정보 경계: 수량은 현재 봉의 모델링된 ask로 먼저 확정한다.
            # 다음 시가를 보고 예산에 딱 맞게 다시 줄이면 벤치마크도 미래를 본다.
            decisions: dict[str, int] = {}
            for symbol in symbols:
                current_ask = market.current_quote(symbol).ask
                decisions[symbol] = (
                    int(budget / current_ask) if current_ask > 0 else 0
                )
            for symbol, quantity in decisions.items():
                if quantity <= 0:
                    continue
                price = market.get_quote(symbol).ask  # 다음 봉 시가 + 반스프레드
                cost = price * quantity
                if price <= 0 or cost > allocation or cost > self.cash:
                    log.warning(
                        "벤치마크 주문 거부 %s BUY x%d — 필요 %s, "
                        "종목 배정 %s, 현금 %s",
                        symbol,
                        quantity,
                        cost,
                        allocation,
                        self.cash,
                    )
                    continue
                self.shares[symbol] = quantity
                self.cash -= cost
