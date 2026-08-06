from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from tossquant.models import Candle, Position, SignalAction
from tossquant.strategy.sma_cross import SmaCrossStrategy, sma


def candles(closes: list[float]) -> list[Candle]:
    start = datetime(2026, 1, 2, tzinfo=timezone.utc)
    return [
        Candle(
            symbol="AAPL",
            ts=start + timedelta(days=i),
            open=Decimal(str(c)),
            high=Decimal(str(c)),
            low=Decimal(str(c)),
            close=Decimal(str(c)),
            volume=100,
        )
        for i, c in enumerate(closes)
    ]


def test_sma_returns_none_when_not_enough_data():
    assert sma([Decimal("1"), Decimal("2")], 3) is None


def test_sma_averages_last_window():
    values = [Decimal(str(v)) for v in (1, 2, 3, 4)]
    assert sma(values, 2) == Decimal("3.5")


def test_fast_must_be_below_slow():
    with pytest.raises(ValueError):
        SmaCrossStrategy(fast=5, slow=5)


def test_golden_cross_enters_when_flat():
    strategy = SmaCrossStrategy(fast=2, slow=4)
    # 하락 후 급반등 → 단기선이 장기선을 상향 돌파
    signal = strategy.on_bar("AAPL", candles([10, 9, 8, 7, 6, 20]), None)
    assert signal is not None
    assert signal.action is SignalAction.ENTER_LONG


def test_golden_cross_ignored_when_already_holding():
    strategy = SmaCrossStrategy(fast=2, slow=4)
    held = Position(symbol="AAPL", quantity=5, avg_price=Decimal("10"))
    assert strategy.on_bar("AAPL", candles([10, 9, 8, 7, 6, 20]), held) is None


def test_dead_cross_exits_when_holding():
    strategy = SmaCrossStrategy(fast=2, slow=4)
    held = Position(symbol="AAPL", quantity=5, avg_price=Decimal("10"))
    signal = strategy.on_bar("AAPL", candles([6, 7, 8, 9, 10, 1]), held)
    assert signal is not None
    assert signal.action is SignalAction.EXIT


def test_dead_cross_ignored_when_flat():
    strategy = SmaCrossStrategy(fast=2, slow=4)
    assert strategy.on_bar("AAPL", candles([6, 7, 8, 9, 10, 1]), None) is None


def test_no_signal_without_warmup():
    strategy = SmaCrossStrategy(fast=3, slow=5)
    assert strategy.warmup_bars == 6
    assert strategy.on_bar("AAPL", candles([1, 2, 3, 4, 5]), None) is None


def test_no_signal_when_no_cross():
    strategy = SmaCrossStrategy(fast=2, slow=4)
    # 단조 상승 — 교차가 일어나지 않는다.
    assert strategy.on_bar("AAPL", candles([1, 2, 3, 4, 5, 6, 7]), None) is None
