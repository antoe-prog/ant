"""가격 불연속 감지 테스트.

이 모듈은 개발 중 두 번 틀렸고 둘 다 조용히 데이터를 망가뜨리는 종류였다:

1. 하루짜리 잘못된 값(-49% 다음날 +101%)을 2:1 분할로 오인
2. 그 오류에서 **되돌아오는 봉**을 다시 분할로 오인 — 지속성 검사만으로는
   못 잡는다. 되돌아온 뒤에는 새 가격대가 실제로 유지되기 때문이다.

둘 다 실제 S&P 500 데이터(LNT, MRO, NWL)에서 나온 패턴이라 그대로 테스트로
박아 둔다.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from tossquant.backtest.corporate import back_adjust, detect
from tossquant.models import Candle

START = datetime(2026, 1, 5, tzinfo=timezone.utc)


def series(rows: list[tuple[float, int]]) -> list[Candle]:
    """(종가, 거래량) 목록으로 캔들을 만든다."""
    return [
        Candle(
            symbol="X",
            ts=START + timedelta(days=i),
            open=Decimal(str(c)),
            high=Decimal(str(c)),
            low=Decimal(str(c)),
            close=Decimal(str(c)),
            volume=v,
        )
        for i, (c, v) in enumerate(rows)
    ]


def flat(price: float, n: int, volume: int = 1000):
    return [(price, volume)] * n


# --- 감지 --------------------------------------------------------------------


def test_quiet_series_has_no_breaks():
    assert detect(series(flat(100, 20))) == []


def test_ordinary_moves_are_ignored():
    """-20% 실적 쇼크는 불연속이 아니다. 기본 기준 25%를 넘지 않는다."""
    assert detect(series(flat(100, 10) + flat(80, 10))) == []


def test_large_gap_is_detected():
    breaks = detect(series(flat(100, 10) + flat(50, 10)))
    assert len(breaks) == 1
    assert breaks[0].ratio == Decimal("0.5")


def test_threshold_is_configurable():
    rows = series(flat(100, 10) + flat(80, 10))
    assert detect(rows, threshold=Decimal("0.15")) != []


# --- 분할 판정 (세 근거를 모두 요구) -----------------------------------------


def split_series():
    """2:1 분할: 가격 절반, 거래량 두 배, 새 가격대 유지."""
    return series(flat(100, 10, 1000) + flat(50, 10, 2000))


def test_split_needs_ratio_volume_and_persistence():
    breaks = detect(split_series())
    assert len(breaks) == 1
    assert breaks[0].looks_like_split
    assert breaks[0].split_ratio == Decimal("0.5")


def test_odd_ratio_is_not_a_split():
    """-43%는 어떤 분할 비율에도 맞지 않는다 — 분사이거나 진짜 폭락이다."""
    breaks = detect(series(flat(100, 10, 1000) + flat(57, 10, 2000)))
    assert breaks[0].split_ratio is None
    assert not breaks[0].looks_like_split


def test_split_ratio_without_volume_jump_is_not_confirmed():
    """진짜 폭락이 우연히 -50%일 수 있다. 거래량까지 맞아야 한다."""
    breaks = detect(series(flat(100, 10, 1000) + flat(50, 10, 1000)))
    assert breaks[0].split_ratio == Decimal("0.5")
    assert not breaks[0].volume_confirms
    assert not breaks[0].looks_like_split


def test_reverse_split_is_detected():
    """1:2 병합은 가격이 두 배, 거래량이 절반."""
    breaks = detect(series(flat(50, 10, 2000) + flat(100, 10, 1000)))
    assert breaks[0].looks_like_split
    assert breaks[0].split_ratio == Decimal("2")


# --- 하루짜리 데이터 오류 (실제로 두 번 틀렸던 지점) --------------------------


def bad_bar_series():
    """LNT 실제 패턴: 35.35 → 17.87 → 35.91. 분할이 아니라 잘못된 값 하나."""
    return series(flat(35.35, 10, 1000) + [(17.87, 2000)] + flat(35.91, 10, 1000))


def test_single_bad_bar_is_not_a_split():
    breaks = detect(bad_bar_series())

    assert len(breaks) == 2
    assert not any(b.looks_like_split for b in breaks), (
        "하루짜리 오류를 분할로 조정하면 데이터가 망가진다"
    )
    assert all(b.looks_like_bad_bar for b in breaks)


def test_recovery_bar_is_not_a_split_either():
    """되돌아오는 봉은 지속성 검사를 통과한다 — 왕복 짝짓기로만 잡힌다."""
    recovery = detect(bad_bar_series())[1]
    assert recovery.ratio > 1
    assert recovery.persists is True          # 새 가격대는 실제로 유지된다
    assert recovery.round_trip is True        # 그래도 짝이 있으므로 오류
    assert not recovery.looks_like_split


def test_upward_bad_bar_is_caught_too():
    """MRO 패턴: 위로 튀었다가 되돌아오는 경우."""
    rows = series(flat(11.91, 10, 1000) + [(16.02, 2000)] + flat(12.00, 10, 1000))
    assert all(b.looks_like_bad_bar for b in detect(rows))


def test_price_that_stays_down_is_not_a_bad_bar():
    breaks = detect(split_series())
    assert not breaks[0].looks_like_bad_bar


def test_break_at_the_very_end_is_assumed_persistent():
    """뒤에 봉이 없으면 판단할 수 없다. 마지막 봉 하나로 전체를 버리지 않는다."""
    breaks = detect(series(flat(100, 10, 1000) + [(50, 2000)]))
    assert breaks[0].persists is True


# --- 소급 조정 ---------------------------------------------------------------


def test_back_adjust_makes_the_series_continuous():
    candles = split_series()
    breaks = detect(candles)

    adjusted = back_adjust(candles, breaks)

    # 분할 이전 가격이 절반으로 내려와 이어진다
    assert adjusted[0].close == Decimal("50")
    assert adjusted[-1].close == Decimal("50")
    assert detect(adjusted) == []          # 조정 후엔 불연속이 사라진다


def test_back_adjust_leaves_recent_prices_untouched():
    """최신 가격이 기준이다. 현재 시점 절대 가격이 바뀌면 안 된다."""
    candles = split_series()
    adjusted = back_adjust(candles, detect(candles))
    assert adjusted[-1].close == candles[-1].close


def test_back_adjust_scales_volume_inversely():
    candles = split_series()
    adjusted = back_adjust(candles, detect(candles))
    assert adjusted[0].volume == 2000      # 1000주 → 분할 후 기준 2000주


def test_back_adjust_ignores_unconfirmed_breaks():
    """분사는 조정 계수를 알 수 없다. 틀린 계수로 고치면 원본보다 나빠진다."""
    candles = series(flat(100, 10, 1000) + flat(57, 10, 2000))
    assert back_adjust(candles, detect(candles)) == candles


def test_back_adjust_never_touches_bad_bars():
    candles = bad_bar_series()
    assert back_adjust(candles, detect(candles)) == candles


def test_back_adjust_without_breaks_is_a_noop():
    candles = series(flat(100, 20))
    assert back_adjust(candles, []) == candles


def test_multiple_splits_compound():
    """분할이 두 번이면 계수가 곱해져야 한다."""
    candles = series(flat(200, 5, 1000) + flat(100, 5, 2000) + flat(50, 5, 4000))
    adjusted = back_adjust(candles, detect(candles))
    assert adjusted[0].close == Decimal("50")
    assert detect(adjusted) == []
