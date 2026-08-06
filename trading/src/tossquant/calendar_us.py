"""미국 정규장 개장 판정.

한국에서 돌리는 봇이므로 서머타임 때문에 KST 기준 시각이 매년 한 시간씩
움직인다. 시각 비교는 전부 America/New_York 기준으로 하고 KST 변환은 표시용
으로만 쓴다.
"""

from __future__ import annotations

from datetime import date, datetime, time
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
KST = ZoneInfo("Asia/Seoul")

REGULAR_OPEN = time(9, 30)
REGULAR_CLOSE = time(16, 0)
EARLY_CLOSE = time(13, 0)

# NYSE 휴장일. 매년 갱신이 필요하다 (연말에 다음 해 일정 추가할 것).
HOLIDAYS: frozenset[date] = frozenset(
    {
        # 2026
        date(2026, 1, 1),   # New Year's Day
        date(2026, 1, 19),  # MLK Jr. Day
        date(2026, 2, 16),  # Presidents' Day
        date(2026, 4, 3),   # Good Friday
        date(2026, 5, 25),  # Memorial Day
        date(2026, 6, 19),  # Juneteenth
        date(2026, 7, 3),   # Independence Day (7/4 토 → 3일 관측)
        date(2026, 9, 7),   # Labor Day
        date(2026, 11, 26), # Thanksgiving
        date(2026, 12, 25), # Christmas
        # 2027
        date(2027, 1, 1),
        date(2027, 1, 18),
        date(2027, 2, 15),
        date(2027, 3, 26),
        date(2027, 5, 31),
        date(2027, 6, 18),  # 6/19 토 → 18일 관측
        date(2027, 7, 5),   # 7/4 일 → 5일 관측
        date(2027, 9, 6),
        date(2027, 11, 25),
        date(2027, 12, 24), # 12/25 토 → 24일 관측
    }
)

# 13:00 ET 조기 폐장일
EARLY_CLOSE_DAYS: frozenset[date] = frozenset(
    {
        date(2026, 11, 27),  # 추수감사절 다음날
        date(2026, 12, 24),
        date(2027, 11, 26),
        date(2027, 12, 23),
    }
)


def to_ny(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        raise ValueError("naive datetime is not accepted; attach a tzinfo")
    return moment.astimezone(NY)


def is_trading_day(day: date) -> bool:
    return day.weekday() < 5 and day not in HOLIDAYS


def close_time(day: date) -> time:
    return EARLY_CLOSE if day in EARLY_CLOSE_DAYS else REGULAR_CLOSE


def is_market_open(moment: datetime) -> bool:
    """정규장(프리/애프터 제외) 개장 여부."""
    ny = to_ny(moment)
    if not is_trading_day(ny.date()):
        return False
    return REGULAR_OPEN <= ny.time() < close_time(ny.date())


def minutes_to_close(moment: datetime) -> int | None:
    """장중이면 폐장까지 남은 분, 장외면 None."""
    if not is_market_open(moment):
        return None
    ny = to_ny(moment)
    close_dt = datetime.combine(ny.date(), close_time(ny.date()), tzinfo=NY)
    return int((close_dt - ny).total_seconds() // 60)


def describe(moment: datetime) -> str:
    ny = to_ny(moment)
    kst = moment.astimezone(KST)
    state = "개장" if is_market_open(moment) else "휴장"
    return (
        f"{state} | NY {ny:%Y-%m-%d %H:%M} / KST {kst:%Y-%m-%d %H:%M}"
    )
