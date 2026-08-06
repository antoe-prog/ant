"""운영 기본값을 지키는 테스트.

기본값이 조용히 바뀌면 실계좌 동작이 바뀐다. 특히 보호 장치는 '켜 두는 것'이
기본이어야 하므로 여기서 못 박는다.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from tossquant.config import Mode, Settings


@pytest.fixture
def defaults(monkeypatch, tmp_path) -> Settings:
    # .env와 실제 환경변수를 무시하고 순수 기본값만 본다.
    for key in list(__import__("os").environ):
        if key.startswith("TOSSQUANT_"):
            monkeypatch.delenv(key, raising=False)
    return Settings(_env_file=None)


def test_paper_mode_is_the_default(defaults):
    """실주문은 반드시 명시적으로 켜야 한다."""
    assert defaults.mode is Mode.PAPER


def test_stop_loss_is_on_by_default(defaults):
    assert defaults.stop_loss_pct == Decimal("0.08")


def test_reentry_cooldown_is_on_by_default(defaults):
    assert defaults.stop_cooldown_days == 3


def test_risk_limits_have_sane_defaults(defaults):
    assert defaults.max_position_pct == Decimal("0.25")
    assert defaults.max_positions == 4
    assert defaults.max_daily_loss_pct == Decimal("0.03")


def test_symbols_parse_from_comma_string():
    settings = Settings(_env_file=None, symbols="aapl, msft ,nvda")
    assert settings.symbols == ["AAPL", "MSFT", "NVDA"]


def test_sma_slow_must_exceed_fast():
    with pytest.raises(ValueError):
        Settings(_env_file=None, sma_fast=60, sma_slow=20)


def test_require_credentials_names_missing_keys():
    settings = Settings(_env_file=None, client_id="", client_secret="")
    with pytest.raises(RuntimeError, match="TOSSQUANT_CLIENT_ID"):
        settings.require_credentials()


def test_require_credentials_passes_when_set():
    settings = Settings(_env_file=None, client_id="a", client_secret="b")
    settings.require_credentials()  # 예외 없음
