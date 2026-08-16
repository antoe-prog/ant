"""시장 국면 필터 테스트.

가장 중요한 두 가지:
1. **청산은 절대 막지 않는다.** 하락장에서 못 빠져나오게 막으면 정확히 반대로
   가는 짓이다.
2. **판단 불가는 신규 진입을 막는다.** UNKNOWN을 위험/정상으로 꾸미지 않고
   알림으로 원인을 드러내며, 청산은 그대로 통과시킨다.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from tossquant.models import Candle, Position, Signal, SignalAction
from tossquant.regime import RegimeFilter
from tossquant.store import Store
from tossquant.stops import StopManager
from tossquant.engine import collect_signals
from tossquant.strategy.base import Strategy

START = datetime(2026, 1, 5, tzinfo=timezone.utc)


def index_bars(closes) -> list[Candle]:
    return [
        Candle("SPY", START + timedelta(days=i), Decimal(str(c)), Decimal(str(c)),
               Decimal(str(c)), Decimal(str(c)), 1000)
        for i, c in enumerate(closes)
    ]


# --- 판정 --------------------------------------------------------------------


def test_risk_on_above_the_average():
    state = RegimeFilter("SPY", 5).evaluate(index_bars([100, 100, 100, 100, 120]))
    assert state.known is True
    assert state.risk_on is True
    assert "SPY" in state.reason


def test_risk_off_below_the_average():
    assert RegimeFilter("SPY", 5).evaluate(index_bars([100] * 4 + [80])).risk_on is False


def test_equal_to_average_is_risk_off():
    """정확히 같으면 '위'가 아니다. 등호를 잘못 쓰면 횡보장에서 매일 뒤집힌다."""
    assert RegimeFilter("SPY", 4).evaluate(index_bars([100] * 4)).risk_on is False


def test_disabled_filter_always_allows():
    filter_ = RegimeFilter("SPY", 200, enabled=False)
    with_data = filter_.evaluate(index_bars([100] * 4 + [1]))
    without_data = filter_.evaluate(None)
    assert with_data.known is True and with_data.risk_on is True
    assert without_data.known is True and without_data.risk_on is True


def test_empty_symbol_disables_the_filter():
    assert RegimeFilter("", 200).enabled is False


def test_symbol_is_normalised():
    assert RegimeFilter("spy", 200).symbol == "SPY"


def test_rejects_nonpositive_window():
    with pytest.raises(ValueError):
        RegimeFilter("SPY", 0)


# --- UNKNOWN -----------------------------------------------------------------


def test_missing_candles_are_unknown_and_block_entries():
    state = RegimeFilter("SPY", 200).evaluate(None)
    assert state.known is False
    assert state.risk_on is False
    assert "데이터 없음" in state.reason


def test_insufficient_candles_are_unknown_and_block_entries():
    state = RegimeFilter("SPY", 200).evaluate(index_bars([100] * 10))
    assert state.known is False
    assert state.risk_on is False
    assert "부족" in state.reason


def test_warmup_matches_the_window():
    assert RegimeFilter("SPY", 200).warmup_bars == 200


# --- collect_signals 연동 ----------------------------------------------------


class AlwaysEnter(Strategy):
    name = "always_enter"

    @property
    def warmup_bars(self) -> int:
        return 1

    def on_bar(self, symbol, candles, position) -> Signal | None:
        if position is not None and position.quantity > 0:
            return Signal(symbol, SignalAction.EXIT, "always exit", Decimal("100"))
        return Signal(symbol, SignalAction.ENTER_LONG, "always enter", Decimal("100"))


@pytest.fixture
def quiet_stops(store: Store) -> StopManager:
    return StopManager(
        store,
        stop_loss_pct=Decimal("0"),
        trailing_stop_pct=Decimal("0"),
        take_profit_pct=Decimal("0"),
        max_holding_days=0,
        cooldown_days=0,
    )


def run_batch(stops, *, allow_entries, holding=False):
    positions = {"A": Position("A", 10, Decimal("100"))} if holding else {}
    return collect_signals(
        ["A"], AlwaysEnter(), stops, positions,
        {"A": Decimal("100")}, {"A": index_bars([100, 100])}, START,
        allow_entries=allow_entries,
    )


def test_entries_pass_when_risk_on(quiet_stops):
    batch = run_batch(quiet_stops, allow_entries=True)
    assert len(batch.signals) == 1
    assert batch.signals[0].action is SignalAction.ENTER_LONG
    assert batch.suppressed_entries == 0


def test_entries_are_suppressed_when_risk_off(quiet_stops):
    batch = run_batch(quiet_stops, allow_entries=False)
    assert batch.signals == []
    assert batch.suppressed_entries == 1


def test_exits_always_pass_even_when_risk_off(quiet_stops):
    """이게 무너지면 하락장에서 빠져나올 방법이 없어진다."""
    batch = run_batch(quiet_stops, allow_entries=False, holding=True)
    assert len(batch.signals) == 1
    assert batch.signals[0].action is SignalAction.EXIT
    assert batch.suppressed_entries == 0


def test_protective_exits_always_pass_when_risk_off(store):
    stops = StopManager(
        store,
        stop_loss_pct=Decimal("0.05"),
        trailing_stop_pct=Decimal("0"),
        take_profit_pct=Decimal("0"),
        max_holding_days=0,
        cooldown_days=0,
    )
    positions = {"A": Position("A", 10, Decimal("100"))}

    batch = collect_signals(
        ["A"], AlwaysEnter(), stops, positions,
        {"A": Decimal("80")}, {"A": index_bars([100, 80])}, START,
        allow_entries=False,
    )

    assert len(batch.signals) == 1
    assert batch.signals[0].protective is True


# --- 백테스트 연동 -----------------------------------------------------------


def trading_bars(symbol: str, closes) -> list[Candle]:
    return [
        Candle(symbol, START + timedelta(days=i), Decimal(str(c)), Decimal(str(c)),
               Decimal(str(c)), Decimal(str(c)), 1000)
        for i, c in enumerate(closes)
    ]


def regime_settings(settings, **kw):
    settings.paper_cash = Decimal("100000")
    settings.max_position_pct = Decimal("1")
    settings.paper_slippage_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    settings.regime_enabled = True
    settings.regime_symbol = "SPY"
    settings.regime_ma_bars = 5
    for k, v in kw.items():
        setattr(settings, k, v)
    return settings


def test_index_is_not_traded(settings):
    """지수는 데이터일 뿐 매매 대상이 아니다."""
    from tossquant.backtest.simulator import Backtester

    history = {
        "A": trading_bars("A", [100] * 10),
        "SPY": trading_bars("SPY", [100] * 10),
    }
    result = Backtester(history, AlwaysEnter(), regime_settings(settings)).run()

    assert result.symbols == ["A"]
    assert all(t.symbol == "A" for t in result.trades)


def test_index_cannot_see_the_future(settings):
    """지수도 같은 커서를 타야 한다. 안 그러면 국면 판정이 미래를 본다."""
    from tossquant.backtest.replay import ReplayMarket

    market = ReplayMarket(
        {
            "A": trading_bars("A", [1, 2, 3, 4, 5]),
            "SPY": trading_bars("SPY", [10, 20, 30, 40, 50]),
        },
        data_only=frozenset({"SPY"}),
    )
    market.seek(2)

    assert market.symbols == ["A"]
    assert "SPY" in market.all_symbols
    assert [c.close for c in market.get_candles("SPY", "1d", 100)] == [
        Decimal("10"), Decimal("20"), Decimal("30")
    ]
    assert set(market.marks()) == {"A"}  # 지수는 평가 대상이 아니다


def test_risk_off_blocks_entries_in_backtest(settings):
    from tossquant.backtest.simulator import Backtester

    # 지수는 계속 내리막 → 5일선 아래에 머문다
    history = {
        "A": trading_bars("A", [100] * 12),
        "SPY": trading_bars("SPY", list(range(120, 108, -1))),
    }
    result = Backtester(history, AlwaysEnter(), regime_settings(settings)).run()

    assert result.trades == []
    assert result.rejections["regime_risk_off"] > 0
    assert result.rejections["regime_unknown"] == 0
    assert result.curve[-1].invested == 0


def test_risk_on_allows_entries_in_backtest(settings):
    from tossquant.backtest.simulator import Backtester

    # 지수 상승 → 5일선 위
    history = {
        "A": trading_bars("A", [100] * 12),
        "SPY": trading_bars("SPY", list(range(100, 112))),
    }
    result = Backtester(history, AlwaysEnter(), regime_settings(settings)).run()

    assert result.rejections["regime_risk_off"] == 0
    assert result.rejections["regime_unknown"] == 0
    assert result.curve[-1].invested > 0


def test_missing_index_blocks_backtest_entries(settings):
    """켜진 필터의 지수 데이터가 없으면 UNKNOWN으로 진입을 막는다."""
    from tossquant.backtest.simulator import Backtester

    history = {"A": trading_bars("A", [100] * 12)}
    result = Backtester(history, AlwaysEnter(), regime_settings(settings)).run()

    assert result.rejections["regime_unknown"] > 0
    assert result.rejections["regime_risk_off"] == 0
    assert result.curve[-1].invested == 0


def test_protection_summary_mentions_the_filter(settings):
    from tossquant.backtest.simulator import Backtester

    history = {
        "A": trading_bars("A", [100] * 12),
        "SPY": trading_bars("SPY", list(range(100, 112))),
    }
    result = Backtester(history, AlwaysEnter(), regime_settings(settings)).run()

    assert any("국면필터" in line for line in result.protection)


def test_backtest_waits_for_the_index_moving_average(settings):
    """전략 워밍업이 짧아도 지수 이동평균이 찰 때까지 기다려야 한다.

    안 그러면 앞부분이 '판단 불가라 통과'로 흘러 필터 효과가 과소평가된다.
    """
    from tossquant.backtest.simulator import Backtester

    history = {
        "A": trading_bars("A", [100] * 20),
        "SPY": trading_bars("SPY", [100] * 20),
    }
    result = Backtester(
        history, AlwaysEnter(), regime_settings(settings, regime_ma_bars=10)
    ).run()

    # 전략 워밍업은 1봉이지만 지수 10일선을 채우고 나서야 시작한다
    assert len(result.curve) == 20 - 10 + 1


def test_insufficient_data_for_the_index_is_a_clear_error(settings):
    from tossquant.backtest.simulator import Backtester

    history = {
        "A": trading_bars("A", [100] * 8),
        "SPY": trading_bars("SPY", [100] * 8),
    }
    with pytest.raises(ValueError, match="국면 필터"):
        Backtester(
            history, AlwaysEnter(), regime_settings(settings, regime_ma_bars=50)
        ).run()
