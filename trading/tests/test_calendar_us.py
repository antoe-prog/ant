from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from tossquant.calendar_us import (
    CalendarCoverageError,
    KST,
    NY,
    close_time,
    describe,
    is_market_open,
    is_trading_day,
    minutes_to_close,
)


def ny(year, month, day, hour, minute=0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=NY)


def test_regular_session_is_open():
    assert is_market_open(ny(2026, 8, 6, 10, 0))


def test_before_open_and_after_close_are_shut():
    assert not is_market_open(ny(2026, 8, 6, 9, 29))
    assert not is_market_open(ny(2026, 8, 6, 16, 0))


def test_weekend_is_shut():
    assert not is_market_open(ny(2026, 8, 8, 12, 0))  # 토요일


def test_holiday_is_shut():
    assert not is_trading_day(ny(2026, 12, 25, 12, 0).date())
    assert not is_market_open(ny(2026, 12, 25, 12, 0))


def test_early_close_day_shuts_at_13():
    assert is_market_open(ny(2026, 11, 27, 12, 59))
    assert not is_market_open(ny(2026, 11, 27, 13, 0))


def test_kst_input_is_converted():
    """KST 자정 = 전날 NY 오전 — 서머타임 여부와 무관하게 장중이어야 한다."""
    kst_moment = datetime(2026, 8, 7, 0, 0, tzinfo=KST)
    assert is_market_open(kst_moment)


def test_naive_datetime_rejected():
    with pytest.raises(ValueError):
        is_market_open(datetime(2026, 8, 6, 10, 0))


def test_minutes_to_close():
    assert minutes_to_close(ny(2026, 8, 6, 15, 30)) == 30
    assert minutes_to_close(ny(2026, 8, 6, 20, 0)) is None


def test_utc_input_works():
    utc_moment = datetime(2026, 8, 6, 14, 0, tzinfo=ZoneInfo("UTC"))  # 10:00 ET
    assert is_market_open(utc_moment)


@pytest.mark.parametrize(
    "month, day",
    [
        (1, 17),
        (2, 21),
        (4, 14),
        (5, 29),
        (6, 19),
        (7, 4),
        (9, 4),
        (11, 23),
        (12, 25),
    ],
)
def test_2028_official_nyse_holidays_are_closed(month, day):
    assert not is_trading_day(ny(2028, month, day, 12).date())


@pytest.mark.parametrize("month, day", [(7, 3), (11, 24)])
def test_2028_official_early_close_days_shut_at_13(month, day):
    day_value = ny(2028, month, day, 12).date()
    assert close_time(day_value).hour == 13
    assert is_market_open(ny(2028, month, day, 12, 59))
    assert not is_market_open(ny(2028, month, day, 13, 0))


def test_2027_day_before_observed_christmas_is_a_regular_session():
    # NYSE의 현재 2026--2028 표는 2027-12-23 조기폐장을 지정하지 않는다.
    assert close_time(ny(2027, 12, 23, 12).date()).hour == 16


def test_calendar_fails_closed_outside_officially_published_years():
    with pytest.raises(CalendarCoverageError, match="2029"):
        is_trading_day(ny(2029, 1, 2, 12).date())
    with pytest.raises(CalendarCoverageError, match="2029"):
        is_market_open(ny(2029, 1, 2, 12))


def test_human_description_reports_unverified_calendar_without_claiming_closed():
    text = describe(ny(2029, 1, 2, 12))
    assert "미검증" in text
    assert "개장" not in text
    assert "휴장" not in text
