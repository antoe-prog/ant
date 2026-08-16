from __future__ import annotations

from decimal import Decimal

import pytest

from tossquant.models import OrderRequest, OrderType, Side, Signal, SignalAction


@pytest.mark.parametrize("quantity", [True, 0, -1, 1.5])
def test_order_request_requires_a_positive_integer_quantity(quantity):
    with pytest.raises(ValueError, match="quantity|수량|integer|양수"):
        OrderRequest("AAPL", Side.BUY, quantity)


@pytest.mark.parametrize(
    "price", [Decimal("0"), Decimal("-1"), Decimal("NaN"), 100]
)
def test_limit_order_requires_a_finite_positive_decimal_price(price):
    with pytest.raises(ValueError, match="limit_price|가격|Decimal|유한|양수"):
        OrderRequest(
            "AAPL",
            Side.BUY,
            1,
            order_type=OrderType.LIMIT,
            limit_price=price,
        )


def test_market_order_rejects_an_ignored_limit_price():
    with pytest.raises(ValueError, match="MARKET|limit_price"):
        OrderRequest("AAPL", Side.BUY, 1, limit_price=Decimal("100"))


@pytest.mark.parametrize(
    "kwargs",
    [
        {"side": "BUY"},
        {"order_type": "MARKET"},
    ],
)
def test_order_request_requires_enum_values_not_lookalike_strings(kwargs):
    values = {"symbol": "AAPL", "side": Side.BUY, "quantity": 1}
    values.update(kwargs)
    with pytest.raises(ValueError, match="side|order_type|enum"):
        OrderRequest(**values)


@pytest.mark.parametrize(
    ("field", "kwargs"),
    [
        ("symbol", {"symbol": "   "}),
        ("client_order_id", {"client_order_id": "   "}),
    ],
)
def test_order_request_rejects_blank_identity_fields(field, kwargs):
    values = {"symbol": "AAPL", "side": Side.BUY, "quantity": 1}
    values.update(kwargs)
    with pytest.raises(ValueError, match=field):
        OrderRequest(**values)


@pytest.mark.parametrize("action", ["ENTER_LONG", "EXIT"])
def test_signal_requires_an_action_enum_not_a_lookalike_string(action):
    with pytest.raises(ValueError, match="action|enum"):
        Signal("AAPL", action, "malformed strategy output", Decimal("100"))


def test_signal_rejects_a_blank_symbol():
    with pytest.raises(ValueError, match="symbol"):
        Signal(
            "   ",
            SignalAction.EXIT,
            "malformed strategy output",
            Decimal("100"),
        )


@pytest.mark.parametrize("reason", ["", "   ", 123])
def test_signal_requires_a_nonblank_string_reason(reason):
    with pytest.raises(ValueError, match="reason"):
        Signal("AAPL", SignalAction.EXIT, reason, Decimal("100"))


@pytest.mark.parametrize(
    "ref_price",
    [Decimal("0"), Decimal("-1"), Decimal("NaN"), Decimal("Infinity"), 100],
)
def test_signal_requires_a_finite_positive_decimal_reference_price(ref_price):
    with pytest.raises(ValueError, match="ref_price|Decimal|finite|positive"):
        Signal("AAPL", SignalAction.EXIT, "risk exit", ref_price)


@pytest.mark.parametrize("protective", [0, 1, "true", None])
def test_signal_requires_an_actual_boolean_protective_flag(protective):
    with pytest.raises(ValueError, match="protective|bool"):
        Signal(
            "AAPL",
            SignalAction.EXIT,
            "risk exit",
            Decimal("100"),
            protective=protective,
        )
