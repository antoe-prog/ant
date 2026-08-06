from __future__ import annotations

from decimal import Decimal

import pytest

from tossquant.broker.base import InsufficientFunds, OrderRejected
from tossquant.broker.paper import PaperBroker
from tossquant.models import OrderRequest, OrderStatus, OrderType, Side
from tossquant.store import Store

from fakes import FakeMarket


@pytest.fixture
def market() -> FakeMarket:
    return FakeMarket({"AAPL": [100.0]}, spread=0.02)


@pytest.fixture
def broker(market, store, settings) -> PaperBroker:
    return PaperBroker(market, store, settings)


def test_market_buy_fills_at_ask_and_debits_cash(broker):
    order = broker.place_order(
        OrderRequest(symbol="AAPL", side=Side.BUY, quantity=10)
    )
    assert order.status is OrderStatus.FILLED
    assert order.filled_quantity == 10
    assert order.avg_fill_price == Decimal("100.01")  # ask
    account = broker.get_account()
    assert account.cash == Decimal("10000") - Decimal("100.01") * 10
    assert account.positions["AAPL"].quantity == 10


def test_market_sell_fills_at_bid_and_credits_cash(broker):
    broker.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=10))
    cash_after_buy = broker.get_account().cash

    broker.place_order(OrderRequest(symbol="AAPL", side=Side.SELL, quantity=4))

    account = broker.get_account()
    assert account.positions["AAPL"].quantity == 6
    assert account.cash == cash_after_buy + Decimal("99.99") * 4


def test_full_sell_removes_position(broker):
    broker.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=3))
    broker.place_order(OrderRequest(symbol="AAPL", side=Side.SELL, quantity=3))
    assert "AAPL" not in broker.get_account().positions


def test_cannot_sell_more_than_held(broker):
    with pytest.raises(OrderRejected, match="공매도는 지원하지 않습니다"):
        broker.place_order(OrderRequest(symbol="AAPL", side=Side.SELL, quantity=1))


def test_insufficient_funds_rejected(broker):
    with pytest.raises(InsufficientFunds):
        broker.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=1000))


def test_averaging_up_recomputes_avg_price(market, broker):
    broker.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=10))
    market.closes["AAPL"] = [Decimal("200")]
    broker.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=10))

    position = broker.get_account().positions["AAPL"]
    assert position.quantity == 20
    # (100.01*10 + 200.01*10) / 20
    assert position.avg_price == Decimal("150.01")


def test_limit_buy_stays_open_until_price_drops(market, broker):
    order = broker.place_order(
        OrderRequest(
            symbol="AAPL",
            side=Side.BUY,
            quantity=5,
            order_type=OrderType.LIMIT,
            limit_price=Decimal("95"),
        )
    )
    assert order.status is OrderStatus.NEW
    assert broker.poll_open_orders() == []

    market.closes["AAPL"] = [Decimal("94")]
    filled = broker.poll_open_orders()

    assert len(filled) == 1
    assert filled[0].status is OrderStatus.FILLED
    assert filled[0].avg_fill_price == Decimal("94.01")  # ask, 지정가보다 유리


def test_limit_buy_fills_immediately_when_marketable(market, broker):
    order = broker.place_order(
        OrderRequest(
            symbol="AAPL",
            side=Side.BUY,
            quantity=5,
            order_type=OrderType.LIMIT,
            limit_price=Decimal("110"),
        )
    )
    assert order.status is OrderStatus.FILLED
    assert order.avg_fill_price == Decimal("100.01")


def test_cancel_open_limit_order(broker):
    order = broker.place_order(
        OrderRequest(
            symbol="AAPL", side=Side.BUY, quantity=5,
            order_type=OrderType.LIMIT, limit_price=Decimal("50"),
        )
    )
    canceled = broker.cancel_order(order.order_id)
    assert canceled.status is OrderStatus.CANCELED
    assert broker.poll_open_orders() == []


def test_slippage_and_commission_applied(market, store, settings):
    settings.paper_slippage_bps = Decimal("100")   # 1%
    settings.paper_commission_bps = Decimal("100")  # 1%
    broker = PaperBroker(market, store, settings)

    order = broker.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=1))

    assert order.avg_fill_price == Decimal("101.01")  # 100.01 * 1.01
    # 체결금액 + 수수료 1%
    assert broker.get_account().cash == Decimal("10000") - Decimal("101.01") - Decimal("1.01")


def test_state_survives_restart(market, settings, tmp_path):
    path = tmp_path / "persist.db"
    settings.db_path = path

    store_a = Store(path)
    broker_a = PaperBroker(market, store_a, settings)
    broker_a.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=7))
    cash = broker_a.get_account().cash
    store_a.close()

    store_b = Store(path)
    broker_b = PaperBroker(market, store_b, settings)
    account = broker_b.get_account()
    store_b.close()

    assert account.cash == cash
    assert account.positions["AAPL"].quantity == 7


def test_paper_broker_is_not_live(broker):
    assert broker.is_live is False


def test_rejects_zero_quantity():
    with pytest.raises(ValueError):
        OrderRequest(symbol="AAPL", side=Side.BUY, quantity=0)


def test_limit_order_requires_price():
    with pytest.raises(ValueError):
        OrderRequest(
            symbol="AAPL", side=Side.BUY, quantity=1, order_type=OrderType.LIMIT
        )
