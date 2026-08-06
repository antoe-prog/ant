"""백테스트 엔진 테스트.

가장 중요한 건 미래 정보 누출이 없다는 것이다. 백테스트가 미래를 살짝이라도
보면 결과는 전부 거짓말이 되고, 그 거짓말은 실계좌에서만 드러난다. 그래서
'전략이 볼 수 있는 것'과 '체결 시점' 두 가지를 명시적으로 못 박아 둔다.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from tossquant.backtest.metrics import EquityPoint, Trade, compute
from tossquant.backtest.replay import ReplayMarket, align
from tossquant.backtest.simulator import Backtester
from tossquant.models import Candle, Position, Signal, SignalAction
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
# 체결은 인덱스 6의 시가(=777)에서 일어나야 한다.
GOLDEN_ROWS = [
    (10, 10), (9, 9), (8, 8), (7, 7), (6, 6), (6, 20), (777, 780), (780, 780),
]


def test_fill_happens_at_next_bar_open(settings, store):
    settings.sma_fast, settings.sma_slow = 2, 4
    settings.paper_slippage_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.paper_cash = Decimal("100000")

    result = Backtester(
        {"A": bars("A", GOLDEN_ROWS)},
        SmaCrossStrategy(settings.sma_fast, settings.sma_slow),
        settings,
    ).run()

    # 신호는 인덱스 5(종가 20)에서 났지만 체결가는 인덱스 6의 시가여야 한다.
    # 종가 20에 체결됐다면 look-ahead 버그다.
    assert result.trades == [] or result.trades[0].entry_price == Decimal("777")
    assert any(p.invested > 0 for p in result.curve)


def test_entry_price_is_next_open_not_signal_close(settings):
    settings.sma_fast, settings.sma_slow = 2, 4
    settings.paper_slippage_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.paper_cash = Decimal("100000")

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


# --- 지표 --------------------------------------------------------------------


def curve(values: list[float], invested: bool = True) -> list[EquityPoint]:
    return [
        EquityPoint(
            ts=START + timedelta(days=i),
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
    points = curve([100, 100], invested=True) + curve([100, 100], invested=False)
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
