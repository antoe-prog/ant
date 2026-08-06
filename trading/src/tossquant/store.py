"""SQLite 영속화.

봇이 재시작돼도 포지션·현금·주문 이력·일별 손익 기준선이 유지되어야 리스크
한도(일일 손실 한도 등)가 의미를 갖는다.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from .models import Order, Position, Side

SCHEMA = """
CREATE TABLE IF NOT EXISTS state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
    symbol    TEXT PRIMARY KEY,
    quantity  INTEGER NOT NULL,
    avg_price TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    order_id        TEXT PRIMARY KEY,
    client_order_id TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    side            TEXT NOT NULL,
    quantity        INTEGER NOT NULL,
    filled_quantity INTEGER NOT NULL,
    avg_fill_price  TEXT NOT NULL,
    status          TEXT NOT NULL,
    ts              TEXT NOT NULL,
    reason          TEXT
);

CREATE TABLE IF NOT EXISTS fills (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   TEXT NOT NULL,
    symbol     TEXT NOT NULL,
    side       TEXT NOT NULL,
    quantity   INTEGER NOT NULL,
    price      TEXT NOT NULL,
    commission TEXT NOT NULL,
    ts         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS position_tracking (
    symbol        TEXT PRIMARY KEY,
    high_water    TEXT,
    opened_at     TEXT,
    blocked_until TEXT
);

CREATE TABLE IF NOT EXISTS equity_curve (
    ts     TEXT PRIMARY KEY,
    equity TEXT NOT NULL,
    cash   TEXT NOT NULL
);
"""


class Store:
    def __init__(self, path: Path | str) -> None:
        self.path = str(path)
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    # --- key/value ---------------------------------------------------------

    def get_state(self, key: str, default: Any = None) -> Any:
        row = self._conn.execute("SELECT value FROM state WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    def set_state(self, key: str, value: Any) -> None:
        self._conn.execute(
            "INSERT INTO state (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value)),
        )
        self._conn.commit()

    # --- 현금 --------------------------------------------------------------

    def get_cash(self, default: Decimal) -> Decimal:
        raw = self.get_state("cash")
        return Decimal(raw) if raw is not None else default

    def set_cash(self, cash: Decimal) -> None:
        self.set_state("cash", str(cash))

    # --- 포지션 ------------------------------------------------------------

    def load_positions(self) -> dict[str, Position]:
        rows = self._conn.execute("SELECT * FROM positions WHERE quantity != 0").fetchall()
        return {
            row["symbol"]: Position(
                symbol=row["symbol"],
                quantity=row["quantity"],
                avg_price=Decimal(row["avg_price"]),
            )
            for row in rows
        }

    def save_position(self, position: Position) -> None:
        if position.quantity == 0:
            self._conn.execute("DELETE FROM positions WHERE symbol = ?", (position.symbol,))
        else:
            self._conn.execute(
                "INSERT INTO positions (symbol, quantity, avg_price) VALUES (?, ?, ?) "
                "ON CONFLICT(symbol) DO UPDATE SET "
                "quantity = excluded.quantity, avg_price = excluded.avg_price",
                (position.symbol, position.quantity, str(position.avg_price)),
            )
        self._conn.commit()

    # --- 주문/체결 ---------------------------------------------------------

    def save_order(self, order: Order) -> None:
        self._conn.execute(
            "INSERT INTO orders (order_id, client_order_id, symbol, side, quantity, "
            "filled_quantity, avg_fill_price, status, ts, reason) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(order_id) DO UPDATE SET "
            "filled_quantity = excluded.filled_quantity, "
            "avg_fill_price = excluded.avg_fill_price, status = excluded.status",
            (
                order.order_id,
                order.client_order_id,
                order.symbol,
                order.side.value,
                order.quantity,
                order.filled_quantity,
                str(order.avg_fill_price),
                order.status.value,
                order.ts.isoformat(),
                order.reject_reason,
            ),
        )
        self._conn.commit()

    def record_fill(
        self,
        order_id: str,
        symbol: str,
        side: Side,
        quantity: int,
        price: Decimal,
        commission: Decimal,
        ts: datetime,
    ) -> None:
        self._conn.execute(
            "INSERT INTO fills (order_id, symbol, side, quantity, price, commission, ts) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (order_id, symbol, side.value, quantity, str(price), str(commission), ts.isoformat()),
        )
        self._conn.commit()

    def order_commission(self, order_id: str) -> Decimal:
        row = self._conn.execute(
            "SELECT COALESCE(SUM(CAST(commission AS REAL)), 0) AS total "
            "FROM fills WHERE order_id = ?",
            (order_id,),
        ).fetchone()
        return Decimal(str(row["total"]))

    def recent_orders(self, limit: int = 20) -> list[sqlite3.Row]:
        return self._conn.execute(
            "SELECT * FROM orders ORDER BY ts DESC LIMIT ?", (limit,)
        ).fetchall()

    # --- 포지션 추적 (손절·트레일링·쿨다운) --------------------------------

    def load_tracking(self, symbol: str) -> sqlite3.Row | None:
        return self._conn.execute(
            "SELECT * FROM position_tracking WHERE symbol = ?", (symbol,)
        ).fetchone()

    def all_tracking(self) -> list[sqlite3.Row]:
        return self._conn.execute("SELECT * FROM position_tracking").fetchall()

    def save_tracking(
        self,
        symbol: str,
        *,
        high_water: Decimal | None,
        opened_at: datetime | None,
        blocked_until: datetime | None,
    ) -> None:
        self._conn.execute(
            "INSERT INTO position_tracking (symbol, high_water, opened_at, blocked_until) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(symbol) DO UPDATE SET "
            "high_water = excluded.high_water, opened_at = excluded.opened_at, "
            "blocked_until = excluded.blocked_until",
            (
                symbol,
                str(high_water) if high_water is not None else None,
                opened_at.isoformat() if opened_at else None,
                blocked_until.isoformat() if blocked_until else None,
            ),
        )
        self._conn.commit()

    def delete_tracking(self, symbol: str) -> None:
        self._conn.execute("DELETE FROM position_tracking WHERE symbol = ?", (symbol,))
        self._conn.commit()

    # --- 평가액 곡선 -------------------------------------------------------

    def record_equity(self, equity: Decimal, cash: Decimal, ts: datetime | None = None) -> None:
        moment = ts or datetime.now(timezone.utc)
        self._conn.execute(
            "INSERT INTO equity_curve (ts, equity, cash) VALUES (?, ?, ?) "
            "ON CONFLICT(ts) DO UPDATE SET equity = excluded.equity, cash = excluded.cash",
            (moment.isoformat(), str(equity), str(cash)),
        )
        self._conn.commit()

    def equity_history(self, limit: int = 100) -> list[sqlite3.Row]:
        return self._conn.execute(
            "SELECT * FROM equity_curve ORDER BY ts DESC LIMIT ?", (limit,)
        ).fetchall()

    def close(self) -> None:
        self._conn.close()
