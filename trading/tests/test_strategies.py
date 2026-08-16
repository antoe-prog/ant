"""새 전략 3종 테스트.

각 전략마다 '발동하는 조건'과 '발동하지 않는 조건'을 둘 다 못 박는다. 과민한
전략은 수수료로 죽고, 둔한 전략은 거래가 0건이라 백테스트가 조용히 무의미해진다.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from tossquant.models import Candle, Position, SignalAction
from tossquant.strategy.breakout import BreakoutStrategy
from tossquant.strategy.mean_reversion import MeanReversionStrategy
from tossquant.strategy.momentum import MomentumStrategy

START = datetime(2026, 1, 5, tzinfo=timezone.utc)


def bars(closes, highs=None, lows=None) -> list[Candle]:
    highs = highs or closes
    lows = lows or closes
    return [
        Candle(
            symbol="A",
            ts=START + timedelta(days=i),
            open=Decimal(str(c)),
            high=Decimal(str(h)),
            low=Decimal(str(low)),
            close=Decimal(str(c)),
            volume=1000,
        )
        for i, (c, h, low) in enumerate(zip(closes, highs, lows))
    ]


HELD = Position("A", 10, Decimal("100"))


# --- 모멘텀 ------------------------------------------------------------------


def momentum(**kw) -> MomentumStrategy:
    kw.setdefault("lookback", 3)
    kw.setdefault("entry_threshold", Decimal("0.05"))
    kw.setdefault("exit_threshold", Decimal("0"))
    return MomentumStrategy(**kw)


def test_momentum_enters_when_return_clears_threshold():
    signal = momentum().on_bar("A", bars([100, 100, 100, 110]), None)
    assert signal is not None
    assert signal.action is SignalAction.ENTER_LONG


def test_momentum_stays_out_below_threshold():
    assert momentum().on_bar("A", bars([100, 100, 100, 102]), None) is None


def test_momentum_exits_when_return_turns_negative():
    signal = momentum().on_bar("A", bars([100, 100, 100, 95]), HELD)
    assert signal is not None
    assert signal.action is SignalAction.EXIT


def test_momentum_holds_between_thresholds():
    """진입 임계와 청산 임계 사이는 히스테리시스 구간 — 아무것도 하지 않는다."""
    assert momentum().on_bar("A", bars([100, 100, 100, 102]), HELD) is None


def test_momentum_ignores_entry_while_holding():
    assert momentum().on_bar("A", bars([100, 100, 100, 130]), HELD) is None


def test_momentum_needs_warmup():
    strategy = momentum(lookback=5)
    assert strategy.warmup_bars == 6
    assert strategy.on_bar("A", bars([1, 2, 3]), None) is None


def test_momentum_rejects_inverted_thresholds():
    with pytest.raises(ValueError, match="사자마자"):
        MomentumStrategy(10, Decimal("0.02"), Decimal("0.05"))


def test_momentum_rejects_zero_lookback():
    with pytest.raises(ValueError):
        MomentumStrategy(0, Decimal("0.05"), Decimal("0"))


def test_momentum_rejects_non_integer_lookback():
    with pytest.raises(ValueError, match="integer|정수"):
        MomentumStrategy(5.5, Decimal("0.05"), Decimal("0"))


@pytest.mark.parametrize(
    ("entry", "exit"),
    [
        (0.05, Decimal("0")),
        (Decimal("0.05"), 0),
        (Decimal("NaN"), Decimal("0")),
        (Decimal("Infinity"), Decimal("0")),
        (Decimal("0.05"), Decimal("-Infinity")),
    ],
)
def test_momentum_rejects_non_decimal_or_non_finite_thresholds(entry, exit):
    with pytest.raises(ValueError, match="Decimal|finite|유한"):
        MomentumStrategy(20, entry, exit)


# --- 돌파 --------------------------------------------------------------------


def test_breakout_enters_above_prior_high():
    strategy = BreakoutStrategy(entry_bars=3, exit_bars=2)
    # 직전 3봉 고가는 12, 현재 종가 15 → 돌파
    signal = strategy.on_bar("A", bars([10, 11, 12, 15]), None)
    assert signal is not None
    assert signal.action is SignalAction.ENTER_LONG


def test_breakout_does_not_enter_at_the_prior_high():
    """같은 값은 돌파가 아니다. 등호를 잘못 쓰면 매일 사게 된다."""
    strategy = BreakoutStrategy(entry_bars=3, exit_bars=2)
    assert strategy.on_bar("A", bars([10, 11, 12, 12]), None) is None


def test_breakout_uses_highs_not_closes():
    """장중 신고가를 종가로만 보면 놓친다."""
    strategy = BreakoutStrategy(entry_bars=3, exit_bars=2)
    # 종가는 낮았지만 고가가 20이었던 봉이 있으므로 15로는 못 뚫는다
    candles = bars([10, 11, 12, 15], highs=[10, 20, 12, 15], lows=[10, 11, 12, 15])
    assert strategy.on_bar("A", candles, None) is None


def test_breakout_exits_below_prior_low():
    strategy = BreakoutStrategy(entry_bars=3, exit_bars=2)
    signal = strategy.on_bar("A", bars([20, 18, 17, 10]), HELD)
    assert signal is not None
    assert signal.action is SignalAction.EXIT


def test_breakout_holds_inside_the_channel():
    strategy = BreakoutStrategy(entry_bars=3, exit_bars=2)
    assert strategy.on_bar("A", bars([20, 18, 17, 17.5]), HELD) is None


def test_breakout_warmup_covers_the_longer_window():
    assert BreakoutStrategy(entry_bars=20, exit_bars=10).warmup_bars == 21
    assert BreakoutStrategy(entry_bars=10, exit_bars=30).warmup_bars == 31


def test_breakout_rejects_zero_windows():
    with pytest.raises(ValueError):
        BreakoutStrategy(0, 10)


@pytest.mark.parametrize(("entry", "exit"), [(20.5, 10), (20, 10.5), (True, 10)])
def test_breakout_rejects_non_integer_windows(entry, exit):
    with pytest.raises(ValueError, match="integer|정수"):
        BreakoutStrategy(entry, exit)


# --- 평균회귀 ----------------------------------------------------------------


def reversion(**kw) -> MeanReversionStrategy:
    kw.setdefault("lookback", 4)
    kw.setdefault("entry_z", Decimal("-1.2"))
    kw.setdefault("exit_z", Decimal("0"))
    return MeanReversionStrategy(**kw)


def test_mean_reversion_buys_the_dip():
    signal = reversion().on_bar("A", bars([100, 100, 100, 90]), None)
    assert signal is not None
    assert signal.action is SignalAction.ENTER_LONG
    assert "과매도" in signal.reason


def test_mean_reversion_ignores_shallow_dips():
    assert reversion(entry_z=Decimal("-5")).on_bar(
        "A", bars([100, 100, 100, 99]), None
    ) is None


def test_mean_reversion_exits_on_reversion():
    signal = reversion().on_bar("A", bars([90, 90, 90, 110]), HELD)
    assert signal is not None
    assert signal.action is SignalAction.EXIT


def test_mean_reversion_holds_while_still_below_mean():
    assert reversion().on_bar("A", bars([100, 100, 105, 98]), HELD) is None


def test_mean_reversion_never_buys_a_rally():
    """추세추종과 반대 방향이라는 게 이 전략의 정체성이다."""
    assert reversion().on_bar("A", bars([90, 95, 100, 130]), None) is None


def test_mean_reversion_survives_flat_prices():
    """변동성이 0이면 z가 정의되지 않는다 — 죽지 말고 넘어가야 한다."""
    assert reversion().on_bar("A", bars([50, 50, 50, 50]), None) is None


def test_mean_reversion_rejects_positive_entry_z():
    with pytest.raises(ValueError, match="음수"):
        MeanReversionStrategy(20, Decimal("1.5"), Decimal("0"))


def test_mean_reversion_rejects_exit_below_entry():
    with pytest.raises(ValueError, match="회귀를 못 기다립니다"):
        MeanReversionStrategy(20, Decimal("-2"), Decimal("-3"))


def test_mean_reversion_rejects_non_integer_lookback():
    with pytest.raises(ValueError, match="integer|정수"):
        MeanReversionStrategy(20.5, Decimal("-2"), Decimal("0"))


@pytest.mark.parametrize(
    ("entry", "exit"),
    [
        (-2.0, Decimal("0")),
        (Decimal("-2"), 0),
        (Decimal("NaN"), Decimal("0")),
        (Decimal("-Infinity"), Decimal("0")),
        (Decimal("-2"), Decimal("Infinity")),
    ],
)
def test_mean_reversion_rejects_non_decimal_or_non_finite_thresholds(entry, exit):
    with pytest.raises(ValueError, match="Decimal|finite|유한"):
        MeanReversionStrategy(20, entry, exit)
