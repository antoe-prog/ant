from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest

from tossquant.calendar_us import NY
from tossquant.models import Account, Position, Signal, SignalAction
from tossquant.risk import RiskManager


NOW = datetime(2026, 8, 6, 10, 0, tzinfo=NY)


@pytest.fixture
def risk(store) -> RiskManager:
    return RiskManager(
        store,
        max_position_pct=Decimal("0.25"),
        max_positions=2,
        max_daily_loss_pct=Decimal("0.03"),
        max_order_notional=Decimal("5000"),
    )


def enter(symbol="AAPL", price="100") -> Signal:
    return Signal(
        symbol=symbol,
        action=SignalAction.ENTER_LONG,
        reason="test",
        ref_price=Decimal(price),
    )


def exit_signal(symbol="AAPL") -> Signal:
    return Signal(
        symbol=symbol, action=SignalAction.EXIT, reason="test", ref_price=Decimal("100")
    )


def test_sizes_to_position_pct(risk):
    account = Account(cash=Decimal("10000"), positions={})
    decision = risk.evaluate(enter(), account, {"AAPL": Decimal("100")}, NOW)
    # 10000 * 0.25 = 2500 예산 → 25주
    assert decision.approved
    assert decision.quantity == 25
    assert decision.cash_budget == Decimal("2500.00")


def test_capped_by_max_order_notional(store):
    risk = RiskManager(
        store,
        max_position_pct=Decimal("1.0"),
        max_positions=5,
        max_daily_loss_pct=Decimal("0.5"),
        max_order_notional=Decimal("1000"),
    )
    account = Account(cash=Decimal("100000"), positions={})
    decision = risk.evaluate(enter(), account, {"AAPL": Decimal("100")}, NOW)
    assert decision.quantity == 10


def test_capped_by_available_cash(risk):
    # 평가액은 1300(현금 300 + MSFT 1000)이라 비중 한도로는 325까지 가능하지만,
    # 실제 현금이 300뿐이므로 3주로 잘려야 한다.
    account = Account(
        cash=Decimal("300"),
        positions={"MSFT": Position("MSFT", 10, Decimal("100"))},
    )
    decision = risk.evaluate(enter(), account, {"AAPL": Decimal("100"), "MSFT": Decimal("100")}, NOW)
    assert decision.approved
    # 현금 300에 CASH_BUFFER(0.99)가 걸려 예산은 297 → 2주.
    assert decision.quantity == 2


def test_reserved_cash_limits_budget_without_reducing_economic_equity(risk):
    account = Account(cash=Decimal("1000"), positions={})

    decision = risk.evaluate(
        enter(),
        account,
        {"AAPL": Decimal("100")},
        NOW,
        available_cash=Decimal("200"),
    )

    # 경제적 평가액은 1,000으로 유지되지만 예약 후 가용 현금 200의 99%가 적용된다.
    assert decision.approved
    assert decision.cash_budget == Decimal("198.00")
    assert decision.quantity == 1


def test_cash_buffer_leaves_headroom_for_fees_and_slippage(risk):
    # 현금을 딱 맞게 쓰면 수수료나 갭 상승 한 번에 주문이 거부된다.
    account = Account(cash=Decimal("1000"), positions={})
    decision = risk.evaluate(enter(), account, {"AAPL": Decimal("1")}, NOW)
    assert decision.quantity < 1000


def test_exec_price_overrides_mark_for_sizing(risk):
    """사이징은 체결가 기준. 종가로 계산하면 갭 상승 시 잔고를 넘긴다."""
    account = Account(cash=Decimal("10000"), positions={})

    on_close = risk.evaluate(enter(), account, {"AAPL": Decimal("100")}, NOW)
    on_gap_up = risk.evaluate(
        enter(), account, {"AAPL": Decimal("100")}, NOW, exec_price=Decimal("200")
    )

    assert on_close.quantity == 25
    assert on_gap_up.quantity == 12  # 2500 예산 / 200


def test_rejects_when_budget_below_one_share(risk):
    account = Account(cash=Decimal("50"), positions={})
    decision = risk.evaluate(enter(), account, {"AAPL": Decimal("100")}, NOW)
    assert not decision.approved
    assert "1주 가격" in decision.reason


def test_rejects_duplicate_entry(risk):
    account = Account(
        cash=Decimal("10000"),
        positions={"AAPL": Position("AAPL", 5, Decimal("100"))},
    )
    decision = risk.evaluate(enter(), account, {"AAPL": Decimal("100")}, NOW)
    assert not decision.approved
    assert decision.reason == "이미 보유 중"


def test_rejects_when_max_positions_reached(risk):
    account = Account(
        cash=Decimal("10000"),
        positions={
            "MSFT": Position("MSFT", 1, Decimal("100")),
            "NVDA": Position("NVDA", 1, Decimal("100")),
        },
    )
    decision = risk.evaluate(enter(), account, {"AAPL": Decimal("100")}, NOW)
    assert not decision.approved
    assert "동시 보유 한도" in decision.reason


def test_exit_returns_full_position(risk):
    account = Account(
        cash=Decimal("0"), positions={"AAPL": Position("AAPL", 13, Decimal("100"))}
    )
    decision = risk.evaluate(exit_signal(), account, {"AAPL": Decimal("90")}, NOW)
    assert decision.approved
    assert decision.quantity == 13
    assert decision.cash_budget is None


def test_exit_without_position_rejected(risk):
    account = Account(cash=Decimal("10000"), positions={})
    decision = risk.evaluate(exit_signal(), account, {}, NOW)
    assert not decision.approved


def test_daily_loss_limit_blocks_new_entries(risk):
    marks = {"AAPL": Decimal("100")}
    baseline = Account(cash=Decimal("10000"), positions={})
    risk.evaluate(enter(), baseline, marks, NOW)  # 기준선 10000 설정

    drawn_down = Account(cash=Decimal("9600"), positions={})  # -4%
    decision = risk.evaluate(enter(), drawn_down, marks, NOW)

    assert not decision.approved
    assert decision.reason == "일일 손실 한도 초과"


def test_zero_daily_loss_limit_disables_the_guard(risk):
    risk.max_daily_loss_pct = Decimal("0")
    marks = {"AAPL": Decimal("100")}
    risk.evaluate(
        enter(), Account(cash=Decimal("10000"), positions={}), marks, NOW
    )

    decision = risk.evaluate(
        enter(), Account(cash=Decimal("9000"), positions={}), marks, NOW
    )

    assert decision.approved


def test_daily_loss_limit_still_allows_exit(risk):
    marks = {"AAPL": Decimal("100")}
    risk.evaluate(enter(), Account(cash=Decimal("10000"), positions={}), marks, NOW)

    held = Account(
        cash=Decimal("0"), positions={"AAPL": Position("AAPL", 10, Decimal("100"))}
    )
    decision = risk.evaluate(exit_signal(), held, {"AAPL": Decimal("50")}, NOW)

    assert decision.approved
    assert decision.quantity == 10


def test_baseline_resets_on_new_trading_day(risk):
    marks = {"AAPL": Decimal("100")}
    day_one = Account(cash=Decimal("10000"), positions={})
    risk.evaluate(enter(), day_one, marks, NOW)

    next_day = datetime(2026, 8, 7, 10, 0, tzinfo=NY)
    day_two = Account(cash=Decimal("9000"), positions={})
    # 새 거래일이므로 9000이 새 기준선 — 한도 위반이 아니다.
    decision = risk.evaluate(enter(), day_two, marks, next_day)

    assert decision.approved


def test_equity_includes_positions(risk):
    account = Account(
        cash=Decimal("1000"), positions={"MSFT": Position("MSFT", 10, Decimal("100"))}
    )
    assert account.equity({"MSFT": Decimal("150")}) == Decimal("2500")
