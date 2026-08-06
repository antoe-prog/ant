"""과거 캔들 확보.

토스 API는 호출 한도가 빡빡하므로 한 번 받은 캔들은 로컬 SQLite에 캐시해 두고
재사용한다. 파라미터를 바꿔 가며 백테스트를 반복 실행할 때 매번 API를 때리면
곧바로 429를 맞는다.

CSV 소스도 함께 제공한다. 토스 캔들 엔드포인트가 아직 검증되지 않은 상태이므로,
다른 곳에서 받은 데이터로도 바로 백테스트를 돌릴 수 있어야 한다.
"""

from __future__ import annotations

import csv
import logging
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Protocol

from ..models import Candle

log = logging.getLogger(__name__)

CACHE_SCHEMA = """
CREATE TABLE IF NOT EXISTS candles (
    symbol   TEXT NOT NULL,
    interval TEXT NOT NULL,
    ts       TEXT NOT NULL,
    open     TEXT NOT NULL,
    high     TEXT NOT NULL,
    low      TEXT NOT NULL,
    close    TEXT NOT NULL,
    volume   INTEGER NOT NULL,
    PRIMARY KEY (symbol, interval, ts)
);
"""

# CSV 컬럼명 후보 — 어디서 받은 파일이든 웬만하면 읽히게 한다.
COLUMN_ALIASES = {
    "ts": ("timestamp", "date", "datetime", "time", "일자"),
    "open": ("open", "o", "시가"),
    "high": ("high", "h", "고가"),
    "low": ("low", "l", "저가"),
    "close": ("close", "adj close", "adj_close", "c", "종가"),
    "volume": ("volume", "vol", "v", "거래량"),
}


class HistorySource(Protocol):
    def fetch(self, symbol: str, interval: str, count: int) -> list[Candle]: ...


def _parse_ts(raw: str) -> datetime:
    text = raw.strip().replace("Z", "+00:00")
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


class CsvSource:
    """`<dir>/<SYMBOL>.csv` 를 읽는다. 헤더 컬럼명은 유연하게 매칭한다."""

    def __init__(self, directory: Path | str) -> None:
        self.directory = Path(directory)

    def fetch(self, symbol: str, interval: str, count: int) -> list[Candle]:
        path = self.directory / f"{symbol}.csv"
        if not path.exists():
            raise FileNotFoundError(f"{path} 가 없습니다")

        with path.open(newline="", encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))
        if not rows:
            return []

        mapping = self._map_columns(rows[0].keys(), path)
        candles = [
            Candle(
                symbol=symbol,
                ts=_parse_ts(row[mapping["ts"]]),
                open=Decimal(row[mapping["open"]]),
                high=Decimal(row[mapping["high"]]),
                low=Decimal(row[mapping["low"]]),
                close=Decimal(row[mapping["close"]]),
                volume=int(float(row[mapping["volume"]] or 0)),
            )
            for row in rows
            if row.get(mapping["close"])
        ]
        candles.sort(key=lambda c: c.ts)
        return candles[-count:] if count else candles

    @staticmethod
    def _map_columns(headers, path: Path) -> dict[str, str]:
        lowered = {h.lower().strip(): h for h in headers}
        mapping: dict[str, str] = {}
        for field, aliases in COLUMN_ALIASES.items():
            for alias in aliases:
                if alias in lowered:
                    mapping[field] = lowered[alias]
                    break
            else:
                raise ValueError(
                    f"{path}: '{field}' 컬럼을 찾지 못했습니다 "
                    f"(후보: {', '.join(aliases)}) — 실제 헤더: {list(headers)}"
                )
        return mapping


class TossSource:
    """토스 Open API에서 캔들을 받는다."""

    def __init__(self, client) -> None:
        self.client = client

    def fetch(self, symbol: str, interval: str, count: int) -> list[Candle]:
        return self.client.get_candles(symbol, interval, count)


class CandleCache:
    def __init__(self, path: Path | str = Path("candles.db")) -> None:
        self._conn = sqlite3.connect(str(path))
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(CACHE_SCHEMA)
        self._conn.commit()

    def load(self, symbol: str, interval: str) -> list[Candle]:
        rows = self._conn.execute(
            "SELECT * FROM candles WHERE symbol = ? AND interval = ? ORDER BY ts",
            (symbol, interval),
        ).fetchall()
        return [
            Candle(
                symbol=symbol,
                ts=datetime.fromisoformat(row["ts"]),
                open=Decimal(row["open"]),
                high=Decimal(row["high"]),
                low=Decimal(row["low"]),
                close=Decimal(row["close"]),
                volume=row["volume"],
            )
            for row in rows
        ]

    def save(self, interval: str, candles: list[Candle]) -> int:
        self._conn.executemany(
            "INSERT INTO candles (symbol, interval, ts, open, high, low, close, volume) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(symbol, interval, ts) DO UPDATE SET "
            "open=excluded.open, high=excluded.high, low=excluded.low, "
            "close=excluded.close, volume=excluded.volume",
            [
                (
                    c.symbol, interval, c.ts.isoformat(),
                    str(c.open), str(c.high), str(c.low), str(c.close), c.volume,
                )
                for c in candles
            ],
        )
        self._conn.commit()
        return len(candles)

    def close(self) -> None:
        self._conn.close()


def load_history(
    symbols: list[str],
    interval: str,
    source: HistorySource,
    *,
    count: int = 500,
    start: datetime | None = None,
    end: datetime | None = None,
    cache: CandleCache | None = None,
    refresh: bool = False,
) -> dict[str, list[Candle]]:
    """캐시를 우선 보고, 없거나 refresh면 소스에서 받아 캐시에 넣는다."""
    history: dict[str, list[Candle]] = {}

    for symbol in symbols:
        candles: list[Candle] = []
        if cache is not None and not refresh:
            candles = cache.load(symbol, interval)
            if candles:
                log.info("%s: 캐시에서 %d개 봉 로드", symbol, len(candles))

        if not candles:
            candles = source.fetch(symbol, interval, count)
            log.info("%s: 소스에서 %d개 봉 수신", symbol, len(candles))
            if cache is not None and candles:
                cache.save(interval, candles)

        if start is not None:
            candles = [c for c in candles if c.ts >= start]
        if end is not None:
            candles = [c for c in candles if c.ts <= end]

        if not candles:
            raise ValueError(f"{symbol}: 지정한 기간에 해당하는 캔들이 없습니다")
        history[symbol] = candles

    return history
