from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest

from tossquant.broker.base import BrokerError
from tossquant.broker.paper import PaperBroker
from tossquant.calendar_us import NY
from tossquant.engine import TradingEngine
from tossquant.models import OrderRequest, Position, Side, Signal, SignalAction
from tossquant.risk import RiskManager
from tossquant.notify import Level
from tossquant.strategy.sma_cross import SmaCrossStrategy

from fakes import FakeMarket
from test_notify import Recorder

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

    signals = collect_signals(
        ["AAPL"], engine.strategy, engine.stops, positions,
        {"AAPL": Decimal("80")}, {"AAPL": []}, OPEN,
    )

    assert len(signals) == 1
    assert signals[0].protective is True
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
