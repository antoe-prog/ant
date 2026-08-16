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

from tossquant.backtest.corporate import (
    VerifiedSplit,
    back_adjust,
    detect,
    load_verified_splits,
)
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


def verified(candles: list[Candle], index: int, ratio: str) -> VerifiedSplit:
    return VerifiedSplit(
        symbol="X",
        effective_date=candles[index].ts.date(),
        ratio=Decimal(ratio),
        source="test-fixture",
    )


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


def test_split_candidate_inside_tolerance_is_not_lost_at_threshold_boundary():
    """4:3 분할 당일 +0.13% 움직여도 0.75 후보 허용오차 안에 있다."""
    rows = series(flat(100, 10, 1000) + flat(75.1, 10, 1333))

    breaks = detect(rows)

    assert len(breaks) == 1
    assert breaks[0].split_ratio == Decimal("0.75")
    assert breaks[0].looks_like_split


def test_subthreshold_known_ratio_without_other_evidence_is_ignored():
    """알려진 비율과 가깝다는 이유만으로 hard threshold를 우회하지 않는다."""
    rows = series(flat(100, 10, 1000) + flat(75.1, 10, 1000))

    assert detect(rows) == []


def test_custom_threshold_is_not_bypassed_by_a_smaller_known_ratio():
    rows = series(flat(100, 10, 1000) + flat(75.1, 10, 1333))

    assert detect(rows, threshold=Decimal("0.50")) == []


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


def test_continued_decline_is_not_mislabeled_as_a_transient_bad_bar():
    """급락 뒤 더 하락한 가격은 이전 가격대로 복귀한 데이터 오류가 아니다."""
    breaks = detect(series(flat(100, 10, 1000) + [(50, 2000)] + flat(35, 10, 2000)))
    assert breaks[0].persists is True
    assert not breaks[0].looks_like_bad_bar


def test_round_trip_compares_actual_endpoints_across_intervening_move():
    """100→50→60→120은 검출 점프 곱만 1이고 실제로는 20% 상승했다."""
    candles = series(
        flat(100, 10, 1000)
        + [(50, 2000), (60, 1800), (120, 900)]
        + flat(120, 10, 900)
    )
    breaks = detect(candles)
    assert len(breaks) == 2
    assert not any(item.round_trip for item in breaks)


@pytest.mark.parametrize("threshold", [Decimal("0"), Decimal("-0.1"), Decimal("NaN")])
def test_detect_rejects_invalid_threshold(threshold):
    with pytest.raises(ValueError, match="threshold"):
        detect(series(flat(100, 5)), threshold=threshold)


def test_persistence_does_not_narrow_extreme_decimal_prices_to_float():
    candles = series(
        flat(100, 5)
        + [(Decimal("1e-10000"), 1000)]
        + [(Decimal("1e-20000"), 1000)] * 5
    )

    breaks = detect(candles)

    assert breaks[0].persists is True


def test_detect_normalizes_decimal_context_overflow():
    candles = series(
        flat(1, 6)
        + [(Decimal("1e1000000"), 1000)]
        + [(Decimal("1e1000000"), 1000)] * 5
    )

    with pytest.raises(ValueError, match="Decimal 지원 범위"):
        detect(candles)


def test_detect_rejects_nonfinite_close():
    candles = series(flat(100, 5))
    broken = Candle(
        symbol="X",
        ts=candles[-1].ts,
        open=Decimal("NaN"),
        high=Decimal("NaN"),
        low=Decimal("NaN"),
        close=Decimal("NaN"),
        volume=1000,
    )

    with pytest.raises(ValueError, match="유한하지 않은 종가"):
        detect([*candles[:-1], broken])


def test_break_at_the_very_end_has_no_persistence_evidence():
    """미래 봉이 없다는 사실을 지속성 증거로 바꾸면 안 된다."""
    breaks = detect(series(flat(100, 10, 1000) + [(50, 2000)]))
    assert breaks[0].persists is None
    assert not breaks[0].looks_like_split


@pytest.mark.parametrize("bad_bars", range(1, 6))
def test_short_bad_price_plateau_is_never_a_split(bad_bars):
    """며칠간 잘못된 가격대가 이어져도 복귀 봉을 역분할로 조정하지 않는다."""
    candles = series(
        flat(100, 10, 1000)
        + flat(50, bad_bars, 2000)
        + flat(100, 10, 1000)
    )

    breaks = detect(candles)

    assert not any(b.looks_like_split for b in breaks)
    assert back_adjust(candles, []) == candles


def test_known_bad_bar_marks_the_symbol_as_contaminated():
    """감지한 데이터 오류를 --exclude-contaminated가 다시 포함하면 안 된다."""
    assert any(b.distorts_backtest for b in detect(bad_bar_series()))


# --- 소급 조정 ---------------------------------------------------------------


def test_back_adjust_makes_the_series_continuous():
    candles = split_series()
    breaks = detect(candles)

    adjusted = back_adjust(candles, [verified(candles, 10, "0.5")])

    # 분할 이전 가격이 절반으로 내려와 이어진다
    assert adjusted[0].close == Decimal("50")
    assert adjusted[-1].close == Decimal("50")
    assert detect(adjusted) == []          # 조정 후엔 불연속이 사라진다


def test_back_adjust_leaves_recent_prices_untouched():
    """최신 가격이 기준이다. 현재 시점 절대 가격이 바뀌면 안 된다."""
    candles = split_series()
    adjusted = back_adjust(candles, [verified(candles, 10, "0.5")])
    assert adjusted[-1].close == candles[-1].close


def test_back_adjust_scales_volume_inversely():
    candles = split_series()
    adjusted = back_adjust(candles, [verified(candles, 10, "0.5")])
    assert adjusted[0].volume == 2000      # 1000주 → 분할 후 기준 2000주


def test_back_adjust_scales_every_ohlc_field_and_preserves_candle_shape():
    before = Candle(
        symbol="X",
        ts=START,
        open=Decimal("98"),
        high=Decimal("105"),
        low=Decimal("95"),
        close=Decimal("100"),
        volume=1001,
    )
    after = Candle(
        symbol="X",
        ts=START + timedelta(days=1),
        open=Decimal("49"),
        high=Decimal("52.5"),
        low=Decimal("47.5"),
        close=Decimal("50"),
        volume=2002,
    )

    adjusted = back_adjust(
        [before, after],
        [
            VerifiedSplit(
                symbol="X",
                effective_date=after.ts.date(),
                ratio=Decimal("0.5"),
                source="test-fixture",
            )
        ],
    )

    assert adjusted[0].open == Decimal("49")
    assert adjusted[0].high == Decimal("52.5")
    assert adjusted[0].low == Decimal("47.5")
    assert adjusted[0].close == Decimal("50")
    assert adjusted[0].low <= adjusted[0].open <= adjusted[0].high
    assert adjusted[0].low <= adjusted[0].close <= adjusted[0].high
    assert adjusted[1] == after


def test_back_adjust_rounds_repeating_ratio_volume_instead_of_truncating():
    candles = series([(700, 1001), (100, 7007)])
    action = verified(candles, 1, str(Decimal(1) / Decimal(7)))

    adjusted = back_adjust(candles, [action])

    assert adjusted[0].volume == 7007


def test_back_adjust_rejects_price_underflow_to_zero():
    candles = series(
        [
            (Decimal("1e-1000026"), 1),
            (Decimal("1"), 1),
            (Decimal("0.01"), 1),
        ]
    )

    with pytest.raises(ValueError, match="조정 후.*OHLC"):
        back_adjust(candles, [verified(candles, 2, "0.01")])


def test_back_adjust_rejects_adjusted_volume_outside_sqlite_integer_range():
    candles = series(
        [
            (Decimal("1"), 2**63 - 1),
            (Decimal("0.0001"), 1),
        ]
    )

    with pytest.raises(ValueError, match="조정 후.*거래량"):
        back_adjust(candles, [verified(candles, 1, "0.0001")])


def test_back_adjust_preserves_event_day_market_return():
    """공시 계수는 관측 종가비가 아니므로 행사일의 정상 -2%를 지우지 않는다."""
    candles = series([(100, 1000), (49, 2000)])

    adjusted = back_adjust(candles, [verified(candles, 1, "0.5")])

    assert adjusted[0].close == Decimal("50")
    assert adjusted[1].close / adjusted[0].close == Decimal("0.98")


@pytest.mark.parametrize(
    ("field", "event_values"),
    [
        ("open", {"open": "100", "high": "100", "low": "50", "close": "50"}),
        ("high", {"open": "50", "high": "100", "low": "50", "close": "50"}),
        ("low", {"open": "50", "high": "50", "low": "25", "close": "50"}),
    ],
)
def test_back_adjust_rejects_mixed_scale_event_day_ohlc(field, event_values):
    """종가만 새 스케일인 혼합 데이터는 체결가·돌파 채널을 조용히 왜곡한다."""
    before = Candle(
        symbol="X",
        ts=START,
        open=Decimal("100"),
        high=Decimal("100"),
        low=Decimal("100"),
        close=Decimal("100"),
        volume=1000,
    )
    event = Candle(
        symbol="X",
        ts=START + timedelta(days=1),
        open=Decimal(event_values["open"]),
        high=Decimal(event_values["high"]),
        low=Decimal(event_values["low"]),
        close=Decimal(event_values["close"]),
        volume=2000,
    )

    with pytest.raises(ValueError, match=rf"행사일 {field}.*잔여 갭"):
        back_adjust([before, event], [verified([before, event], 1, "0.5")])


def test_back_adjust_rejects_grossly_wrong_manifest_factor():
    candles = series([(100, 1000), (50, 2000)])

    with pytest.raises(ValueError, match="계수.*잔여 갭"):
        back_adjust(candles, [verified(candles, 1, "0.25")])


def test_back_adjust_rejects_manifest_factor_leaving_detectable_break():
    candles = series([(100, 1000), (50, 2000)])

    with pytest.raises(ValueError, match="잔여 갭"):
        back_adjust(candles, [verified(candles, 1, "0.75")])


@pytest.mark.parametrize(
    ("before", "after", "factor", "event_type"),
    [
        (100, 50, Decimal(1) / Decimal(3), "split"),
        (100, 200, Decimal("4"), "reverse_split"),
    ],
)
def test_back_adjust_rejects_factor_that_creates_fifty_percent_residual_gap(
    before, after, factor, event_type
):
    candles = series([(before, 1000), (after, 2000)])
    action = VerifiedSplit(
        symbol="X",
        effective_date=candles[1].ts.date(),
        ratio=factor,
        event_type=event_type,
        source="test-fixture",
    )

    with pytest.raises(ValueError, match="잔여 갭"):
        back_adjust(candles, [action])


def test_back_adjust_rejects_weekly_rows_mislabeled_as_daily():
    """interval 문자열만 1d인 주봉에 날짜 매니페스트를 적용하면 경계가 모호하다."""
    candles = series([(100, 1000), (50, 2000), (50, 2000), (50, 2000)])
    candles = [
        Candle(**{**candle.__dict__, "ts": START + timedelta(days=index * 7)})
        for index, candle in enumerate(candles)
    ]
    original = list(candles)

    with pytest.raises(ValueError, match="일봉 주기"):
        back_adjust(candles, [verified(candles, 1, "0.5")])

    assert candles == original


def test_back_adjust_accepts_dense_daily_rows_with_weekend_and_holiday_gaps():
    """미국 일봉의 일반적인 주말(3일)·연휴(4일) 간격은 일봉 증거로 인정한다."""
    dates = [START, START + timedelta(days=3), START + timedelta(days=7)]
    prices = [Decimal("100"), Decimal("100"), Decimal("50")]
    candles = [
        Candle(
            symbol="X",
            ts=ts,
            open=price,
            high=price,
            low=price,
            close=price,
            volume=1000 if index < 2 else 2000,
        )
        for index, (ts, price) in enumerate(zip(dates, prices))
    ]

    adjusted = back_adjust(candles, [verified(candles, 2, "0.5")])

    assert [c.close for c in adjusted] == [
        Decimal("50"),
        Decimal("50"),
        Decimal("50"),
    ]


def test_back_adjust_normalizes_residual_gap_decimal_overflow():
    before = Candle(
        symbol="X",
        ts=START,
        open=Decimal("1e-999999"),
        high=Decimal("1e-999999"),
        low=Decimal("1e-999999"),
        close=Decimal("1e-999999"),
        volume=1,
    )
    event = Candle(
        symbol="X",
        ts=START + timedelta(days=1),
        open=Decimal("1e999999"),
        high=Decimal("1e999999"),
        low=Decimal("1e999999"),
        close=Decimal("1e999999"),
        volume=1,
    )

    with pytest.raises(ValueError, match="검증 계수 산술.*범위"):
        back_adjust([before, event], [verified([before, event], 1, "0.5")])


def test_back_adjust_rejects_intraday_date_matching():
    """date 매니페스트로 같은 날 여러 intraday 봉의 경계를 추측하지 않는다."""
    candles = series([(100, 1000), (50, 2000), (51, 2100)])
    candles[1] = Candle(
        **{**candles[1].__dict__, "ts": candles[1].ts.replace(hour=14, minute=30)}
    )
    candles[2] = Candle(
        **{**candles[2].__dict__, "ts": candles[2].ts.replace(hour=15, minute=30)}
    )

    with pytest.raises(ValueError, match="UTC 자정 일봉"):
        back_adjust(candles, [verified(candles, 1, "0.5")])


def test_back_adjust_rejects_non_utc_daily_session_dates():
    """KST 자정이 UTC 전일로 바뀌어 한 봉 늦게 조정되는 일을 막는다."""
    kst = timezone(timedelta(hours=9))
    candles = series([(100, 1000), (50, 2000), (50, 2000)])
    candles = [
        Candle(**{**candle.__dict__, "ts": candle.ts.replace(tzinfo=kst)})
        for candle in candles
    ]

    with pytest.raises(ValueError, match="UTC 자정 일봉"):
        back_adjust(candles, [verified(candles, 1, "0.5")])


def test_back_adjust_ignores_unconfirmed_breaks():
    """분사는 조정 계수를 알 수 없다. 틀린 계수로 고치면 원본보다 나빠진다."""
    candles = series(flat(100, 10, 1000) + flat(57, 10, 2000))
    assert back_adjust(candles, []) == candles


def test_back_adjust_never_touches_bad_bars():
    candles = bad_bar_series()
    assert back_adjust(candles, []) == candles


def test_back_adjust_without_breaks_is_a_noop():
    candles = series(flat(100, 20))
    assert back_adjust(candles, []) == candles


def test_multiple_splits_compound():
    """분할이 두 번이면 계수가 곱해져야 한다."""
    candles = series(flat(200, 5, 1000) + flat(100, 5, 2000) + flat(50, 5, 4000))
    adjusted = back_adjust(
        candles,
        [verified(candles, 5, "0.5"), verified(candles, 10, "0.5")],
    )
    assert adjusted[0].close == Decimal("50")
    assert detect(adjusted) == []


def test_price_volume_heuristic_never_authorizes_adjustment():
    """가격·거래량이 완벽히 맞아도 외부 확인 없이는 후보일 뿐이다."""
    candles = split_series()
    assert detect(candles)[0].looks_like_split
    assert back_adjust(candles, []) == candles


def test_verified_split_manifest_requires_a_source(tmp_path):
    manifest = tmp_path / "splits.csv"
    manifest.write_text(
        "symbol,date,ratio,event_type,source\nX,2026-01-15,0.5,split,\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="source"):
        load_verified_splits(manifest)


def test_verified_split_manifest_supports_fraction_ratio(tmp_path):
    manifest = tmp_path / "splits.csv"
    manifest.write_text(
        "symbol,date,ratio,event_type,source\n"
        "X,2026-01-15,1/7,split,issuer-press-release\n",
        encoding="utf-8",
    )

    loaded = load_verified_splits(manifest)

    assert loaded["X"][0].ratio == Decimal(1) / Decimal(7)
    assert loaded["X"][0].event_type == "split"


@pytest.mark.parametrize("ratio", ["1/0", "bad", "1/2/3"])
def test_verified_split_manifest_normalizes_invalid_ratio_errors(tmp_path, ratio):
    manifest = tmp_path / "splits.csv"
    manifest.write_text(
        f"symbol,date,ratio,event_type,source\n"
        f"X,2026-01-15,{ratio},split,issuer\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match=r"splits\.csv:2.*ratio"):
        load_verified_splits(manifest)


@pytest.mark.parametrize(
    ("ratio", "event_type"),
    [("1e-999999999", "split"), ("1e999999999", "reverse_split")],
)
def test_verified_split_manifest_rejects_unbounded_finite_ratio(
    tmp_path, ratio, event_type
):
    manifest = tmp_path / "splits.csv"
    manifest.write_text(
        "symbol,date,ratio,event_type,source\n"
        f"X,2026-01-15,{ratio},{event_type},issuer\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="지원 범위"):
        load_verified_splits(manifest)


def test_verified_split_manifest_normalizes_short_rows(tmp_path):
    manifest = tmp_path / "splits.csv"
    manifest.write_text(
        "symbol,date,ratio,event_type,source\nX,2026-01-15\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match=r"splits\.csv:2"):
        load_verified_splits(manifest)


def test_verified_adjustment_manifest_requires_event_type_column(tmp_path):
    manifest = tmp_path / "splits.csv"
    manifest.write_text(
        "symbol,date,ratio,source\nX,2026-01-15,0.5,issuer\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="event_type"):
        load_verified_splits(manifest)


def test_verified_adjustment_manifest_rejects_duplicate_headers(tmp_path):
    manifest = tmp_path / "splits.csv"
    manifest.write_text(
        "symbol,date,ratio,ratio,event_type,source\n"
        "X,2026-01-15,0.25,0.5,split,issuer\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="중복.*ratio"):
        load_verified_splits(manifest)


def test_verified_adjustment_manifest_rejects_extra_headers(tmp_path):
    manifest = tmp_path / "splits.csv"
    manifest.write_text(
        "symbol,date,ratio,event_type,source,cash_component\n"
        "X,2026-01-15,0.5,split,issuer,12.34\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="추가.*cash_component"):
        load_verified_splits(manifest)


def test_verified_adjustment_manifest_rejects_surplus_row_values(tmp_path):
    manifest = tmp_path / "splits.csv"
    manifest.write_text(
        "symbol,date,ratio,event_type,source\n"
        "X,2026-01-15,0.5,split,issuer,12.34\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match=r"splits\.csv:2.*헤더보다"):
        load_verified_splits(manifest)


def test_verified_adjustment_manifest_rejects_unterminated_quoted_source(tmp_path):
    manifest = tmp_path / "splits.csv"
    manifest.write_text(
        "symbol,date,ratio,event_type,source\n"
        'X,2026-01-15,0.5,split,"issuer\n'
        "Y,2026-01-16,0.5,split,issuer\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="CSV 파싱 실패"):
        load_verified_splits(manifest)


def test_verified_adjustment_manifest_normalizes_oversized_csv_field(tmp_path):
    manifest = tmp_path / "splits.csv"
    manifest.write_text(
        "symbol,date,ratio,event_type,source\n"
        f"X,2026-01-15,0.5,split,{'x' * 140_000}\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="CSV 파싱 실패"):
        load_verified_splits(manifest)


@pytest.mark.parametrize("event_type", ["", "dividend", "reverse_split"])
def test_verified_adjustment_manifest_validates_event_semantics(
    tmp_path, event_type
):
    manifest = tmp_path / "splits.csv"
    manifest.write_text(
        "symbol,date,ratio,event_type,source\n"
        f"X,2026-01-15,0.5,{event_type},issuer\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="event_type|reverse_split"):
        load_verified_splits(manifest)


def test_same_class_stock_dividend_is_recorded_without_calling_it_a_split(tmp_path):
    manifest = tmp_path / "adjustments.csv"
    manifest.write_text(
        "symbol,date,ratio,event_type,source\n"
        "DISCK,2014-08-07,0.5,same_class_stock_dividend,issuer\n",
        encoding="utf-8",
    )

    action = load_verified_splits(manifest)["DISCK"][0]

    assert action.event_type == "same_class_stock_dividend"
