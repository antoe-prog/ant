from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest

from tossquant.backtest.data import CandleCache, CsvSource, load_history
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
        [f"2026-01-{day:02d},1,1,1,{day},1" for day in range(2, 12)],
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


# --- load_history ------------------------------------------------------------


class CountingSource:
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
