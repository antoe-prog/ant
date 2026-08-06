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
        # 보호 청산은 기본으로 꺼 둔다. 급락 시나리오에서 손절과 전략 신호가
        # 동시에 발동하면 무엇을 테스트하는지 흐려지므로, 필요한 테스트에서만
        # 명시적으로 켠다. 운영 기본값(8%)은 test_config.py에서 따로 지킨다.
        stop_loss_pct=Decimal("0"),
        trailing_stop_pct=Decimal("0"),
        take_profit_pct=Decimal("0"),
        max_holding_days=0,
    )
