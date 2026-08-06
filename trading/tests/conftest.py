from __future__ import annotations

from decimal import Decimal

import pytest

from tossquant.config import Settings
from tossquant.store import Store

@pytest.fixture
def store(tmp_path) -> Store:
    s = Store(tmp_path / "test.db")
    yield s
    s.close()


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        client_id="test-id",
        client_secret="test-secret",
        account_id="test-account",
        symbols=["AAPL"],
        paper_cash=Decimal("10000"),
        paper_slippage_bps=Decimal("0"),
        paper_commission_bps=Decimal("0"),
        db_path=tmp_path / "test.db",
        sma_fast=3,
        sma_slow=5,
        max_position_pct=Decimal("0.5"),
        max_positions=2,
        max_daily_loss_pct=Decimal("0.03"),
        max_order_notional=Decimal("100000"),
    )
