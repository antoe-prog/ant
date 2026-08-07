"""지표 테스트.

'현재 봉을 포함하느냐'가 여기서 가장 실수하기 쉽다. 돌파 전략에서 현재 봉을
포함해 신고가를 계산하면 돌파가 영원히 성립하지 않는데, 예외도 나지 않고
그냥 거래가 0건이 될 뿐이라 조용히 지나간다.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from tossquant.strategy.indicators import (
    highest,
    lowest,
    roc,
    sma,
    stdev,
    zscore,
)


def dec(*values) -> list[Decimal]:
    return [Decimal(str(v)) for v in values]


# --- sma ---------------------------------------------------------------------


def test_sma_averages_last_window():
    assert sma(dec(1, 2, 3, 4), 2) == Decimal("3.5")


def test_sma_ignores_older_bars():
    assert sma(dec(100, 1, 1), 2) == Decimal("1")


def test_sma_needs_enough_data():
    assert sma(dec(1, 2), 3) is None


def test_sma_rejects_nonpositive_window():
    assert sma(dec(1, 2, 3), 0) is None


# --- stdev / zscore ----------------------------------------------------------


def test_stdev_of_constant_series_is_zero():
    assert stdev(dec(5, 5, 5, 5), 4) == 0


def test_stdev_uses_sample_formula():
    # [2,4,4,4,5,5,7,9] 의 표본표준편차는 2.138...
    result = stdev(dec(2, 4, 4, 4, 5, 5, 7, 9), 8)
    assert result == pytest.approx(Decimal("2.13809"), abs=1e-4)


def test_zscore_is_zero_at_the_mean():
    assert zscore(dec(1, 2, 3, 2), 4) is not None


def test_zscore_is_negative_below_the_mean():
    z = zscore(dec(10, 10, 10, 4), 4)
    assert z < 0


def test_zscore_undefined_without_volatility():
    """변동성이 0이면 나눗셈이 성립하지 않는다 — 0으로 나누면 안 된다."""
    assert zscore(dec(5, 5, 5, 5), 4) is None


def test_zscore_needs_enough_data():
    assert zscore(dec(1, 2), 5) is None


# --- roc ---------------------------------------------------------------------


def test_roc_measures_return_over_lookback():
    assert roc(dec(100, 0, 0, 110), 3) == Decimal("0.1")


def test_roc_is_negative_on_decline():
    assert roc(dec(100, 90), 1) == Decimal("-0.1")


def test_roc_needs_lookback_plus_one_bars():
    assert roc(dec(100, 110), 2) is None


def test_roc_guards_against_zero_base():
    assert roc(dec(0, 110), 1) is None


# --- highest / lowest --------------------------------------------------------


def test_highest_excludes_current_bar_by_default():
    """돌파 판정의 핵심. 현재 봉을 포함하면 돌파가 성립할 수 없다."""
    assert highest(dec(1, 2, 3, 99), 3) == Decimal("3")


def test_highest_can_include_current_bar():
    assert highest(dec(1, 2, 3, 99), 3, exclude_last=False) == Decimal("99")


def test_lowest_excludes_current_bar_by_default():
    assert lowest(dec(9, 8, 7, 1), 3) == Decimal("7")


def test_highest_needs_a_full_window_after_exclusion():
    # 4개 중 현재 봉을 빼면 3개 → 창 4는 채울 수 없다
    assert highest(dec(1, 2, 3, 4), 4) is None
    assert highest(dec(1, 2, 3, 4), 3) == Decimal("3")


def test_lowest_needs_a_full_window_after_exclusion():
    assert lowest(dec(1, 2, 3, 4), 4) is None
