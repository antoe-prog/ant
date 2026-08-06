from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest

from tossquant.broker.base import BrokerError
from tossquant.broker.paper import PaperBroker
from tossquant.calendar_us import NY
from tossquant.engine import TradingEngine
from tossquant.models import Side, Signal, SignalAction
from tossquant.risk import RiskManager
from tossquant.strategy.sma_cross import SmaCrossStrategy

from fakes import FakeMarket

OPEN = datetime(2026, 8, 6, 10, 0, tzinfo=NY)
CLOSED = datetime(2026, 8, 6, 20, 0, tzinfo=NY)

# 하락 후 급반등 — 마지막 봉에서 골든크로스가 발생한다.
GOLDEN = [30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15,
          14, 13, 12, 11, 10, 9, 8, 7, 6, 60]
# 상승 후 급락 — 마지막 봉에서 데드크로스.
DEAD = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
        22, 23, 24, 25, 26, 27, 28, 29, 30, 1]
FLAT = [20] * 26


def build(closes: list[float], settings, store) -> tuple[TradingEngine, PaperBroker, FakeMarket]:
    market = FakeMarket({"AAPL": closes})
    broker = PaperBroker(market, store, settings)
    strategy = SmaCrossStrategy(settings.sma_fast, settings.sma_slow)
    risk = RiskManager(
        store,
        max_position_pct=settings.max_position_pct,
        max_positions=settings.max_positions,
        max_daily_loss_pct=settings.max_daily_loss_pct,
        max_order_notional=settings.max_order_notional,
    )
    return TradingEngine(broker, strategy, risk, store, settings), broker, market


def test_no_trading_outside_market_hours(settings, store):
    engine, broker, _ = build(GOLDEN, settings, store)
    assert engine.run_once(CLOSED) == []
    assert broker.get_account().positions == {}


def test_golden_cross_produces_a_buy(settings, store):
    engine, broker, _ = build(GOLDEN, settings, store)

    orders = engine.run_once(OPEN)

    assert len(orders) == 1
    assert orders[0].side is Side.BUY
    assert broker.get_account().positions["AAPL"].quantity > 0


def test_flat_market_produces_nothing(settings, store):
    engine, broker, _ = build(FLAT, settings, store)
    assert engine.run_once(OPEN) == []
    assert broker.get_account().positions == {}


def test_dead_cross_exits_existing_position(settings, store):
    engine, broker, market = build(DEAD, settings, store)
    # 먼저 포지션을 만든다.
    from tossquant.models import OrderRequest
    broker.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=10))
    assert broker.get_account().positions["AAPL"].quantity == 10

    orders = engine.run_once(OPEN)

    assert len(orders) == 1
    assert orders[0].side is Side.SELL
    assert "AAPL" not in broker.get_account().positions


def test_equity_curve_is_recorded(settings, store):
    engine, _, _ = build(FLAT, settings, store)
    engine.run_once(OPEN)
    history = store.equity_history(5)
    assert len(history) == 1
    assert Decimal(history[0]["equity"]) == Decimal("10000")


def test_symbol_with_insufficient_candles_is_skipped(settings, store):
    engine, broker, _ = build([10, 11], settings, store)
    assert engine.run_once(OPEN) == []


def test_broker_error_on_one_symbol_does_not_stop_others(settings, store):
    settings.symbols = ["BAD", "AAPL"]
    market = FakeMarket({"AAPL": GOLDEN})
    original = market.get_candles

    def flaky(symbol, interval, count):
        if symbol == "BAD":
            raise BrokerError("boom")
        return original(symbol, interval, count)

    market.get_candles = flaky
    broker = PaperBroker(market, store, settings)
    risk = RiskManager(
        store,
        max_position_pct=settings.max_position_pct,
        max_positions=settings.max_positions,
        max_daily_loss_pct=settings.max_daily_loss_pct,
        max_order_notional=settings.max_order_notional,
    )
    engine = TradingEngine(
        broker, SmaCrossStrategy(settings.sma_fast, settings.sma_slow), risk, store, settings
    )

    orders = engine.run_once(OPEN)

    assert len(orders) == 1
    assert orders[0].symbol == "AAPL"


def test_strategy_exception_is_contained(settings, store):
    engine, broker, _ = build(GOLDEN, settings, store)

    def explode(*args, **kwargs):
        raise ZeroDivisionError("strategy bug")

    engine.strategy.on_bar = explode

    assert engine.run_once(OPEN) == []  # 예외가 밖으로 새지 않는다


def test_sizing_uses_live_quote_not_candle_close(settings, store):
    """호가가 종가보다 높으면 그만큼 적게 사야 한다."""
    engine, broker, market = build(GOLDEN, settings, store)
    # 마지막 종가는 60이지만 호가는 그 두 배로 벌어져 있다.
    market.spread = Decimal("60")

    orders = engine.run_once(OPEN)

    assert len(orders) == 1
    # 종가 60 기준이면 5000/60 = 83주, 호가 90 기준이면 55주.
    assert orders[0].filled_quantity == 55


def test_exec_price_is_none_when_quote_lookup_fails(settings, store):
    engine, broker, _ = build(GOLDEN, settings, store)

    def broken_quote(symbol):
        raise BrokerError("quote endpoint down")

    broker.get_quote = broken_quote
    signal = Signal("AAPL", SignalAction.ENTER_LONG, "test", Decimal("60"))

    assert engine._exec_price(signal) is None


def test_trading_continues_when_quote_lookup_fails(settings, store):
    """호가를 못 받아도 종가로 사이징해서 매매는 계속되어야 한다."""
    engine, broker, _ = build(GOLDEN, settings, store)
    engine._exec_price = lambda signal: None

    orders = engine.run_once(OPEN)

    assert len(orders) == 1
    assert orders[0].filled_quantity == 83  # 종가 60 기준 5000/60


def test_run_forever_survives_a_failing_cycle(settings, store):
    engine, _, _ = build(FLAT, settings, store)
    calls = {"n": 0}

    def failing_cycle(now=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient")
        engine.stop()
        return []

    engine.run_once = failing_cycle
    engine.run_forever(sleep=lambda _: None)

    assert calls["n"] == 2  # 첫 사이클 실패 후 계속 돌았다
