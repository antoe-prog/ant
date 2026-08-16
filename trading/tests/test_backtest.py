"""백테스트 엔진 테스트.

가장 중요한 건 미래 정보 누출이 없다는 것이다. 백테스트가 미래를 살짝이라도
보면 결과는 전부 거짓말이 되고, 그 거짓말은 실계좌에서만 드러난다. 그래서
'전략이 볼 수 있는 것'과 '체결 시점' 두 가지를 명시적으로 못 박아 둔다.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from io import StringIO

import pytest
from rich.console import Console

from tossquant.backtest.metrics import EquityPoint, Trade, compute
from tossquant.backtest.replay import ReplayMarket, align
from tossquant.backtest.report import render
from tossquant.backtest.simulator import Backtester, _BuyAndHold
from tossquant.broker.base import OrderRejected
from tossquant.broker.paper import PaperBroker
from tossquant.models import (
    Candle,
    Order,
    OrderStatus,
    Position,
    Side,
    Signal,
    SignalAction,
)
from tossquant.stops import StopManager
from tossquant.strategy.base import Strategy
from tossquant.strategy.sma_cross import SmaCrossStrategy

START = datetime(2026, 1, 5, tzinfo=timezone.utc)


def bars(symbol: str, rows: list[tuple[float, float]], step_days: int = 1) -> list[Candle]:
    """(시가, 종가) 쌍으로 캔들을 만든다."""
    return [
        Candle(
            symbol=symbol,
            ts=START + timedelta(days=i * step_days),
            open=Decimal(str(o)),
            high=Decimal(str(max(o, c))),
            low=Decimal(str(min(o, c))),
            close=Decimal(str(c)),
            volume=1000,
        )
        for i, (o, c) in enumerate(rows)
    ]


def flat_bars(symbol: str, closes: list[float]) -> list[Candle]:
    return bars(symbol, [(c, c) for c in closes])


# --- align ------------------------------------------------------------------


def test_align_keeps_common_timestamps_only():
    a = flat_bars("A", [1, 2, 3, 4])
    b = flat_bars("B", [1, 2, 3, 4])[1:]  # 첫 봉 없음

    aligned = align({"A": a, "B": b})

    assert len(aligned["A"]) == len(aligned["B"]) == 3
    assert [c.ts for c in aligned["A"]] == [c.ts for c in aligned["B"]]


def test_align_of_empty_history():
    assert align({}) == {}


# --- ReplayMarket -----------------------------------------------------------


def test_replay_never_reveals_future_bars():
    market = ReplayMarket({"A": flat_bars("A", [1, 2, 3, 4, 5])})

    for index in range(market.length):
        market.seek(index)
        visible = market.get_candles("A", "1d", 100)
        assert len(visible) == index + 1
        assert visible[-1].close == Decimal(str(index + 1))


def test_replay_quote_is_next_bar_open():
    market = ReplayMarket(
        {"A": bars("A", [(10, 11), (20, 21), (30, 31)])},
        spread_bps=Decimal("0"),
    )
    market.seek(0)

    quote = market.get_quote("A")

    assert quote.last == Decimal("20")  # 1번 봉 시가
    assert quote.ts == market.next_timestamp()


def test_replay_quote_on_last_bar_falls_back_to_close():
    market = ReplayMarket(
        {"A": bars("A", [(10, 11), (20, 21)])}, spread_bps=Decimal("0")
    )
    market.seek(1)

    assert not market.has_next()
    assert market.get_quote("A").last == Decimal("21")


def test_replay_applies_spread():
    market = ReplayMarket(
        {"A": bars("A", [(10, 10), (100, 100)])}, spread_bps=Decimal("100")  # 1%
    )
    market.seek(0)
    quote = market.get_quote("A")

    assert quote.ask == Decimal("100.5")
    assert quote.bid == Decimal("99.5")


@pytest.mark.parametrize("spread", [Decimal("20000"), Decimal("NaN")])
def test_replay_rejects_spread_that_cannot_produce_positive_quotes(spread):
    with pytest.raises(ValueError, match="spread"):
        ReplayMarket({"A": flat_bars("A", [100, 100])}, spread_bps=spread)


def test_replay_rejects_too_short_history():
    with pytest.raises(ValueError, match="2개 미만"):
        ReplayMarket({"A": flat_bars("A", [1])})


def test_replay_rejects_empty_history():
    with pytest.raises(ValueError, match="캔들이 없습니다"):
        ReplayMarket({})


def test_replay_seek_out_of_range():
    market = ReplayMarket({"A": flat_bars("A", [1, 2, 3])})
    with pytest.raises(IndexError):
        market.seek(3)


# --- 체결 시점 ---------------------------------------------------------------


# fast=2, slow=4 → warmup 5. 인덱스 5의 종가에서 골든크로스가 발생하고,
# 체결은 인덱스 6의 시가(=777)에서 일어나야 한다. 신호 종가 700과는 다르지만
# 1주가 고정 예산 1,000 안에 드는 평범한 갭이라 체결될 수 있다.
GOLDEN_ROWS = [
    (10, 10), (9, 9), (8, 8), (7, 7), (6, 6), (6, 700), (777, 780), (780, 780),
]


def test_fill_happens_at_next_bar_open(settings, store):
    settings.sma_fast, settings.sma_slow = 2, 4
    settings.paper_slippage_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.paper_cash = Decimal("100000")
    # 신호 종가 700에서 1주로 정해져 다음 시가 777도 고정 예산 안이다.
    settings.max_order_notional = Decimal("1000")

    result = Backtester(
        {"A": bars("A", GOLDEN_ROWS)},
        SmaCrossStrategy(settings.sma_fast, settings.sma_slow),
        settings,
    ).run()

    # 신호는 인덱스 5(종가 700)에서 났지만 체결가는 인덱스 6의 시가여야 한다.
    # 종가 700에 체결됐다면 체결 시점 버그다.
    assert result.trades == [] or result.trades[0].entry_price == Decimal("777")
    assert any(p.invested > 0 for p in result.curve)


def test_entry_price_is_next_open_not_signal_close(settings):
    settings.sma_fast, settings.sma_slow = 2, 4
    settings.paper_slippage_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.paper_cash = Decimal("100000")
    settings.max_order_notional = Decimal("1000")

    market_history = {"A": bars("A", GOLDEN_ROWS)}
    backtester = Backtester(
        market_history, SmaCrossStrategy(2, 4), settings
    )
    result = backtester.run()

    # 포지션이 실제로 잡혔고, 그 취득 단가가 777이어야 한다.
    invested_points = [p for p in result.curve if p.invested > 0]
    assert invested_points, "매수가 일어나지 않았습니다"
    # 체결 후 첫 평가 시점의 보유 가치는 780(그 봉 종가) 기준
    assert invested_points[0].invested % Decimal("780") == 0


def test_entry_quantity_does_not_use_unseen_next_open(monkeypatch, settings):
    """다음 시가가 달라도 신호 봉에서 제출하는 수량은 같아야 한다."""

    class EnterOnFirstVisibleBar(Strategy):
        name = "enter_first"

        @property
        def warmup_bars(self) -> int:
            return 1

        def on_bar(self, symbol, candles, position) -> Signal | None:
            if len(candles) == 1 and position is None:
                return Signal(
                    symbol, SignalAction.ENTER_LONG, "enter", candles[-1].close
                )
            return None

    preflighted: list[int] = []
    original_estimate = PaperBroker.estimate_cash_required

    def capture_preflight(self, request, quote=None):
        # 결정 시점 수량 조정은 current quote를 명시해 호출하고, next-open 배치
        # preflight만 quote를 생략한다.
        if quote is None:
            preflighted.append(request.quantity)
        return original_estimate(self, request, quote)

    monkeypatch.setattr(PaperBroker, "estimate_cash_required", capture_preflight)
    settings.paper_cash = Decimal("1000")
    settings.max_position_pct = Decimal("1")
    settings.max_order_notional = Decimal("10000")
    settings.paper_slippage_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")

    for future_open in (Decimal("50"), Decimal("200")):
        rows = [
            (Decimal("100"), Decimal("100")),
            (future_open, Decimal("100")),
            (Decimal("100"), Decimal("100")),
        ]
        Backtester(
            {"A": bars("A", rows)}, EnterOnFirstVisibleBar(), settings
        ).run()

    assert preflighted == [9, 9]


def test_unaffordable_next_open_gap_is_counted_as_broker_rejection(settings):
    class EnterOnFirstVisibleBar(Strategy):
        name = "enter_first"

        @property
        def warmup_bars(self) -> int:
            return 1

        def on_bar(self, symbol, candles, position) -> Signal | None:
            if len(candles) == 1 and position is None:
                return Signal(
                    symbol, SignalAction.ENTER_LONG, "enter", candles[-1].close
                )
            return None

    settings.paper_cash = Decimal("1000")
    settings.max_position_pct = Decimal("1")
    settings.max_order_notional = Decimal("10000")
    settings.paper_slippage_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")
    rows = [
        (Decimal("100"), Decimal("100")),
        (Decimal("200"), Decimal("200")),
        (Decimal("200"), Decimal("200")),
    ]

    result = Backtester(
        {"A": bars("A", rows)}, EnterOnFirstVisibleBar(), settings
    ).run()

    assert not any(point.invested > 0 for point in result.curve)
    assert any(key.startswith("broker:need ") for key in result.rejections)


class PeekingStrategy(Strategy):
    """전략이 볼 수 있는 캔들 범위를 기록만 하는 감시용 전략."""

    name = "peeking"

    def __init__(self) -> None:
        self.seen: list[Decimal] = []

    @property
    def warmup_bars(self) -> int:
        return 2

    def on_bar(self, symbol, candles, position) -> Signal | None:
        self.seen.append(candles[-1].close)
        return None


def test_strategy_only_ever_sees_past_and_current_bar(settings):
    closes = [1, 2, 3, 4, 5, 6]
    strategy = PeekingStrategy()
    settings.paper_cash = Decimal("1000")

    Backtester({"A": flat_bars("A", closes)}, strategy, settings).run()

    # warmup=2 → 인덱스 1부터, 마지막 봉은 체결 불가라 신호를 묻지 않는다.
    assert strategy.seen == [Decimal(str(c)) for c in closes[1:-1]]


# --- 시뮬레이터 --------------------------------------------------------------


def test_insufficient_history_raises(settings):
    settings.paper_cash = Decimal("10000")
    with pytest.raises(ValueError, match="캔들이 부족"):
        Backtester({"A": flat_bars("A", [1, 2, 3])}, SmaCrossStrategy(3, 5), settings).run()


def test_no_signal_means_no_trades(settings):
    settings.paper_cash = Decimal("10000")
    result = Backtester(
        {"A": flat_bars("A", [20] * 30)}, SmaCrossStrategy(3, 5), settings
    ).run()

    assert result.trades == []
    assert result.metrics.total_return == 0.0
    assert result.metrics.exposure == 0.0


def test_rejections_are_counted(settings):
    """자본이 1주 값에도 못 미치면 기각 사유가 집계돼야 한다."""
    settings.sma_fast, settings.sma_slow = 2, 4
    settings.paper_cash = Decimal("1")  # 777달러짜리 주식을 살 수 없다

    result = Backtester(
        {"A": bars("A", GOLDEN_ROWS)}, SmaCrossStrategy(2, 4), settings
    ).run()

    assert result.trades == []
    assert result.rejections["budget_below_one_share"] >= 1


def test_round_trip_trade_is_recorded(settings):
    settings.sma_fast, settings.sma_slow = 2, 4
    settings.paper_slippage_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.paper_cash = Decimal("100000")
    settings.max_order_notional = Decimal("1000")

    # 골든크로스로 진입 후 급락시켜 데드크로스로 청산시킨다.
    rows = GOLDEN_ROWS + [(780, 780), (780, 1), (1, 1), (1, 1)]
    result = Backtester({"A": bars("A", rows)}, SmaCrossStrategy(2, 4), settings).run()

    assert len(result.trades) == 1
    trade = result.trades[0]
    assert trade.symbol == "A"
    assert trade.entry_price == Decimal("777")
    assert trade.exit_price == Decimal("1")
    assert trade.pnl < 0
    assert not trade.is_win
    assert trade.bars_held > 0


def test_commission_is_deducted_from_trade_pnl(settings):
    settings.sma_fast, settings.sma_slow = 2, 4
    settings.paper_slippage_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")
    settings.paper_cash = Decimal("100000")
    settings.max_order_notional = Decimal("1000")

    rows = GOLDEN_ROWS + [(780, 780), (780, 1), (1, 1), (1, 1)]
    history = {"A": bars("A", rows)}

    settings.paper_commission_bps = Decimal("0")
    free = Backtester(history, SmaCrossStrategy(2, 4), settings).run()

    settings.paper_commission_bps = Decimal("50")
    costly = Backtester(history, SmaCrossStrategy(2, 4), settings).run()

    assert costly.trades[0].pnl < free.trades[0].pnl


def test_benchmark_starts_from_same_cash(settings):
    settings.paper_cash = Decimal("10000")
    result = Backtester(
        {"A": flat_bars("A", [20] * 30)}, SmaCrossStrategy(3, 5), settings
    ).run()

    assert result.benchmark_curve[0].equity == Decimal("10000")
    assert result.benchmark_curve[0].invested == 0  # 첫 봉엔 아직 미체결


def test_benchmark_tracks_price(settings):
    settings.paper_cash = Decimal("10000")
    settings.backtest_spread_bps = Decimal("0")
    # 워밍업 이후 가격이 2배가 되면 벤치마크도 대략 2배가 되어야 한다.
    closes = [100] * 10 + [200] * 10
    result = Backtester(
        {"A": flat_bars("A", closes)}, SmaCrossStrategy(3, 5), settings
    ).run()

    assert result.benchmark_metrics.total_return > 0.9


def test_benchmark_share_decision_does_not_use_unseen_next_open():
    decided: list[int] = []
    for future_open in (Decimal("50"), Decimal("80")):
        market = ReplayMarket(
            {
                "A": bars(
                    "A",
                    [
                        (Decimal("100"), Decimal("100")),
                        (future_open, Decimal("100")),
                    ],
                )
            },
            spread_bps=Decimal("0"),
        )
        benchmark = _BuyAndHold(Decimal("1000"))
        benchmark.observe(market, is_first=True)
        decided.append(benchmark.shares["A"])

    # 전략과 같은 1% 현금 버퍼를 적용하되, 미래 시가에 따라 수량을 바꾸지 않는다.
    assert decided == [9, 9]


def test_benchmark_rejects_fixed_quantity_when_next_open_is_unaffordable():
    market = ReplayMarket(
        {
            "A": bars(
                "A",
                [
                    (Decimal("100"), Decimal("100")),
                    (Decimal("200"), Decimal("200")),
                ],
            )
        },
        spread_bps=Decimal("0"),
    )
    benchmark = _BuyAndHold(Decimal("1000"))

    benchmark.observe(market, is_first=True)

    assert benchmark.shares == {}
    assert benchmark.cash == Decimal("1000")


def test_benchmark_symbol_budget_keeps_stable_holding_independent_of_order():
    runs: list[dict[str, int]] = []
    for gap_symbol in ("A", "Z"):
        gap_rows = bars(
            gap_symbol,
            [(100, 100), (Decimal("225"), 100)],
        )
        stable_rows = bars("B", [(100, 100), (100, 100)])
        history = (
            {gap_symbol: gap_rows, "B": stable_rows}
            if gap_symbol == "A"
            else {"B": stable_rows, gap_symbol: gap_rows}
        )
        market = ReplayMarket(
            history,
            spread_bps=Decimal("0"),
        )
        benchmark = _BuyAndHold(Decimal("1000"))

        benchmark.observe(market, is_first=True)
        runs.append(dict(benchmark.shares))

    assert runs == [{"B": 4}, {"B": 4}]


def test_benchmark_sizes_with_decision_ask_so_unchanged_open_fits_allocation():
    market = ReplayMarket(
        {"A": bars("A", [(99, 99), (99, 99)])},
        spread_bps=Decimal("210"),
    )
    benchmark = _BuyAndHold(Decimal("1000"))

    benchmark.observe(market, is_first=True)

    # 현재 close로 10주를 잡으면 ask 비용이 배정액을 넘어 전량 거부된다.
    assert benchmark.shares == {"A": 9}


def test_benchmark_rejects_empty_tradable_universe():
    market = ReplayMarket(
        {"SPY": bars("SPY", [(100, 100), (100, 100)])},
        data_only=frozenset({"SPY"}),
    )

    with pytest.raises(ValueError, match="매매 대상|tradable|symbol"):
        _BuyAndHold(Decimal("1000")).observe(market, is_first=True)


def test_multi_symbol_backtest_runs(settings):
    settings.paper_cash = Decimal("100000")
    result = Backtester(
        {
            "A": flat_bars("A", [10, 9, 8, 7, 6, 5, 4, 30, 30, 30, 30, 30]),
            "B": flat_bars("B", [50, 49, 48, 47, 46, 45, 44, 90, 90, 90, 90, 90]),
        },
        SmaCrossStrategy(2, 4),
        settings,
    ).run()

    assert set(result.symbols) == {"A", "B"}
    assert len(result.curve) > 1


class EnterEverySymbolOnFirstBar(Strategy):
    name = "enter_every_symbol_first"

    @property
    def warmup_bars(self) -> int:
        return 1

    def on_bar(self, symbol, candles, position) -> Signal | None:
        if len(candles) == 1 and position is None:
            return Signal(symbol, SignalAction.ENTER_LONG, "enter", candles[-1].close)
        return None


class NeverSignal(Strategy):
    name = "never_signal"

    @property
    def warmup_bars(self) -> int:
        return 1

    def on_bar(self, symbol, candles, position) -> Signal | None:
        return None


def test_no_rejections_leave_counter_and_rendered_table_empty(settings):
    settings.max_daily_loss_pct = Decimal("0")
    settings.stop_loss_pct = Decimal("0")
    result = Backtester(
        {"A": bars("A", [(100, 100)] * 3)},
        NeverSignal(),
        settings,
    ).run()

    assert not result.rejections
    assert "regime_risk_off" not in result.rejections
    output = StringIO()
    render(
        result,
        Console(file=output, force_terminal=False, width=120),
        show_trades=0,
    )
    assert "신호 기각 사유" not in output.getvalue()


def test_backtester_rejects_regime_only_history_without_tradable_symbols(settings):
    settings.regime_enabled = True
    settings.regime_symbol = "SPY"
    settings.regime_ma_bars = 1
    settings.max_daily_loss_pct = Decimal("0")

    with pytest.raises(ValueError, match="매매 대상|tradable|symbol"):
        Backtester(
            {"SPY": bars("SPY", [(100, 100)] * 3)},
            NeverSignal(),
            settings,
        )


class RotateFromAToB(Strategy):
    name = "rotate_a_to_b"

    @property
    def warmup_bars(self) -> int:
        return 1

    def on_bar(self, symbol, candles, position) -> Signal | None:
        if len(candles) == 1 and symbol == "A" and position is None:
            return Signal(symbol, SignalAction.ENTER_LONG, "enter A", candles[-1].close)
        if len(candles) == 2 and symbol == "A" and position is not None:
            return Signal(symbol, SignalAction.EXIT, "exit A", candles[-1].close)
        if len(candles) == 2 and symbol == "B" and position is None:
            return Signal(symbol, SignalAction.ENTER_LONG, "enter B", candles[-1].close)
        return None


class RotateFromXIntoEveryOtherSymbol(Strategy):
    name = "rotate_x_into_every_other_symbol"

    @property
    def warmup_bars(self) -> int:
        return 1

    def on_bar(self, symbol, candles, position) -> Signal | None:
        if len(candles) == 1 and symbol == "X" and position is None:
            return Signal(symbol, SignalAction.ENTER_LONG, "seed X", candles[-1].close)
        if len(candles) == 2 and symbol == "X" and position is not None:
            return Signal(symbol, SignalAction.EXIT, "exit X", candles[-1].close)
        if len(candles) == 2 and symbol != "X" and position is None:
            return Signal(symbol, SignalAction.ENTER_LONG, "rotate", candles[-1].close)
        return None


class EnterAThenBOnLossDay(Strategy):
    name = "enter_a_then_b_on_loss_day"

    @property
    def warmup_bars(self) -> int:
        return 1

    def on_bar(self, symbol, candles, position) -> Signal | None:
        if len(candles) == 1 and symbol == "A" and position is None:
            return Signal(symbol, SignalAction.ENTER_LONG, "seed A", candles[-1].close)
        if len(candles) == 2 and symbol == "B" and position is None:
            return Signal(symbol, SignalAction.ENTER_LONG, "enter B", candles[-1].close)
        return None


def test_daily_loss_baseline_uses_session_open_equity_before_new_fills(
    monkeypatch, settings
):
    original = PaperBroker.place_order
    submitted: list[str] = []

    def capture(self, request, *, cash_envelope=None):
        submitted.append(request.symbol)
        return original(self, request, cash_envelope=cash_envelope)

    monkeypatch.setattr(PaperBroker, "place_order", capture)
    settings.paper_cash = Decimal("1000")
    settings.max_position_pct = Decimal("1")
    settings.max_positions = 2
    settings.max_order_notional = Decimal("10000")
    settings.max_daily_loss_pct = Decimal("0.03")
    settings.paper_slippage_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")

    result = Backtester(
        {
            "A": bars("A", [(100, 100), (100, 80), (80, 80)]),
            "B": bars("B", [(10, 10), (10, 10), (10, 10)]),
        },
        EnterAThenBOnLossDay(),
        settings,
    ).run()

    assert submitted == ["A"]
    assert result.rejections["daily_loss_limit"] == 1
    assert result.curve[1].equity == Decimal("820")


def test_daily_loss_fails_closed_when_one_day_interval_has_ambiguous_sessions(
    settings,
):
    settings.candle_interval = "1d"
    same_session = [
        Candle(
            symbol="A",
            ts=START + timedelta(hours=index),
            open=Decimal("100"),
            high=Decimal("100"),
            low=Decimal("100"),
            close=Decimal("100"),
            volume=1000,
        )
        for index in range(3)
    ]

    with pytest.raises(ValueError, match="1d.*세션|세션.*1d"):
        Backtester(
            {"A": same_session},
            EnterEverySymbolOnFirstBar(),
            settings,
        ).run()


def test_daily_loss_rejects_weekly_cadence_mislabeled_as_one_day(settings):
    settings.candle_interval = "1d"
    settings.max_daily_loss_pct = Decimal("0.03")
    weekly = bars(
        "A",
        [(100, 100), (100, 100), (100, 100)],
        step_days=7,
    )

    with pytest.raises(ValueError, match="1d|일봉|간격|주기"):
        Backtester(
            {"A": weekly},
            EnterEverySymbolOnFirstBar(),
            settings,
        )


def test_daily_loss_accepts_four_day_weekend_or_holiday_gap(settings):
    settings.candle_interval = "1d"
    settings.max_daily_loss_pct = Decimal("0.03")
    long_weekends = bars(
        "A",
        [(100, 100), (100, 100), (100, 100)],
        step_days=4,
    )

    result = Backtester(
        {"A": long_weekends},
        EnterEverySymbolOnFirstBar(),
        settings,
    ).run()

    assert len(result.curve) == 3


def test_daily_loss_rejects_sparse_cadence_created_by_symbol_intersection(settings):
    settings.candle_interval = "1d"
    settings.max_daily_loss_pct = Decimal("0.03")
    a_source = bars("A", [(100, 100)] * 10)
    b_source = bars("B", [(100, 100)] * 10)
    # 각 원본은 5개 gap 중 4개가 1일이라 80% 정책을 통과한다. 하지만 실제
    # ReplayMarket 교집합은 day 0/day 9뿐이라 일봉 cadence가 아니다.
    history = {
        "A": [a_source[index] for index in (0, 1, 2, 3, 4, 9)],
        "B": [b_source[index] for index in (0, 5, 6, 7, 8, 9)],
    }

    with pytest.raises(ValueError, match="공통|정렬|1d|일봉|간격|주기"):
        Backtester(
            history,
            EnterEverySymbolOnFirstBar(),
            settings,
        )


def test_non_daily_backtest_explicitly_disables_daily_loss_without_session_open(
    caplog,
    settings,
):
    settings.candle_interval = "1h"
    settings.max_daily_loss_pct = Decimal("0.03")

    Backtester(
        {"A": bars("A", [(100, 100), (100, 100), (100, 100)])},
        EnterEverySymbolOnFirstBar(),
        settings,
    ).run()

    assert "일일 손실 한도" in caplog.text
    assert "비활성" in caplog.text


def test_small_gap_up_within_fixed_decision_budget_still_fills(settings):
    settings.paper_cash = Decimal("1000")
    settings.max_position_pct = Decimal("1")
    settings.max_positions = 1
    settings.max_order_notional = Decimal("1000")
    settings.paper_slippage_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")

    result = Backtester(
        {"A": bars("A", [(300, 300), (310, 310), (310, 310)])},
        EnterEverySymbolOnFirstBar(),
        settings,
    ).run()

    # 결정 예산은 990, 현재가 기준 3주다. 다음 시가 비용 930은 같은 예산 안이다.
    assert result.curve[1].invested == Decimal("930")


def test_known_current_costs_reduce_quantity_without_rejecting_flat_open(settings):
    settings.paper_cash = Decimal("1000")
    settings.max_position_pct = Decimal("1")
    settings.max_positions = 1
    settings.max_order_notional = Decimal("1000")
    settings.paper_slippage_bps = Decimal("100")
    settings.paper_commission_bps = Decimal("100")
    settings.backtest_spread_bps = Decimal("210")

    result = Backtester(
        {"A": bars("A", [(99, 99), (99, 99), (99, 99)])},
        EnterEverySymbolOnFirstBar(),
        settings,
    ).run()

    # close만 보면 10주지만 현재 ask+슬리피지+수수료로는 9주만 예산 990 안이다.
    assert result.curve[1].invested == Decimal("891")


def test_same_bar_rotation_reuses_only_decision_mark_exit_proceeds(
    monkeypatch, settings
):
    original = PaperBroker.place_order
    runs: list[list[tuple[str, Side, int]]] = []
    settings.paper_cash = Decimal("1000")
    settings.max_position_pct = Decimal("1")
    settings.max_positions = 1
    settings.max_order_notional = Decimal("10000")
    settings.paper_slippage_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")

    # 두 시가 모두 고정 9주를 살 실제 현금은 남긴다. 청산 갭으로 배치 총현금이
    # 부족한 경우는 아래 fail-closed 회귀에서 별도로 고정한다.
    for unseen_exit_open in (Decimal("100"), Decimal("200")):
        submitted: list[tuple[str, Side, int]] = []

        def capture(self, request, *, cash_envelope=None):
            submitted.append((request.symbol, request.side, request.quantity))
            return original(self, request, cash_envelope=cash_envelope)

        monkeypatch.setattr(PaperBroker, "place_order", capture)
        history = {
            "A": bars(
                "A",
                [
                    (100, 100),
                    (100, 100),
                    (unseen_exit_open, 100),
                    (100, 100),
                ],
            ),
            "B": bars("B", [(100, 100)] * 4),
        }
        Backtester(history, RotateFromAToB(), settings).run()
        runs.append(submitted)

    expected = [
        ("A", Side.BUY, 9),
        ("A", Side.SELL, 9),
        ("B", Side.BUY, 9),
    ]
    assert runs == [expected, expected]


def test_rotation_buy_batch_fails_closed_when_exit_gap_leaves_total_cash_short(
    monkeypatch, settings
):
    original = PaperBroker.place_order
    runs: list[tuple[list[tuple[str, Side, int]], int]] = []
    settings.paper_cash = Decimal("1000")
    settings.max_position_pct = Decimal("0.5")
    settings.max_positions = 2
    settings.max_order_notional = Decimal("10000")
    settings.max_daily_loss_pct = Decimal("0")
    settings.paper_slippage_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")
    settings.stop_loss_pct = Decimal("0")

    # X의 결정봉 평가는 1,000이지만 다음 시가 청산대금은 200뿐이다. A/B BUY는
    # 각각 700이라 하나씩은 현금 700에 들어가지만 둘을 합치면 1,400이다. 심볼
    # 이름 순서로 하나만 체결하면, 무관한 타 종목 A↔Z 변경이 B 보유를 바꾼다.
    for other_symbol in ("A", "Z"):
        filled: list[tuple[str, Side, int]] = []

        def capture(self, request, *, cash_envelope=None):
            order = original(self, request, cash_envelope=cash_envelope)
            if order.status is OrderStatus.FILLED:
                filled.append((order.symbol, order.side, order.filled_quantity))
            return order

        monkeypatch.setattr(PaperBroker, "place_order", capture)
        history = {
            "X": bars("X", [(50, 50), (50, 100), (20, 20), (20, 20)]),
            other_symbol: bars(other_symbol, [(100, 100)] * 4),
            "B": bars("B", [(100, 100)] * 4),
        }
        result = Backtester(
            history,
            RotateFromXIntoEveryOtherSymbol(),
            settings,
        ).run()
        runs.append((filled, result.rejections["batch_cash_shortfall"]))

    expected_fills = [
        ("X", Side.BUY, 10),
        ("X", Side.SELL, 10),
    ]
    assert runs == [(expected_fills, 2), (expected_fills, 2)]


def test_rotation_buy_batch_fails_closed_when_planned_exit_is_rejected(
    monkeypatch, settings
):
    original = PaperBroker.place_order
    filled: list[tuple[str, Side, int]] = []
    settings.paper_cash = Decimal("1000")
    settings.max_position_pct = Decimal("0.4")
    settings.max_positions = 1
    settings.max_order_notional = Decimal("10000")
    settings.max_daily_loss_pct = Decimal("0")
    settings.paper_slippage_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")
    settings.stop_loss_pct = Decimal("0")

    def reject_exit(self, request, *, cash_envelope=None):
        if request.side is Side.SELL:
            raise OrderRejected("forced exit rejection", request)
        order = original(self, request, cash_envelope=cash_envelope)
        if order.status is OrderStatus.FILLED:
            filled.append((order.symbol, order.side, order.filled_quantity))
        return order

    monkeypatch.setattr(PaperBroker, "place_order", reject_exit)
    result = Backtester(
        {
            "A": bars("A", [(100, 100)] * 4),
            "B": bars("B", [(100, 100)] * 4),
        },
        RotateFromAToB(),
        settings,
    ).run()

    assert filled == [("A", Side.BUY, 4)]
    assert result.curve[-1].cash == Decimal("600")
    assert result.curve[-1].invested == Decimal("400")
    assert result.rejections["batch_exit_dependency"] == 1


def test_same_bar_requests_are_frozen_before_any_unseen_open_fill(
    monkeypatch, settings
):
    original_estimate = PaperBroker.estimate_cash_required
    runs: list[list[tuple[str, int]]] = []
    settings.paper_cash = Decimal("1000")
    settings.max_position_pct = Decimal("0.4")
    settings.max_positions = 2
    settings.max_order_notional = Decimal("10000")
    settings.paper_slippage_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")

    for a_next_open in (Decimal("50"), Decimal("225")):
        preflighted: list[tuple[str, int]] = []

        def capture_preflight(self, request, quote=None):
            if quote is None:
                preflighted.append((request.symbol, request.quantity))
            return original_estimate(self, request, quote)

        monkeypatch.setattr(
            PaperBroker,
            "estimate_cash_required",
            capture_preflight,
        )
        history = {
            "A": bars("A", [(100, 100), (a_next_open, 100), (100, 100)]),
            "B": bars("B", [(100, 100), (100, 100), (100, 100)]),
        }
        Backtester(history, EnterEverySymbolOnFirstBar(), settings).run()
        runs.append(preflighted)

    expected = [("A", 4), ("B", 4)]
    assert runs == [expected, expected]


def test_same_bar_cash_envelopes_make_stable_fill_independent_of_symbol_order(
    monkeypatch, settings
):
    original = PaperBroker.place_order
    runs: list[list[tuple[str, int]]] = []
    settings.paper_cash = Decimal("1000")
    settings.max_position_pct = Decimal("0.4")
    settings.max_positions = 2
    settings.max_order_notional = Decimal("10000")
    settings.paper_slippage_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")

    # 첫 실행은 갭 종목 A가 B보다 먼저, 둘째는 Z가 B보다 나중에 체결된다.
    # A/Z의 다음 시가가 자기 예약액을 넘더라도 B의 예약 현금은 건드리면 안 된다.
    for gap_symbol, gap_open in (
        ("A", Decimal("50")),
        ("A", Decimal("225")),
        ("Z", Decimal("225")),
    ):
        filled: list[tuple[str, int]] = []

        def capture(self, request, *, cash_envelope=None):
            order = original(self, request, cash_envelope=cash_envelope)
            if order.status is OrderStatus.FILLED:
                filled.append((order.symbol, order.filled_quantity))
            return order

        monkeypatch.setattr(PaperBroker, "place_order", capture)
        history = {
            gap_symbol: bars(
                gap_symbol,
                [(100, 100), (gap_open, 100), (100, 100)],
            ),
            "B": bars("B", [(100, 100), (100, 100), (100, 100)]),
        }
        Backtester(history, EnterEverySymbolOnFirstBar(), settings).run()
        runs.append(filled)

    assert all(("B", 4) in filled for filled in runs)


def test_envelope_slack_preserves_shadow_equity_and_order_independence(
    monkeypatch, settings
):
    original = PaperBroker.place_order
    runs: list[tuple[list[tuple[str, int, Decimal]], int]] = []
    settings.paper_cash = Decimal("1000")
    settings.max_position_pct = Decimal("0.4")
    settings.max_positions = 2
    settings.max_order_notional = Decimal("10000")
    settings.max_daily_loss_pct = Decimal("0.03")
    settings.paper_slippage_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")

    for expensive_symbol in ("A", "Z"):
        submitted: list[tuple[str, int, Decimal]] = []

        def capture(self, request, *, cash_envelope=None):
            assert cash_envelope is not None
            submitted.append((request.symbol, request.quantity, cash_envelope))
            return original(self, request, cash_envelope=cash_envelope)

        monkeypatch.setattr(PaperBroker, "place_order", capture)
        history = {
            expensive_symbol: bars(expensive_symbol, [(300, 300)] * 3),
            "B": bars("B", [(100, 100)] * 3),
        }
        result = Backtester(
            history,
            EnterEverySymbolOnFirstBar(),
            settings,
        ).run()
        runs.append((submitted, result.rejections["daily_loss_limit"]))

    for submitted, fake_daily_loss_rejections in runs:
        quantities = {symbol: quantity for symbol, quantity, _ in submitted}
        assert quantities["B"] == 4
        assert quantities["A" if "A" in quantities else "Z"] == 1
        assert sum(envelope for _, _, envelope in submitted) <= Decimal("1000")
        assert fake_daily_loss_rejections == 0


def test_same_bar_request_plan_is_independent_of_history_mapping_order(
    monkeypatch, settings
):
    original = PaperBroker.place_order
    runs: list[list[tuple[str, int]]] = []
    settings.paper_cash = Decimal("1000")
    settings.max_position_pct = Decimal("0.4")
    settings.max_positions = 2
    settings.max_order_notional = Decimal("10000")
    settings.paper_slippage_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")
    rows = [(100, 100), (100, 100), (100, 100)]

    for symbols in (("A", "B"), ("B", "A")):
        submitted: list[tuple[str, int]] = []

        def capture(self, request, *, cash_envelope=None):
            submitted.append((request.symbol, request.quantity))
            return original(self, request, cash_envelope=cash_envelope)

        monkeypatch.setattr(PaperBroker, "place_order", capture)
        history = {symbol: bars(symbol, rows) for symbol in symbols}
        Backtester(history, EnterEverySymbolOnFirstBar(), settings).run()
        runs.append(submitted)

    assert runs == [[("A", 4), ("B", 4)], [("A", 4), ("B", 4)]]


# --- 보호 청산 연동 ----------------------------------------------------------


class AlwaysIn(Strategy):
    """비면 사고, 절대 스스로 팔지 않는다.

    보호 청산을 격리하기 위한 전략이다. SMA 크로스를 쓰면 급락 시 데드크로스가
    같은 봉에 발동해서 청산이 손절 때문인지 전략 때문인지 구분할 수 없다.
    이 전략은 청산 신호를 절대 내지 않으므로, 나가는 건 전부 보호 장치의 몫이다.
    """

    name = "always_in"

    @property
    def warmup_bars(self) -> int:
        return 2

    def on_bar(self, symbol, candles, position) -> Signal | None:
        if position is not None and position.quantity > 0:
            return None
        return Signal(symbol, SignalAction.ENTER_LONG, "always in", candles[-1].close)


def stop_settings(settings, **overrides):
    settings.paper_slippage_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.paper_cash = Decimal("100000")
    settings.max_position_pct = Decimal("1")
    settings.stop_loss_pct = Decimal("0")
    settings.trailing_stop_pct = Decimal("0")
    settings.take_profit_pct = Decimal("0")
    settings.max_holding_days = 0
    for key, value in overrides.items():
        setattr(settings, key, value)
    return settings


# 100에 진입 → 완만하게 하락. 손절 10%면 종가 88인 봉에서 발동한다.
DECLINE = [(100, 100), (100, 100), (100, 100), (100, 95), (95, 92), (92, 88),
           (88, 85), (85, 85), (85, 85), (85, 85)]


def run_decline(settings, **overrides):
    return Backtester(
        {"A": bars("A", DECLINE)}, AlwaysIn(), stop_settings(settings, **overrides)
    ).run()


def test_no_exit_at_all_without_protection(settings):
    """전략이 청산을 안 내면 손절 없이는 끝까지 물린다 — 이게 고치려는 문제다."""
    result = run_decline(settings)
    assert result.trades == []


def test_optional_end_liquidation_uses_final_next_open_and_closes_benchmark(
    settings,
):
    settings.paper_cash = Decimal("100000")
    settings.max_position_pct = Decimal("1")
    settings.max_order_notional = Decimal("100000")
    settings.max_daily_loss_pct = Decimal("0")
    settings.paper_slippage_bps = Decimal("100")
    settings.paper_commission_bps = Decimal("100")
    settings.backtest_spread_bps = Decimal("100")
    settings.stop_loss_pct = Decimal("0")
    rows = [
        (100, 100),
        (100, 100),
        (100, 100),
        (100, 200),
        (80, 500),
    ]

    raw = Backtester(
        {"A": bars("A", rows)}, AlwaysIn(), settings
    ).run()
    liquidated = Backtester(
        {"A": bars("A", rows)},
        AlwaysIn(),
        settings,
        liquidate_at_end=True,
    ).run()

    assert raw.curve[-1].invested > 0
    assert raw.trades == []
    assert raw.benchmark_curve[-1].invested > 0

    assert liquidated.curve[-1].invested == 0
    assert liquidated.curve[-1].cash == liquidated.curve[-1].equity
    assert len(liquidated.trades) == 1
    # 끝에서 두 번째 종가 200이나 마지막 종가 500이 아니라 마지막 시가 80의
    # bid와 매도 슬리피지로 체결돼야 한다.
    assert liquidated.trades[0].exit_price == Decimal("78.80")
    assert liquidated.trades[0].exit_ts == bars("A", rows)[-1].ts
    assert liquidated.benchmark_curve[-1].invested == 0
    assert (
        liquidated.benchmark_curve[-1].cash
        == liquidated.benchmark_curve[-1].equity
    )
    assert liquidated.benchmark_curve[-1].cash == Decimal("79413.5")


def test_end_liquidation_blocks_a_new_penultimate_entry(settings):
    class EnterOnlyOnPenultimateBar(Strategy):
        name = "enter_only_on_penultimate"

        @property
        def warmup_bars(self) -> int:
            return 1

        def on_bar(self, symbol, candles, position) -> Signal | None:
            if len(candles) == 4 and position is None:
                return Signal(
                    symbol,
                    SignalAction.ENTER_LONG,
                    "late entry",
                    candles[-1].close,
                )
            return None

    settings.paper_cash = Decimal("1000")
    settings.max_position_pct = Decimal("1")
    settings.max_order_notional = Decimal("1000")
    settings.max_daily_loss_pct = Decimal("0")
    settings.paper_slippage_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")
    rows = [(100, 100)] * 5

    raw = Backtester(
        {"A": bars("A", rows)},
        EnterOnlyOnPenultimateBar(),
        settings,
    ).run()
    liquidated = Backtester(
        {"A": bars("A", rows)},
        EnterOnlyOnPenultimateBar(),
        settings,
        liquidate_at_end=True,
    ).run()

    assert raw.curve[-1].invested > 0
    assert liquidated.curve[-1].invested == 0
    assert liquidated.trades == []


def test_stop_loss_exits_when_strategy_never_would(settings):
    result = run_decline(settings, stop_loss_pct=Decimal("0.10"))

    assert len(result.trades) == 1
    trade = result.trades[0]
    assert trade.entry_price == Decimal("100")
    # 종가 88 <= 90(손절선)인 봉에서 발동 → 다음 봉 시가 88에 체결
    assert trade.exit_price == Decimal("88")
    assert not trade.is_win


def test_stop_loss_reduces_drawdown_and_preserves_capital(settings):
    without = run_decline(settings)
    with_stop = run_decline(settings, stop_loss_pct=Decimal("0.10"))

    assert with_stop.metrics.max_drawdown < without.metrics.max_drawdown
    assert with_stop.metrics.end_equity > without.metrics.end_equity


def test_stop_loss_silent_when_decline_stays_within_band(settings):
    result = run_decline(settings, stop_loss_pct=Decimal("0.30"))
    assert result.trades == []


def test_trailing_stop_locks_in_gains(settings):
    # 100에 진입 → 150까지 상승 → 반락
    rows = [(100, 100), (100, 100), (100, 120), (120, 150), (150, 134),
            (134, 130), (130, 130)]
    result = Backtester(
        {"A": bars("A", rows)},
        AlwaysIn(),
        stop_settings(settings, trailing_stop_pct=Decimal("0.10")),
    ).run()

    assert len(result.trades) == 1
    trade = result.trades[0]
    # 고점 150의 -10%는 135. 종가 134인 봉에서 발동 → 다음 봉 시가 134에 체결
    assert trade.exit_price == Decimal("134")
    assert trade.is_win  # 진입 100 대비로는 여전히 이익


def test_take_profit_exits_on_the_way_up(settings):
    rows = [(100, 100), (100, 100), (100, 110), (110, 125), (125, 130), (130, 130)]
    result = Backtester(
        {"A": bars("A", rows)},
        AlwaysIn(),
        stop_settings(settings, take_profit_pct=Decimal("0.20")),
    ).run()

    assert result.trades[0].exit_price == Decimal("125")
    assert result.trades[0].is_win


def test_max_holding_days_forces_exit(settings):
    rows = [(100, 100)] * 10
    result = Backtester(
        {"A": bars("A", rows)}, AlwaysIn(), stop_settings(settings, max_holding_days=3)
    ).run()

    assert len(result.trades) >= 1
    assert result.trades[0].bars_held <= 5


def test_cooldown_blocks_immediate_reentry(settings):
    """AlwaysIn은 비면 바로 다시 사려 하므로 쿨다운이 없으면 무한 재진입한다."""
    blocked = run_decline(settings, stop_loss_pct=Decimal("0.10"), stop_cooldown_days=30)
    unblocked = run_decline(settings, stop_loss_pct=Decimal("0.10"), stop_cooldown_days=0)

    assert blocked.rejections["stop_cooldown"] >= 1
    # 쿨다운이 없으면 손절당한 자리에서 곧바로 다시 들어가 있다.
    assert unblocked.curve[-1].invested > 0
    assert blocked.curve[-1].invested == 0


def test_protective_cooldown_starts_at_actual_exit_fill(monkeypatch, settings):
    anchors: list[datetime] = []
    original = StopManager.on_exit

    def capture(self, symbol, now, *, protective):
        anchors.append(now)
        return original(self, symbol, now, protective=protective)

    monkeypatch.setattr(StopManager, "on_exit", capture)

    result = run_decline(
        settings,
        stop_loss_pct=Decimal("0.10"),
        stop_cooldown_days=3,
    )

    assert anchors == [result.trades[0].exit_ts]


def test_unfilled_protective_exit_does_not_start_cooldown(monkeypatch, settings):
    original_place_order = PaperBroker.place_order
    cooldown_calls: list[datetime] = []

    def leave_sells_unfilled(self, request, *, cash_envelope=None):
        if request.side is Side.SELL:
            return Order(
                order_id="paper-unfilled-exit",
                client_order_id=request.client_order_id,
                symbol=request.symbol,
                side=request.side,
                quantity=request.quantity,
                filled_quantity=0,
                avg_fill_price=Decimal("0"),
                status=OrderStatus.NEW,
                ts=datetime.now(timezone.utc),
            )
        return original_place_order(
            self,
            request,
            cash_envelope=cash_envelope,
        )

    def capture_cooldown(self, symbol, now, *, protective):
        cooldown_calls.append(now)

    monkeypatch.setattr(PaperBroker, "place_order", leave_sells_unfilled)
    monkeypatch.setattr(StopManager, "on_exit", capture_cooldown)

    result = run_decline(
        settings,
        stop_loss_pct=Decimal("0.10"),
        stop_cooldown_days=3,
    )

    assert result.trades == []
    assert cooldown_calls == []


# --- 지표 --------------------------------------------------------------------


def curve(
    values: list[float],
    invested: bool = True,
    *,
    start_day: int = 0,
) -> list[EquityPoint]:
    return [
        EquityPoint(
            ts=START + timedelta(days=start_day + i),
            equity=Decimal(str(v)),
            cash=Decimal("0") if invested else Decimal(str(v)),
            invested=Decimal(str(v)) if invested else Decimal("0"),
        )
        for i, v in enumerate(values)
    ]


def test_total_return():
    metrics = compute(curve([100, 110, 120]))
    assert metrics.total_return == pytest.approx(0.2)


def test_max_drawdown():
    # 100 → 150 → 75 : 고점 150에서 50% 하락
    metrics = compute(curve([100, 150, 75, 120]))
    assert metrics.max_drawdown == pytest.approx(0.5)


def test_drawdown_duration_counts_bars_below_peak():
    metrics = compute(curve([100, 200, 150, 150, 150, 300]))
    assert metrics.max_drawdown_bars == 3


def test_flat_curve_has_no_risk_metrics():
    metrics = compute(curve([100] * 10))
    assert metrics.total_return == 0.0
    assert metrics.max_drawdown == 0.0
    assert metrics.volatility == 0.0
    assert metrics.sharpe == 0.0


def test_exposure_reflects_time_in_market():
    points = curve([100, 100], invested=True) + curve(
        [100, 100], invested=False, start_day=2
    )
    metrics = compute(points)
    assert metrics.exposure == pytest.approx(0.5)


def test_cagr_annualizes():
    # 1년 동안 정확히 2배
    points = [
        EquityPoint(START, Decimal("100"), Decimal("0"), Decimal("100")),
        EquityPoint(
            START + timedelta(days=365.25), Decimal("200"), Decimal("0"), Decimal("200")
        ),
    ]
    assert compute(points).cagr == pytest.approx(1.0, abs=0.01)


def test_trade_statistics():
    trades = [
        Trade("A", START, START, 1, Decimal("100"), Decimal("110"), Decimal("10"), 1),
        Trade("A", START, START, 1, Decimal("100"), Decimal("110"), Decimal("30"), 1),
        Trade("A", START, START, 1, Decimal("100"), Decimal("80"), Decimal("-20"), 1),
    ]
    metrics = compute(curve([100, 120]), trades)

    assert metrics.trades == 3
    assert metrics.win_rate == pytest.approx(2 / 3)
    assert metrics.avg_win == Decimal("20")
    assert metrics.avg_loss == Decimal("-20")
    assert metrics.profit_factor == pytest.approx(2.0)


def test_trade_return_pct():
    trade = Trade("A", START, START, 2, Decimal("100"), Decimal("110"), Decimal("20"), 1)
    assert trade.return_pct == pytest.approx(0.1)
    assert trade.is_win


def test_compute_needs_two_points():
    with pytest.raises(ValueError, match="최소 2개"):
        compute(curve([100]))
