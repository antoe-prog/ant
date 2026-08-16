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
import re
import sqlite3
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from decimal import Decimal, DecimalException
from pathlib import Path
from typing import Mapping, Protocol

from ..models import Candle
from .corporate import VerifiedSplit, back_adjust, detect

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
CREATE TABLE IF NOT EXISTS candle_snapshots (
    symbol     TEXT NOT NULL,
    interval   TEXT NOT NULL,
    row_count  INTEGER NOT NULL,
    complete   INTEGER NOT NULL,
    PRIMARY KEY (symbol, interval)
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
SAFE_SYMBOL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\Z")
SQLITE_INTEGER_MAX = 2**63 - 1


@dataclass(frozen=True)
class HistoryBatch:
    """소스 응답과 '이것이 전체 이력인가'라는 별도 증거.

    행 수가 요청 수보다 작다는 사실만으로 전체 이력이라고 추측하지 않는다.
    API의 일시적인 짧은 응답도 똑같이 보이기 때문이다.
    """

    candles: list[Candle]
    complete: bool = False

    def __post_init__(self) -> None:
        if type(self.complete) is not bool:
            raise TypeError("HistoryBatch.complete는 bool이어야 합니다")


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
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _utc(ts: datetime) -> datetime:
    if not isinstance(ts, datetime):
        raise ValueError("timestamp는 datetime이어야 합니다")
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def _validate_ohlcv(prices: dict[str, Decimal], volume: int) -> None:
    if any(not isinstance(value, Decimal) for value in prices.values()):
        raise ValueError("OHLC 가격은 Decimal이어야 합니다")
    if any(not value.is_finite() for value in prices.values()):
        raise ValueError("가격이 유한값이 아닙니다")
    if any(value <= 0 for value in prices.values()):
        raise ValueError("OHLC 가격은 모두 0보다 커야 합니다")
    low, high = prices["low"], prices["high"]
    if not (low <= prices["open"] <= high and low <= prices["close"] <= high):
        raise ValueError("OHLC 범위가 모순됩니다 (low <= open/close <= high 필요)")
    if isinstance(volume, bool) or not isinstance(volume, int) or volume < 0:
        raise ValueError("거래량은 0 이상의 정수여야 합니다")
    if volume > SQLITE_INTEGER_MAX:
        raise ValueError("거래량이 SQLite INTEGER 범위를 벗어납니다")


def parse_candle_values(
    symbol: str,
    values: Mapping[str, str],
    *,
    context: str,
) -> Candle:
    """문자열 OHLCV 한 행을 소비자와 동일한 규칙으로 검증·변환한다."""
    try:
        prices = {
            field: Decimal(values[field])
            for field in ("open", "high", "low", "close")
        }
        volume_decimal = Decimal(values["volume"])
        if not volume_decimal.is_finite():
            raise ValueError("거래량이 유한값이 아닙니다")
        if volume_decimal != volume_decimal.to_integral_value():
            raise ValueError("거래량이 정수가 아닙니다")
        volume = int(volume_decimal)
        ts = _parse_ts(values["ts"])
        _validate_ohlcv(prices, volume)
    except (DecimalException, KeyError, OverflowError, ValueError) as exc:
        detail = str(exc) or "숫자 형식이 잘못됐습니다"
        raise ValueError(
            f"{context}: OHLCV 파싱 실패 "
            f"(open={values.get('open')!r}, high={values.get('high')!r}, "
            f"low={values.get('low')!r}, close={values.get('close')!r}, "
            f"volume={values.get('volume')!r}): {detail}"
        ) from exc
    return Candle(
        symbol=symbol,
        ts=ts,
        open=prices["open"],
        high=prices["high"],
        low=prices["low"],
        close=prices["close"],
        volume=volume,
    )


def _normalize_candles(symbol: str, candles: list[Candle]) -> list[Candle]:
    """모든 소스에 공통으로 적용할 캐시·백테스트 경계 검증."""
    normalized: list[Candle] = []
    seen: set[datetime] = set()
    for position, candle in enumerate(candles, start=1):
        if candle.symbol.upper() != symbol.upper():
            raise ValueError(
                f"{symbol}: 소스 {position}번째 캔들의 symbol이 {candle.symbol!r}입니다"
            )
        ts = _utc(candle.ts)
        if ts in seen:
            raise ValueError(f"{symbol}: 중복 timestamp {ts.isoformat()}")
        seen.add(ts)
        prices = {
            "open": candle.open,
            "high": candle.high,
            "low": candle.low,
            "close": candle.close,
        }
        try:
            _validate_ohlcv(prices, candle.volume)
        except ValueError as exc:
            raise ValueError(
                f"{symbol} {ts.isoformat()}: 잘못된 OHLCV: {exc}"
            ) from exc
        normalized.append(replace(candle, symbol=symbol, ts=ts))
    normalized.sort(key=lambda candle: candle.ts)
    return normalized


def _missing_requested_boundaries(
    candles: list[Candle],
    start: datetime | None,
    end: datetime | None,
    *,
    complete: bool,
) -> list[str]:
    """불완전한 표본이 명시한 기간 경계를 실제로 덮는지 확인한다."""
    if complete:
        return []
    if not candles:
        return [
            boundary
            for boundary, requested in (("start", start), ("end", end))
            if requested is not None
        ]

    missing: list[str] = []
    if start is not None and candles[0].ts > start:
        missing.append("start")
    if end is not None and candles[-1].ts < end:
        missing.append("end")
    return missing


class CsvSource:
    """`<dir>/<SYMBOL>.csv` 를 읽는다. 헤더 컬럼명은 유연하게 매칭한다."""

    def __init__(self, directory: Path | str) -> None:
        self.directory = Path(directory)

    def fetch(self, symbol: str, interval: str, count: int) -> list[Candle]:
        return self.fetch_batch(symbol, interval, count).candles

    def fetch_batch(self, symbol: str, interval: str, count: int) -> HistoryBatch:
        if count < 0:
            raise ValueError("count는 0 이상이어야 합니다")
        candles = self._read(symbol)
        selected = candles[-count:] if count else candles
        return HistoryBatch(selected, complete=(count == 0 or len(candles) <= count))

    def _read(self, symbol: str) -> list[Candle]:
        if not SAFE_SYMBOL.fullmatch(symbol) or symbol in {".", ".."}:
            raise ValueError(f"안전하지 않은 symbol: {symbol!r}")
        root = self.directory.resolve()
        path = (self.directory / f"{symbol}.csv").resolve()
        if path.parent != root:
            raise ValueError(f"{symbol}: CSV 폴더 밖의 파일은 읽을 수 없습니다")
        if not path.exists():
            raise FileNotFoundError(f"{path} 가 없습니다")

        with path.open(newline="", encoding="utf-8-sig") as handle:
            try:
                reader = csv.DictReader(handle, strict=True)
                mapping = self._map_columns(reader.fieldnames or (), path)
                rows = list(reader)
            except csv.Error as exc:
                raise ValueError(f"{path}: CSV 파싱 실패: {exc}") from exc
        candles: list[Candle] = []
        seen: dict[datetime, int] = {}
        for line_number, row in enumerate(rows, start=2):
            if None in row:
                raise ValueError(
                    f"{path}:{line_number}: CSV 헤더보다 값이 더 많습니다"
                )
            values: dict[str, str] = {}
            for field, header in mapping.items():
                raw = row.get(header)
                if raw is None or not raw.strip():
                    raise ValueError(f"{path}:{line_number}: '{field}' 값이 비어 있습니다")
                values[field] = raw.strip()
            candle = parse_candle_values(
                symbol, values, context=f"{path}:{line_number}"
            )
            ts = candle.ts
            if ts in seen:
                raise ValueError(
                    f"{path}:{line_number}: 중복 timestamp {ts.isoformat()} "
                    f"(첫 행 {seen[ts]})"
                )
            seen[ts] = line_number
            candles.append(candle)
        candles.sort(key=lambda c: c.ts)
        return candles

    @staticmethod
    def _map_columns(headers, path: Path) -> dict[str, str]:
        normalized = [h.lower().strip() for h in headers]
        duplicates = sorted(
            {header for header in normalized if normalized.count(header) > 1}
        )
        if duplicates:
            raise ValueError(
                f"{path}: 중복 CSV 헤더: {', '.join(duplicates)}"
            )
        lowered = dict(zip(normalized, headers))
        mapping: dict[str, str] = {}
        for field, aliases in COLUMN_ALIASES.items():
            matches = [lowered[alias] for alias in aliases if alias in lowered]
            if len(matches) > 1:
                raise ValueError(
                    f"{path}: '{field}'에 해당하는 헤더가 여러 개입니다: "
                    + ", ".join(matches)
                )
            if not matches:
                raise ValueError(
                    f"{path}: '{field}' 컬럼을 찾지 못했습니다 "
                    f"(후보: {', '.join(aliases)}) — 실제 헤더: {list(headers)}"
                )
            mapping[field] = matches[0]
        return mapping


class TossSource:
    """토스 Open API에서 캔들을 받는다."""

    def __init__(self, client) -> None:
        self.client = client

    def fetch(self, symbol: str, interval: str, count: int) -> list[Candle]:
        return self.client.get_candles(symbol, interval, count)

    def fetch_batch(self, symbol: str, interval: str, count: int) -> HistoryBatch:
        # 현재 토스 응답 스키마에는 '전체 이력 끝'을 증명하는 필드가 검증돼 있지
        # 않다. 성공 응답의 행 수만으로 complete=True를 만들지 않는다.
        return HistoryBatch(self.fetch(symbol, interval, count), complete=False)


class CandleCache:
    def __init__(self, path: Path | str = Path("candles.db")) -> None:
        self._conn = sqlite3.connect(str(path))
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(CACHE_SCHEMA)
        self._conn.commit()

    def load(self, symbol: str, interval: str, count: int = 0) -> list[Candle]:
        if count < 0:
            raise ValueError("count는 0 이상이어야 합니다")
        # 이전 버전 DB에는 서로 다른 UTC 오프셋 문자열이 남아 있을 수 있다.
        # ISO 문자열 ORDER BY는 실제 시각 순서가 아니므로 파싱 후 정렬한다.
        rows = self._conn.execute(
            "SELECT * FROM candles WHERE symbol = ? AND interval = ?",
            (symbol, interval),
        ).fetchall()
        try:
            candles = [
                Candle(
                    symbol=symbol,
                    ts=_utc(datetime.fromisoformat(row["ts"])),
                    open=Decimal(row["open"]),
                    high=Decimal(row["high"]),
                    low=Decimal(row["low"]),
                    close=Decimal(row["close"]),
                    volume=row["volume"],
                )
                for row in rows
            ]
            candles = _normalize_candles(symbol, candles)
        except (DecimalException, TypeError, ValueError) as exc:
            raise ValueError(
                f"{symbol}: 캐시된 OHLCV 스냅샷이 유효하지 않습니다: {exc}"
            ) from exc
        return candles[-count:] if count else candles

    def can_satisfy(
        self,
        symbol: str,
        interval: str,
        count: int,
        *,
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> bool:
        """이 캐시 스냅샷이 요청 범위를 실제로 포함하는지 확인한다.

        이전 버전 DB처럼 메타데이터가 없는 캐시는 완전하다고 추측하지 않는다.
        한 번 다시 받은 뒤부터 정확한 범위를 재사용한다.
        """
        return self.load_satisfying(
            symbol, interval, count, start=start, end=end
        ) is not None

    def load_satisfying(
        self,
        symbol: str,
        interval: str,
        count: int,
        *,
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> list[Candle] | None:
        """메타데이터와 행을 한 SQLite 스냅샷에서 검증해 함께 반환한다."""
        if count < 0:
            raise ValueError("count는 0 이상이어야 합니다")
        start = _utc(start) if start is not None else None
        end = _utc(end) if end is not None else None

        owns_transaction = not self._conn.in_transaction
        if owns_transaction:
            self._conn.execute("BEGIN")
        try:
            row = self._conn.execute(
                "SELECT row_count, complete FROM candle_snapshots "
                "WHERE symbol = ? AND interval = ?",
                (symbol, interval),
            ).fetchone()
            try:
                valid_candles = self.load(symbol, interval)
            except ValueError as exc:
                log.warning("%s: 유효하지 않은 캐시는 무시합니다: %s", symbol, exc)
                return None
            if row is not None:
                row_count = row["row_count"]
                raw_complete = row["complete"]
                if (
                    type(row_count) is not int
                    or row_count < 0
                    or row_count != len(valid_candles)
                    or type(raw_complete) is not int
                    or raw_complete not in (0, 1)
                ):
                    log.warning(
                        "%s: 캐시 스냅샷 메타데이터가 실제 행과 일치하지 않습니다",
                        symbol,
                    )
                    return None
                snapshot_complete = raw_complete == 1
            else:
                snapshot_complete = False
            count_satisfied = snapshot_complete or (
                count > 0 and len(valid_candles) >= count
            )
            if not count_satisfied:
                return None

            selected = valid_candles[-count:] if count else valid_candles
            selected_complete = snapshot_complete and (
                count == 0 or len(valid_candles) <= count
            )
            if _missing_requested_boundaries(
                selected, start, end, complete=selected_complete
            ):
                return None
            return selected
        finally:
            if owns_transaction:
                self._conn.rollback()

    def save(self, interval: str, candles: list[Candle]) -> int:
        with self._conn:
            self._upsert(interval, candles)
            # 임의 증분 저장으로는 전체 범위를 알 수 없으므로 기존 완전성
            # 메타데이터를 폐기한다.
            self._conn.executemany(
                "DELETE FROM candle_snapshots WHERE symbol = ? AND interval = ?",
                {(c.symbol, interval) for c in candles},
            )
        return len(candles)

    def replace_snapshot(
        self,
        symbol: str,
        interval: str,
        candles: list[Candle],
        *,
        complete: bool,
    ) -> int:
        """한 번의 소스 응답으로 캐시를 원자적으로 교체한다."""
        if type(complete) is not bool:
            raise TypeError("스냅샷 complete는 bool이어야 합니다")
        candidate = list(candles)
        if any(c.symbol != symbol for c in candidate):
            raise ValueError("스냅샷에는 요청한 심볼의 캔들만 들어가야 합니다")
        # DELETE 전에 검증해야 실패가 기존의 정상 스냅샷을 건드리지 않는다. 특히
        # 같은 UTC 시각의 다른 오프셋 문자열은 SQLite PK에 넣기 전에 하나의 시각으로
        # 정규화해 중복으로 거부한다. UPSERT 뒤의 행 수로 완전성을 추측하면 두 입력이
        # 한 행으로 접힌 결과를 complete=True로 인증하게 된다.
        normalized = _normalize_candles(symbol, candidate)
        with self._conn:
            self._conn.execute(
                "DELETE FROM candles WHERE symbol = ? AND interval = ?",
                (symbol, interval),
            )
            self._upsert(interval, normalized)
            row_count = self._conn.execute(
                "SELECT COUNT(*) FROM candles WHERE symbol = ? AND interval = ?",
                (symbol, interval),
            ).fetchone()[0]
            if row_count != len(normalized):
                raise ValueError(
                    f"{symbol}: 스냅샷 저장 행 수 {row_count}가 "
                    f"검증 입력 {len(normalized)}개와 일치하지 않습니다"
                )
            self._conn.execute(
                "INSERT INTO candle_snapshots "
                "(symbol, interval, row_count, complete) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(symbol, interval) DO UPDATE SET "
                "row_count=excluded.row_count, complete=excluded.complete",
                (symbol, interval, row_count, int(complete)),
            )
        return row_count

    def _upsert(self, interval: str, candles: list[Candle]) -> None:
        self._conn.executemany(
            "INSERT INTO candles (symbol, interval, ts, open, high, low, close, volume) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(symbol, interval, ts) DO UPDATE SET "
            "open=excluded.open, high=excluded.high, low=excluded.low, "
            "close=excluded.close, volume=excluded.volume",
            [
                (
                    c.symbol, interval, _utc(c.ts).isoformat(),
                    str(c.open), str(c.high), str(c.low), str(c.close), c.volume,
                )
                for c in candles
            ],
        )

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
    on_break: str = "warn",
    verified_splits: dict[str, list[VerifiedSplit]] | None = None,
) -> dict[str, list[Candle]]:
    """캐시를 우선 보고, 없거나 refresh면 소스에서 받아 캐시에 넣는다.

    on_break — 가격 불연속(분할·분사·데이터 오류)을 어떻게 다룰지:
      "ignore"  아무것도 하지 않는다
      "warn"    (기본) 로그로 경고만 한다. 데이터는 그대로 둔다.
      "adjust"  외부 공시로 검증된 분할만 소급 조정한다. 나머지는 경고.

    기본이 warn인 이유: 불연속을 감지하는 건 확실하지만 원인은 외부 데이터
    없이 확정할 수 없다. 조용히 고치는 것보다 알려주는 게 낫다.
    """
    if count < 0:
        raise ValueError("count는 0 이상이어야 합니다")
    start = _utc(start) if start is not None else None
    end = _utc(end) if end is not None else None
    if start is not None and end is not None and start > end:
        raise ValueError("start는 end보다 늦을 수 없습니다")
    if on_break not in ("ignore", "warn", "adjust"):
        raise ValueError(f"알 수 없는 on_break '{on_break}'")
    if on_break == "adjust" and verified_splits is None:
        raise ValueError(
            "on_break='adjust'에는 출처가 기록된 verified_splits가 필요합니다"
        )
    if on_break == "adjust" and interval != "1d":
        raise ValueError("on_break='adjust'는 interval='1d'에서만 지원합니다")
    history: dict[str, list[Candle]] = {}

    for symbol in symbols:
        candles: list[Candle] = []
        cached_snapshot = (
            cache.load_satisfying(
                symbol,
                interval,
                count,
                start=start,
                end=end,
            )
            if cache is not None
            else None
        )
        cached_fallback = cached_snapshot if cached_snapshot is not None else []
        if not refresh and cached_fallback:
            candles = cached_fallback
            if candles:
                log.info("%s: 캐시에서 %d개 봉 로드", symbol, len(candles))

        if not candles:
            fetch_batch = getattr(source, "fetch_batch", None)
            batch = (
                fetch_batch(symbol, interval, count)
                if callable(fetch_batch)
                else HistoryBatch(
                    source.fetch(symbol, interval, count), complete=False
                )
            )
            if not isinstance(batch, HistoryBatch):
                raise TypeError("fetch_batch는 HistoryBatch를 반환해야 합니다")
            received = _normalize_candles(symbol, list(batch.candles))
            original_count = len(received)
            if count and original_count > count:
                received = received[-count:]
            complete = batch.complete and (count == 0 or original_count <= count)
            sufficient = complete or (count > 0 and len(received) >= count)
            missing_boundaries = _missing_requested_boundaries(
                received, start, end, complete=complete
            )
            log.info(
                "%s: 소스에서 %d개 봉 수신 (complete=%s)",
                symbol,
                len(received),
                complete,
            )
            if not received and cached_fallback:
                raise ValueError(
                    f"{symbol}: refresh가 빈 응답을 반환했습니다; "
                    f"기존 캐시는 보존했습니다 ({len(cached_fallback)}개)"
                )
            elif not sufficient:
                if cached_fallback:
                    raise ValueError(
                        f"{symbol}: refresh 응답 {len(received)}개로 요청 "
                        f"{count}개의 완전성을 증명할 수 없습니다; "
                        f"기존 캐시는 보존했습니다 ({len(cached_fallback)}개)"
                    )
                else:
                    raise ValueError(
                        f"{symbol}: 소스 응답 {len(received)}개로 요청 {count}개의 "
                        "완전성을 확인할 수 없습니다"
                    )
            elif missing_boundaries:
                boundary_text = ", ".join(missing_boundaries)
                if cached_fallback:
                    raise ValueError(
                        f"{symbol}: refresh 응답이 요청한 {boundary_text} 경계를 "
                        "덮지 않아 기간 완전성을 확인할 수 없습니다; "
                        "기존 캐시는 보존했습니다"
                    )
                raise ValueError(
                    f"{symbol}: 소스 응답이 요청한 {boundary_text} 경계를 "
                    "덮지 않아 기간 완전성을 확인할 수 없습니다"
                )
            elif received:
                in_requested_range = [
                    candle
                    for candle in received
                    if (start is None or candle.ts >= start)
                    and (end is None or candle.ts <= end)
                ]
                if (start is not None or end is not None) and not in_requested_range:
                    if cached_fallback:
                        raise ValueError(
                            f"{symbol}: refresh 응답에 지정한 기간의 캔들이 없습니다; "
                            "기존 캐시는 보존했습니다"
                        )
                    raise ValueError(
                        f"{symbol}: 지정한 기간에 해당하는 캔들이 없습니다"
                    )
                candles = received
                if cache is not None:
                    # 충분하거나 명시적으로 완전한 응답만 기존 스냅샷과 교체한다.
                    cache.replace_snapshot(
                        symbol, interval, candles, complete=complete
                    )

        if start is not None:
            candles = [c for c in candles if c.ts >= start]
        if end is not None:
            candles = [c for c in candles if c.ts <= end]

        if not candles:
            raise ValueError(f"{symbol}: 지정한 기간에 해당하는 캔들이 없습니다")

        if on_break != "ignore":
            candles = _handle_breaks(
                symbol,
                candles,
                on_break,
                (verified_splits or {}).get(symbol.upper(), []),
            )
        history[symbol] = candles

    return history


def _handle_breaks(
    symbol: str,
    candles: list[Candle],
    policy: str,
    verified_splits: list[VerifiedSplit],
) -> list[Candle]:
    """가격 불연속을 보고하고, 정책이 adjust면 검증된 분할만 고친다."""
    breaks = detect(candles)
    # 공시 매니페스트는 policy=adjust일 때만 실제 해석에 참여한다. warn에서
    # 날짜만 같다고 경고를 숨기면 사용자는 원본이 그대로라는 사실을 놓친다.
    verified_dates = (
        {item.effective_date for item in verified_splits}
        if policy == "adjust"
        else set()
    )
    candidates = [
        b for b in breaks
        if b.looks_like_split and b.ts.date() not in verified_dates
    ]
    bad_bars = [b for b in breaks if b.looks_like_bad_bar]
    unknown = [
        b for b in breaks
        if not b.looks_like_split
        and not b.looks_like_bad_bar
        and b.ts.date() not in verified_dates
    ]

    for item in bad_bars:
        log.warning("%s 데이터 오류 의심 — %s", symbol, item.describe())
    for item in unknown:
        log.warning(
            "%s 원인 불명 불연속 — %s (분사면 백테스트가 왜곡됩니다)",
            symbol, item.describe(),
        )

    for item in candidates:
        log.warning(
            "%s 분할비 후보 — %s (외부 공시 확인 전에는 조정하지 않습니다)",
            symbol, item.describe(),
        )

    if policy == "adjust":
        for item in verified_splits:
            if candles[0].ts.date() <= item.effective_date <= candles[-1].ts.date():
                log.info(
                    "%s 검증 승수 소급 조정 — %s event_type=%s factor=%s source=%s",
                    symbol,
                    item.effective_date,
                    item.event_type,
                    item.ratio,
                    item.source,
                )
        return back_adjust(candles, verified_splits)

    return candles
