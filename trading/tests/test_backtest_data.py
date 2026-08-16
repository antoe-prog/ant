from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from tossquant.backtest.corporate import VerifiedSplit
from tossquant.backtest.data import CandleCache, CsvSource, HistoryBatch, load_history
from tossquant.models import Candle


def write_csv(path, header: str, rows: list[str]) -> None:
    path.write_text("\n".join([header, *rows]) + "\n", encoding="utf-8")


def test_csv_source_reads_standard_columns(tmp_path):
    write_csv(
        tmp_path / "AAPL.csv",
        "date,open,high,low,close,volume",
        ["2026-01-02,100,105,99,104,1000", "2026-01-03,104,110,103,109,2000"],
    )

    candles = CsvSource(tmp_path).fetch("AAPL", "1d", 10)

    assert len(candles) == 2
    assert candles[0].close == Decimal("104")
    assert candles[1].volume == 2000
    assert candles[0].ts.tzinfo is not None


def test_csv_source_accepts_alias_columns(tmp_path):
    write_csv(
        tmp_path / "MSFT.csv",
        "Timestamp,O,H,L,Adj Close,Vol",
        ["2026-01-02,10,11,9,10.5,50"],
    )

    candles = CsvSource(tmp_path).fetch("MSFT", "1d", 10)

    assert candles[0].close == Decimal("10.5")


def test_csv_source_sorts_by_timestamp(tmp_path):
    write_csv(
        tmp_path / "A.csv",
        "date,open,high,low,close,volume",
        ["2026-01-05,3,3,3,3,1", "2026-01-02,1,1,1,1,1", "2026-01-03,2,2,2,2,1"],
    )

    candles = CsvSource(tmp_path).fetch("A", "1d", 10)

    assert [c.close for c in candles] == [Decimal("1"), Decimal("2"), Decimal("3")]


def test_csv_source_honours_count(tmp_path):
    write_csv(
        tmp_path / "A.csv",
        "date,open,high,low,close,volume",
        [f"2026-01-{day:02d},{day},{day},{day},{day},1" for day in range(2, 12)],
    )

    candles = CsvSource(tmp_path).fetch("A", "1d", 3)

    assert [c.close for c in candles] == [Decimal("9"), Decimal("10"), Decimal("11")]


def test_csv_source_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        CsvSource(tmp_path).fetch("NOPE", "1d", 10)


def test_csv_source_reports_missing_column(tmp_path):
    write_csv(tmp_path / "A.csv", "date,open,high,low,volume", ["2026-01-02,1,1,1,1"])

    with pytest.raises(ValueError, match="close"):
        CsvSource(tmp_path).fetch("A", "1d", 10)


def test_csv_source_reports_invalid_numeric_row_with_location(tmp_path):
    write_csv(
        tmp_path / "A.csv",
        "date,open,high,low,close,volume",
        ["2026-01-02,not-a-number,11,9,10,1000"],
    )

    with pytest.raises(ValueError, match=r"A\.csv:2.*open"):
        CsvSource(tmp_path).fetch("A", "1d", 10)


def test_csv_source_rejects_partially_missing_ohlc_row(tmp_path):
    write_csv(
        tmp_path / "A.csv",
        "date,open,high,low,close,volume",
        ["2026-01-02,,,,10,3"],
    )

    with pytest.raises(ValueError, match=r"A\.csv:2.*open"):
        CsvSource(tmp_path).fetch("A", "1d", 10)


def test_csv_source_rejects_rows_with_more_values_than_headers(tmp_path):
    write_csv(
        tmp_path / "A.csv",
        "date,open,high,low,close,volume",
        ["2026-01-02,10,11,9,10,1000,999999"],
    )

    with pytest.raises(ValueError, match=r"A\.csv:2.*헤더보다.*값"):
        CsvSource(tmp_path).fetch("A", "1d", 10)


def test_csv_source_rejects_unterminated_quote_that_swallows_later_rows(tmp_path):
    write_csv(
        tmp_path / "A.csv",
        "date,open,high,low,close,volume,note",
        [
            '2026-01-02,10,10,10,10,1,"unterminated',
            "2026-01-03,11,11,11,11,2,ok",
        ],
    )

    with pytest.raises(ValueError, match=r"A\.csv.*CSV 파싱 실패"):
        CsvSource(tmp_path).fetch("A", "1d", 0)


@pytest.mark.parametrize(
    "row",
    [
        "2026-01-02,0,1,0,0.5,3",
        "2026-01-02,-1,1,-2,0.5,3",
        "2026-01-02,10,9,8,10,3",
        "2026-01-02,10,11,10.5,10,3",
    ],
)
def test_csv_source_rejects_nonpositive_or_impossible_ohlc(tmp_path, row):
    write_csv(tmp_path / "A.csv", "date,open,high,low,close,volume", [row])

    with pytest.raises(ValueError, match=r"A\.csv:2.*OHLC"):
        CsvSource(tmp_path).fetch("A", "1d", 10)


def test_csv_source_rejects_duplicate_timestamps(tmp_path):
    write_csv(
        tmp_path / "A.csv",
        "date,open,high,low,close,volume",
        [
            "2026-01-02,1,1,1,1,3",
            "2026-01-02,2,2,2,2,4",
        ],
    )

    with pytest.raises(ValueError, match=r"A\.csv:3.*중복 timestamp"):
        CsvSource(tmp_path).fetch("A", "1d", 10)


def test_csv_source_rejects_negative_count(tmp_path):
    write_csv(
        tmp_path / "A.csv",
        "date,open,high,low,close,volume",
        ["2026-01-02,1,1,1,1,3"],
    )

    with pytest.raises(ValueError, match="count"):
        CsvSource(tmp_path).fetch("A", "1d", -1)


def test_csv_source_rejects_symbol_path_traversal(tmp_path):
    write_csv(
        tmp_path / "SECRET.csv",
        "date,open,high,low,close,volume",
        ["2026-01-02,1,1,1,1,3"],
    )
    data = tmp_path / "data"
    data.mkdir()

    with pytest.raises(ValueError, match="symbol"):
        CsvSource(data).fetch("../SECRET", "1d", 0)


def test_csv_source_rejects_symlink_that_escapes_data_directory(tmp_path):
    write_csv(
        tmp_path / "SECRET.csv",
        "date,open,high,low,close,volume",
        ["2026-01-02,1,1,1,1,3"],
    )
    data = tmp_path / "data"
    data.mkdir()
    (data / "LINK.csv").symlink_to(tmp_path / "SECRET.csv")

    with pytest.raises(ValueError, match="CSV 폴더 밖"):
        CsvSource(data).fetch("LINK", "1d", 0)


# --- 캐시 --------------------------------------------------------------------


def sample(symbol: str, day: int, close: str) -> Candle:
    return Candle(
        symbol=symbol,
        ts=datetime(2026, 1, day, tzinfo=timezone.utc),
        open=Decimal(close),
        high=Decimal(close),
        low=Decimal(close),
        close=Decimal(close),
        volume=1,
    )


def test_cache_round_trip(tmp_path):
    cache = CandleCache(tmp_path / "c.db")
    cache.save("1d", [sample("A", 2, "10"), sample("A", 3, "11")])

    loaded = cache.load("A", "1d")
    cache.close()

    assert [c.close for c in loaded] == [Decimal("10"), Decimal("11")]


def test_cache_upserts_same_timestamp(tmp_path):
    cache = CandleCache(tmp_path / "c.db")
    cache.save("1d", [sample("A", 2, "10")])
    cache.save("1d", [sample("A", 2, "99")])

    loaded = cache.load("A", "1d")
    cache.close()

    assert len(loaded) == 1
    assert loaded[0].close == Decimal("99")


def test_cache_separates_intervals(tmp_path):
    cache = CandleCache(tmp_path / "c.db")
    cache.save("1d", [sample("A", 2, "10")])
    cache.save("1h", [sample("A", 2, "20")])

    assert cache.load("A", "1d")[0].close == Decimal("10")
    assert cache.load("A", "1h")[0].close == Decimal("20")
    cache.close()


def test_cache_load_honours_count_and_keeps_chronological_order(tmp_path):
    cache = CandleCache(tmp_path / "c.db")
    cache.save("1d", [sample("A", day, str(day)) for day in range(2, 7)])

    loaded = cache.load("A", "1d", count=2)
    cache.close()

    assert [c.close for c in loaded] == [Decimal("5"), Decimal("6")]


@pytest.mark.parametrize("offset_equivalent", [False, True])
def test_replace_snapshot_rejects_duplicate_instants_and_preserves_old_snapshot(
    tmp_path, offset_equivalent
):
    cache = CandleCache(tmp_path / "c.db")
    cache.replace_snapshot("A", "1d", [sample("A", 1, "9")], complete=True)
    first = sample("A", 2, "10")
    second_ts = (
        first.ts.astimezone(timezone(timedelta(hours=9)))
        if offset_equivalent
        else first.ts
    )
    second = Candle(
        symbol="A",
        ts=second_ts,
        open=Decimal("20"),
        high=Decimal("20"),
        low=Decimal("20"),
        close=Decimal("20"),
        volume=2,
    )

    with pytest.raises(ValueError, match="중복 timestamp"):
        cache.replace_snapshot("A", "1d", [first, second], complete=True)

    assert [c.close for c in cache.load("A", "1d")] == [Decimal("9")]
    metadata = cache._conn.execute(
        "SELECT row_count, complete FROM candle_snapshots "
        "WHERE symbol = ? AND interval = ?",
        ("A", "1d"),
    ).fetchone()
    assert (metadata["row_count"], metadata["complete"]) == (1, 1)
    cache.close()


def test_replace_snapshot_requires_actual_bool_complete_and_preserves_old_snapshot(
    tmp_path,
):
    cache = CandleCache(tmp_path / "c.db")
    cache.replace_snapshot("A", "1d", [sample("A", 1, "9")], complete=True)

    with pytest.raises(TypeError, match="complete"):
        cache.replace_snapshot("A", "1d", [sample("A", 2, "10")], complete=1)

    assert [c.close for c in cache.load("A", "1d")] == [Decimal("9")]
    cache.close()


# --- load_history ------------------------------------------------------------


class CountingSource:
    def __init__(self, candles: list[Candle], *, complete: bool = True) -> None:
        self.candles = candles
        self.complete = complete
        self.calls = 0

    def fetch(self, symbol: str, interval: str, count: int) -> list[Candle]:
        self.calls += 1
        return self.candles

    def fetch_batch(self, symbol: str, interval: str, count: int) -> HistoryBatch:
        return HistoryBatch(self.fetch(symbol, interval, count), complete=self.complete)


class FetchOnlySource:
    def __init__(self, candles: list[Candle]) -> None:
        self.candles = candles
        self.calls = 0

    def fetch(self, symbol: str, interval: str, count: int) -> list[Candle]:
        self.calls += 1
        return self.candles


def test_load_history_populates_and_reuses_cache(tmp_path):
    source = CountingSource([sample("A", 2, "10"), sample("A", 3, "11")])
    cache = CandleCache(tmp_path / "c.db")

    load_history(["A"], "1d", source, cache=cache)
    load_history(["A"], "1d", source, cache=cache)

    assert source.calls == 1  # 두 번째는 캐시에서
    cache.close()


def test_load_history_refresh_bypasses_cache(tmp_path):
    source = CountingSource([sample("A", 2, "10"), sample("A", 3, "11")])
    cache = CandleCache(tmp_path / "c.db")

    load_history(["A"], "1d", source, cache=cache)
    load_history(["A"], "1d", source, cache=cache, refresh=True)

    assert source.calls == 2
    cache.close()


def test_load_history_refetches_when_cached_sample_is_too_small(tmp_path):
    source = CountingSource(
        [sample("A", 2, "2"), sample("A", 3, "3")], complete=False
    )
    cache = CandleCache(tmp_path / "c.db")

    first = load_history(["A"], "1d", source, cache=cache, count=2)
    source.candles = [sample("A", day, str(day)) for day in range(2, 7)]
    source.complete = True
    second = load_history(["A"], "1d", source, cache=cache, count=5)

    assert len(first["A"]) == 2
    assert [c.close for c in second["A"]] == [
        Decimal("2"), Decimal("3"), Decimal("4"), Decimal("5"), Decimal("6")
    ]
    assert source.calls == 2
    cache.close()


def test_load_history_serves_only_latest_requested_rows_from_larger_cache(tmp_path):
    source = CountingSource([sample("A", day, str(day)) for day in range(2, 7)])
    cache = CandleCache(tmp_path / "c.db")

    load_history(["A"], "1d", source, cache=cache, count=5)
    history = load_history(["A"], "1d", source, cache=cache, count=2)

    assert [c.close for c in history["A"]] == [Decimal("5"), Decimal("6")]
    assert source.calls == 1
    cache.close()


def test_refresh_replaces_snapshot_instead_of_leaving_stale_rows(tmp_path):
    source = CountingSource([sample("A", day, str(day)) for day in range(2, 7)])
    cache = CandleCache(tmp_path / "c.db")

    load_history(["A"], "1d", source, cache=cache, count=5)
    source.candles = [sample("A", 5, "50"), sample("A", 6, "60")]
    refreshed = load_history(
        ["A"], "1d", source, cache=cache, count=2, refresh=True
    )

    assert [c.close for c in refreshed["A"]] == [Decimal("50"), Decimal("60")]
    assert [c.close for c in cache.load("A", "1d")] == [
        Decimal("50"), Decimal("60")
    ]
    cache.close()


def test_complete_all_rows_fetch_can_be_reused_without_guessing(tmp_path):
    source = CountingSource([sample("A", day, str(day)) for day in range(2, 7)])
    cache = CandleCache(tmp_path / "c.db")

    load_history(["A"], "1d", source, cache=cache, count=0)
    history = load_history(["A"], "1d", source, cache=cache, count=0)

    assert len(history["A"]) == 5
    assert source.calls == 1
    cache.close()


def test_short_incomplete_refresh_does_not_replace_usable_snapshot(tmp_path):
    source = CountingSource([sample("A", day, str(day)) for day in range(2, 7)])
    cache = CandleCache(tmp_path / "c.db")
    load_history(["A"], "1d", source, cache=cache, count=5)

    source.candles = [sample("A", 5, "50"), sample("A", 6, "60")]
    source.complete = False
    with pytest.raises(ValueError, match="refresh.*기존 캐시는 보존"):
        load_history(["A"], "1d", source, cache=cache, count=5, refresh=True)

    assert len(cache.load("A", "1d")) == 5
    assert source.calls == 2
    cache.close()


def test_incomplete_short_response_without_fallback_fails_instead_of_truncating():
    source = CountingSource(
        [sample("A", 2, "2"), sample("A", 3, "3")], complete=False
    )

    with pytest.raises(ValueError, match="완전성"):
        load_history(["A"], "1d", source, count=5)


@pytest.mark.parametrize(
    ("start", "end", "missing_boundary"),
    [
        (
            datetime(2026, 1, 2, tzinfo=timezone.utc),
            datetime(2026, 1, 8, tzinfo=timezone.utc),
            "start",
        ),
        (
            datetime(2026, 1, 6, tzinfo=timezone.utc),
            datetime(2026, 1, 12, tzinfo=timezone.utc),
            "end",
        ),
    ],
)
def test_incomplete_batch_must_cover_explicit_date_boundaries(
    start, end, missing_boundary
):
    source = CountingSource(
        [sample("A", day, str(day)) for day in range(5, 10)],
        complete=False,
    )

    with pytest.raises(ValueError, match=rf"{missing_boundary}.*완전성"):
        load_history(
            ["A"],
            "1d",
            source,
            count=5,
            start=start,
            end=end,
        )


def test_incomplete_batch_can_serve_a_range_when_it_brackets_both_boundaries():
    source = CountingSource(
        [sample("A", day, str(day)) for day in range(2, 11)],
        complete=False,
    )

    history = load_history(
        ["A"],
        "1d",
        source,
        count=9,
        start=datetime(2026, 1, 3, tzinfo=timezone.utc),
        end=datetime(2026, 1, 9, tzinfo=timezone.utc),
    )

    assert [c.ts.day for c in history["A"]] == list(range(3, 10))


def test_incomplete_cached_tail_that_misses_range_boundary_is_refetched(tmp_path):
    source = CountingSource(
        [sample("A", day, str(day)) for day in range(5, 10)],
        complete=False,
    )
    cache = CandleCache(tmp_path / "c.db")
    load_history(["A"], "1d", source, count=5, cache=cache)

    source.candles = [sample("A", day, str(day)) for day in range(2, 7)]
    source.complete = True
    history = load_history(
        ["A"],
        "1d",
        source,
        count=5,
        start=datetime(2026, 1, 2, tzinfo=timezone.utc),
        end=datetime(2026, 1, 5, tzinfo=timezone.utc),
        cache=cache,
    )

    assert [c.ts.day for c in history["A"]] == [2, 3, 4, 5]
    assert source.calls == 2
    cache.close()


def test_cache_coverage_and_rows_are_read_from_one_snapshot(tmp_path, monkeypatch):
    path = tmp_path / "c.db"
    cache = CandleCache(path)
    writer = CandleCache(path)
    cache._conn.execute("PRAGMA journal_mode=WAL")
    writer._conn.execute("PRAGMA journal_mode=WAL")
    cache.replace_snapshot(
        "A",
        "1d",
        [sample("A", day, str(day)) for day in range(2, 7)],
        complete=True,
    )

    original_load = cache.load
    swapped = False

    def replace_between_metadata_and_rows(*args, **kwargs):
        nonlocal swapped
        if not swapped:
            writer.replace_snapshot(
                "A",
                "1d",
                [sample("A", day, str(day)) for day in range(5, 10)],
                complete=False,
            )
            swapped = True
        return original_load(*args, **kwargs)

    monkeypatch.setattr(cache, "load", replace_between_metadata_and_rows)
    source = CountingSource([], complete=False)

    history = load_history(
        ["A"],
        "1d",
        source,
        count=5,
        start=datetime(2026, 1, 2, tzinfo=timezone.utc),
        end=datetime(2026, 1, 8, tzinfo=timezone.utc),
        cache=cache,
    )

    assert [c.ts.day for c in history["A"]] == [2, 3, 4, 5, 6]
    assert source.calls == 0
    cache.close()
    writer.close()


def test_cache_refetches_when_complete_snapshot_loses_a_row(tmp_path):
    source = CountingSource([sample("A", day, "10") for day in range(2, 7)])
    cache = CandleCache(tmp_path / "c.db")
    load_history(["A"], "1d", source, count=5, cache=cache, on_break="ignore")

    with cache._conn:
        cache._conn.execute(
            "DELETE FROM candles WHERE symbol = ? AND interval = ? AND ts = ?",
            ("A", "1d", sample("A", 2, "10").ts.isoformat()),
        )
    source.candles = [sample("A", day, "20") for day in range(2, 7)]

    history = load_history(
        ["A"],
        "1d",
        source,
        count=5,
        start=sample("A", 2, "10").ts,
        end=sample("A", 6, "10").ts,
        cache=cache,
        on_break="ignore",
    )

    assert source.calls == 2
    assert [c.ts.day for c in history["A"]] == list(range(2, 7))
    assert all(c.close == Decimal("20") for c in history["A"])
    cache.close()


def test_cache_refetches_when_complete_metadata_is_not_boolean(tmp_path):
    source = CountingSource([sample("A", day, "10") for day in range(2, 7)])
    cache = CandleCache(tmp_path / "c.db")
    load_history(["A"], "1d", source, count=5, cache=cache, on_break="ignore")

    with cache._conn:
        cache._conn.execute(
            "UPDATE candle_snapshots SET complete = 2 "
            "WHERE symbol = ? AND interval = ?",
            ("A", "1d"),
        )
    source.candles = [sample("A", day, "20") for day in range(2, 7)]

    history = load_history(
        ["A"], "1d", source, count=5, cache=cache, on_break="ignore"
    )

    assert source.calls == 2
    assert all(c.close == Decimal("20") for c in history["A"])
    cache.close()


def test_generic_source_duplicate_timestamps_cannot_overstate_cache_coverage(tmp_path):
    duplicate = sample("A", 2, "10")
    source = CountingSource([duplicate] * 5)
    cache = CandleCache(tmp_path / "c.db")

    with pytest.raises(ValueError, match="중복 timestamp"):
        load_history(["A"], "1d", source, cache=cache, count=5)

    assert cache.load("A", "1d") == []
    assert not cache.can_satisfy("A", "1d", 5)
    cache.close()


def test_cache_orders_mixed_timezone_offsets_by_instant(tmp_path):
    earlier = Candle(
        symbol="A",
        ts=datetime(2026, 1, 2, 0, 30, tzinfo=timezone.utc),
        open=Decimal("10"), high=Decimal("10"), low=Decimal("10"),
        close=Decimal("10"), volume=1,
    )
    later = Candle(
        symbol="A",
        ts=datetime(2026, 1, 1, 23, 30, tzinfo=timezone(-timedelta(hours=2))),
        open=Decimal("20"), high=Decimal("20"), low=Decimal("20"),
        close=Decimal("20"), volume=1,
    )
    cache = CandleCache(tmp_path / "c.db")
    cache.save("1d", [later, earlier])

    loaded = cache.load("A", "1d", count=1)

    assert loaded[0].close == Decimal("20")
    assert loaded[0].ts == datetime(2026, 1, 2, 1, 30, tzinfo=timezone.utc)
    cache.close()


@pytest.mark.parametrize("value", ["false", 0, 1, None])
def test_history_batch_complete_requires_an_actual_bool(value):
    with pytest.raises(TypeError, match="complete"):
        HistoryBatch([], complete=value)


def test_fetch_only_source_cannot_claim_count_zero_is_complete():
    source = FetchOnlySource([sample("A", 2, "10")])

    with pytest.raises(ValueError, match="완전성"):
        load_history(["A"], "1d", source, count=0)


def test_source_symbol_case_is_canonicalized_to_requested_symbol(tmp_path):
    lower = sample("a", 2, "10")
    source = CountingSource([lower])
    cache = CandleCache(tmp_path / "c.db")

    history = load_history(["A"], "1d", source, count=1, cache=cache)

    assert history["A"][0].symbol == "A"
    assert cache.load("A", "1d")[0].symbol == "A"
    cache.close()


def test_legacy_cache_without_snapshot_metadata_can_satisfy_finite_count(tmp_path):
    cache = CandleCache(tmp_path / "c.db")
    cache.save("1d", [sample("A", 2, "10"), sample("A", 3, "11")])
    source = FetchOnlySource([])

    history = load_history(["A"], "1d", source, count=2, cache=cache)

    assert [c.close for c in history["A"]] == [Decimal("10"), Decimal("11")]
    assert source.calls == 0
    cache.close()


def test_empty_complete_refresh_preserves_last_usable_snapshot(tmp_path):
    source = CountingSource([sample("A", 2, "10"), sample("A", 3, "11")])
    cache = CandleCache(tmp_path / "c.db")
    load_history(["A"], "1d", source, count=0, cache=cache)

    source.candles = []
    with pytest.raises(ValueError, match="refresh.*기존 캐시는 보존"):
        load_history(["A"], "1d", source, count=0, cache=cache, refresh=True)

    assert len(cache.load("A", "1d")) == 2
    assert cache.can_satisfy("A", "1d", 0)
    cache.close()


def test_refresh_outside_requested_window_preserves_last_usable_snapshot(tmp_path):
    source = CountingSource([sample("A", 2, "10"), sample("A", 3, "11")])
    cache = CandleCache(tmp_path / "c.db")
    load_history(["A"], "1d", source, count=2, cache=cache)
    source.candles = [sample("A", 10, "20"), sample("A", 11, "21")]

    with pytest.raises(ValueError, match="기간.*기존 캐시는 보존"):
        load_history(
            ["A"],
            "1d",
            source,
            count=2,
            start=datetime(2026, 1, 2, tzinfo=timezone.utc),
            end=datetime(2026, 1, 3, tzinfo=timezone.utc),
            cache=cache,
            refresh=True,
        )

    assert [c.close for c in cache.load("A", "1d")] == [
        Decimal("10"), Decimal("11")
    ]
    cache.close()


def test_legacy_cache_invalid_or_duplicate_instants_are_refetched(tmp_path):
    cache = CandleCache(tmp_path / "c.db")
    with cache._conn:  # 실제 f0 스키마에는 메타데이터 없이 이 행들만 있었다.
        cache._conn.executemany(
            "INSERT INTO candles "
            "(symbol, interval, ts, open, high, low, close, volume) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("A", "1d", "2026-01-02T00:00:00+00:00", "NaN", "1", "1", "1", 1),
                ("A", "1d", "2026-01-01T19:00:00-05:00", "-1", "1", "-1", "1", -5),
            ],
        )
    source = CountingSource([sample("A", 2, "10"), sample("A", 3, "11")])

    history = load_history(["A"], "1d", source, count=2, cache=cache)

    assert source.calls == 1
    assert [c.close for c in history["A"]] == [Decimal("10"), Decimal("11")]
    assert len(cache.load("A", "1d")) == 2
    cache.close()


def test_legacy_cache_valid_rows_with_duplicate_utc_instant_are_refetched(tmp_path):
    cache = CandleCache(tmp_path / "c.db")
    with cache._conn:
        cache._conn.executemany(
            "INSERT INTO candles "
            "(symbol, interval, ts, open, high, low, close, volume) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("A", "1d", "2026-01-02T00:00:00+00:00", "1", "1", "1", "1", 1),
                ("A", "1d", "2026-01-01T19:00:00-05:00", "1", "1", "1", "1", 1),
            ],
        )
    source = CountingSource([sample("A", 2, "10"), sample("A", 3, "11")])

    history = load_history(["A"], "1d", source, count=2, cache=cache)

    assert source.calls == 1
    assert [c.close for c in history["A"]] == [Decimal("10"), Decimal("11")]
    cache.close()


def test_generic_source_rejects_non_decimal_prices_as_value_error():
    candle = Candle(
        symbol="A", ts=datetime(2026, 1, 2, tzinfo=timezone.utc),
        open=1, high=1, low=1, close=1, volume=1,
    )

    with pytest.raises(ValueError, match="Decimal"):
        load_history(["A"], "1d", CountingSource([candle]), count=1)


def test_generic_source_rejects_volume_outside_sqlite_integer_range(tmp_path):
    candle = sample("A", 2, "10")
    candle = Candle(
        symbol=candle.symbol, ts=candle.ts, open=candle.open, high=candle.high,
        low=candle.low, close=candle.close, volume=2**63,
    )
    cache = CandleCache(tmp_path / "c.db")

    with pytest.raises(ValueError, match="SQLite"):
        load_history(["A"], "1d", CountingSource([candle]), count=1, cache=cache)

    assert cache.load("A", "1d") == []
    cache.close()


def test_naive_date_range_is_interpreted_as_utc_instead_of_type_error():
    source = CountingSource([sample("A", 2, "10"), sample("A", 3, "11")])

    history = load_history(
        ["A"],
        "1d",
        source,
        count=0,
        start=datetime(2026, 1, 3),
    )

    assert [c.close for c in history["A"]] == [Decimal("11")]


def test_date_range_rejects_start_after_end():
    with pytest.raises(ValueError, match="start.*end"):
        load_history(
            ["A"],
            "1d",
            CountingSource([sample("A", 2, "10")]),
            start=datetime(2026, 1, 3),
            end=datetime(2026, 1, 2),
        )


def test_load_history_filters_by_date_range():
    source = CountingSource(
        [sample("A", day, str(day)) for day in range(2, 10)]
    )

    history = load_history(
        ["A"],
        "1d",
        source,
        start=datetime(2026, 1, 4, tzinfo=timezone.utc),
        end=datetime(2026, 1, 6, tzinfo=timezone.utc),
    )

    assert [c.close for c in history["A"]] == [Decimal("4"), Decimal("5"), Decimal("6")]


def test_load_history_raises_when_range_is_empty():
    source = CountingSource([sample("A", 2, "10")])

    with pytest.raises(ValueError, match="캔들이 없습니다"):
        load_history(
            ["A"], "1d", source, start=datetime(2027, 1, 1, tzinfo=timezone.utc)
        )


def test_adjust_does_not_infer_split_from_truncated_tail():
    """전체로는 왕복 오류인 마지막 저가 봉을 기간 끝에서 분할로 만들면 안 된다."""
    candles = [sample("A", day, "100") for day in range(2, 12)]
    low = sample("A", 12, "50")
    low = Candle(
        symbol=low.symbol,
        ts=low.ts,
        open=low.open,
        high=low.high,
        low=low.low,
        close=low.close,
        volume=2,
    )
    candles.extend([low, sample("A", 13, "100")])

    history = load_history(
        ["A"],
        "1d",
        CountingSource(candles),
        end=low.ts,
        on_break="adjust",
        verified_splits={},
    )

    assert history["A"][0].close == Decimal("100")


def test_adjust_requires_explicit_verified_split_input():
    source = CountingSource([sample("A", 2, "100"), sample("A", 3, "50")])

    with pytest.raises(ValueError, match="verified_splits"):
        load_history(["A"], "1d", source, on_break="adjust")


def test_adjust_rejects_non_daily_interval_before_fetching():
    candles = [sample("A", 2, "100"), sample("A", 9, "50")]
    source = CountingSource(candles)
    split = VerifiedSplit(
        symbol="A",
        effective_date=candles[1].ts.date(),
        ratio=Decimal("0.5"),
        source="issuer-action",
    )

    with pytest.raises(ValueError, match=r"interval.*1d"):
        load_history(
            ["A"],
            "1wk",
            source,
            count=0,
            on_break="adjust",
            verified_splits={"A": [split]},
        )

    assert source.calls == 0


def test_adjust_rejects_weekly_spaced_rows_even_when_interval_claims_daily():
    start = datetime(2026, 1, 2, tzinfo=timezone.utc)
    candles = []
    for index, price in enumerate(("100", "50", "50", "50")):
        value = Decimal(price)
        candles.append(
            Candle(
                symbol="A",
                ts=start + timedelta(days=index * 7),
                open=value,
                high=value,
                low=value,
                close=value,
                volume=1000 if index == 0 else 2000,
            )
        )
    split = VerifiedSplit(
        symbol="A",
        effective_date=candles[1].ts.date(),
        ratio=Decimal("0.5"),
        source="issuer-action",
    )

    with pytest.raises(ValueError, match="일봉 주기"):
        load_history(
            ["A"],
            "1d",
            CountingSource(candles),
            count=0,
            on_break="adjust",
            verified_splits={"A": [split]},
        )


def test_load_history_adjusts_only_manifest_verified_split():
    candles = [sample("A", day, "100") for day in range(2, 7)]
    post = [sample("A", day, "50") for day in range(7, 12)]
    candles.extend(post)
    split = VerifiedSplit(
        symbol="A",
        effective_date=post[0].ts.date(),
        ratio=Decimal("0.5"),
        source="issuer-action",
    )

    history = load_history(
        ["A"],
        "1d",
        CountingSource(candles),
        on_break="adjust",
        verified_splits={"A": [split]},
    )

    assert history["A"][0].close == Decimal("50")
    assert history["A"][-1].close == Decimal("50")


def test_warn_policy_never_applies_or_hides_break_even_with_verified_split(caplog):
    candles = [sample("A", day, "100") for day in range(2, 7)]
    post = [sample("A", day, "50") for day in range(7, 12)]
    candles.extend(post)
    split = VerifiedSplit(
        symbol="A",
        effective_date=post[0].ts.date(),
        ratio=Decimal("0.5"),
        source="issuer-action",
    )

    with caplog.at_level("WARNING", logger="tossquant.backtest.data"):
        history = load_history(
            ["A"],
            "1d",
            CountingSource(candles),
            on_break="warn",
            verified_splits={"A": [split]},
        )

    assert history["A"][0].close == Decimal("100")
    assert "A 원인 불명 불연속" in caplog.text
