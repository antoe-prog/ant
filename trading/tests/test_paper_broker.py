from __future__ import annotations

import sqlite3
import threading
from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from tossquant.broker.base import BrokerError, InsufficientFunds, OrderRejected
from tossquant.broker.paper import PaperBroker
from tossquant.models import Order, OrderRequest, OrderStatus, OrderType, Position, Side
from tossquant.store import Store, StoreConflict, StoreMigrationError

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


def test_cash_envelope_uses_same_spread_slippage_and_commission_cost(
    market, store, settings
):
    settings.paper_slippage_bps = Decimal("100")
    settings.paper_commission_bps = Decimal("100")
    broker = PaperBroker(market, store, settings)
    request = OrderRequest(symbol="AAPL", side=Side.BUY, quantity=1)

    # ask 100.01 -> 1% slippage fill 101.01 -> 1% commission 1.01.
    assert broker.estimate_cash_required(request) == Decimal("102.02")

    with pytest.raises(InsufficientFunds):
        broker.place_order(request, cash_envelope=Decimal("102.01"))
    assert broker.get_account().cash == Decimal("10000")
    assert broker.get_account().positions == {}

    order = broker.place_order(request, cash_envelope=Decimal("102.02"))
    assert order.status is OrderStatus.FILLED
    assert broker.get_account().cash == Decimal("9897.98")


def test_max_affordable_quantity_accounts_for_known_modeled_costs(
    market, store, settings
):
    settings.paper_slippage_bps = Decimal("100")
    settings.paper_commission_bps = Decimal("100")
    broker = PaperBroker(market, store, settings)
    request = OrderRequest(symbol="AAPL", side=Side.BUY, quantity=10)

    assert broker.max_affordable_quantity(
        request,
        Decimal("1000"),
    ) == 9


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


def test_open_sell_orders_reserve_aggregate_held_quantity(market, broker):
    broker.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=10))
    first = broker.place_order(
        OrderRequest(
            symbol="AAPL",
            side=Side.SELL,
            quantity=6,
            order_type=OrderType.LIMIT,
            limit_price=Decimal("200"),
        )
    )

    with pytest.raises(OrderRejected, match="reserved|available"):
        broker.place_order(
            OrderRequest(
                symbol="AAPL",
                side=Side.SELL,
                quantity=6,
                order_type=OrderType.LIMIT,
                limit_price=Decimal("200"),
            )
        )

    broker.cancel_order(first.order_id)
    replacement = broker.place_order(
        OrderRequest(
            symbol="AAPL",
            side=Side.SELL,
            quantity=6,
            order_type=OrderType.LIMIT,
            limit_price=Decimal("200"),
        )
    )
    assert replacement.status is OrderStatus.NEW


def test_open_buy_orders_reserve_cash_including_commission(market, store, settings):
    settings.paper_commission_bps = Decimal("100")  # 1%
    broker = PaperBroker(market, store, settings)
    first = broker.place_order(
        OrderRequest(
            symbol="AAPL",
            side=Side.BUY,
            quantity=60,
            order_type=OrderType.LIMIT,
            limit_price=Decimal("95"),
        )
    )

    # 첫 주문 예약: 95*60 + 1% = 5,757. 두 번째 예약까지 합치면
    # 10,120.20으로 현금 10,000을 넘는다.
    with pytest.raises(InsufficientFunds):
        broker.place_order(
            OrderRequest(
                symbol="AAPL",
                side=Side.BUY,
                quantity=48,
                order_type=OrderType.LIMIT,
                limit_price=Decimal("90"),
            )
        )

    broker.cancel_order(first.order_id)
    replacement = broker.place_order(
        OrderRequest(
            symbol="AAPL",
            side=Side.BUY,
            quantity=48,
            order_type=OrderType.LIMIT,
            limit_price=Decimal("90"),
        )
    )
    assert replacement.status is OrderStatus.NEW


def test_pending_buys_remain_funded_when_later_order_fills_first(market, broker):
    low_limit = broker.place_order(
        OrderRequest(
            symbol="AAPL",
            side=Side.BUY,
            quantity=50,
            order_type=OrderType.LIMIT,
            limit_price=Decimal("80"),
        )
    )
    high_limit = broker.place_order(
        OrderRequest(
            symbol="AAPL",
            side=Side.BUY,
            quantity=50,
            order_type=OrderType.LIMIT,
            limit_price=Decimal("95"),
        )
    )

    market.closes["AAPL"] = [Decimal("90")]
    first_fills = broker.poll_open_orders()
    assert [order.order_id for order in first_fills] == [high_limit.order_id]

    market.closes["AAPL"] = [Decimal("75")]
    second_fills = broker.poll_open_orders()
    assert [order.order_id for order in second_fills] == [low_limit.order_id]
    assert broker.get_account().positions["AAPL"].quantity == 100
    assert broker.get_account().cash == Decimal("1749.00")


def test_fill_settlement_rolls_back_db_and_memory_on_mid_transaction_fault(
    market, settings, tmp_path
):
    path = tmp_path / "atomic-paper.db"
    local_store = Store(path)
    broker = PaperBroker(market, local_store, settings)
    local_store._conn.executescript(  # noqa: SLF001 - bounded fault injection
        """
        CREATE TRIGGER fail_fill_insert
        BEFORE INSERT ON fills
        BEGIN
            SELECT RAISE(ABORT, 'injected fill fault');
        END;
        """
    )

    with pytest.raises(sqlite3.IntegrityError, match="injected fill fault"):
        broker.place_order(
            OrderRequest(symbol="AAPL", side=Side.BUY, quantity=10)
        )

    account = broker.get_account()
    assert account.cash == Decimal("10000")
    assert account.positions == {}
    assert local_store.recent_orders() == []
    assert local_store.load_positions() == {}
    assert local_store.get_cash(default=Decimal("0")) == Decimal("10000")
    assert local_store._conn.execute("SELECT COUNT(*) FROM fills").fetchone()[0] == 0
    local_store.close()

    reopened = Store(path)
    try:
        assert reopened.get_cash(default=Decimal("0")) == Decimal("10000")
        assert reopened.load_positions() == {}
        assert reopened.recent_orders() == []
    finally:
        reopened.close()


def test_committed_pending_fill_replay_is_idempotent_across_retry_and_restart(
    market, settings, tmp_path
):
    path = tmp_path / "idempotent-paper.db"
    local_store = Store(path)
    broker = PaperBroker(market, local_store, settings)
    pending = broker.place_order(
        OrderRequest(
            symbol="AAPL",
            side=Side.BUY,
            quantity=10,
            order_type=OrderType.LIMIT,
            limit_price=Decimal("95"),
        )
    )
    market.closes["AAPL"] = [Decimal("90")]

    original_settle = local_store.settle_fill
    failed_after_commit = False

    def commit_then_raise(*args, **kwargs):
        nonlocal failed_after_commit
        result = original_settle(*args, **kwargs)
        if not failed_after_commit:
            failed_after_commit = True
            raise RuntimeError("injected post-commit fault")
        return result

    local_store.settle_fill = commit_then_raise
    with pytest.raises(RuntimeError, match="post-commit"):
        broker.poll_open_orders()

    # DB commit happened, but the exception prevented the broker's memory update and
    # pending-order dequeue. A retry must reconcile that fill, not apply it again.
    assert broker.get_account().cash == Decimal("10000")
    assert broker.get_account().positions == {}
    assert local_store.get_cash(Decimal("0")) == Decimal("9099.90")
    assert local_store.load_positions()["AAPL"].quantity == 10
    assert local_store._conn.execute(  # noqa: SLF001 - invariant inspection
        "SELECT COUNT(*) FROM fills WHERE order_id = ?", (pending.order_id,)
    ).fetchone()[0] == 1

    local_store.settle_fill = original_settle
    replayed = broker.poll_open_orders()
    assert [order.order_id for order in replayed] == [pending.order_id]
    assert broker.poll_open_orders() == []
    assert broker.get_account().cash == Decimal("9099.90")
    assert broker.get_account().positions["AAPL"].quantity == 10
    assert local_store._conn.execute(  # noqa: SLF001 - invariant inspection
        "SELECT COUNT(*) FROM fills WHERE order_id = ?", (pending.order_id,)
    ).fetchone()[0] == 1
    broker.close()
    local_store.close()

    reopened = Store(path)
    restarted = PaperBroker(market, reopened, settings)
    try:
        assert restarted.poll_open_orders() == []
        assert restarted.get_account().cash == Decimal("9099.90")
        assert restarted.get_account().positions["AAPL"].quantity == 10
        assert reopened._conn.execute(  # noqa: SLF001 - invariant inspection
            "SELECT COUNT(*) FROM fills WHERE order_id = ?", (pending.order_id,)
        ).fetchone()[0] == 1
    finally:
        restarted.close()
        reopened.close()


def test_committed_pending_order_is_reconciled_before_reservation_retry(
    market, settings, tmp_path
):
    path = tmp_path / "pending-post-commit.db"
    local_store = Store(path)
    broker = PaperBroker(market, local_store, settings)
    original_save = local_store.save_pending_paper_order
    failed_after_commit = False

    def commit_then_raise(*args, **kwargs):
        nonlocal failed_after_commit
        result = original_save(*args, **kwargs)
        if not failed_after_commit:
            failed_after_commit = True
            raise RuntimeError("injected pending post-commit fault")
        return result

    local_store.save_pending_paper_order = commit_then_raise
    request = OrderRequest(
        symbol="AAPL",
        side=Side.BUY,
        quantity=100,
        order_type=OrderType.LIMIT,
        limit_price=Decimal("95"),
    )
    with pytest.raises(RuntimeError, match="pending post-commit"):
        broker.place_order(request)

    rows = local_store.pending_paper_orders()
    assert len(rows) == 1
    assert rows[0]["client_order_id"] == request.client_order_id
    assert set(broker._open_orders) == {rows[0]["order_id"]}  # noqa: SLF001

    replayed = broker.place_order(request)
    assert replayed.order_id == rows[0]["order_id"]
    assert len(local_store.pending_paper_orders()) == 1
    broker.close()
    local_store.close()

    reopened = Store(path)
    restarted = PaperBroker(market, reopened, settings)
    replayed_after_restart = restarted.place_order(request)
    assert replayed_after_restart.order_id == rows[0]["order_id"]
    assert len(reopened.pending_paper_orders()) == 1

    market.closes["AAPL"] = [Decimal("90")]
    fills = restarted.poll_open_orders()
    assert [order.order_id for order in fills] == [rows[0]["order_id"]]
    assert restarted.poll_open_orders() == []
    assert restarted.get_account().positions["AAPL"].quantity == 100
    assert reopened._conn.execute(  # noqa: SLF001 - invariant inspection
        "SELECT COUNT(*) FROM fills WHERE order_id = ?", (rows[0]["order_id"],)
    ).fetchone()[0] == 1
    restarted.close()
    reopened.close()


def test_committed_immediate_fill_retry_after_restart_is_idempotent_by_client_id(
    market, settings, tmp_path
):
    path = tmp_path / "immediate-post-commit.db"
    local_store = Store(path)
    broker = PaperBroker(market, local_store, settings)
    original_settle = local_store.settle_fill
    failed_after_commit = False

    def commit_then_raise(*args, **kwargs):
        nonlocal failed_after_commit
        result = original_settle(*args, **kwargs)
        if not failed_after_commit:
            failed_after_commit = True
            raise RuntimeError("injected immediate post-commit fault")
        return result

    local_store.settle_fill = commit_then_raise
    request = OrderRequest(
        symbol="AAPL",
        side=Side.BUY,
        quantity=10,
        client_order_id="stable-market-client",
    )
    with pytest.raises(RuntimeError, match="immediate post-commit"):
        broker.place_order(request)

    persisted = local_store.recent_orders(1)[0]
    original_order_id = persisted["order_id"]
    assert local_store._conn.execute(  # noqa: SLF001 - invariant inspection
        "SELECT COUNT(*) FROM fills WHERE order_id = ?", (original_order_id,)
    ).fetchone()[0] == 1
    broker.close()
    local_store.close()

    reopened = Store(path)
    restarted = PaperBroker(market, reopened, settings)
    try:
        replayed = restarted.place_order(request)

        assert replayed.order_id == original_order_id
        assert restarted.get_account().positions["AAPL"].quantity == 10
        assert reopened._conn.execute(  # noqa: SLF001 - invariant inspection
            "SELECT COUNT(*) FROM fills WHERE order_id = ?", (original_order_id,)
        ).fetchone()[0] == 1
        assert len(reopened.recent_orders()) == 1
    finally:
        restarted.close()
        reopened.close()


def test_paper_client_order_id_reuse_with_different_request_fails_closed(broker):
    original = OrderRequest(
        symbol="AAPL",
        side=Side.BUY,
        quantity=1,
        order_type=OrderType.LIMIT,
        limit_price=Decimal("50"),
        client_order_id="paper-idempotency-key",
    )
    first = broker.place_order(original)

    with pytest.raises(BrokerError, match="client_order_id.*이미 사용"):
        broker.place_order(replace(original, quantity=2))

    assert [row["order_id"] for row in broker._store.pending_paper_orders()] == [  # noqa: SLF001
        first.order_id
    ]


def test_paper_client_order_id_migration_fails_closed_on_legacy_duplicates(
    tmp_path,
):
    path = tmp_path / "duplicate-paper-client-ids.db"
    store = Store(path)
    store._conn.execute(  # noqa: SLF001 - legacy corruption fixture
        "DROP INDEX paper_client_order_id_once"
    )
    for index in range(2):
        store.save_order(
            Order(
                order_id=f"paper-legacy-{index}",
                client_order_id="duplicate-client",
                symbol="AAPL",
                side=Side.BUY,
                quantity=1,
                filled_quantity=1,
                avg_fill_price=Decimal("100"),
                status=OrderStatus.FILLED,
                ts=datetime.now(timezone.utc),
            ),
            origin="paper",
        )
    store.close()

    with pytest.raises(StoreMigrationError, match="client_order_id.*중복|중복.*client"):
        Store(path)


def test_fill_uniqueness_migration_fails_closed_on_legacy_duplicates(tmp_path):
    path = tmp_path / "duplicate-legacy-fills.db"
    connection = sqlite3.connect(path)
    connection.execute(
        """
        CREATE TABLE fills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            price TEXT NOT NULL,
            commission TEXT NOT NULL,
            ts TEXT NOT NULL
        )
        """
    )
    values = (
        "paper-duplicate",
        "AAPL",
        Side.BUY.value,
        1,
        "100",
        "0",
        datetime.now(timezone.utc).isoformat(),
    )
    connection.execute(
        "INSERT INTO fills (order_id, symbol, side, quantity, price, commission, ts) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        values,
    )
    connection.execute(
        "INSERT INTO fills (order_id, symbol, side, quantity, price, commission, ts) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        values,
    )
    connection.commit()
    connection.close()

    with pytest.raises(RuntimeError, match="중복|duplicate"):
        Store(path)


def test_same_paper_broker_serializes_concurrent_order_lifecycle(
    market, store, settings
):
    broker = PaperBroker(market, store, settings)
    first_in_settlement = threading.Event()
    second_in_settlement = threading.Event()
    release_settlements = threading.Event()
    call_guard = threading.Lock()
    calls = 0
    original_settle = store.settle_fill

    def observed_settle(*args, **kwargs):
        nonlocal calls
        with call_guard:
            calls += 1
            call_number = calls
        if call_number == 1:
            first_in_settlement.set()
            assert release_settlements.wait(timeout=2)
        elif call_number == 2:
            second_in_settlement.set()
            assert release_settlements.wait(timeout=2)
        return original_settle(*args, **kwargs)

    store.settle_fill = observed_settle
    results: list[Order] = []
    errors: list[BaseException] = []

    def buy_one() -> None:
        try:
            results.append(
                broker.place_order(
                    OrderRequest(symbol="AAPL", side=Side.BUY, quantity=1)
                )
            )
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    first = threading.Thread(target=buy_one)
    second = threading.Thread(target=buy_one)
    first.start()
    assert first_in_settlement.wait(timeout=2)
    second.start()
    overlapped = second_in_settlement.wait(timeout=0.2)
    release_settlements.set()
    first.join(timeout=2)
    second.join(timeout=2)

    assert not first.is_alive() and not second.is_alive()
    assert not overlapped, "두 번째 주문이 첫 주문 커밋 전에 settlement에 진입했습니다"
    assert errors == []
    assert len(results) == 2
    account = broker.get_account()
    assert account.cash == Decimal("9799.98")
    assert account.positions["AAPL"].quantity == 2
    assert store.get_cash(Decimal("0")) == account.cash
    assert store.load_positions() == account.positions
    assert store._conn.execute("SELECT COUNT(*) FROM fills").fetchone()[0] == 2


def test_store_write_lock_prevents_save_order_from_committing_mid_settlement(
    store
):
    store.set_cash(Decimal("10000"))
    began = threading.Event()
    release_settlement = threading.Event()
    original_connection = store._conn  # noqa: SLF001 - deterministic interleave

    class PauseAfterBegin:
        def execute(self, sql, parameters=()):
            result = original_connection.execute(sql, parameters)
            if sql.strip().upper() == "BEGIN IMMEDIATE":
                began.set()
                assert release_settlement.wait(timeout=2)
            return result

        def __getattr__(self, name):
            return getattr(original_connection, name)

    store._conn = PauseAfterBegin()  # noqa: SLF001 - deterministic interleave
    filled = Order(
        order_id="paper-atomic-lock",
        client_order_id="atomic-lock",
        symbol="AAPL",
        side=Side.BUY,
        quantity=1,
        filled_quantity=1,
        avg_fill_price=Decimal("100"),
        status=OrderStatus.FILLED,
        ts=datetime.now(timezone.utc),
    )
    unrelated = Order(
        order_id="live-unrelated",
        client_order_id="unrelated",
        symbol="MSFT",
        side=Side.BUY,
        quantity=1,
        filled_quantity=0,
        avg_fill_price=Decimal("0"),
        status=OrderStatus.NEW,
        ts=datetime.now(timezone.utc),
    )
    errors: list[BaseException] = []
    unrelated_saved = threading.Event()

    def settle() -> None:
        try:
            store.settle_fill(
                filled,
                request=OrderRequest(
                    symbol="AAPL",
                    side=Side.BUY,
                    quantity=1,
                    client_order_id="atomic-lock",
                ),
                commission=Decimal("0"),
                cash=Decimal("9900"),
                position=Position("AAPL", 1, Decimal("100")),
                expected_cash=Decimal("10000"),
                expected_position=None,
            )
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    def save_unrelated() -> None:
        try:
            store.save_order(unrelated)
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)
        finally:
            unrelated_saved.set()

    settlement_thread = threading.Thread(target=settle)
    writer_thread = threading.Thread(target=save_unrelated)
    settlement_thread.start()
    assert began.wait(timeout=2)
    writer_thread.start()
    interleaved = unrelated_saved.wait(timeout=0.2)
    release_settlement.set()
    settlement_thread.join(timeout=2)
    writer_thread.join(timeout=2)

    assert not settlement_thread.is_alive() and not writer_thread.is_alive()
    assert not interleaved, "save_order가 settle_fill 트랜잭션 중간에 커밋했습니다"
    assert errors == []
    assert store.get_cash(Decimal("0")) == Decimal("9900")
    assert store.load_positions()["AAPL"].quantity == 1
    assert store._conn.execute("SELECT COUNT(*) FROM fills").fetchone()[0] == 1
    assert {row["order_id"] for row in store.recent_orders()} == {
        "paper-atomic-lock",
        "live-unrelated",
    }


def test_slippage_and_commission_applied(market, store, settings):
    settings.paper_slippage_bps = Decimal("100")   # 1%
    settings.paper_commission_bps = Decimal("100")  # 1%
    broker = PaperBroker(market, store, settings)

    order = broker.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=1))

    assert order.avg_fill_price == Decimal("101.01")  # 100.01 * 1.01
    # 체결금액 + 수수료 1%
    assert broker.get_account().cash == Decimal("10000") - Decimal("101.01") - Decimal("1.01")


def test_rounded_non_positive_fill_is_rejected_before_position_mutation(
    store, settings
):
    penny_market = FakeMarket({"AAPL": [0.01]}, spread=0)
    store.save_position(Position("AAPL", 1, Decimal("0.01")))
    settings.paper_slippage_bps = Decimal("9999")
    broker = PaperBroker(penny_market, store, settings)

    with pytest.raises(OrderRejected, match="fill price"):
        broker.place_order(
            OrderRequest(symbol="AAPL", side=Side.SELL, quantity=1)
        )

    assert broker.get_account().positions["AAPL"].quantity == 1


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


def test_pending_limit_order_survives_restart_fills_once_and_keeps_reservation(
    market, settings, tmp_path
):
    path = tmp_path / "pending-restart.db"
    store_a = Store(path)
    broker_a = PaperBroker(market, store_a, settings)
    pending = broker_a.place_order(
        OrderRequest(
            symbol="AAPL",
            side=Side.BUY,
            quantity=100,
            order_type=OrderType.LIMIT,
            limit_price=Decimal("95"),
        )
    )
    store_a.close()

    store_b = Store(path)
    broker_b = PaperBroker(market, store_b, settings)
    with pytest.raises(InsufficientFunds):
        broker_b.place_order(
            OrderRequest(
                symbol="AAPL",
                side=Side.BUY,
                quantity=100,
                order_type=OrderType.LIMIT,
                limit_price=Decimal("95"),
            )
        )

    market.closes["AAPL"] = [Decimal("90")]
    fills = broker_b.poll_open_orders()
    assert [order.order_id for order in fills] == [pending.order_id]
    assert broker_b.poll_open_orders() == []
    assert broker_b.get_account().positions["AAPL"].quantity == 100
    fill_count = store_b._conn.execute(  # noqa: SLF001 - invariant inspection
        "SELECT COUNT(*) FROM fills WHERE order_id = ?", (pending.order_id,)
    ).fetchone()[0]
    assert fill_count == 1
    store_b.close()

    store_c = Store(path)
    try:
        broker_c = PaperBroker(market, store_c, settings)
        assert broker_c.poll_open_orders() == []
        assert broker_c.get_account().positions["AAPL"].quantity == 100
    finally:
        store_c.close()


def test_legacy_incomplete_pending_paper_order_fails_closed(
    market, settings, store
):
    store.save_order(
        Order(
            order_id="paper-legacy",
            client_order_id="legacy-client",
            symbol="AAPL",
            side=Side.BUY,
            quantity=1,
            filled_quantity=0,
            avg_fill_price=Decimal("0"),
            status=OrderStatus.NEW,
            ts=datetime.now(timezone.utc),
        )
    )

    with pytest.raises(BrokerError, match="paper-legacy.*복구|복구.*paper-legacy"):
        PaperBroker(market, store, settings)


def test_live_pending_rows_are_not_loaded_as_paper_orders(market, settings, store):
    # A local pre-submit intent must be created through the authoritative claim
    # path; ``intent:`` is deliberately reserved from external order IDs.
    store.claim_live_intent(
        OrderRequest(
            symbol="AAPL",
            side=Side.BUY,
            quantity=1,
            client_order_id="client-2",
        ),
        datetime.now(timezone.utc),
    )
    for index, order_id in enumerate(("live-order-1", "paper-real-toss-id"), 1):
        store.save_order(
            Order(
                order_id=order_id,
                client_order_id=f"client-{order_id}",
                symbol=f"LIVE{index}",
                side=Side.BUY,
                quantity=1,
                filled_quantity=0,
                avg_fill_price=Decimal("0"),
                status=OrderStatus.NEW,
                ts=datetime.now(timezone.utc),
            ),
            origin="live",
        )

    broker = PaperBroker(market, store, settings)

    assert broker.poll_open_orders() == []


def test_store_migrates_legacy_order_table_for_pending_request_fields(tmp_path):
    path = tmp_path / "legacy-schema.db"
    connection = sqlite3.connect(path)
    connection.execute(
        """
        CREATE TABLE orders (
            order_id TEXT PRIMARY KEY,
            client_order_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            filled_quantity INTEGER NOT NULL,
            avg_fill_price TEXT NOT NULL,
            status TEXT NOT NULL,
            ts TEXT NOT NULL,
            reason TEXT
        )
        """
    )
    connection.commit()
    connection.close()

    migrated = Store(path)
    try:
        columns = {
            row["name"]
            for row in migrated._conn.execute(  # noqa: SLF001 - migration check
                "PRAGMA table_info(orders)"
            )
        }
        assert {"order_type", "limit_price", "origin"} <= columns
    finally:
        migrated.close()


def test_file_backed_paper_broker_allows_only_one_active_writer(
    market, settings, tmp_path
):
    path = tmp_path / "single-writer.db"
    store_a = Store(path)
    broker_a = PaperBroker(market, store_a, settings)
    store_b = Store(path)

    with pytest.raises(BrokerError, match="이미.*실행|active|lock"):
        PaperBroker(market, store_b, settings)

    broker_a.close()
    broker_b = PaperBroker(market, store_b, settings)
    try:
        order = broker_b.place_order(
            OrderRequest(symbol="AAPL", side=Side.BUY, quantity=1)
        )
        assert order.status is OrderStatus.FILLED
    finally:
        broker_b.close()
        store_b.close()
        store_a.close()


def test_same_in_memory_store_allows_only_one_active_paper_broker(
    market, settings
):
    shared_store = Store(":memory:")
    first = PaperBroker(market, shared_store, settings)
    try:
        with pytest.raises(BrokerError, match="이미.*브로커|active|lease"):
            PaperBroker(market, shared_store, settings)
    finally:
        first.close()

    replacement = PaperBroker(market, shared_store, settings)
    replacement.close()
    shared_store.close()


def test_distinct_in_memory_stores_allow_independent_paper_brokers(
    market, settings
):
    first_store = Store(":memory:")
    second_store = Store(":memory:")
    first = PaperBroker(market, first_store, settings)
    second = PaperBroker(market, second_store, settings)
    try:
        assert first.get_account().cash == Decimal("10000")
        assert second.get_account().cash == Decimal("10000")
    finally:
        first.close()
        second.close()
        first_store.close()
        second_store.close()


def test_authoritative_state_guard_rejects_bypassed_stale_memory(
    market, settings
):
    shared_store = Store(":memory:")
    broker = PaperBroker(market, shared_store, settings)
    try:
        shared_store.set_cash(Decimal("9000"))
        with pytest.raises(StoreConflict, match="변경|stale|동시"):
            broker.place_order(
                OrderRequest(symbol="AAPL", side=Side.BUY, quantity=10)
            )
        assert shared_store.get_cash(Decimal("0")) == Decimal("9000")
        assert shared_store.load_positions() == {}
        assert shared_store._conn.execute(  # noqa: SLF001 - invariant inspection
            "SELECT COUNT(*) FROM fills"
        ).fetchone()[0] == 0
    finally:
        broker.close()
        shared_store.close()


def test_save_order_rejects_reused_broker_id_with_different_identity(store):
    original = Order(
        order_id="broker-reused-id",
        client_order_id="client-a",
        symbol="AAPL",
        side=Side.BUY,
        quantity=3,
        filled_quantity=0,
        avg_fill_price=Decimal("0"),
        status=OrderStatus.NEW,
        ts=datetime.now(timezone.utc),
    )
    store.save_order(original, origin="live")

    with pytest.raises(StoreConflict, match="다른 주문|identity|재사용"):
        store.save_order(
            Order(
                order_id=original.order_id,
                client_order_id="client-b",
                symbol="MSFT",
                side=Side.SELL,
                quantity=9,
                filled_quantity=9,
                avg_fill_price=Decimal("200"),
                status=OrderStatus.FILLED,
                ts=datetime.now(timezone.utc),
            ),
            origin="live",
        )

    persisted = store.recent_orders(limit=1)[0]
    assert persisted["client_order_id"] == "client-a"
    assert persisted["symbol"] == "AAPL"
    assert persisted["side"] == Side.BUY.value
    assert persisted["quantity"] == 3
    assert persisted["status"] == OrderStatus.NEW.value


def test_save_order_rolls_back_failed_commit_and_connection_remains_reusable(store):
    original_connection = store._conn  # noqa: SLF001 - injected commit failure

    class FailCommitOnce:
        def __init__(self):
            self.failed = False
            self.rollbacks = 0

        def commit(self):
            if not self.failed:
                self.failed = True
                raise sqlite3.OperationalError("injected commit failure")
            return original_connection.commit()

        def rollback(self):
            self.rollbacks += 1
            return original_connection.rollback()

        def __getattr__(self, name):
            return getattr(original_connection, name)

    connection = FailCommitOnce()
    store._conn = connection  # noqa: SLF001 - deterministic fault injection
    order = Order(
        order_id="live-commit-retry",
        client_order_id="commit-retry",
        symbol="AAPL",
        side=Side.BUY,
        quantity=1,
        filled_quantity=0,
        avg_fill_price=Decimal("0"),
        status=OrderStatus.NEW,
        ts=datetime.now(timezone.utc),
    )

    with pytest.raises(sqlite3.OperationalError, match="injected commit"):
        store.save_order(order, origin="live")

    assert connection.rollbacks == 1
    assert not original_connection.in_transaction
    assert original_connection.execute(
        "SELECT 1 FROM orders WHERE order_id = ?", (order.order_id,)
    ).fetchone() is None

    store.save_order(order, origin="live")
    assert store.recent_orders(1)[0]["order_id"] == order.order_id


def test_save_order_allows_monotonic_partial_progress_then_fill(store):
    initial = Order(
        order_id="live-progress",
        client_order_id="progress-client",
        symbol="AAPL",
        side=Side.BUY,
        quantity=10,
        filled_quantity=0,
        avg_fill_price=Decimal("0"),
        status=OrderStatus.NEW,
        ts=datetime.now(timezone.utc),
    )
    first_partial = replace(
        initial,
        filled_quantity=2,
        avg_fill_price=Decimal("100"),
        status=OrderStatus.PARTIALLY_FILLED,
    )
    later_partial = replace(
        first_partial,
        filled_quantity=6,
        avg_fill_price=Decimal("101"),
    )
    filled = replace(
        later_partial,
        filled_quantity=10,
        avg_fill_price=Decimal("102"),
        status=OrderStatus.FILLED,
    )

    store.save_order(initial, origin="live")
    store.save_order(first_partial, origin="live")
    # Same semantic partial replay is an idempotent no-op even if receive ts differs.
    store.save_order(
        replace(first_partial, ts=datetime.now(timezone.utc)), origin="live"
    )
    store.save_order(later_partial, origin="live")
    store.save_order(filled, origin="live")

    row = store.recent_orders(1)[0]
    assert row["status"] == OrderStatus.FILLED.value
    assert row["filled_quantity"] == 10
    assert Decimal(row["avg_fill_price"]) == Decimal("102")


def test_save_order_rejects_partial_decrease_or_same_quantity_price_change(store):
    partial = Order(
        order_id="live-partial",
        client_order_id="partial-client",
        symbol="AAPL",
        side=Side.BUY,
        quantity=10,
        filled_quantity=6,
        avg_fill_price=Decimal("101"),
        status=OrderStatus.PARTIALLY_FILLED,
        ts=datetime.now(timezone.utc),
    )
    store.save_order(partial, origin="live")

    with pytest.raises(StoreConflict, match="체결 수량|filled|PARTIAL"):
        store.save_order(replace(partial, filled_quantity=5), origin="live")
    with pytest.raises(StoreConflict, match="체결가|price|PARTIAL|동일"):
        store.save_order(
            replace(partial, avg_fill_price=Decimal("102")), origin="live"
        )

    row = store.recent_orders(1)[0]
    assert row["status"] == OrderStatus.PARTIALLY_FILLED.value
    assert row["filled_quantity"] == 6
    assert Decimal(row["avg_fill_price"]) == Decimal("101")


def test_save_order_terminal_replay_is_idempotent_but_regression_fails(store):
    filled = Order(
        order_id="live-terminal",
        client_order_id="terminal-client",
        symbol="AAPL",
        side=Side.BUY,
        quantity=10,
        filled_quantity=10,
        avg_fill_price=Decimal("100"),
        status=OrderStatus.FILLED,
        ts=datetime.now(timezone.utc),
    )
    store.save_order(filled, origin="live")
    persisted_ts = store.recent_orders(1)[0]["ts"]

    store.save_order(replace(filled, ts=datetime.now(timezone.utc)), origin="live")
    assert store.recent_orders(1)[0]["ts"] == persisted_ts

    with pytest.raises(StoreConflict, match="전이|terminal|FILLED"):
        store.save_order(
            replace(
                filled,
                filled_quantity=0,
                avg_fill_price=Decimal("0"),
                status=OrderStatus.NEW,
            ),
            origin="live",
        )

    row = store.recent_orders(1)[0]
    assert row["status"] == OrderStatus.FILLED.value
    assert row["filled_quantity"] == 10
    assert Decimal(row["avg_fill_price"]) == Decimal("100")


def test_concurrent_save_order_cannot_overwrite_newer_terminal_state(
    monkeypatch, tmp_path
):
    path = tmp_path / "concurrent-order-transition.db"
    first = Store(path)
    second = Store(path)
    initial = Order(
        order_id="live-concurrent-terminal",
        client_order_id="concurrent-terminal-client",
        symbol="AAPL",
        side=Side.BUY,
        quantity=10,
        filled_quantity=0,
        avg_fill_price=Decimal("0"),
        status=OrderStatus.NEW,
        ts=datetime.now(timezone.utc),
    )
    partial = replace(
        initial,
        filled_quantity=4,
        avg_fill_price=Decimal("100"),
        status=OrderStatus.PARTIALLY_FILLED,
    )
    filled = replace(
        initial,
        filled_quantity=10,
        avg_fill_price=Decimal("101"),
        status=OrderStatus.FILLED,
    )
    first.save_order(initial, origin="live")

    partial_read = threading.Event()
    terminal_attempted = threading.Event()
    terminal_done = threading.Event()
    original_transition = Store._validate_order_transition

    def coordinate_transition(cls, stored, incoming):
        result = original_transition(stored, incoming)
        if incoming.status is OrderStatus.PARTIALLY_FILLED:
            partial_read.set()
            assert terminal_attempted.wait(timeout=2)
            # Without a write transaction the terminal writer completes here,
            # then this stale partial overwrites it. With BEGIN IMMEDIATE the
            # terminal writer waits, so the partial commits first and FILLED wins.
            terminal_done.wait(timeout=0.25)
        return result

    monkeypatch.setattr(
        Store,
        "_validate_order_transition",
        classmethod(coordinate_transition),
    )
    errors: list[BaseException] = []

    def save_partial() -> None:
        try:
            first.save_order(partial, origin="live")
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    def save_terminal() -> None:
        try:
            assert partial_read.wait(timeout=2)
            terminal_attempted.set()
            second.save_order(filled, origin="live")
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)
        finally:
            terminal_done.set()

    workers = [
        threading.Thread(target=save_partial, daemon=True),
        threading.Thread(target=save_terminal, daemon=True),
    ]
    try:
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(timeout=3)

        assert all(not worker.is_alive() for worker in workers)
        assert errors == []
        persisted = first.recent_orders(1)[0]
        assert persisted["status"] == OrderStatus.FILLED.value
        assert persisted["filled_quantity"] == 10
        assert Decimal(persisted["avg_fill_price"]) == Decimal("101")
    finally:
        first.close()
        second.close()


@pytest.mark.parametrize(
    ("status", "filled_quantity", "avg_fill_price"),
    [
        (OrderStatus.NEW, 1, Decimal("100")),
        (OrderStatus.PARTIALLY_FILLED, 0, Decimal("0")),
        (OrderStatus.PARTIALLY_FILLED, 10, Decimal("100")),
        (OrderStatus.FILLED, 9, Decimal("100")),
        (OrderStatus.REJECTED, 1, Decimal("100")),
    ],
)
def test_save_order_rejects_status_quantity_price_inconsistency(
    store, status, filled_quantity, avg_fill_price
):
    invalid = Order(
        order_id=f"invalid-{status.value}-{filled_quantity}",
        client_order_id="invalid-client",
        symbol="AAPL",
        side=Side.BUY,
        quantity=10,
        filled_quantity=filled_quantity,
        avg_fill_price=avg_fill_price,
        status=status,
        ts=datetime.now(timezone.utc),
    )

    with pytest.raises(ValueError, match="status|체결|filled|avg"):
        store.save_order(invalid, origin="live")
    assert store.recent_orders() == []


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
