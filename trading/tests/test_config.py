"""운영 기본값을 지키는 테스트.

기본값이 조용히 바뀌면 실계좌 동작이 바뀐다. 특히 보호 장치는 '켜 두는 것'이
기본이어야 하므로 여기서 못 박는다.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from pydantic import ValidationError

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


def test_symbol_fields_are_canonical_for_list_and_regime_inputs():
    settings = Settings(
        _env_file=None,
        symbols=[" aapl ", "Spy"],
        regime_symbol=" spy ",
    )

    assert settings.symbols == ["AAPL", "SPY"]
    assert settings.regime_symbol == "SPY"


def test_blank_regime_symbol_is_rejected():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, regime_symbol="   ")


def test_sma_slow_must_exceed_fast():
    with pytest.raises(ValueError):
        Settings(_env_file=None, sma_fast=60, sma_slow=20)


@pytest.mark.parametrize(
    ("field", "value"),
    [("sma_fast", 0), ("sma_fast", -1), ("sma_slow", 0), ("sma_slow", -1)],
)
def test_sma_windows_must_be_positive(field, value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{field: value})


@pytest.mark.parametrize(
    ("field", "value"), [("sma_fast", 80), ("sma_slow", 10)]
)
def test_failed_sma_assignment_preserves_the_original_pair(field, value):
    settings = Settings(_env_file=None, sma_fast=20, sma_slow=60)

    with pytest.raises(ValidationError):
        setattr(settings, field, value)

    assert (settings.sma_fast, settings.sma_slow) == (20, 60)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("stop_loss_pct", "-0.01"),
        ("stop_loss_pct", "1"),
        ("trailing_stop_pct", "-0.01"),
        ("trailing_stop_pct", "1"),
        ("max_daily_loss_pct", "-0.01"),
        ("max_daily_loss_pct", "1"),
        ("max_position_pct", "0"),
        ("max_position_pct", "1.01"),
        ("take_profit_pct", "-0.01"),
        ("request_timeout", 0),
        ("poll_seconds", 0),
        ("paper_cash", "0"),
        ("paper_slippage_bps", "-0.01"),
        ("paper_slippage_bps", "10000"),
        ("paper_commission_bps", "-0.01"),
        ("backtest_spread_bps", "-0.01"),
        ("backtest_spread_bps", "20000"),
        ("regime_ma_bars", 0),
        ("momentum_lookback", 0),
        ("breakout_entry_bars", 0),
        ("breakout_exit_bars", 0),
        ("meanrev_lookback", 1),
        ("max_positions", 0),
        ("max_order_notional", "0"),
        ("max_holding_days", -1),
        ("stop_cooldown_days", -1),
    ],
)
def test_rejects_numeric_values_outside_operational_domains(field, value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{field: value})


@pytest.mark.parametrize(
    "field",
    [
        "paper_cash",
        "paper_slippage_bps",
        "paper_commission_bps",
        "backtest_spread_bps",
        "max_position_pct",
        "max_daily_loss_pct",
        "max_order_notional",
        "stop_loss_pct",
        "trailing_stop_pct",
        "take_profit_pct",
        "momentum_entry",
        "momentum_exit",
        "meanrev_entry_z",
        "meanrev_exit_z",
    ],
)
@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_rejects_non_finite_decimal_settings(field, value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{field: value})


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_rejects_non_finite_request_timeout(value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, request_timeout=value)


def test_risk_percentage_boundaries_and_large_profit_target_are_valid():
    settings = Settings(
        _env_file=None,
        stop_loss_pct="0",
        trailing_stop_pct="0.999",
        max_daily_loss_pct="0",
        max_position_pct="1",
        take_profit_pct="2",
    )

    assert settings.trailing_stop_pct == Decimal("0.999")
    assert settings.max_position_pct == Decimal("1")
    assert settings.take_profit_pct == Decimal("2")


def test_assignment_cannot_bypass_numeric_domain_validation(defaults):
    with pytest.raises(ValidationError):
        defaults.stop_loss_pct = Decimal("2")


@pytest.mark.parametrize(
    "values",
    [
        {"momentum_entry": "0.01", "momentum_exit": "0.02"},
        {"meanrev_entry_z": "0", "meanrev_exit_z": "0"},
        {"meanrev_entry_z": "-2", "meanrev_exit_z": "-3"},
    ],
)
def test_rejects_strategy_thresholds_that_cannot_generate_a_coherent_cycle(values):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **values)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("momentum_entry", Decimal("-1")),
        ("momentum_exit", Decimal("1")),
        ("meanrev_entry_z", Decimal("0")),
        ("meanrev_exit_z", Decimal("-3")),
    ],
)
def test_failed_strategy_threshold_assignment_preserves_prior_values(
    defaults, field, value
):
    before = defaults.model_dump()

    with pytest.raises(ValidationError):
        setattr(defaults, field, value)

    assert defaults.model_dump() == before


def test_execution_cost_boundaries_keep_positive_prices():
    settings = Settings(
        _env_file=None,
        paper_slippage_bps="9999.999",
        backtest_spread_bps="19999.999",
    )

    assert settings.paper_slippage_bps == Decimal("9999.999")
    assert settings.backtest_spread_bps == Decimal("19999.999")


def test_require_credentials_names_missing_keys():
    settings = Settings(_env_file=None, client_id="", client_secret="")
    with pytest.raises(RuntimeError, match="TOSSQUANT_CLIENT_ID"):
        settings.require_credentials()


def test_require_credentials_passes_when_set():
    settings = Settings(_env_file=None, client_id="a", client_secret="b")
    settings.require_credentials()  # 예외 없음
