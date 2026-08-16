#!/usr/bin/env python
"""종목별 전략 vs 바이앤홀드 분포.

두세 종목만 보고 내린 결론은 대개 종목 선택의 산물이다. 같은 전략을 전 종목에
돌려 '몇 %에서 이겼나'를 봐야 전략 자체의 성질이 드러난다.

사용:
    python scripts/sweep.py <csv폴더> [--fast 20 --slow 60 --limit 100]

CSV는 `<폴더>/<종목>.csv`, 헤더는 date,open,high,low,close,volume.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import logging
import math
import os
import pathlib
import platform
import shutil
import stat
import statistics
import sys
import tempfile
from collections import defaultdict
from contextlib import contextmanager
from decimal import Decimal
from typing import Iterator

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent


def _file_sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _calculate_measurement_code_sha256() -> str:
    paths = [
        pathlib.Path(__file__).resolve(),
        SCRIPT_DIR / "prepare_plotly_data.py",
        PROJECT_ROOT / "pyproject.toml",
    ]
    paths.extend(sorted((PROJECT_ROOT / "src" / "tossquant").rglob("*.py")))
    aggregate = hashlib.sha256()
    aggregate.update(b"sha256-relative-path-content-v1\0")
    for path in paths:
        relative = path.relative_to(PROJECT_ROOT).as_posix().encode("utf-8")
        aggregate.update(len(relative).to_bytes(4, "big"))
        aggregate.update(relative)
        aggregate.update(bytes.fromhex(_file_sha256(path)))
    return aggregate.hexdigest()


# 실행 모듈을 import하기 전의 실제 바이트를 고정한다. 이후 보고하는 해시는
# 이 값이며, 시작 뒤 디스크 코드가 달라지면 성공 결과를 내지 않는다.
STARTUP_CODE_SHA256 = _calculate_measurement_code_sha256()
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from tossquant.backtest.corporate import (  # noqa: E402
    detect,
    load_verified_splits_bytes,
)
from tossquant.backtest.data import (  # noqa: E402
    CsvSource,
    HistoryBatch,
    load_history,
)
from tossquant.backtest.simulator import Backtester  # noqa: E402
from tossquant.config import Settings  # noqa: E402
from tossquant.models import Candle  # noqa: E402
from tossquant.strategy import registry  # noqa: E402

if _calculate_measurement_code_sha256() != STARTUP_CODE_SHA256:
    raise RuntimeError("TossQuant 코드가 import 중 변경됐습니다")


REPORT_FILENAME = "preparation-report.json"
DATASET_DIGEST_ALGORITHM = "sha256-filename-size-content-v1"
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_REPORT_BYTES = 10 * 1024 * 1024
TIMESTAMP_DIGEST_ALGORITHM = "sha256-iso-utc-timestamp-newline-v1"
COHORT_DIGEST_ALGORITHM = "sha256-symbols-timestamp-range-v3"
MEASUREMENT_CODE_DIGEST_ALGORITHM = "sha256-relative-path-content-v1"
COHORT_SELECTION = (
    "maximum validated row count, then largest identical UTC-midnight "
    "timestamp sequence"
)
SWEEP_RESULT_SCHEMA_VERSION = 1
SWEEP_RESULT_PREFIX = "sweep_result="
SIMULATION_CONFIG_FIELDS = (
    "candle_interval",
    "paper_cash",
    "paper_slippage_bps",
    "paper_commission_bps",
    "backtest_spread_bps",
    "strategy",
    "sma_fast",
    "sma_slow",
    "momentum_lookback",
    "momentum_entry",
    "momentum_exit",
    "breakout_entry_bars",
    "breakout_exit_bars",
    "meanrev_lookback",
    "meanrev_entry_z",
    "meanrev_exit_z",
    "regime_enabled",
    "regime_symbol",
    "regime_ma_bars",
    "max_position_pct",
    "max_positions",
    "max_daily_loss_pct",
    "max_order_notional",
    "stop_loss_pct",
    "trailing_stop_pct",
    "take_profit_pct",
    "max_holding_days",
    "stop_cooldown_days",
)


class SweepSettings(Settings):
    """측정값이 셸의 TOSSQUANT_* 환경변수에 오염되지 않는 설정."""

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls,
        init_settings,
        env_settings,
        dotenv_settings,
        file_secret_settings,
    ):
        return (init_settings,)


class MemorySource:
    """검증·스냅샷한 캔들만 제공해 긴 측정 중 파일 변경을 차단한다."""

    def __init__(self, histories: dict[str, list[Candle]]) -> None:
        self.histories = histories

    def fetch(self, symbol: str, interval: str, count: int) -> list[Candle]:
        return self.fetch_batch(symbol, interval, count).candles

    def fetch_batch(self, symbol: str, interval: str, count: int) -> HistoryBatch:
        if count < 0:
            raise ValueError("count는 0 이상이어야 합니다")
        if symbol not in self.histories:
            raise FileNotFoundError(f"{symbol}: 스냅샷에 캔들이 없습니다")
        candles = self.histories[symbol]
        selected = candles[-count:] if count else candles
        return HistoryBatch(list(selected), complete=True)


def _read_regular_file_bytes(
    path: pathlib.Path,
    *,
    max_bytes: int,
    description: str,
) -> bytes:
    """특수파일에서 block하지 않고 한 번 연 일반 파일의 바이트만 읽는다."""
    path = pathlib.Path(path)
    flags = (
        os.O_RDONLY
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_NONBLOCK", 0)
    )
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise ValueError(
            f"{description}은(는) 읽을 수 있는 일반 파일이어야 합니다: {path}"
        ) from exc
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError(f"{description}은(는) 일반 파일이어야 합니다: {path}")
        with os.fdopen(descriptor, "rb", closefd=False) as handle:
            content = handle.read(max_bytes + 1)
        if len(content) > max_bytes:
            raise ValueError(
                f"{description}이(가) {max_bytes}바이트 제한을 넘습니다: {path}"
            )
    finally:
        os.close(descriptor)
    return content


def load_manifest_snapshot(
    path: pathlib.Path,
) -> tuple[dict, str]:
    """일반 파일을 한 번 연 FD에서 읽고 같은 바이트를 파싱·해시한다."""
    content = _read_regular_file_bytes(
        path,
        max_bytes=MAX_MANIFEST_BYTES,
        description="검증 승수 파일",
    )
    parsed = load_verified_splits_bytes(content, source_name=str(path))
    return parsed, hashlib.sha256(content).hexdigest()


def measurement_code_sha256() -> str:
    """시작 때 고정한 코드 해시를 반환하고 디스크 변경은 실패시킨다."""
    current = _calculate_measurement_code_sha256()
    if current != STARTUP_CODE_SHA256:
        raise ValueError(
            "측정 중 TossQuant 코드가 변경됐습니다: "
            f"startup={STARTUP_CODE_SHA256} current={current}"
        )
    return STARTUP_CODE_SHA256


def _csv_paths(directory: pathlib.Path) -> list[pathlib.Path]:
    paths = sorted(directory.glob("*.csv"), key=lambda path: path.name)
    if not paths:
        raise ValueError(f"{directory} 에 CSV가 없습니다")
    for path in paths:
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"CSV는 일반 파일이어야 합니다: {path}")
    return paths


def _dataset_digest(paths: list[pathlib.Path]) -> str:
    aggregate = hashlib.sha256()
    aggregate.update(DATASET_DIGEST_ALGORITHM.encode("ascii") + b"\0")
    aggregate.update(len(paths).to_bytes(8, "big"))
    for path in paths:
        name = path.name.encode("utf-8")
        size = path.stat().st_size
        aggregate.update(len(name).to_bytes(4, "big"))
        aggregate.update(name)
        aggregate.update(size.to_bytes(8, "big"))
        aggregate.update(bytes.fromhex(_file_sha256(path)))
    return aggregate.hexdigest()


@contextmanager
def csv_snapshot(
    directory: pathlib.Path,
) -> Iterator[tuple[pathlib.Path, str, dict | None]]:
    """CSV 집합을 사본으로 고정하고 복사 전후 해시를 대조한다."""
    directory = pathlib.Path(directory)
    if directory.is_symlink():
        raise ValueError(f"CSV 폴더는 심볼릭 링크일 수 없습니다: {directory}")
    if not directory.is_dir():
        raise ValueError(f"CSV 폴더가 아닙니다: {directory}")
    directory = directory.resolve()
    report_path = directory / REPORT_FILENAME
    report_exists = os.path.lexists(report_path)
    report_bytes_before = (
        _read_regular_file_bytes(
            report_path,
            max_bytes=MAX_REPORT_BYTES,
            description="준비 보고서",
        )
        if report_exists
        else None
    )
    report_before: dict | None = None

    with tempfile.TemporaryDirectory(prefix="tossquant-sweep-snapshot-") as raw:
        snapshot = pathlib.Path(raw) / "dataset"
        snapshot.mkdir()
        paths_before = _csv_paths(directory)
        source_digest_before = _dataset_digest(paths_before)
        for path in paths_before:
            shutil.copyfile(path, snapshot / path.name)
        if report_bytes_before is not None:
            (snapshot / REPORT_FILENAME).write_bytes(report_bytes_before)

        snapshot_digest = _dataset_digest(_csv_paths(snapshot))
        source_digest_after = _dataset_digest(_csv_paths(directory))
        if (
            snapshot_digest != source_digest_before
            or source_digest_after != source_digest_before
        ):
            raise ValueError(
                "입력 CSV가 스냅샷 중 변경됐습니다: "
                f"before={source_digest_before} snapshot={snapshot_digest} "
                f"source_after={source_digest_after}"
            )
        if [path.name for path in paths_before] != [
            path.name for path in _csv_paths(directory)
        ]:
            raise ValueError("입력 CSV 목록이 스냅샷 중 변경됐습니다")

        if os.path.lexists(report_path) != report_exists:
            raise ValueError("준비 보고서 유무가 스냅샷 중 변경됐습니다")
        if report_bytes_before is not None:
            from prepare_plotly_data import verify_prepared_output

            report_before = verify_prepared_output(snapshot)
            if report_before["output_sha256"] != source_digest_before:
                raise ValueError("준비 보고서와 입력 CSV SHA-256이 다릅니다")
            report_bytes_after = _read_regular_file_bytes(
                report_path,
                max_bytes=MAX_REPORT_BYTES,
                description="준비 보고서",
            )
            if report_bytes_after != report_bytes_before:
                raise ValueError("준비 보고서가 스냅샷 중 변경됐습니다")
        yield snapshot, source_digest_before, report_before


def load_snapshot_histories(
    directory: pathlib.Path,
) -> tuple[dict[str, list[Candle]], list[tuple[str, str]]]:
    source = CsvSource(directory)
    histories: dict[str, list[Candle]] = {}
    skipped: list[tuple[str, str]] = []
    seen_symbols: dict[str, str] = {}
    for path in _csv_paths(directory):
        symbol = path.stem
        canonical = symbol.upper()
        if canonical in seen_symbols:
            raise ValueError(
                f"대소문자만 다른 중복 심볼: {seen_symbols[canonical]}, {symbol}"
            )
        seen_symbols[canonical] = symbol
        try:
            candles = source.fetch(symbol, "1d", 0)
            if not candles:
                raise ValueError("캔들이 없습니다")
            intraday = next(
                (
                    candle.ts
                    for candle in candles
                    if any(
                        (
                            candle.ts.hour,
                            candle.ts.minute,
                            candle.ts.second,
                            candle.ts.microsecond,
                        )
                    )
                ),
                None,
            )
            if intraday is not None:
                raise ValueError(
                    "스윕은 UTC 자정 일봉만 지원합니다: "
                    f"timestamp={intraday.isoformat()}"
                )
        except (FileNotFoundError, KeyError, OSError, ValueError) as exc:
            reason = str(exc) or type(exc).__name__
            reason = reason.replace(str(directory) + os.sep, "")
            skipped.append((symbol, reason))
            continue
        histories[canonical] = candles
    return histories, skipped


def select_cohort(
    histories: dict[str, list[Candle]],
    *,
    min_bars: int,
) -> tuple[list[str], tuple, int]:
    """동일 개수뿐 아니라 동일 timestamp 열을 쓰는 최대 코호트를 고른다."""
    if not histories:
        raise ValueError("검증된 매매 대상 CSV가 없습니다")
    threshold = min_bars or max(len(candles) for candles in histories.values())
    eligible = {
        symbol: candles
        for symbol, candles in histories.items()
        if len(candles) >= threshold
    }
    if not eligible:
        raise ValueError(f"{threshold}봉 이상인 매매 대상이 없습니다")
    groups: dict[tuple, list[str]] = defaultdict(list)
    for symbol, candles in eligible.items():
        groups[tuple(candle.ts for candle in candles)].append(symbol)
    signature, symbols = min(
        groups.items(),
        key=lambda item: (
            -len(item[1]),
            -len(item[0]),
            tuple(sorted(item[1])),
        ),
    )
    selected = sorted(symbols)
    return selected, signature, len(histories) - len(selected)


def simulation_config(settings: Settings) -> dict[str, object]:
    values = settings.model_dump(mode="json")
    return {field: values[field] for field in SIMULATION_CONFIG_FIELDS}


def cohort_sha256(symbols: list[str], timestamp_signature: tuple) -> str:
    timestamp_sha256 = timestamp_signature_sha256(timestamp_signature)
    payload = {
        "algorithm": COHORT_DIGEST_ALGORITHM,
        "bars": len(timestamp_signature),
        "first_session": timestamp_signature[0].date().isoformat(),
        "last_session": timestamp_signature[-1].date().isoformat(),
        "symbols": sorted(symbols),
        "timestamp_sha256": timestamp_sha256,
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def timestamp_signature_sha256(timestamp_signature: tuple) -> str:
    digest = hashlib.sha256()
    for timestamp in timestamp_signature:
        digest.update(timestamp.isoformat().encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def canonical_json(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def preparation_provenance(report: dict | None) -> dict | None:
    if report is None:
        return None
    fields = (
        "preparation_schema_version",
        "preparation_tool_version",
        "preparation_tool_sha256",
        "backtest_data_module",
        "backtest_data_sha256",
        "candle_model_module",
        "candle_model_sha256",
        "python_version",
        "source_kind",
        "source_url",
        "source_commit",
        "source_path",
        "source_sha256",
        "symbols",
        "input_rows",
        "written_rows",
        "timestamp_digest_algorithm",
        "output_digest_algorithm",
        "output_sha256",
        "report_digest_algorithm",
        "report_sha256",
    )
    result = {field: report[field] for field in fields}
    result.update(
        {
            "dropped_rows": len(report["dropped_rows"]),
            "missing_rows": sum(
                "missing" in row for row in report["dropped_rows"]
            ),
            "invalid_ohlcv_rows": sum(
                "invalid" in row for row in report["dropped_rows"]
            ),
        }
    )
    return result


def summarize_rows(rows: list[tuple]) -> tuple[dict[str, object], dict[str, list[dict]]]:
    def col(index: int) -> list[float]:
        return [row[index] for row in rows]

    total = len(rows)
    wins = sum(1 for row in rows if row[1] > row[2])
    aggregates: dict[str, object] = {
        "completed_symbol_count": total,
        "strategy_return_median": float(statistics.median(col(1))),
        "benchmark_return_median": float(statistics.median(col(2))),
        "strategy_mdd_median": float(statistics.median(col(3))),
        "benchmark_mdd_median": float(statistics.median(col(4))),
        "strategy_sharpe_median": float(statistics.median(col(5))),
        "benchmark_sharpe_median": float(statistics.median(col(6))),
        "symbols_strategy_return_gt_benchmark": wins,
        "cross_sectional_beat_rate": wins / total,
        "positive_strategy_returns": sum(1 for value in col(1) if value > 0),
        "mean_trades": float(statistics.mean(col(7))),
    }

    def ranked_row(row: tuple) -> dict[str, object]:
        return {
            "symbol": row[0],
            "strategy_return": row[1],
            "benchmark_return": row[2],
            "excess_return": row[1] - row[2],
            "strategy_mdd": row[3],
            "benchmark_mdd": row[4],
            "strategy_sharpe": row[5],
            "benchmark_sharpe": row[6],
            "trades": row[7],
        }

    ordered = sorted(rows, key=lambda row: row[1] - row[2], reverse=True)
    ranked = {
        "top": [ranked_row(row) for row in ordered[:5]],
        "bottom": [ranked_row(row) for row in ordered[-5:]],
    }
    return aggregates, ranked


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("csv_dir", type=pathlib.Path)
    p.add_argument("--strategy", default="sma_cross", choices=registry.NAMES)
    p.add_argument("--fast", type=int, default=20)
    p.add_argument("--slow", type=int, default=60)
    p.add_argument("--limit", type=int, default=0, help="종목 수 제한 (0=전체)")
    p.add_argument("--min-bars", type=int, default=0, help="이 봉 수 미만은 제외")
    p.add_argument("--stop-loss", type=float, default=0.08)
    p.add_argument("--regime", default="", help="국면 필터 지수 심볼 (예: SPY)")
    p.add_argument("--regime-ma", type=int, default=200)
    p.add_argument("--on-break", default="warn",
                   choices=("ignore", "warn", "adjust"),
                   help="가격 불연속 처리")
    p.add_argument("--verified-splits", type=pathlib.Path,
                   help=("검증된 동일종목 승수 CSV "
                         "(symbol,date,ratio,event_type,source)"))
    p.add_argument("--exclude-contaminated", action="store_true",
                   help=("전체 기간의 하락·일시 불연속 종목을 사후 제외 "
                         "(미래정보를 쓰는 민감도 분석 전용)"))
    p.add_argument(
        "--allow-skipped",
        action="store_true",
        help="CSV/조정 오류 종목의 이유를 출력하고 나머지만 계속 (기본은 실패)",
    )
    args = p.parse_args()
    if args.limit < 0:
        p.error("--limit은 0 이상이어야 합니다")
    if args.min_bars < 0:
        p.error("--min-bars는 0 이상이어야 합니다")
    if not math.isfinite(args.stop_loss) or not 0 <= args.stop_loss < 1:
        p.error("--stop-loss는 0 이상 1 미만의 유한값이어야 합니다")
    if args.fast <= 0 or args.slow <= 0:
        p.error("--fast와 --slow는 0보다 커야 합니다")
    if args.fast >= args.slow:
        p.error("--fast는 --slow보다 작아야 합니다")
    if args.regime_ma <= 0:
        p.error("--regime-ma는 0보다 커야 합니다")
    args.regime = args.regime.strip().upper()
    return args


def print_skipped(
    processed: int,
    skipped: list[tuple[str, str]],
) -> None:
    print(f"처리 {processed}개 · 오류로 건너뜀 {len(skipped)}개")
    for symbol, reason in skipped:
        print(f"  {symbol}: {reason}")
    print()


def main() -> None:
    args = parse_args()
    print(
        "실행 컨텍스트 "
        + json.dumps(
            {
                "argv": sys.argv,
                "cwd": str(pathlib.Path.cwd().resolve()),
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    # 보호 청산 이벤트만 대량 출력하지 않는다. 데이터 불연속 경고는 반드시 보인다.
    logging.getLogger("tossquant.stops").setLevel(logging.ERROR)

    if args.on_break == "adjust" and args.verified_splits is None:
        sys.exit("--on-break adjust에는 --verified-splits 파일이 필요합니다")
    if args.verified_splits is not None and args.on_break != "adjust":
        sys.exit("--verified-splits는 --on-break adjust에서만 사용할 수 있습니다")
    try:
        if args.verified_splits is not None:
            verified_splits, manifest_sha256 = load_manifest_snapshot(
                args.verified_splits
            )
        else:
            verified_splits, manifest_sha256 = None, None
    except ValueError as exc:
        sys.exit(str(exc))

    try:
        with csv_snapshot(args.csv_dir) as (snapshot, input_digest, prep_report):
            histories, skipped = load_snapshot_histories(snapshot)
    except (ImportError, KeyError, OSError, ValueError) as exc:
        sys.exit(f"입력 스냅샷 실패: {exc}")

    discovered = len(histories) + len(skipped)
    if skipped and not args.allow_skipped:
        print_skipped(len(histories), skipped)
        sys.exit(
            f"{len(skipped)}개 CSV가 유효하지 않습니다. 검증 후 다시 실행하거나 "
            "--allow-skipped로 명시적으로 제외하세요"
        )

    source = MemorySource(histories)
    regime_requested = args.regime
    regime_symbol = regime_requested if regime_requested in histories else ""
    if regime_requested and not regime_symbol:
        sys.exit(f"국면 필터 심볼 {regime_requested}의 유효한 CSV가 없습니다")
    target_histories = {
        symbol: candles
        for symbol, candles in histories.items()
        if symbol != regime_symbol
    }
    try:
        symbols, timestamp_signature, cohort_excluded = select_cohort(
            target_histories,
            min_bars=args.min_bars,
        )
    except ValueError as exc:
        sys.exit(f"매매 대상 코호트 오류: {exc}")
    if regime_symbol and tuple(
        candle.ts for candle in histories[regime_symbol]
    ) != timestamp_signature:
        sys.exit(
            f"국면 필터 {regime_symbol}와 매매 대상의 timestamp 열이 다릅니다"
        )
    base_symbols = list(symbols)

    print(
        f"입력 발견 {discovered}개 · 유효 {len(histories)}개 · "
        f"코호트 {len(symbols)}개 · 코호트 제외 {cohort_excluded}개 · "
        f"오류 {len(skipped)}개"
    )
    print(f"기본 코호트 SHA-256={cohort_sha256(symbols, timestamp_signature)}")
    print(
        "기본 코호트 timestamp_sha256="
        f"{timestamp_signature_sha256(timestamp_signature)}"
    )
    print(
        "기본 코호트 기간="
        f"{timestamp_signature[0].date().isoformat()}.."
        f"{timestamp_signature[-1].date().isoformat()} · "
        f"bars={len(timestamp_signature)}"
    )
    if prep_report is not None:
        print(
            f"준비 산출물 검증 완료 · output_sha256={input_digest} · "
            f"source_sha256={prep_report['source_sha256']} · "
            f"schema={prep_report['preparation_schema_version']} · "
            f"tool_sha256={prep_report['preparation_tool_sha256']} · "
            f"report_sha256={prep_report['report_sha256']}"
        )
    else:
        print(
            "[주의] preparation-report.json 없는 로컬 입력을 스냅샷했습니다 · "
            f"input_sha256={input_digest}"
        )
    if manifest_sha256 is not None:
        print(f"검증 승수 SHA-256={manifest_sha256}")
    print()

    dropped: list[str] = []
    if args.exclude_contaminated:
        # 이 필터는 미래에 생길 불연속까지 먼저 본다. 데이터 품질 영향의 방향을
        # 보는 사후 민감도 분석일 뿐, 실전에서 재현 가능한 종목 선택이 아니다.
        print(
            "[주의] 사후 전체기간 민감도 필터: 미래정보로 코호트를 고르므로 "
            "편향 없는 성과로 해석할 수 없습니다.\n"
        )
        print(
            "사후 민감도 계약 "
            + json.dumps(
                {
                    "unbiased_estimate": False,
                    "uses_future_information": True,
                },
                sort_keys=True,
            )
            + "\n"
        )
        clean = []
        for symbol in symbols:
            try:
                breaks = detect(source.fetch(symbol, "1d", 0))
            except (FileNotFoundError, KeyError, ValueError) as exc:
                skipped.append((symbol, str(exc) or type(exc).__name__))
                continue
            resolved_dates = (
                {
                    item.effective_date
                    for item in (verified_splits or {}).get(symbol.upper(), [])
                }
                if args.on_break == "adjust"
                else set()
            )
            if any(
                b.distorts_backtest and b.ts.date() not in resolved_dates
                for b in breaks
            ):
                dropped.append(symbol)
            else:
                clean.append(symbol)
        if dropped:
            print(
                f"사후 의심 종목 {len(dropped)}개 제외: "
                f"{', '.join(sorted(dropped))}\n"
            )
        symbols = clean

    if args.limit:
        symbols = symbols[: args.limit]
    if not symbols:
        sys.exit("필터와 제한을 적용한 뒤 매매 대상이 없습니다")

    try:
        settings = SweepSettings(
            client_id="x",
            client_secret="y",
            paper_cash=Decimal("10000"),
            max_position_pct=Decimal("1"),
            max_positions=1,
            max_order_notional=Decimal("10000"),
            stop_loss_pct=Decimal(str(args.stop_loss)),
            regime_enabled=bool(regime_symbol),
            regime_symbol=regime_symbol or "SPY",
            regime_ma_bars=args.regime_ma,
            strategy=args.strategy,
            sma_fast=args.fast,
            sma_slow=args.slow,
        )
    except ValueError as exc:
        sys.exit(f"측정 설정 오류: {exc}")
    request = {
        "exclude_contaminated": args.exclude_contaminated,
        "limit": args.limit,
        "min_bars": args.min_bars,
        "on_break": args.on_break,
        "verified_splits": args.verified_splits is not None,
    }
    print("측정 요청 " + json.dumps(request, ensure_ascii=False, sort_keys=True))
    print(
        f"계획 대상 {len(symbols)}개 · "
        f"cohort_sha256={cohort_sha256(symbols, timestamp_signature)}"
    )
    try:
        code_sha256 = measurement_code_sha256()
    except ValueError as exc:
        sys.exit(str(exc))
    print(
        f"측정 코드 SHA-256={code_sha256} · "
        f"Python={platform.python_version()} · "
        f"pydantic={importlib.metadata.version('pydantic')} · "
        f"pydantic-settings={importlib.metadata.version('pydantic-settings')}"
    )
    print(
        "고정 시뮬레이션 설정 "
        + json.dumps(simulation_config(settings), ensure_ascii=False, sort_keys=True)
        + "\n"
    )
    strategy = registry.build(args.strategy, settings)
    rows = []
    for symbol in symbols:
        try:
            wanted = [symbol] + ([regime_symbol] if regime_symbol else [])
            history = load_history(wanted, "1d", source, count=0,
                                   on_break=args.on_break,
                                   verified_splits=verified_splits)
            result = Backtester(history, strategy, settings).run()
            metric_values = (
                result.metrics.total_return,
                result.benchmark_metrics.total_return,
                result.metrics.max_drawdown,
                result.benchmark_metrics.max_drawdown,
                result.metrics.sharpe,
                result.benchmark_metrics.sharpe,
            )
            if not all(math.isfinite(value) for value in metric_values):
                raise ValueError("유한하지 않은 측정값이 계산됐습니다")
        except (FileNotFoundError, KeyError, ValueError) as exc:
            skipped.append((symbol, str(exc) or type(exc).__name__))
            continue
        rows.append(
            (
                symbol,
                *metric_values,
                result.metrics.trades,
            )
        )

    if skipped or args.allow_skipped:
        print_skipped(len(rows), skipped)
    if skipped and not args.allow_skipped:
        sys.exit(
            f"{len(skipped)}개 종목에서 오류가 발생했습니다. "
            "검증 후 다시 실행하거나 --allow-skipped로 명시적으로 제외하세요"
        )
    if not rows:
        sys.exit("유효한 결과가 없습니다")
    try:
        measurement_code_sha256()
    except ValueError as exc:
        sys.exit(str(exc))
    completed_symbols = [row[0] for row in rows]
    print(
        f"완료 결과 {len(completed_symbols)}개 · "
        f"cohort_sha256={cohort_sha256(completed_symbols, timestamp_signature)}\n"
    )
    aggregates, ranked = summarize_rows(rows)
    report(rows, args, len(timestamp_signature), aggregates, ranked)
    print('\n실행 종료 {"exit_status": 0}')
    result = {
        "schema_version": SWEEP_RESULT_SCHEMA_VERSION,
        "kind": "tossquant.sweep_result",
        "reported_exit_status": 0,
        "invocation": {
            "argv": list(sys.argv),
            "cwd": str(pathlib.Path.cwd().resolve()),
        },
        "request": request,
        "input": {
            "digest_algorithm": DATASET_DIGEST_ALGORITHM,
            "sha256": input_digest,
            "preparation": preparation_provenance(prep_report),
        },
        "verified_splits": (
            {"sha256": manifest_sha256}
            if manifest_sha256 is not None
            else None
        ),
        "code": {
            "digest_algorithm": MEASUREMENT_CODE_DIGEST_ALGORITHM,
            "sha256": code_sha256,
        },
        "runtime": {
            "python": platform.python_version(),
            "pydantic": importlib.metadata.version("pydantic"),
            "pydantic_settings": importlib.metadata.version(
                "pydantic-settings"
            ),
        },
        "simulation_config": simulation_config(settings),
        "cohort": {
            "selection": COHORT_SELECTION,
            "discovered_symbol_count": discovered,
            "valid_symbol_count": len(histories),
            "timeline_excluded_symbol_count": cohort_excluded,
            "base_symbols": base_symbols,
            "planned_symbols": list(symbols),
            "completed_symbols": completed_symbols,
            "bars": len(timestamp_signature),
            "first_session": timestamp_signature[0].date().isoformat(),
            "last_session": timestamp_signature[-1].date().isoformat(),
            "timestamp_digest_algorithm": TIMESTAMP_DIGEST_ALGORITHM,
            "timestamp_sha256": timestamp_signature_sha256(
                timestamp_signature
            ),
            "cohort_digest_algorithm": COHORT_DIGEST_ALGORITHM,
            "base_sha256": cohort_sha256(base_symbols, timestamp_signature),
            "planned_sha256": cohort_sha256(symbols, timestamp_signature),
            "completed_sha256": cohort_sha256(
                completed_symbols, timestamp_signature
            ),
        },
        "posthoc_exclusion": {
            "symbols": sorted(dropped),
            "uses_future_information": bool(args.exclude_contaminated),
            "unbiased_estimate": not args.exclude_contaminated,
        },
        "aggregates": aggregates,
        "ranked": ranked,
        "skipped": [
            {"symbol": symbol, "reason": reason}
            for symbol, reason in skipped
        ],
    }
    print(SWEEP_RESULT_PREFIX + canonical_json(result))


def report(
    rows: list[tuple],
    args: argparse.Namespace,
    bars: int,
    aggregates: dict[str, object],
    ranked: dict[str, list[dict]],
) -> None:
    total = int(aggregates["completed_symbol_count"])
    wins = int(aggregates["symbols_strategy_return_gt_benchmark"])

    print(
        f"종목 {total}개 × {bars}봉 · 전략 {args.strategy} · "
        f"손절 {args.stop_loss * 100:g}% · "
        f"국면필터 {f'{regime}일선' if (regime := args.regime_ma if args.regime else 0) else '없음'}\n"
    )
    print(f"{'':20} {'전략':>10} {'바이앤홀드':>12}")
    for label, strategy_field, benchmark_field in (
        (
            "총수익률 중앙값",
            "strategy_return_median",
            "benchmark_return_median",
        ),
        (
            "MDD 중앙값",
            "strategy_mdd_median",
            "benchmark_mdd_median",
        ),
    ):
        print(
            f"{label:20} {float(aggregates[strategy_field]) * 100:9.1f}% "
            f"{float(aggregates[benchmark_field]) * 100:11.1f}%"
        )
    print(
        f"{'Sharpe 중앙값':20} "
        f"{float(aggregates['strategy_sharpe_median']):10.2f} "
        f"{float(aggregates['benchmark_sharpe_median']):12.2f}"
    )

    print(f"\n바이앤홀드를 이긴 종목  {wins}/{total} ({wins / total * 100:.1f}%)")
    print(
        "수익이 난 종목          "
        f"{aggregates['positive_strategy_returns']}/{total}"
    )
    print(f"평균 거래 횟수          {float(aggregates['mean_trades']):.1f}")

    for title, subset in (
        ("초과수익 상위 5", ranked["top"]),
        ("초과수익 하위 5", ranked["bottom"]),
    ):
        print(f"\n{title}")
        for item in subset:
            print(
                f"  {item['symbol']:6} "
                f"전략 {float(item['strategy_return']) * 100:+8.1f}%  "
                f"벤치 {float(item['benchmark_return']) * 100:+8.1f}%  "
                f"차이 {float(item['excess_return']) * 100:+9.1f}%p"
            )


if __name__ == "__main__":
    main()
