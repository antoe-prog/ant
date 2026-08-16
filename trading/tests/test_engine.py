from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import threading
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
from pathlib import Path

import pytest

from tossquant.broker.base import Broker, BrokerError, OrderRejected
from tossquant.broker.paper import PaperBroker
from tossquant.calendar_us import CalendarCoverageError, NY
from tossquant.engine import TradingEngine
from tossquant.models import (
    Account,
    Candle,
    Order,
    OrderRequest,
    OrderStatus,
    Position,
    Quote,
    Side,
    Signal,
    SignalAction,
)
from tossquant.risk import RiskManager
from tossquant.notify import Level
from tossquant.regime import RegimeState
from tossquant.store import Store, StoreConflict, StoreLeaseError
from tossquant.strategy.sma_cross import SmaCrossStrategy
from tossquant.strategy.base import Strategy

from fakes import FakeMarket
from test_notify import FailOnceRecorder, Recorder

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


class LiveOrderBroker:
    """주문 응답 수명주기만 격리하는 라이브 브로커 대역."""

    def __init__(
        self,
        status: OrderStatus,
        *,
        filled_quantity: int = 0,
        error: BrokerError | None = None,
        quote_error: bool = False,
    ) -> None:
        self.status = status
        self.filled_quantity = filled_quantity
        self.error = error
        self.quote_error = quote_error
        self.requests: list[OrderRequest] = []
        self.account = Account(cash=Decimal("10000"), positions={})

    @property
    def is_live(self) -> bool:
        return True

    def get_quote(self, symbol: str) -> Quote:
        if self.quote_error:
            raise BrokerError("quote unavailable")
        return Quote(
            symbol=symbol,
            last=Decimal("100"),
            bid=Decimal("100"),
            ask=Decimal("100"),
            ts=datetime.now(timezone.utc),
        )

    def get_account(self) -> Account:
        return self.account

    def get_positions(self) -> dict[str, Position]:
        return dict(self.account.positions)

    def place_order(self, request: OrderRequest) -> Order:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        return Order(
            order_id="live-order-1",
            client_order_id=request.client_order_id,
            symbol=request.symbol,
            side=request.side,
            quantity=request.quantity,
            filled_quantity=self.filled_quantity,
            avg_fill_price=(
                Decimal("100") if self.filled_quantity else Decimal("0")
            ),
            status=self.status,
            ts=datetime.now(timezone.utc),
        )


class EnterEverySymbol(Strategy):
    name = "enter-every-symbol"

    @property
    def warmup_bars(self) -> int:
        return 1

    def on_bar(self, symbol, candles, position):
        if position is not None and position.quantity > 0:
            return None
        return Signal(symbol, SignalAction.ENTER_LONG, "test", Decimal("100"))


class RecordingNoSignals(Strategy):
    name = "recording-none"

    def __init__(self) -> None:
        self.symbols: list[str] = []

    @property
    def warmup_bars(self) -> int:
        return 1

    def on_bar(self, symbol, candles, position):
        self.symbols.append(symbol)
        return None


class HoldingCoverageBroker(Broker):
    def __init__(
        self,
        positions: dict[str, Position],
        prices: dict[str, Decimal],
        *,
        unavailable: set[str] | None = None,
    ) -> None:
        self.cash = Decimal("10000")
        self.positions = dict(positions)
        self.prices = prices
        self.unavailable = unavailable or set()
        self.candle_requests: list[str] = []
        self.requests: list[OrderRequest] = []

    @property
    def is_live(self) -> bool:
        return True

    def get_account(self) -> Account:
        return Account(self.cash, dict(self.positions))

    def get_positions(self) -> dict[str, Position]:
        return dict(self.positions)

    def get_candles(self, symbol, interval, count):
        self.candle_requests.append(symbol)
        if symbol in self.unavailable:
            raise BrokerError(f"{symbol} unavailable")
        price = self.prices[symbol]
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        return [
            Candle(
                symbol,
                start + timedelta(days=index),
                price,
                price,
                price,
                price,
                1000,
            )
            for index in range(max(count, 21))
        ]

    def get_quote(self, symbol):
        price = self.prices[symbol]
        return Quote(symbol, price, price, price, datetime.now(timezone.utc))

    def place_order(self, request):
        self.requests.append(request)
        price = self.prices[request.symbol]
        if request.side is Side.SELL:
            position = self.positions[request.symbol]
            remaining = position.quantity - request.quantity
            if remaining:
                self.positions[request.symbol] = Position(
                    request.symbol, remaining, position.avg_price
                )
            else:
                self.positions.pop(request.symbol)
            self.cash += price * request.quantity
        else:
            self.cash -= price * request.quantity
            self.positions[request.symbol] = Position(
                request.symbol, request.quantity, price
            )
        return Order(
            order_id=f"live-coverage-{len(self.requests)}",
            client_order_id=request.client_order_id,
            symbol=request.symbol,
            side=request.side,
            quantity=request.quantity,
            filled_quantity=request.quantity,
            avg_fill_price=price,
            status=OrderStatus.FILLED,
            ts=datetime.now(timezone.utc),
        )

    def cancel_order(self, order_id):
        raise NotImplementedError


def build_coverage_engine(settings, store, broker, strategy, notifier=None):
    risk = RiskManager(
        store,
        max_position_pct=settings.max_position_pct,
        max_positions=settings.max_positions,
        max_daily_loss_pct=settings.max_daily_loss_pct,
        max_order_notional=settings.max_order_notional,
    )
    return TradingEngine(
        broker, strategy, risk, store, settings, notifier=notifier
    )


class PartialFirstLiveBroker(Broker):
    def __init__(self, partial_quantity: int) -> None:
        self.cash = Decimal("10000")
        self.positions: dict[str, Position] = {}
        self.partial_quantity = partial_quantity
        self.requests: list[OrderRequest] = []
        self.account_calls = 0

    @property
    def is_live(self) -> bool:
        return True

    def get_candles(self, symbol, interval, count):
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        return [
            Candle(
                symbol,
                start + timedelta(days=index),
                Decimal("100"),
                Decimal("100"),
                Decimal("100"),
                Decimal("100"),
                1000,
            )
            for index in range(21)
        ]

    def get_quote(self, symbol):
        return Quote(
            symbol,
            Decimal("100"),
            Decimal("100"),
            Decimal("100"),
            datetime.now(timezone.utc),
        )

    def get_account(self):
        self.account_calls += 1
        return Account(self.cash, dict(self.positions))

    def get_positions(self):
        return dict(self.positions)

    def place_order(self, request):
        self.requests.append(request)
        if request.symbol == "A":
            filled = self.partial_quantity
            status = OrderStatus.PARTIALLY_FILLED
        else:
            filled = request.quantity
            status = OrderStatus.FILLED
        if filled:
            self.cash -= Decimal("100") * filled
            self.positions[request.symbol] = Position(
                request.symbol, filled, Decimal("100")
            )
        return Order(
            order_id=f"live-{request.symbol}",
            client_order_id=request.client_order_id,
            symbol=request.symbol,
            side=request.side,
            quantity=request.quantity,
            filled_quantity=filled,
            avg_fill_price=Decimal("100"),
            status=status,
            ts=datetime.now(timezone.utc),
        )

    def cancel_order(self, order_id):
        raise NotImplementedError


def build_live_batch_engine(settings, store, broker):
    risk = RiskManager(
        store,
        max_position_pct=settings.max_position_pct,
        max_positions=settings.max_positions,
        max_daily_loss_pct=settings.max_daily_loss_pct,
        max_order_notional=settings.max_order_notional,
    )
    return TradingEngine(
        broker, EnterEverySymbol(), risk, store, settings
    )


def test_no_trading_outside_market_hours(settings, store):
    engine, broker, _ = build(GOLDEN, settings, store)
    assert engine.run_once(CLOSED) == []
    assert broker.get_account().positions == {}


def test_engine_fails_closed_before_broker_access_when_calendar_is_unverified(
    settings, store
):
    engine, broker, _ = build(GOLDEN, settings, store)

    with pytest.raises(CalendarCoverageError, match="2029"):
        engine.run_once(datetime(2029, 1, 2, 10, 0, tzinfo=NY))

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


def test_unconfigured_holding_is_covered_for_protective_exit_then_dropped(
    settings, store
):
    settings.symbols = ["AAPL"]
    settings.stop_loss_pct = Decimal("0.08")
    settings.regime_enabled = False
    broker = HoldingCoverageBroker(
        {"MSFT": Position("MSFT", 10, Decimal("100"))},
        {"AAPL": Decimal("100"), "MSFT": Decimal("50")},
    )
    strategy = RecordingNoSignals()
    engine = build_coverage_engine(settings, store, broker, strategy)

    first = engine.run_once(OPEN)

    assert [(order.symbol, order.side) for order in first] == [("MSFT", Side.SELL)]
    assert set(broker.candle_requests) == {"AAPL", "MSFT"}
    assert strategy.symbols == ["AAPL"]
    assert "MSFT" not in broker.positions

    broker.candle_requests.clear()
    strategy.symbols.clear()
    assert engine.run_once(OPEN + timedelta(minutes=1)) == []
    assert broker.candle_requests == ["AAPL"]
    assert strategy.symbols == ["AAPL"]


def test_missing_holding_coverage_blocks_entries_and_false_equity_but_keeps_safe_exit(
    settings, store
):
    settings.symbols = ["AAPL"]
    settings.stop_loss_pct = Decimal("0.08")
    settings.regime_enabled = False
    broker = HoldingCoverageBroker(
        {
            "MISSING": Position("MISSING", 5, Decimal("100")),
            "EXIT": Position("EXIT", 4, Decimal("100")),
        },
        {
            "AAPL": Decimal("100"),
            "MISSING": Decimal("50"),
            "EXIT": Decimal("50"),
        },
        unavailable={"MISSING"},
    )
    notifier = Recorder(throttle_seconds=0)
    engine = build_coverage_engine(
        settings, store, broker, EnterEverySymbol(), notifier
    )
    near_close = OPEN.replace(hour=15, minute=58)

    executed = engine.run_once(near_close)

    assert [(order.symbol, order.side) for order in executed] == [("EXIT", Side.SELL)]
    assert [(request.symbol, request.side) for request in broker.requests] == [
        ("EXIT", Side.SELL)
    ]
    assert set(broker.candle_requests) == {"AAPL", "MISSING", "EXIT"}
    assert store.equity_history() == []
    assert store.get_state("risk.day_baseline") is None
    assert not any("장 마감 요약" in note.title for note in notifier.sent)
    coverage = [note for note in notifier.sent if "관리 불가" in note.title]
    assert len(coverage) == 1
    assert "MISSING" in " ".join(coverage[0].lines)


def test_unknown_enabled_regime_blocks_entry_and_emits_error(settings, store):
    settings.symbols = ["AAPL"]
    settings.regime_enabled = True
    settings.regime_symbol = "SPY"
    settings.regime_ma_bars = 5
    broker = HoldingCoverageBroker(
        {},
        {"AAPL": Decimal("100"), "SPY": Decimal("80")},
        unavailable={"SPY"},
    )
    notifier = Recorder(throttle_seconds=300)
    engine = build_coverage_engine(
        settings, store, broker, EnterEverySymbol(), notifier
    )

    assert engine.run_once(OPEN) == []
    assert broker.requests == []
    assert store.get_state("regime.risk_on") is None
    errors = [note for note in notifier.sent if "국면 판단 불가" in note.title]
    assert len(errors) == 1
    assert errors[0].level is Level.ERROR


def test_unknown_regime_preserves_protective_exit(settings, store):
    settings.symbols = ["AAPL"]
    settings.regime_enabled = True
    settings.regime_symbol = "SPY"
    settings.regime_ma_bars = 5
    settings.stop_loss_pct = Decimal("0.08")
    broker = HoldingCoverageBroker(
        {"AAPL": Position("AAPL", 4, Decimal("100"))},
        {"AAPL": Decimal("50"), "SPY": Decimal("80")},
        unavailable={"SPY"},
    )
    notifier = Recorder(throttle_seconds=300)
    engine = build_coverage_engine(
        settings, store, broker, RecordingNoSignals(), notifier
    )

    executed = engine.run_once(OPEN)

    assert [(order.symbol, order.side) for order in executed] == [
        ("AAPL", Side.SELL)
    ]
    assert store.get_state("regime.risk_on") is None


def test_regime_unknown_dedups_and_recovery_uses_normal_transition_policy(
    settings, store
):
    settings.symbols = ["AAPL"]
    settings.regime_enabled = True
    settings.regime_symbol = "SPY"
    settings.regime_ma_bars = 5
    broker = HoldingCoverageBroker(
        {}, {"AAPL": Decimal("100"), "SPY": Decimal("80")}
    )
    mode = "unknown"
    original_candles = broker.get_candles

    def regime_scenario(symbol, interval, count):
        nonlocal mode
        if symbol != "SPY":
            return original_candles(symbol, interval, count)
        broker.candle_requests.append(symbol)
        if mode == "unknown":
            raise BrokerError("SPY unavailable")
        closes = [Decimal("80")] * max(count, 21)
        if mode == "on":
            closes[-1] = Decimal("120")
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        return [
            Candle(symbol, start + timedelta(days=i), p, p, p, p, 1000)
            for i, p in enumerate(closes)
        ]

    broker.get_candles = regime_scenario
    notifier = Recorder(throttle_seconds=300)
    engine = build_coverage_engine(
        settings, store, broker, RecordingNoSignals(), notifier
    )

    engine.run_once(OPEN)  # UNKNOWN: error, no persisted bool
    assert store.get_state("regime.risk_on") is None

    mode = "off"
    engine.run_once(OPEN + timedelta(minutes=1))  # first known: store, no transition
    assert store.get_state("regime.risk_on") is False
    assert not any("시장 국면 → 위험" in note.title for note in notifier.sent)

    mode = "unknown"
    engine.run_once(OPEN + timedelta(minutes=2))
    assert store.get_state("regime.risk_on") is False

    mode = "on"
    engine.run_once(OPEN + timedelta(minutes=3))
    assert store.get_state("regime.risk_on") is True
    assert len([n for n in notifier.sent if "국면 판단 불가" in n.title]) == 1
    assert len([n for n in notifier.sent if "시장 국면 → 정상" in n.title]) == 1


def test_regime_evaluation_exception_becomes_unknown_and_blocks_entry(
    settings, store
):
    settings.symbols = ["AAPL"]
    settings.regime_enabled = True
    settings.regime_symbol = "SPY"
    settings.regime_ma_bars = 5
    broker = HoldingCoverageBroker(
        {}, {"AAPL": Decimal("100"), "SPY": Decimal("80")}
    )
    notifier = Recorder(throttle_seconds=300)
    engine = build_coverage_engine(
        settings, store, broker, EnterEverySymbol(), notifier
    )

    def explode(_candles):
        raise ArithmeticError("bad regime data")

    engine.regime.evaluate = explode

    assert engine.run_once(OPEN) == []
    assert broker.requests == []
    assert store.get_state("regime.risk_on") is None
    assert any("국면 판단 불가" in note.title for note in notifier.sent)


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


def test_strategy_cannot_emit_a_signal_for_a_different_symbol(settings, store):
    engine, broker, _ = build(GOLDEN, settings, store)

    engine.strategy.on_bar = lambda symbol, candles, position: Signal(
        "MSFT", SignalAction.ENTER_LONG, "wrong symbol", Decimal("100")
    )

    assert engine.run_once(OPEN) == []
    assert broker.get_account().positions == {}


def test_strategy_action_is_rechecked_at_the_consumption_boundary(settings, store):
    engine, broker, market = build(GOLDEN, settings, store)
    signal = Signal(
        "AAPL", SignalAction.ENTER_LONG, "mutated action", Decimal("100")
    )
    # A frozen dataclass can still be corrupted by deserializers or hostile plugin
    # code.  The order boundary must not rely only on normal construction.
    object.__setattr__(signal, "action", "ENTER_LONG")
    engine.strategy.on_bar = lambda symbol, candles, position: signal

    assert engine.run_once(OPEN) == []
    assert broker.get_account().positions == {}
    assert market.quote_calls == 0


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


def test_live_entry_fails_closed_when_quote_lookup_fails(settings, store):
    """현재 호가가 없으면 라이브 주문 한도를 종가로 우회하면 안 된다."""
    engine, _, _ = build(GOLDEN, settings, store)
    broker = LiveOrderBroker(OrderStatus.FILLED, quote_error=True)
    engine.broker = broker
    signal = Signal("AAPL", SignalAction.ENTER_LONG, "test", Decimal("60"))

    order = engine._act(
        signal,
        Account(cash=Decimal("10000"), positions={}),
        {"AAPL": Decimal("60")},
        OPEN,
    )

    assert order is None
    assert broker.requests == []


def test_live_new_order_is_persisted_and_blocks_duplicate_submission(settings, store):
    engine, _, _ = build(GOLDEN, settings, store)
    broker = LiveOrderBroker(OrderStatus.NEW)
    engine.broker = broker
    notifier = Recorder(throttle_seconds=0)
    engine.notifier = notifier
    signal = Signal("AAPL", SignalAction.ENTER_LONG, "test", Decimal("100"))
    account = Account(cash=Decimal("10000"), positions={})

    first = engine._act(signal, account, {"AAPL": Decimal("100")}, OPEN)
    second = engine._act(signal, account, {"AAPL": Decimal("100")}, OPEN)

    assert first is None
    assert second is None
    assert len(broker.requests) == 1
    unresolved = store.unresolved_order("AAPL")
    assert unresolved is not None
    assert unresolved["status"] == OrderStatus.NEW.value
    assert not any("체결" in notification.title for notification in notifier.sent)


def test_ambiguous_live_failure_keeps_intent_and_blocks_retry(settings, store):
    engine, _, _ = build(GOLDEN, settings, store)
    broker = LiveOrderBroker(
        OrderStatus.NEW,
        error=BrokerError("주문 결과 불명 — reconciliation required"),
    )
    engine.broker = broker
    signal = Signal("AAPL", SignalAction.ENTER_LONG, "test", Decimal("100"))
    account = Account(cash=Decimal("10000"), positions={})

    assert engine._act(signal, account, {"AAPL": Decimal("100")}, OPEN) is None
    assert engine._act(signal, account, {"AAPL": Decimal("100")}, OPEN) is None

    assert len(broker.requests) == 1
    unresolved = store.unresolved_order("AAPL")
    assert unresolved is not None
    assert unresolved["order_id"].startswith("intent:")


def test_atomic_live_intent_claim_stops_concurrent_engine_submission(
    settings, store
):
    """두 cycle이 선조회를 함께 통과해도 브로커 제출은 하나여야 한다."""
    engine, _, _ = build(GOLDEN, settings, store)
    broker = LiveOrderBroker(OrderStatus.FILLED)
    next_order = 0
    order_lock = threading.Lock()
    def uniquely_identified_place(request):
        nonlocal next_order
        with order_lock:
            broker.requests.append(request)
            next_order += 1
            order_id = f"live-concurrent-{next_order}"
        return Order(
            order_id=order_id,
            client_order_id=request.client_order_id,
            symbol=request.symbol,
            side=request.side,
            quantity=request.quantity,
            filled_quantity=request.quantity,
            avg_fill_price=Decimal("100"),
            status=OrderStatus.FILLED,
            ts=datetime.now(timezone.utc),
        )

    broker.place_order = uniquely_identified_place
    engine.broker = broker
    original_check = store.unresolved_live_order
    preflight_barrier = threading.Barrier(2)

    def synchronized_preflight(symbol=None):
        result = original_check(symbol)
        preflight_barrier.wait(timeout=2)
        return result

    store.unresolved_live_order = synchronized_preflight
    signal = Signal("AAPL", SignalAction.ENTER_LONG, "race", Decimal("100"))
    account = Account(cash=Decimal("10000"), positions={})
    results: list[Order | None] = []
    errors: list[BaseException] = []

    def act() -> None:
        try:
            results.append(
                engine._act(signal, account, {"AAPL": Decimal("100")}, OPEN)
            )
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    workers = [threading.Thread(target=act) for _ in range(2)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(timeout=3)

    assert all(not worker.is_alive() for worker in workers)
    assert errors == []
    assert len(broker.requests) == 1
    assert len([order for order in results if order is not None]) == 1


def test_completed_live_entry_still_fences_same_cycle_retry(settings, store):
    """빠른 FILLED 뒤에도 같은 의사결정 봉을 다시 보내면 안 된다."""
    engine, _, _ = build(GOLDEN, settings, store)
    broker = LiveOrderBroker(OrderStatus.FILLED)

    def place(request):
        broker.requests.append(request)
        return Order(
            order_id=f"live-fast-{len(broker.requests)}",
            client_order_id=request.client_order_id,
            symbol=request.symbol,
            side=request.side,
            quantity=request.quantity,
            filled_quantity=request.quantity,
            avg_fill_price=Decimal("100"),
            status=OrderStatus.FILLED,
            ts=datetime.now(timezone.utc),
        )

    broker.place_order = place
    engine.broker = broker
    signal = Signal("AAPL", SignalAction.ENTER_LONG, "race", Decimal("100"))
    stale_account = Account(cash=Decimal("10000"), positions={})

    decision_bar = datetime(2026, 8, 5, 20, 0, tzinfo=timezone.utc)
    first = engine._act(
        signal,
        stale_account,
        {"AAPL": Decimal("100")},
        OPEN,
        decision_ts=decision_bar,
    )
    second = engine._act(
        signal,
        stale_account,
        {"AAPL": Decimal("100")},
        OPEN + timedelta(minutes=10),
        decision_ts=decision_bar,
    )

    assert first is not None
    assert second is None
    assert len(broker.requests) == 1


def test_live_client_order_id_rejects_naive_decision_timestamp(settings, store):
    engine, _, _ = build(GOLDEN, settings, store)

    with pytest.raises(ValueError, match="timezone-aware"):
        engine._live_client_order_id(  # noqa: SLF001 - runtime boundary contract
            "AAPL",
            Side.BUY,
            datetime(2026, 8, 5, 20, 0),
        )


def test_reserved_intent_order_id_keeps_reconciliation_fence(settings, store):
    """A broker response must not impersonate the local intent ledger row."""
    engine, _, _ = build(GOLDEN, settings, store)
    broker = LiveOrderBroker(OrderStatus.FILLED)

    def place(request):
        broker.requests.append(request)
        return Order(
            order_id=store.intent_order_id(request.client_order_id),
            client_order_id=request.client_order_id,
            symbol=request.symbol,
            side=request.side,
            quantity=request.quantity,
            filled_quantity=request.quantity,
            avg_fill_price=Decimal("100"),
            status=OrderStatus.FILLED,
            ts=datetime.now(timezone.utc),
        )

    broker.place_order = place
    engine.broker = broker
    signal = Signal("AAPL", SignalAction.ENTER_LONG, "race", Decimal("100"))

    result = engine._act(
        signal,
        Account(cash=Decimal("10000"), positions={}),
        {"AAPL": Decimal("100")},
        OPEN,
        decision_ts=datetime(2026, 8, 5, 20, 0, tzinfo=timezone.utc),
    )

    assert result is None
    assert engine._halt_signal_batch is True  # noqa: SLF001
    unresolved = store.unresolved_live_order("AAPL")
    assert unresolved is not None
    assert unresolved["order_id"].startswith("intent:")
    assert unresolved["status"] == OrderStatus.NEW.value


def test_completed_live_entry_fence_is_shared_across_store_connections(
    settings, tmp_path
):
    """첫 engine이 intent를 지운 뒤에도 같은 DB의 다른 engine은 재전송하지 않는다."""
    path = tmp_path / "live-completed-cycle.db"
    stores = [Store(path), Store(path)]
    brokers = [LiveOrderBroker(OrderStatus.FILLED, filled_quantity=50) for _ in stores]

    def make_engine(index):
        risk = RiskManager(
            stores[index],
            max_position_pct=settings.max_position_pct,
            max_positions=settings.max_positions,
            max_daily_loss_pct=settings.max_daily_loss_pct,
            max_order_notional=settings.max_order_notional,
        )
        return TradingEngine(
            brokers[index],
            SmaCrossStrategy(settings.sma_fast, settings.sma_slow),
            risk,
            stores[index],
            settings,
        )

    engines = [make_engine(index) for index in range(2)]
    signal = Signal("AAPL", SignalAction.ENTER_LONG, "race", Decimal("100"))
    stale_account = Account(cash=Decimal("10000"), positions={})
    decision_bar = datetime(2026, 8, 5, 20, 0, tzinfo=timezone.utc)
    try:
        first = engines[0]._act(
            signal,
            stale_account,
            {"AAPL": Decimal("100")},
            OPEN,
            decision_ts=decision_bar,
        )
        second = engines[1]._act(
            signal,
            stale_account,
            {"AAPL": Decimal("100")},
            OPEN + timedelta(minutes=10),
            decision_ts=decision_bar,
        )

        assert first is not None
        assert second is None
        assert sum(len(broker.requests) for broker in brokers) == 1
    finally:
        for local_store in stores:
            local_store.close()


def test_definite_rejection_is_not_retried_on_same_bar_but_next_bar_can_retry(
    settings, store
):
    engine, _, _ = build(GOLDEN, settings, store)
    broker = LiveOrderBroker(OrderStatus.REJECTED)

    def reject(request):
        broker.requests.append(request)
        raise OrderRejected("거부", request)

    broker.place_order = reject
    engine.broker = broker
    signal = Signal("AAPL", SignalAction.ENTER_LONG, "race", Decimal("100"))
    stale_account = Account(cash=Decimal("10000"), positions={})
    first_bar = datetime(2026, 8, 5, 20, 0, tzinfo=timezone.utc)
    second_bar = first_bar + timedelta(days=1)

    assert engine._act(
        signal,
        stale_account,
        {"AAPL": Decimal("100")},
        OPEN,
        decision_ts=first_bar,
    ) is None
    assert engine._act(
        signal,
        stale_account,
        {"AAPL": Decimal("100")},
        OPEN + timedelta(minutes=1),
        decision_ts=first_bar,
    ) is None
    assert len(broker.requests) == 1

    assert engine._act(
        signal,
        stale_account,
        {"AAPL": Decimal("100")},
        OPEN + timedelta(days=1),
        decision_ts=second_bar,
    ) is None
    assert len(broker.requests) == 2
    rows = store.recent_orders(10)
    assert [row["status"] for row in rows] == [
        OrderStatus.REJECTED.value,
        OrderStatus.REJECTED.value,
    ]


def test_live_submission_lease_does_not_hold_sqlite_transaction_and_allows_exit(
    tmp_path,
):
    """진입 network 수명주기 중에도 DB 조회와 다른 종목 청산은 가능하다."""
    path = tmp_path / "live-lifecycle-lease.db"
    stores = [Store(path), Store(path)]
    try:
        with stores[0].live_submission_lease("A", is_entry=True):
            assert stores[1].get_state("probe") is None
            with pytest.raises(StoreConflict, match="라이브 주문 제출"):
                with stores[1].live_submission_lease("B", is_entry=True):
                    pass
            with stores[1].live_submission_lease("B", is_entry=False):
                pass

        with stores[1].live_submission_lease("B", is_entry=True):
            pass
    finally:
        for local_store in stores:
            local_store.close()


def test_store_pins_relative_file_identity_before_cwd_changes(
    monkeypatch, tmp_path
):
    original_cwd = tmp_path / "original"
    later_cwd = tmp_path / "later"
    original_cwd.mkdir()
    later_cwd.mkdir()
    monkeypatch.chdir(original_cwd)
    owner = Store("relative-ledger.db")
    competitor = None
    try:
        monkeypatch.chdir(later_cwd)
        owner.acquire_paper_lease()

        competitor = Store(original_cwd / "relative-ledger.db")
        with pytest.raises(StoreLeaseError, match="이미|active|lock|실행"):
            competitor.acquire_paper_lease()
    finally:
        if competitor is not None:
            competitor.close()
        owner.close()


def test_hardlink_aliases_share_one_paper_writer_lease(tmp_path):
    path = tmp_path / "paper-ledger.db"
    alias = tmp_path / "paper-ledger-alias.db"
    Store(path).close()
    os.link(path, alias)

    owner = Store(path)
    competitor = Store(alias)
    try:
        owner.acquire_paper_lease()
        with pytest.raises(StoreLeaseError, match="이미|다른 프로세스|사용 중"):
            competitor.acquire_paper_lease()

        owner.release_paper_lease()
        competitor.acquire_paper_lease()
    finally:
        competitor.close()
        owner.close()


@pytest.mark.skipif(not hasattr(os, "fork"), reason="POSIX fork 전용 회귀 테스트")
def test_forked_child_rejects_inherited_store_without_releasing_parent_locks(
    tmp_path,
):
    path = tmp_path / "fork-owned.db"
    state_base = tmp_path / "live-state"
    scope = f"https://openapi.tossinvest.com|{tmp_path}-fork-owner"
    owner = Store(path)
    owner.acquire_live_account_lease(scope)
    read_fd, write_fd = os.pipe()
    pid = os.fork()
    if pid == 0:  # pragma: no cover - assertions execute in the parent
        os.close(read_fd)
        outcomes = {}
        for label, operation in (
            ("use", lambda: owner.get_state("probe")),
            ("close", owner.close),
        ):
            try:
                operation()
            except BaseException as exc:
                outcomes[label] = f"{type(exc).__name__}:{exc}"
            else:
                outcomes[label] = "ok"
        os.write(write_fd, json.dumps(outcomes).encode("utf-8"))
        os.close(write_fd)
        os._exit(0)

    os.close(write_fd)
    try:
        payload = os.read(read_fd, 8192)
        _, status = os.waitpid(pid, 0)
        outcomes = json.loads(payload.decode("utf-8"))
        assert os.waitstatus_to_exitcode(status) == 0
        assert "StoreConflict" in outcomes["use"]
        assert "StoreConflict" in outcomes["close"]

        # A fresh interpreter has no inherited in-memory lease registry, so this
        # specifically proves that the child did not unlock the parent's flock.
        source = Path(__file__).resolve().parents[1] / "src"
        probe = subprocess.run(
            [
                sys.executable,
                "-c",
                (
                    "import sys\n"
                    "from pathlib import Path\n"
                    "from tossquant.store import Store, StoreConflict\n"
                    "Store._live_state_base = staticmethod(lambda: Path(sys.argv[3]))\n"
                    "candidate = Store(sys.argv[1])\n"
                    "try:\n"
                    "    candidate.acquire_live_account_lease(sys.argv[2])\n"
                    "except StoreConflict:\n"
                    "    candidate.close()\n"
                    "    raise SystemExit(23)\n"
                    "candidate.close()\n"
                ),
                str(path),
                scope,
                str(state_base),
            ],
            cwd=tmp_path,
            env={**os.environ, "PYTHONPATH": str(source)},
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert probe.returncode == 23, probe.stderr
        assert owner.get_state("probe") is None
    finally:
        os.close(read_fd)
        owner.close()

    reopened = Store(path)
    try:
        reopened.acquire_live_account_lease(scope)
    finally:
        reopened.close()


@pytest.mark.skipif(not hasattr(os, "fork"), reason="POSIX fork 전용 회귀 테스트")
def test_forked_child_resets_local_registries_but_parent_os_locks_still_win(
    tmp_path,
):
    path = tmp_path / "fork-registry.db"
    alias = tmp_path / "fork-registry-alias.db"
    scope = f"https://openapi.tossinvest.com|{tmp_path}-fork-registry"
    owner = Store(path)
    owner.acquire_paper_lease()
    owner.acquire_live_account_lease(scope)
    os.link(path, alias)

    read_fd, write_fd = os.pipe()
    pid = os.fork()
    if pid == 0:  # pragma: no cover - assertions execute in the parent
        os.close(read_fd)
        outcomes: dict[str, str] = {}
        candidates = [Store(alias), Store(path)]
        try:
            for label, operation in (
                ("paper", candidates[0].acquire_paper_lease),
                (
                    "live",
                    lambda: candidates[1].acquire_live_account_lease(scope),
                ),
            ):
                try:
                    operation()
                except BaseException as exc:
                    outcomes[label] = f"{type(exc).__name__}:{exc}"
                else:
                    outcomes[label] = "ok"
        finally:
            for candidate in candidates:
                candidate.close()
        os.write(write_fd, json.dumps(outcomes).encode("utf-8"))
        os.close(write_fd)
        os._exit(0)

    os.close(write_fd)
    try:
        payload = os.read(read_fd, 8192)
        _, status = os.waitpid(pid, 0)
        outcomes = json.loads(payload.decode("utf-8"))
        assert os.waitstatus_to_exitcode(status) == 0
        assert "StoreLeaseError" in outcomes["paper"]
        assert "다른 프로세스" in outcomes["paper"]
        assert "StoreConflict" in outcomes["live"]
        assert "다른 프로세스" in outcomes["live"]
        assert owner.get_state("probe") is None
    finally:
        os.close(read_fd)
        owner.close()

    reopened = Store(alias)
    try:
        reopened.acquire_paper_lease()
    finally:
        reopened.close()


def test_close_waits_for_in_progress_live_submission_context(tmp_path):
    local_store = Store(tmp_path / "close-vs-submission.db")
    entered = threading.Event()
    release = threading.Event()
    submission_done = threading.Event()
    close_done = threading.Event()
    errors: list[BaseException] = []

    def submit() -> None:
        try:
            with local_store.live_submission_lease("AAPL", is_entry=True):
                entered.set()
                assert release.wait(timeout=2)
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)
        finally:
            submission_done.set()

    def close() -> None:
        try:
            local_store.close()
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)
        finally:
            close_done.set()

    submitter = threading.Thread(target=submit, daemon=True)
    closer = threading.Thread(target=close, daemon=True)
    submitter.start()
    assert entered.wait(timeout=2)
    closer.start()
    close_was_blocked = not close_done.wait(timeout=0.2)
    release.set()
    submitter.join(timeout=2)
    closer.join(timeout=2)

    assert close_was_blocked
    assert submission_done.is_set() and close_done.is_set()
    assert errors == []


def test_live_account_release_is_forbidden_inside_submission_context(tmp_path):
    path = tmp_path / "release-vs-submission.db"
    scope = f"https://openapi.tossinvest.com|{tmp_path}-release"
    owner = Store(path)
    competitor = Store(path)
    try:
        owner.acquire_live_account_lease(scope)
        with owner.live_submission_lease(
            "AAPL", is_entry=True, account_scope=scope
        ):
            with pytest.raises(StoreConflict, match="제출|컨텍스트|release"):
                owner.release_live_account_lease()
            with pytest.raises(StoreConflict, match="계좌|DB|사용 중"):
                competitor.acquire_live_account_lease(scope)

        owner.release_live_account_lease()
        competitor.acquire_live_account_lease(scope)
    finally:
        competitor.close()
        owner.close()


def test_account_scoped_live_lease_conflicts_across_different_db_paths(tmp_path):
    stores = [Store(tmp_path / "one.db"), Store(tmp_path / "two.db")]
    scope = "https://openapi.tossinvest.com\0client\0account"
    try:
        with stores[0].live_submission_lease(
            "A", is_entry=True, account_scope=scope
        ):
            with pytest.raises(StoreConflict, match="라이브 주문 제출"):
                with stores[1].live_submission_lease(
                    "B", is_entry=True, account_scope=scope
                ):
                    pass

            # A different account must not be serialized behind this one.
            with stores[1].live_submission_lease(
                "B", is_entry=True, account_scope=f"{scope}-other"
            ):
                pass
    finally:
        for local_store in stores:
            local_store.close()


def test_live_account_owner_conflicts_across_different_tmpdir_environments(
    tmp_path,
):
    """TMPDIR spelling must not split the safety domain for one account."""
    source = Path(__file__).resolve().parents[1] / "src"
    state_base = tmp_path / "stable-state"
    state_base.mkdir(mode=0o700)
    temp_roots = [tmp_path / "tmp-a", tmp_path / "tmp-b"]
    for temp_root in temp_roots:
        temp_root.mkdir()
    scope = f"https://openapi.tossinvest.com|{tmp_path}-account"
    child_code = """
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from tossquant.store import Store, StoreConflict

if hasattr(Store, "_live_state_base"):
    Store._live_state_base = staticmethod(lambda: Path(sys.argv[4]))
store = Store(sys.argv[2])
try:
    store.acquire_live_account_lease(sys.argv[3])
except StoreConflict as exc:
    print(f"blocked:{exc}", flush=True)
else:
    print("owned", flush=True)
    sys.stdin.readline()
finally:
    store.close()
"""
    processes: list[subprocess.Popen[str]] = []
    try:
        first_env = {**os.environ, "TMPDIR": str(temp_roots[0])}
        first = subprocess.Popen(
            [
                sys.executable,
                "-c",
                child_code,
                str(source),
                str(tmp_path / "one.db"),
                scope,
                str(state_base),
            ],
            env=first_env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        processes.append(first)
        assert first.stdout is not None
        assert first.stdout.readline().strip() == "owned"

        second_env = {**os.environ, "TMPDIR": str(temp_roots[1])}
        second = subprocess.Popen(
            [
                sys.executable,
                "-c",
                child_code,
                str(source),
                str(tmp_path / "two.db"),
                scope,
                str(state_base),
            ],
            env=second_env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        processes.append(second)
        assert second.stdout is not None
        assert second.stdout.readline().strip().startswith("blocked:")
        second.wait(timeout=5)
        assert second.returncode == 0

        # A hard process death releases only the OS locks. The durable binding
        # must still allow the original ledger, while continuing to reject the
        # different path checked above.
        first.kill()
        first.wait(timeout=5)
        restarted = subprocess.Popen(
            [
                sys.executable,
                "-c",
                child_code,
                str(source),
                str(tmp_path / "one.db"),
                scope,
                str(state_base),
            ],
            env=second_env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        processes.append(restarted)
        assert restarted.stdout is not None
        assert restarted.stdout.readline().strip() == "owned"
        assert restarted.stdin is not None
        restarted.stdin.write("\n")
        restarted.stdin.flush()
        _, stderr = restarted.communicate(timeout=5)
        assert restarted.returncode == 0, stderr
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)


def test_live_lease_root_rejects_existing_world_writable_directory(tmp_path):
    source = Path(__file__).resolve().parents[1] / "src"
    state_base = tmp_path / "unsafe-state"
    root = state_base / "live-leases"
    root.mkdir(parents=True)
    state_base.chmod(0o700)
    root.chmod(0o777)
    child_code = """
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from tossquant.store import Store, StoreConflict

if hasattr(Store, "_live_state_base"):
    Store._live_state_base = staticmethod(lambda: Path(sys.argv[2]))
try:
    Store._live_lease_root()
except StoreConflict:
    print("blocked")
else:
    print("accepted")
"""
    env = {**os.environ, "TMPDIR": str(state_base)}
    completed = subprocess.run(
        [sys.executable, "-c", child_code, str(source), str(state_base)],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == "blocked"


def test_live_lease_root_rejects_world_writable_state_base(
    monkeypatch, tmp_path
):
    state_base = tmp_path / "unsafe-state-base"
    root = state_base / "live-leases"
    root.mkdir(parents=True, mode=0o700)
    state_base.chmod(0o777)
    monkeypatch.setattr(
        Store, "_live_state_base", staticmethod(lambda: state_base)
    )

    with pytest.raises(StoreConflict, match="상태.*0700|상태.*권한"):
        Store._live_lease_root()


def test_live_lease_root_rejects_symlink(monkeypatch, tmp_path):
    state_base = tmp_path / "state"
    state_base.mkdir(mode=0o700)
    redirected = tmp_path / "redirected"
    redirected.mkdir(mode=0o700)
    (state_base / "live-leases").symlink_to(redirected, target_is_directory=True)
    monkeypatch.setattr(
        Store, "_live_state_base", staticmethod(lambda: state_base)
    )

    with pytest.raises(StoreConflict, match="안전|폴더|경로"):
        Store._live_lease_root()


def test_live_owner_lock_rejects_symlink(monkeypatch, tmp_path):
    state_base = tmp_path / "state"
    monkeypatch.setattr(
        Store, "_live_state_base", staticmethod(lambda: state_base)
    )
    root = Store._live_lease_root()
    scope = f"https://openapi.tossinvest.com|{tmp_path}-symlink-lock"
    target = root / "attacker-target"
    target.write_bytes(b"")
    target.chmod(0o600)
    owner_lock = root / f"{sha256(scope.encode('utf-8')).hexdigest()}.owner.lock"
    owner_lock.symlink_to(target)

    local_store = Store(tmp_path / "symlink-owner.db")
    try:
        with pytest.raises(StoreConflict, match="잠금|안전|열지"):
            local_store.acquire_live_account_lease(scope)
    finally:
        local_store.close()


def test_live_binding_rejects_non_private_file_mode(monkeypatch, tmp_path):
    state_base = tmp_path / "state"
    monkeypatch.setattr(
        Store, "_live_state_base", staticmethod(lambda: state_base)
    )
    root = Store._live_lease_root()
    scope = f"https://openapi.tossinvest.com|{tmp_path}-binding-mode"
    binding = root / (
        f"{sha256(scope.encode('utf-8')).hexdigest()}.db-binding.json"
    )
    binding.write_text("{}", encoding="utf-8")
    binding.chmod(0o644)

    local_store = Store(tmp_path / "binding-mode.db")
    try:
        with pytest.raises(StoreConflict, match="0600|권한"):
            local_store.acquire_live_account_lease(scope)
    finally:
        local_store.close()


def test_same_live_account_is_durably_bound_to_one_db_path(tmp_path):
    path_one = tmp_path / "one.db"
    path_two = tmp_path / "two.db"
    scope = f"https://openapi.tossinvest.com\0{tmp_path}-account"
    first = Store(path_one)
    second = Store(path_two)
    try:
        first.acquire_live_account_lease(scope)
        with pytest.raises(StoreConflict, match="계좌|account|DB"):
            second.acquire_live_account_lease(scope)
        second.acquire_live_account_lease(f"{scope}-other-account")
    finally:
        first.close()
        second.close()

    # The OS owner lock is released on close, but changing the durable ledger
    # path after a crash/restart must still require explicit reconciliation.
    reopened_other = Store(path_two)
    try:
        with pytest.raises(StoreConflict, match="DB|원장|대사"):
            reopened_other.acquire_live_account_lease(scope)
    finally:
        reopened_other.close()

    reopened_original = Store(path_one)
    try:
        reopened_original.acquire_live_account_lease(scope)
    finally:
        reopened_original.close()


def test_recreated_db_at_bound_path_fails_live_owner_acquisition(tmp_path):
    path = tmp_path / "bound.db"
    scope = f"https://openapi.tossinvest.com|{tmp_path}-recreate"
    original = Store(path)
    original.acquire_live_account_lease(scope)
    original.close()

    path.unlink()
    recreated = Store(path)
    try:
        with pytest.raises(StoreConflict, match="원장|ledger|UUID|대사"):
            recreated.acquire_live_account_lease(scope)
    finally:
        recreated.close()


def test_legacy_path_only_live_binding_fails_closed_for_acquire_and_reset(
    tmp_path,
):
    path = tmp_path / "legacy-bound.db"
    scope = f"https://openapi.tossinvest.com|{tmp_path}-legacy"
    original = Store(path)
    original.close()

    binding = Store._live_lease_root() / (
        f"{sha256(scope.encode('utf-8')).hexdigest()}.db-binding.json"
    )
    binding.write_text(
        json.dumps({"db_path": str(path.resolve())}), encoding="utf-8"
    )
    binding.chmod(0o600)

    with pytest.raises(StoreConflict, match="라이브|원장|대사"):
        Store.reset_paper_database(path)

    reopened = Store(path)
    try:
        with pytest.raises(StoreConflict, match="원장|UUID|대사"):
            reopened.acquire_live_account_lease(scope)
    finally:
        reopened.close()


def test_reset_rejects_regular_db_leaf_replaced_after_inspection(
    monkeypatch, tmp_path
):
    path = tmp_path / "reset-target.db"
    replacement = tmp_path / "replacement.db"
    parked_original = tmp_path / "parked-original.db"
    Store(path).close()
    Store(replacement).close()

    def replace_during_binding_scan(cls, root, canonical):
        Path(canonical).replace(parked_original)
        replacement.replace(canonical)
        return False

    monkeypatch.setattr(
        Store,
        "_live_binding_references_db",
        classmethod(replace_during_binding_scan),
    )

    with pytest.raises(StoreConflict, match="바뀌|변경|reset 대상"):
        Store.reset_paper_database(path)

    assert path.exists()
    assert parked_original.exists()


def test_reset_restores_replacement_swapped_immediately_before_final_rename(
    monkeypatch, tmp_path
):
    path = tmp_path / "reset-final-rename.db"
    replacement = tmp_path / "replacement-final-rename.db"
    parked_original = tmp_path / "parked-final-rename-original.db"
    Store(path).close()
    Store(replacement).close()
    with sqlite3.connect(replacement) as connection:
        connection.execute("CREATE TABLE replacement_marker (value TEXT)")
        connection.execute("INSERT INTO replacement_marker VALUES ('preserved')")

    original_rename = os.rename
    original_link = os.link
    original_delete = Store._delete_reset_target.__func__
    original_fsync = Store._fsync_directory
    injected = False
    replacement_linked = False
    fsynced_after_restore = False

    def replace_at_final_rename(source, destination):
        nonlocal injected
        if not injected and Path(source) == path:
            injected = True
            os.replace(path, parked_original)
            os.replace(replacement, path)
        return original_rename(source, destination)

    monkeypatch.setattr(os, "rename", replace_at_final_rename)

    def track_replacement_link(source, destination, **kwargs):
        nonlocal replacement_linked
        result = original_link(source, destination, **kwargs)
        if Path(destination) == path:
            replacement_linked = True
        return result

    def track_restore_fsync(directory):
        nonlocal fsynced_after_restore
        result = original_fsync(directory)
        if replacement_linked and Path(directory) == path.parent:
            fsynced_after_restore = True
        return result

    monkeypatch.setattr(os, "link", track_replacement_link)
    monkeypatch.setattr(
        Store, "_fsync_directory", staticmethod(track_restore_fsync)
    )
    original_wal = Path(f"{path}-wal")

    def delete_with_original_sidecar(cls, target, expected):
        original_wal.write_bytes(b"original-ledger-wal")
        return original_delete(cls, target, expected)

    monkeypatch.setattr(
        Store,
        "_delete_reset_target",
        classmethod(delete_with_original_sidecar),
    )

    with pytest.raises(StoreConflict, match="바뀌|변경|reset 대상|격리"):
        Store.reset_paper_database(path)

    assert injected
    assert replacement_linked
    assert fsynced_after_restore
    assert path.exists()
    assert parked_original.exists()
    assert not original_wal.exists()
    quarantines = list(tmp_path.glob(f".{path.name}.reset-*"))
    assert len(quarantines) == 1
    assert (quarantines[0] / original_wal.name).read_bytes() == (
        b"original-ledger-wal"
    )
    with sqlite3.connect(path) as connection:
        assert connection.execute(
            "SELECT value FROM replacement_marker"
        ).fetchone() == ("preserved",)


def test_reset_preserves_concurrent_replacement_database_and_wal(
    monkeypatch, tmp_path
):
    path = tmp_path / "reset-concurrent.db"
    Store(path).close()
    removed = threading.Event()
    replacement_ready = threading.Event()
    release_replacement = threading.Event()
    errors: list[BaseException] = []
    original_delete = Store._delete_reset_target.__func__

    def replace_with_wal() -> None:
        connection = None
        try:
            assert removed.wait(timeout=2)
            connection = sqlite3.connect(path)
            assert connection.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
            connection.execute("PRAGMA wal_autocheckpoint=0")
            connection.execute("CREATE TABLE replacement (value TEXT NOT NULL)")
            connection.execute("INSERT INTO replacement VALUES ('preserved')")
            connection.commit()
            assert Path(f"{path}-wal").exists()
            replacement_ready.set()
            assert release_replacement.wait(timeout=2)
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)
            replacement_ready.set()
        finally:
            if connection is not None:
                connection.close()

    worker = threading.Thread(target=replace_with_wal, daemon=True)
    worker.start()

    def pause_after_delete(cls, target, expected):
        original_delete(cls, target, expected)
        removed.set()
        assert replacement_ready.wait(timeout=2)

    monkeypatch.setattr(
        Store, "_delete_reset_target", classmethod(pause_after_delete)
    )
    try:
        with pytest.raises(StoreConflict, match="새|바뀌|교체|reset"):
            Store.reset_paper_database(path)

        assert path.exists()
        assert Path(f"{path}-wal").exists()
        with sqlite3.connect(path) as check:
            assert check.execute("SELECT value FROM replacement").fetchone() == (
                "preserved",
            )
    finally:
        release_replacement.set()
        worker.join(timeout=2)

    assert not worker.is_alive()
    assert errors == []


def test_live_ledger_identity_commit_recovers_after_binding_failure(
    monkeypatch, tmp_path
):
    path = tmp_path / "partial-binding.db"
    scope = f"https://openapi.tossinvest.com|{tmp_path}-partial-binding"
    local_store = Store(path)
    original = local_store._bind_live_account_db

    def fail_binding(*args, **kwargs):
        raise StoreConflict("injected binding failure")

    monkeypatch.setattr(local_store, "_bind_live_account_db", fail_binding)
    with pytest.raises(StoreConflict, match="injected"):
        local_store.acquire_live_account_lease(scope)

    ledger_uuid = local_store.get_state("live.ledger_uuid")
    assert isinstance(ledger_uuid, str) and len(ledger_uuid) == 32
    assert local_store.get_state("live.account_scope_hash") == sha256(
        scope.encode("utf-8")
    ).hexdigest()

    monkeypatch.setattr(local_store, "_bind_live_account_db", original)
    try:
        local_store.acquire_live_account_lease(scope)
    finally:
        local_store.close()


def test_one_live_ledger_rejects_second_account_scope(tmp_path):
    path = tmp_path / "one-ledger.db"
    stores = [Store(path), Store(path)]
    try:
        stores[0].acquire_live_account_lease(
            "https://openapi.tossinvest.com|ACCOUNT-A"
        )
        with pytest.raises(StoreConflict, match="계좌|account|원장|ledger"):
            stores[1].acquire_live_account_lease(
                "https://openapi.tossinvest.com|ACCOUNT-B"
            )
    finally:
        for local_store in stores:
            local_store.close()


def test_concurrent_same_store_live_account_acquisition_is_idempotent(tmp_path):
    local_store = Store(tmp_path / "shared.db")
    scope = "https://openapi.tossinvest.com\0same-store-account"
    start = threading.Barrier(2)
    acquired: list[bool] = []
    errors: list[BaseException] = []

    def acquire() -> None:
        start.wait(timeout=2)
        try:
            local_store.acquire_live_account_lease(scope)
            acquired.append(True)
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    workers = [threading.Thread(target=acquire) for _ in range(2)]
    try:
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(timeout=3)

        assert all(not worker.is_alive() for worker in workers)
        assert errors == []
        assert acquired == [True, True]
    finally:
        local_store.close()


def test_close_does_not_hold_db_lock_while_waiting_for_live_account_lock(
    monkeypatch, tmp_path
):
    local_store = Store(tmp_path / "close-order.db")
    entered_binding = threading.Event()
    release_binding = threading.Event()
    close_has_db_lock = threading.Event()
    original_binding = local_store._bind_live_ledger_identity

    class ObservedRLock:
        def __init__(self) -> None:
            self._lock = threading.RLock()

        def __enter__(self):
            self._lock.acquire()
            if threading.current_thread().name == "store-closer":
                close_has_db_lock.set()
            return self

        def __exit__(self, exc_type, exc, traceback):
            self._lock.release()

    local_store._db_lock = ObservedRLock()

    def paused_binding(scope_hash):
        entered_binding.set()
        assert release_binding.wait(timeout=2)
        if close_has_db_lock.is_set():
            raise StoreConflict("abort old inverted ordering")
        return original_binding(scope_hash)

    monkeypatch.setattr(
        local_store, "_bind_live_ledger_identity", paused_binding
    )
    errors: list[BaseException] = []

    def acquire() -> None:
        try:
            local_store.acquire_live_account_lease(
                f"https://openapi.tossinvest.com|{tmp_path}-close-order"
            )
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    owner = threading.Thread(target=acquire, name="store-owner", daemon=True)
    closer = threading.Thread(
        target=local_store.close, name="store-closer", daemon=True
    )
    owner.start()
    assert entered_binding.wait(timeout=2)
    closer.start()
    inverted = close_has_db_lock.wait(timeout=0.2)
    release_binding.set()
    owner.join(timeout=2)
    closer.join(timeout=2)

    assert not inverted
    assert not owner.is_alive() and not closer.is_alive()
    assert errors == []


def test_live_entry_refreshes_account_inside_account_scoped_lease(settings, store):
    """A completed entry in another engine must invalidate the stale snapshot."""
    settings.max_positions = 1
    settings.max_position_pct = Decimal("1")
    settings.max_order_notional = Decimal("10000")
    broker = LiveOrderBroker(OrderStatus.FILLED)

    def place(request):
        broker.requests.append(request)
        position = Position(request.symbol, request.quantity, Decimal("100"))
        broker.account = Account(
            cash=broker.account.cash - Decimal("100") * request.quantity,
            positions={**broker.account.positions, request.symbol: position},
        )
        return Order(
            order_id=f"live-{len(broker.requests)}",
            client_order_id=request.client_order_id,
            symbol=request.symbol,
            side=request.side,
            quantity=request.quantity,
            filled_quantity=request.quantity,
            avg_fill_price=Decimal("100"),
            status=OrderStatus.FILLED,
            ts=datetime.now(timezone.utc),
        )

    broker.place_order = place

    def make_engine(local_store):
        return TradingEngine(
            broker,
            SmaCrossStrategy(settings.sma_fast, settings.sma_slow),
            RiskManager(
                local_store,
                max_position_pct=settings.max_position_pct,
                max_positions=settings.max_positions,
                max_daily_loss_pct=settings.max_daily_loss_pct,
                max_order_notional=settings.max_order_notional,
            ),
            local_store,
            settings,
        )

    engines = [make_engine(store), make_engine(store)]
    stale = Account(cash=Decimal("10000"), positions={})
    decision_bar = datetime(2026, 8, 5, 20, 0, tzinfo=timezone.utc)
    assert engines[0]._act(
        Signal("A", SignalAction.ENTER_LONG, "first", Decimal("100")),
        stale,
        {"A": Decimal("100")},
        OPEN,
        decision_ts=decision_bar,
    ) is not None
    assert engines[1]._act(
        Signal("B", SignalAction.ENTER_LONG, "stale", Decimal("100")),
        stale,
        {"B": Decimal("100")},
        OPEN + timedelta(minutes=1),
        decision_ts=decision_bar,
    ) is None
    assert [request.symbol for request in broker.requests] == ["A"]


def test_live_account_scope_canonicalizes_default_port_idna_and_path(
    settings, store
):
    engine, _, _ = build(GOLDEN, settings, store)
    settings.base_url = "https://BÜCHER.example:443/api/../v1/"
    first = engine._live_account_scope()
    settings.base_url = "https://xn--bcher-kva.example/v1"
    second = engine._live_account_scope()
    settings.base_url = "https://BÜCHER.example.:443/%76%31//"
    percent_encoded = engine._live_account_scope()
    assert first == second == percent_encoded


@pytest.mark.parametrize(
    "base_url",
    [
        "ftp://openapi.tossinvest.com",
        "https://user@openapi.tossinvest.com",
        "https://openapi.tossinvest.com?environment=other",
        "https://openapi.tossinvest.com#other",
        "https:///missing-host",
        "https://openapi.tossinvest.com/%00",
        "https://openapi.tossinvest.com:99999",
        "https://%00",
    ],
)
def test_live_account_scope_rejects_invalid_url(base_url, settings, store):
    engine, _, _ = build(GOLDEN, settings, store)
    settings.base_url = base_url
    with pytest.raises(BrokerError, match="base_url|URL|http"):
        engine._live_account_scope()


def test_live_client_order_id_is_scoped_to_account(settings, store):
    engine, _, _ = build(GOLDEN, settings, store)
    decision_bar = datetime(2026, 8, 5, 20, 0, tzinfo=timezone.utc)
    settings.account_id = "ACCOUNT-A"
    first = engine._live_client_order_id("AAPL", Side.BUY, decision_bar)
    settings.account_id = "ACCOUNT-B"
    second = engine._live_client_order_id("AAPL", Side.BUY, decision_bar)
    assert first != second


def test_same_engine_rejects_overlapping_run_once(settings, store):
    engine, _, _ = build(GOLDEN, settings, store)
    entered = threading.Event()
    release = threading.Event()
    calls: list[datetime | None] = []

    def blocking_cycle(now=None):
        calls.append(now)
        entered.set()
        assert release.wait(timeout=2)
        return []

    engine._run_once = blocking_cycle  # type: ignore[method-assign]
    worker = threading.Thread(target=lambda: engine.run_once(OPEN))
    worker.start()
    assert entered.wait(timeout=2)
    try:
        assert engine.run_once(OPEN + timedelta(days=1)) == []
        assert calls == [OPEN]
    finally:
        release.set()
        worker.join(timeout=2)
    assert not worker.is_alive()


def test_store_rejects_external_live_order_in_intent_namespace(store):
    with pytest.raises(ValueError, match="intent"):
        store.save_order(
            Order(
                order_id="intent:broker-order",
                client_order_id="external-client",
                symbol="AAPL",
                side=Side.BUY,
                quantity=1,
                filled_quantity=1,
                avg_fill_price=Decimal("100"),
                status=OrderStatus.FILLED,
                ts=OPEN,
            ),
            origin="live",
        )


def test_live_submission_lease_is_exclusive_across_processes(tmp_path):
    path = tmp_path / "live-process-lease.db"
    source = Path(__file__).resolve().parents[1] / "src"
    parent_store = Store(path)
    child_code = """
import sys
sys.path.insert(0, sys.argv[2])
from tossquant.store import Store

store = Store(sys.argv[1])
try:
    with store.live_submission_lease("AAPL", is_entry=True):
        print("locked", flush=True)
        sys.stdin.readline()
finally:
    store.close()
"""
    process = subprocess.Popen(
        [sys.executable, "-c", child_code, str(path), str(source)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert process.stdout is not None
        assert process.stdout.readline().strip() == "locked"
        with pytest.raises(StoreConflict, match="라이브 주문 제출"):
            with parent_store.live_submission_lease("AAPL", is_entry=True):
                pass

        assert process.stdin is not None
        process.stdin.write("\n")
        process.stdin.flush()
        stdout, stderr = process.communicate(timeout=5)
        assert process.returncode == 0, (stdout, stderr)

        with parent_store.live_submission_lease("AAPL", is_entry=True):
            pass
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)
        parent_store.close()


def test_live_intent_claim_is_atomic_across_store_connections(tmp_path):
    """같은 파일 DB를 연 두 engine도 미확정 진입 하나만 claim한다."""
    path = tmp_path / "live-intent-race.db"
    stores = [Store(path), Store(path)]
    start = threading.Barrier(2)
    claims: list[str] = []
    conflicts: list[StoreConflict] = []

    def claim(index: int) -> None:
        request = OrderRequest(
            symbol="AAPL",
            side=Side.BUY,
            quantity=10,
            client_order_id=f"concurrent-{index}",
        )
        start.wait(timeout=2)
        try:
            claims.append(stores[index].claim_live_intent(request, OPEN))
        except StoreConflict as exc:
            conflicts.append(exc)

    workers = [threading.Thread(target=claim, args=(index,)) for index in range(2)]
    try:
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(timeout=3)

        assert all(not worker.is_alive() for worker in workers)
        assert len(claims) == 1
        assert len(conflicts) == 1
        rows = stores[0]._conn.execute(  # noqa: SLF001 - 원자 claim 원장 검증
            "SELECT * FROM orders WHERE status = ?", (OrderStatus.NEW.value,)
        ).fetchall()
        assert len(rows) == 1
    finally:
        for local_store in stores:
            local_store.close()


def test_partial_live_exit_does_not_start_cooldown_or_resubmit(settings, store):
    settings.stop_cooldown_days = 3
    engine, _, _ = build(FLAT, settings, store)
    broker = LiveOrderBroker(OrderStatus.PARTIALLY_FILLED, filled_quantity=5)
    engine.broker = broker
    store.save_tracking(
        "AAPL",
        high_water=Decimal("120"),
        opened_at=OPEN,
        blocked_until=None,
    )
    signal = Signal(
        "AAPL",
        SignalAction.EXIT,
        "protective",
        Decimal("90"),
        protective=True,
    )
    account = Account(
        cash=Decimal("0"),
        positions={"AAPL": Position("AAPL", 10, Decimal("100"))},
    )
    broker.account = account

    first = engine._act(signal, account, {"AAPL": Decimal("90")}, OPEN)
    second = engine._act(signal, account, {"AAPL": Decimal("90")}, OPEN)

    assert first is None
    assert second is None
    assert len(broker.requests) == 1
    tracking = store.load_tracking("AAPL")
    assert tracking is not None
    assert tracking["opened_at"] == OPEN.isoformat()
    assert tracking["blocked_until"] is None


def test_partial_live_order_stops_batch_before_max_positions_can_be_bypassed(
    settings, store
):
    settings.symbols = ["A", "B"]
    settings.max_positions = 1
    settings.max_position_pct = Decimal("1")
    settings.max_order_notional = Decimal("1000")
    broker = PartialFirstLiveBroker(partial_quantity=1)
    engine = build_live_batch_engine(settings, store, broker)

    executed = engine.run_once(OPEN)

    assert executed == []
    assert [request.symbol for request in broker.requests] == ["A"]
    assert set(broker.positions) == {"A"}
    # Initial snapshot + lease-scoped preflight + post-submission refresh.
    assert broker.account_calls == 3


def test_canceled_partial_live_order_stops_batch_and_preserves_terminal_record(
    settings, store
):
    settings.symbols = ["A", "B"]
    settings.max_positions = 1
    settings.max_position_pct = Decimal("1")
    settings.max_order_notional = Decimal("1000")
    broker = PartialFirstLiveBroker(partial_quantity=1)
    original_place_order = broker.place_order

    def canceled_partial_then_fill(request):
        order = original_place_order(request)
        if request.symbol == "A":
            return replace(order, status=OrderStatus.CANCELED)
        return order

    broker.place_order = canceled_partial_then_fill
    engine = build_live_batch_engine(settings, store, broker)

    executed = engine.run_once(OPEN)

    assert executed == []
    assert [request.symbol for request in broker.requests] == ["A"]
    assert set(broker.positions) == {"A"}
    assert broker.account_calls == 3
    row = store.recent_orders(1)[0]
    assert row["symbol"] == "A"
    assert row["status"] == OrderStatus.CANCELED.value
    assert row["filled_quantity"] == 1
    assert store.unresolved_live_order() is None


def test_unresolved_live_order_globally_fences_later_cash_using_entry(
    settings, store
):
    settings.symbols = ["A", "B"]
    settings.max_positions = 2
    settings.max_position_pct = Decimal("1")
    settings.max_order_notional = Decimal("10000")
    broker = PartialFirstLiveBroker(partial_quantity=90)
    engine = build_live_batch_engine(settings, store, broker)

    engine.run_once(OPEN)
    # A 부분체결 뒤 현금은 1,000이라 B 9주는 심사를 통과할 수 있지만,
    # A의 최종 상태가 불명인 동안 새 진입 자체를 전역 차단해야 한다.
    engine.run_once(OPEN + timedelta(minutes=1))

    assert [request.symbol for request in broker.requests] == ["A"]
    assert broker.cash == Decimal("1000")


def test_ambiguous_live_submission_stops_batch_and_refreshes_account(
    settings, store
):
    settings.symbols = ["A", "B"]
    settings.max_positions = 2
    broker = PartialFirstLiveBroker(partial_quantity=1)

    def ambiguous(request):
        broker.requests.append(request)
        raise BrokerError("주문 결과 불명 — 확인 필요")

    broker.place_order = ambiguous
    engine = build_live_batch_engine(settings, store, broker)

    executed = engine.run_once(OPEN)

    assert executed == []
    assert [request.symbol for request in broker.requests] == ["A"]
    assert broker.account_calls == 3
    assert store.unresolved_live_order("A") is not None


def test_rejected_with_unreconciled_partial_fill_keeps_intent_and_stops_batch(
    settings, store
):
    settings.symbols = ["A", "B"]
    settings.max_positions = 1
    settings.max_position_pct = Decimal("1")
    settings.max_order_notional = Decimal("1000")
    broker = PartialFirstLiveBroker(partial_quantity=1)
    original_place_order = broker.place_order

    def rejected_with_fill(request):
        original_place_order(request)
        raise BrokerError(
            "REJECTED 응답의 체결 상태 불명 — reconciliation required"
        )

    broker.place_order = rejected_with_fill
    engine = build_live_batch_engine(settings, store, broker)

    executed = engine.run_once(OPEN)

    assert executed == []
    assert [request.symbol for request in broker.requests] == ["A"]
    assert set(broker.positions) == {"A"}
    assert broker.account_calls == 3
    unresolved = store.unresolved_live_order("A")
    assert unresolved is not None
    assert unresolved["order_id"].startswith("intent:")


def test_global_unresolved_entry_does_not_block_other_symbol_exit(settings, store):
    engine, _, _ = build(FLAT, settings, store)
    broker = LiveOrderBroker(OrderStatus.FILLED, filled_quantity=10)
    engine.broker = broker
    store.save_order(
        Order(
            order_id="live-pending-A",
            client_order_id="pending-A",
            symbol="A",
            side=Side.BUY,
            quantity=10,
            filled_quantity=0,
            avg_fill_price=Decimal("0"),
            status=OrderStatus.NEW,
            ts=OPEN,
        )
    )
    signal = Signal("B", SignalAction.EXIT, "safety exit", Decimal("100"))
    account = Account(
        cash=Decimal("0"),
        positions={"B": Position("B", 10, Decimal("100"))},
    )
    broker.account = account

    order = engine._act(signal, account, {"B": Decimal("100")}, OPEN)

    assert order is not None
    assert [request.symbol for request in broker.requests] == ["B"]


def test_live_order_id_with_paper_prefix_still_fences_new_entry(settings, store):
    engine, _, _ = build(FLAT, settings, store)
    broker = LiveOrderBroker(OrderStatus.FILLED, filled_quantity=10)
    engine.broker = broker
    store.save_order(
        Order(
            order_id="paper-real-toss-order-id",
            client_order_id="live-client",
            symbol="A",
            side=Side.BUY,
            quantity=10,
            filled_quantity=0,
            avg_fill_price=Decimal("0"),
            status=OrderStatus.NEW,
            ts=OPEN,
        ),
        origin="live",
    )
    signal = Signal("B", SignalAction.ENTER_LONG, "test", Decimal("100"))
    account = Account(cash=Decimal("10000"), positions={})

    assert engine._act(signal, account, {"B": Decimal("100")}, OPEN) is None
    assert broker.requests == []
    assert store.unresolved_live_order()["order_id"] == "paper-real-toss-order-id"


# --- 보호 청산 연동 ----------------------------------------------------------


def silence_strategy(engine) -> None:
    """전략을 침묵시켜 보호 청산만 격리해서 본다.

    급락은 손절과 데드크로스를 동시에 트리거하므로, 이렇게 하지 않으면 매도가
    어느 쪽 때문인지 구분할 수 없다.
    """
    engine.strategy.on_bar = lambda symbol, candles, position: None


def test_stop_loss_liquidates_without_any_strategy_signal(settings, store):
    settings.stop_loss_pct = Decimal("0.10")
    engine, broker, market = build(FLAT, settings, store)
    silence_strategy(engine)
    broker.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=10))

    # 평단은 20.01인데 시세가 15로 떨어졌다 (-25%).
    market.closes["AAPL"] = [Decimal("20")] * 25 + [Decimal("15")]

    orders = engine.run_once(OPEN)

    assert len(orders) == 1
    assert orders[0].side is Side.SELL
    assert "AAPL" not in broker.get_account().positions


def test_stop_loss_does_not_fire_within_threshold(settings, store):
    settings.stop_loss_pct = Decimal("0.10")
    engine, broker, market = build(FLAT, settings, store)
    silence_strategy(engine)
    broker.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=10))

    market.closes["AAPL"] = [Decimal("20")] * 25 + [Decimal("19")]  # -5%

    assert engine.run_once(OPEN) == []
    assert broker.get_account().positions["AAPL"].quantity == 10


def test_stop_out_sets_cooldown_but_strategy_exit_does_not(settings, store):
    """손절로 나간 뒤에만 재진입이 막혀야 한다."""
    settings.stop_loss_pct = Decimal("0.10")
    settings.stop_cooldown_days = 5

    engine, broker, market = build(FLAT, settings, store)
    silence_strategy(engine)
    broker.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=10))
    market.closes["AAPL"] = [Decimal("20")] * 25 + [Decimal("15")]

    engine.run_once(OPEN)

    assert engine.stops.is_blocked("AAPL", OPEN) is True


def test_cooldown_blocks_reentry_after_stop_out(settings, store):
    settings.stop_loss_pct = Decimal("0.10")
    settings.stop_cooldown_days = 5
    engine, broker, _ = build(GOLDEN, settings, store)

    engine.stops.on_exit("AAPL", OPEN, protective=True)
    orders = engine.run_once(OPEN)  # 골든크로스가 떠 있지만 쿨다운 중

    assert orders == []
    assert broker.get_account().positions == {}


def test_protective_exit_suppresses_strategy_signal_same_cycle(settings, store):
    """손절이 걸린 종목은 그 사이클에 전략 신호를 묻지 않는다."""
    from tossquant.engine import collect_signals

    settings.stop_loss_pct = Decimal("0.05")
    engine, broker, market = build(GOLDEN, settings, store)

    calls: list[str] = []

    def counting_on_bar(symbol, candles, position):
        calls.append(symbol)
        return None

    engine.strategy.on_bar = counting_on_bar
    positions = {"AAPL": Position("AAPL", 10, Decimal("100"))}

    batch = collect_signals(
        ["AAPL"], engine.strategy, engine.stops, positions,
        {"AAPL": Decimal("80")}, {"AAPL": []}, OPEN,
    )

    assert len(batch.signals) == 1
    assert batch.signals[0].protective is True
    assert calls == []  # 전략은 호출조차 되지 않았다


# --- 알림 연동 ---------------------------------------------------------------


def titles(notifier) -> list[str]:
    return [n.title for n in notifier.sent]


def test_fill_is_notified(settings, store):
    engine, _, _ = build(GOLDEN, settings, store)
    notifier = Recorder()
    engine.notifier = notifier

    engine.run_once(OPEN)

    assert len(notifier.sent) == 1
    assert "AAPL BUY" in notifier.sent[0].title
    assert notifier.sent[0].level is Level.INFO


def test_protective_exit_is_notified_as_warning(settings, store):
    settings.stop_loss_pct = Decimal("0.10")
    engine, broker, market = build(FLAT, settings, store)
    silence_strategy(engine)
    broker.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=10))
    market.closes["AAPL"] = [Decimal("20")] * 25 + [Decimal("15")]

    notifier = Recorder()
    engine.notifier = notifier
    engine.run_once(OPEN)

    assert notifier.sent[0].level is Level.WARN
    assert "보호 청산" in "\n".join(notifier.sent[0].lines)


def test_fills_can_be_muted(settings, store):
    settings.notify_fills = False
    engine, _, _ = build(GOLDEN, settings, store)
    notifier = Recorder()
    engine.notifier = notifier

    engine.run_once(OPEN)

    assert notifier.sent == []


def test_order_failure_is_notified_and_deduped(settings, store):
    engine, broker, _ = build(GOLDEN, settings, store)
    notifier = Recorder(throttle_seconds=300)
    engine.notifier = notifier

    def failing(request):
        raise BrokerError("broker down")

    broker.place_order = failing

    engine.run_once(OPEN)
    engine.run_once(OPEN)  # 같은 문제 반복 — 알림은 한 번만

    assert len(notifier.sent) == 1
    assert notifier.sent[0].level is Level.ERROR


def test_daily_loss_limit_is_notified_once_per_day(settings, store):
    settings.max_daily_loss_pct = Decimal("0.02")
    engine, broker, market = build(FLAT, settings, store)
    silence_strategy(engine)
    notifier = Recorder(throttle_seconds=0)
    engine.notifier = notifier

    engine.run_once(OPEN)  # 기준선 10000 설정
    broker.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=100))
    market.closes["AAPL"] = [Decimal("20")] * 25 + [Decimal("15")]

    engine.run_once(OPEN)
    engine.run_once(OPEN)

    breaches = [n for n in notifier.sent if "일일 손실 한도" in n.title]
    assert len(breaches) == 1


def test_daily_loss_marker_is_saved_only_after_successful_delivery(settings, store):
    settings.max_daily_loss_pct = Decimal("0.02")
    engine, _, _ = build(FLAT, settings, store)
    notifier = FailOnceRecorder()
    engine.notifier = notifier

    engine._notify_daily_loss(Decimal("9000"), Decimal("10000"), OPEN)
    assert store.get_state("notify.daily_loss_date") is None

    engine._notify_daily_loss(Decimal("9000"), Decimal("10000"), OPEN)

    assert notifier.attempts == 2
    assert len(notifier.sent) == 1
    assert store.get_state("notify.daily_loss_date") == "2026-08-06"


def test_zero_daily_loss_limit_does_not_notify(settings, store):
    settings.max_daily_loss_pct = Decimal("0")
    engine, _, _ = build(FLAT, settings, store)
    notifier = Recorder(throttle_seconds=0)
    engine.notifier = notifier

    engine._notify_daily_loss(Decimal("9000"), Decimal("10000"), OPEN)

    assert not any("일일 손실 한도" in note.title for note in notifier.sent)


def test_daily_summary_fires_near_close_only_once(settings, store):
    engine, _, _ = build(FLAT, settings, store)
    notifier = Recorder(throttle_seconds=0)
    engine.notifier = notifier

    engine.run_once(OPEN)  # 10:00 — 아직 아님
    assert not any("장 마감 요약" in t for t in titles(notifier))

    near_close = datetime(2026, 8, 6, 15, 58, tzinfo=NY)
    engine.run_once(near_close)
    engine.run_once(near_close)  # 중복 방지

    summaries = [n for n in notifier.sent if "장 마감 요약" in n.title]
    assert len(summaries) == 1


def test_daily_summary_reuses_account_positions_and_failure_does_not_block_exit(
    settings, store
):
    settings.symbols = ["AAPL"]
    settings.stop_loss_pct = Decimal("0.08")
    settings.regime_enabled = False
    broker = HoldingCoverageBroker(
        {"AAPL": Position("AAPL", 10, Decimal("100"))},
        {"AAPL": Decimal("50")},
    )

    def unexpected_position_refetch():
        raise BrokerError("summary must reuse the account snapshot")

    broker.get_positions = unexpected_position_refetch
    notifier = Recorder(fail=True)
    engine = build_coverage_engine(
        settings, store, broker, RecordingNoSignals(), notifier
    )
    near_close = datetime(2026, 8, 6, 15, 58, tzinfo=NY)

    executed = engine.run_once(near_close)

    assert [(order.symbol, order.side) for order in executed] == [
        ("AAPL", Side.SELL)
    ]
    assert [(request.symbol, request.side) for request in broker.requests] == [
        ("AAPL", Side.SELL)
    ]
    assert store.get_state("notify.summary_date") is None


def test_daily_summary_marker_is_saved_only_after_successful_delivery(
    settings, store
):
    engine, _, _ = build(FLAT, settings, store)
    notifier = FailOnceRecorder()
    engine.notifier = notifier
    near_close = datetime(2026, 8, 6, 15, 58, tzinfo=NY)

    engine._notify_daily_summary(
        Decimal("10000"), Decimal("10000"), near_close, {}
    )
    assert store.get_state("notify.summary_date") is None

    engine._notify_daily_summary(
        Decimal("10000"), Decimal("10000"), near_close, {}
    )

    assert notifier.attempts == 2
    assert len(notifier.sent) == 1
    assert store.get_state("notify.summary_date") == "2026-08-06"


def test_failed_regime_transition_is_retried_after_engine_restart(settings, store):
    settings.regime_enabled = True
    engine, broker, _ = build(FLAT, settings, store)
    store.set_state("regime.risk_on", False)
    failed = FailOnceRecorder()
    engine.notifier = failed
    recovered = RegimeState(risk_on=True, reason="SPY recovered")

    engine._notify_regime(recovered, OPEN)

    assert failed.attempts == 1
    assert failed.sent == []
    assert store.get_state("regime.risk_on") is True
    assert store.get_state("notify.regime_transition") == {
        "risk_on": True,
        "reason": "SPY recovered",
    }

    delivered = Recorder()
    restarted = TradingEngine(
        broker,
        engine.strategy,
        engine.risk,
        store,
        settings,
        stops=engine.stops,
        notifier=delivered,
        regime=engine.regime,
    )
    restarted._notify_regime(recovered, OPEN + timedelta(minutes=1))

    assert len(delivered.sent) == 1
    assert "시장 국면 → 정상" in delivered.sent[0].title
    assert store.get_state("regime.risk_on") is True
    assert store.get_state("notify.regime_transition") is None


def test_daily_summary_can_be_muted(settings, store):
    settings.notify_daily_summary = False
    engine, _, _ = build(FLAT, settings, store)
    notifier = Recorder(throttle_seconds=0)
    engine.notifier = notifier

    engine.run_once(datetime(2026, 8, 6, 15, 58, tzinfo=NY))

    assert not any("장 마감 요약" in t for t in titles(notifier))


def test_notifier_failure_does_not_break_trading(settings, store):
    """알림이 터져도 주문은 나가야 한다 — 이게 이 계층의 존재 조건이다."""
    engine, broker, _ = build(GOLDEN, settings, store)
    engine.notifier = Recorder(fail=True)

    orders = engine.run_once(OPEN)

    assert len(orders) == 1
    assert broker.get_account().positions["AAPL"].quantity > 0


def test_startup_and_shutdown_are_notified(settings, store):
    engine, _, _ = build(FLAT, settings, store)
    notifier = Recorder(throttle_seconds=0)
    engine.notifier = notifier
    engine.stop()

    engine.run_forever(sleep=lambda _: None)

    assert any("봇 시작" in t for t in titles(notifier))
    assert any("봇 종료" in t for t in titles(notifier))


def test_cycle_failure_is_notified(settings, store):
    engine, _, _ = build(FLAT, settings, store)
    notifier = Recorder(throttle_seconds=0)
    engine.notifier = notifier
    calls = {"n": 0}

    def failing_cycle(now=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient")
        engine.stop()
        return []

    engine.run_once = failing_cycle
    engine.run_forever(sleep=lambda _: None)

    failures = [n for n in notifier.sent if "사이클 실패" in n.title]
    assert len(failures) == 1
    assert failures[0].level is Level.ERROR


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


def test_startup_warns_when_key_is_expiring(settings, store):
    """1년 뒤 조용히 멈추는 걸 막는 게 목적이므로 시작 알림에 실려야 한다."""
    from datetime import date

    settings.key_expires_at = date.today() + timedelta(days=10)
    engine, _, _ = build(FLAT, settings, store)
    notifier = Recorder(throttle_seconds=0)
    engine.notifier = notifier
    engine.stop()

    engine.run_forever(sleep=lambda _: None)

    start = next(n for n in notifier.sent if "봇 시작" in n.title)
    assert any("10일 뒤 만료" in line for line in start.lines)
    assert start.level is Level.WARN


def test_startup_is_quiet_when_key_is_fresh(settings, store):
    from datetime import date

    settings.key_expires_at = date.today() + timedelta(days=300)
    engine, _, _ = build(FLAT, settings, store)
    notifier = Recorder(throttle_seconds=0)
    engine.notifier = notifier
    engine.stop()

    engine.run_forever(sleep=lambda _: None)

    start = next(n for n in notifier.sent if "봇 시작" in n.title)
    assert not any("만료" in line for line in start.lines)
    assert start.level is Level.INFO
