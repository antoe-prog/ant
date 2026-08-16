from __future__ import annotations

import math
from dataclasses import replace
from io import StringIO
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from rich.console import Console

from tossquant.backtest.metrics import EquityPoint, Trade, compute
from tossquant.backtest.report import _ratio, _trade_table


START = datetime(2026, 1, 1, tzinfo=timezone.utc)


def points(values: list[str]) -> list[EquityPoint]:
    return [
        EquityPoint(
            ts=START + timedelta(days=index),
            equity=Decimal(value),
            cash=Decimal(value),
            invested=Decimal("0"),
        )
        for index, value in enumerate(values)
    ]


def rendered_trade_table(metrics) -> str:
    output = StringIO()
    Console(file=output, force_terminal=False, width=100).print(
        _trade_table(metrics)
    )
    return output.getvalue()


def test_sortino_uses_target_relative_downside_deviation_with_one_loss():
    # 수익률은 +10%, -5%, +10%. 음수 표본이 하나뿐이어도 downside risk는 0이 아니다.
    metrics = compute(points(["100", "110", "104.5", "114.95"]))
    returns = (0.10, -0.05, 0.10)
    mean_return = sum(returns) / len(returns)
    downside_deviation = math.sqrt(
        sum(min(value, 0.0) ** 2 for value in returns) / len(returns)
    )
    annualizer = math.sqrt(365.25)

    assert metrics.sortino == pytest.approx(
        mean_return / downside_deviation * annualizer
    )
    assert metrics.sortino > 0


def test_zero_variance_ratios_distinguish_constant_gain_flat_and_loss():
    gain = compute(points(["100", "110", "121"]))
    flat = compute(points(["100", "100", "100"]))
    loss = compute(points(["100", "90", "81"]))

    assert gain.volatility == 0
    assert gain.sharpe == math.inf
    assert gain.sortino == math.inf
    assert flat.sharpe == 0
    assert flat.sortino == 0
    assert loss.volatility == 0
    assert loss.sharpe == -math.inf
    assert math.isfinite(loss.sortino)
    assert loss.sortino < 0


def test_report_labels_signed_infinite_ratios_without_decimal_inf_text():
    assert _ratio(math.inf) == "∞"
    assert _ratio(0.0) == "0.00"
    assert _ratio(-math.inf) == "-∞"


def test_all_winning_trades_have_infinite_not_zero_profit_factor():
    trades = [
        Trade(
            "A",
            START,
            START + timedelta(days=1),
            1,
            Decimal("100"),
            Decimal("110"),
            Decimal("10"),
            1,
        )
    ]

    metrics = compute(points(["100", "110"]), trades)

    assert metrics.profit_factor == math.inf
    assert "∞" in rendered_trade_table(metrics)


def test_profit_factor_is_undefined_without_profit_or_loss():
    metrics = compute(points(["100", "100"]))

    assert metrics.profit_factor is None
    assert "—" in rendered_trade_table(metrics)


def test_compute_rejects_decimal_values_that_overflow_float_metrics():
    with pytest.raises(ValueError, match="유한한 float"):
        compute(points(["1", "1e400"]))


def test_compute_normalizes_annualization_overflow_to_value_error():
    with pytest.raises(ValueError, match="유한하지 않은 지표"):
        compute(points(["1", "1e300"]))


def test_profit_factor_overflow_with_real_loss_is_not_lossless_infinity():
    trades = [
        Trade(
            "A",
            START,
            START + timedelta(days=1),
            1,
            Decimal("1"),
            Decimal("1"),
            Decimal("1e400"),
            1,
        ),
        Trade(
            "A",
            START,
            START + timedelta(days=1),
            1,
            Decimal("1"),
            Decimal("1"),
            Decimal("-1"),
            1,
        ),
    ]

    with pytest.raises(ValueError, match="손익비|profit factor|유한"):
        compute(points(["100", "100"]), trades)


def test_breakeven_trade_does_not_dilute_average_actual_loss():
    trades = [
        Trade(
            "A",
            START,
            START + timedelta(days=1),
            1,
            Decimal("100"),
            Decimal("90"),
            Decimal("-10"),
            1,
        ),
        Trade(
            "B",
            START,
            START + timedelta(days=1),
            1,
            Decimal("100"),
            Decimal("100"),
            Decimal("0"),
            1,
        ),
    ]

    metrics = compute(points(["100", "100"]), trades)

    assert metrics.avg_loss == Decimal("-10")


def test_breakeven_trade_is_not_counted_as_a_win():
    trades = [
        Trade(
            "A",
            START,
            START + timedelta(days=1),
            1,
            Decimal("100"),
            Decimal("110"),
            Decimal("10"),
            1,
        ),
        Trade(
            "B",
            START,
            START + timedelta(days=1),
            1,
            Decimal("100"),
            Decimal("100"),
            Decimal("0"),
            1,
        ),
    ]

    metrics = compute(points(["100", "100"]), trades)

    assert metrics.win_rate == pytest.approx(0.5)


@pytest.mark.parametrize(
    "second_timestamp",
    [START, START - timedelta(days=1)],
    ids=["duplicate", "reversed"],
)
def test_compute_rejects_nonincreasing_timestamps(second_timestamp):
    curve = [
        EquityPoint(START, Decimal("100"), Decimal("100"), Decimal("0")),
        EquityPoint(
            second_timestamp,
            Decimal("100"),
            Decimal("100"),
            Decimal("0"),
        ),
    ]

    with pytest.raises(ValueError, match="timestamp|시각|증가"):
        compute(curve)


def test_compute_rejects_timezone_naive_timestamps():
    naive = START.replace(tzinfo=None)
    curve = [
        EquityPoint(naive, Decimal("100"), Decimal("100"), Decimal("0")),
        EquityPoint(
            naive + timedelta(days=1),
            Decimal("100"),
            Decimal("100"),
            Decimal("0"),
        ),
    ]

    with pytest.raises(ValueError, match="timezone|timestamp|시각"):
        compute(curve)


@pytest.mark.parametrize(
    ("field", "value", "paired_value"),
    [
        ("cash", Decimal("NaN"), Decimal("0")),
        ("invested", Decimal("NaN"), Decimal("100")),
        ("cash", Decimal("-1"), Decimal("101")),
        ("invested", Decimal("-1"), Decimal("101")),
        ("cash", 100.0, Decimal("0")),
        ("invested", 0.0, Decimal("100")),
    ],
)
def test_compute_rejects_invalid_cash_or_invested_domain(
    field, value, paired_value
):
    point = EquityPoint(
        START + timedelta(days=1),
        Decimal("100"),
        paired_value if field == "invested" else value,
        value if field == "invested" else paired_value,
    )
    curve = [points(["100"])[0], point]

    with pytest.raises(ValueError, match="cash|invested|현금|투자|Decimal|유한|0 이상"):
        compute(curve)


def test_compute_rejects_broken_equity_accounting_identity():
    curve = points(["100", "100"])
    curve[1] = replace(
        curve[1],
        equity=Decimal("110"),
        cash=Decimal("100"),
        invested=Decimal("100"),
    )

    with pytest.raises(ValueError, match="cash|invested|equity|평가|합계|일치"):
        compute(curve)


def test_flat_equal_peaks_have_zero_drawdown_duration():
    metrics = compute(points(["100", "100", "100", "100", "100"]))

    assert metrics.max_drawdown == 0
    assert metrics.max_drawdown_bars == 0


def test_equal_peak_recovery_resets_drawdown_duration():
    metrics = compute(points(["100", "90", "100", "100", "100"]))

    assert metrics.max_drawdown == pytest.approx(0.1)
    assert metrics.max_drawdown_bars == 1
