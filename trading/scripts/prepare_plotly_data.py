#!/usr/bin/env python3
"""핀 고정 Plotly S&P 500 CSV를 종목별 TossQuant CSV로 재현한다.

원본에는 OHLC 일부가 빈 행이 있으므로 그 행을 조용히 보정하지 않는다. 제외한
행과 이유를 preparation-report.json에 남겨 이후 측정의 정확한 입력을 재현한다.
"""

from __future__ import annotations

import argparse
import ctypes
import csv
import errno
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import sys
import tempfile
import urllib.request
from collections import OrderedDict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import tossquant.backtest.data as backtest_data  # noqa: E402
import tossquant.models as candle_models  # noqa: E402
from tossquant.backtest.data import CsvSource, parse_candle_values  # noqa: E402

SOURCE_COMMIT = "0c447c47b757ad74edecab31f0d72f849d2e67c2"
SOURCE_URL = (
    "https://raw.githubusercontent.com/plotly/datasets/"
    f"{SOURCE_COMMIT}/all_stocks_5yr.csv"
)
SOURCE_SHA256 = "6aea253cd19de60b568143991aaf1fa482456565c389205658d236e595e716cf"
SOURCE_INPUT_ROWS = 619_040
# 핀 고정 출처라는 주장은 보고서 안의 무키 자기 해시만으로 증명되지 않는다.
# 현재 생산자/소비자 계약으로 독립 재생성한 외부 신뢰점도 함께 고정한다.
PINNED_SOURCE_SHA256 = SOURCE_SHA256
PINNED_OUTPUT_SHA256 = "63e3d9d0bf1c71c5d5a330506a22db6b46589a6b8b99ecc12d1c498f4bd912ef"
PINNED_DROPPED_ROWS_SHA256 = (
    "9685034f58c8b4969e7de4a72cfe5ef9d9b5cf887731d911895610852cbd7b6c"
)
OUTPUT_FIELDS = ("date", "open", "high", "low", "close", "volume")
REQUIRED_FIELDS = (*OUTPUT_FIELDS, "Name")
MAX_OPEN_FILES = 64
SAFE_SYMBOL = re.compile(r"[A-Z0-9][A-Z0-9._-]*\Z")
PREPARATION_SCHEMA_VERSION = 5
PREPARATION_TOOL_VERSION = "prepare_plotly_data/5"
OUTPUT_DIGEST_ALGORITHM = "sha256-filename-size-content-v1"
TIMESTAMP_DIGEST_ALGORITHM = "sha256-iso-utc-timestamp-newline-v1"
REPORT_DIGEST_ALGORITHM = "sha256-canonical-json-v1"
REPORT_FILENAME = "preparation-report.json"
MAX_REPORT_BYTES = 10 * 1024 * 1024
BACKTEST_DATA_MODULE = "tossquant.backtest.data"
BACKTEST_DATA_PATH = Path(backtest_data.__file__).resolve()
CANDLE_MODEL_MODULE = "tossquant.models"
CANDLE_MODEL_PATH = Path(candle_models.__file__).resolve()
WINDOWS_RESERVED_BASENAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"}
    | {f"COM{number}" for number in range(1, 10)}
    | {f"LPT{number}" for number in range(1, 10)}
)
REPORT_FIELDS = {
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
    "input_rows",
    "written_rows",
    "dropped_rows",
    "symbols",
    "symbol_rows",
    "timestamp_digest_algorithm",
    "symbol_timestamp_sha256",
    "symbol_timestamp_bounds",
    "output_digest_algorithm",
    "output_sha256",
    "report_digest_algorithm",
    "report_sha256",
}


def _snapshot_source(path: Path) -> tuple[Path, str]:
    """한 번 연 파일을 복사하며 해시해, 검증한 바로 그 바이트를 고정한다."""
    digest = hashlib.sha256()
    snapshot_handle = tempfile.NamedTemporaryFile(
        prefix="tossquant-source-snapshot-", suffix=".csv", delete=False
    )
    snapshot = Path(snapshot_handle.name)
    descriptor: int | None = None
    try:
        flags = (
            os.O_RDONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_NONBLOCK", 0)
        )
        descriptor = os.open(path, flags)
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError(f"원본은 일반 파일이어야 합니다: {path}")
        source_handle = os.fdopen(descriptor, "rb")
        descriptor = None
        with source_handle, snapshot_handle:
            for chunk in iter(lambda: source_handle.read(1024 * 1024), b""):
                digest.update(chunk)
                snapshot_handle.write(chunk)
    except Exception:
        snapshot.unlink(missing_ok=True)
        raise
    finally:
        if descriptor is not None:
            os.close(descriptor)
    return snapshot, digest.hexdigest()


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _code_provenance_sha256() -> dict[str, str]:
    """한 작업이 고정해 보고서에 기록할 생산자·소비자 코드 바이트."""
    return {
        "preparation_tool_sha256": _file_sha256(Path(__file__).resolve()),
        "backtest_data_sha256": _file_sha256(BACKTEST_DATA_PATH),
        "candle_model_sha256": _file_sha256(CANDLE_MODEL_PATH),
    }


def _read_regular_file_bytes(
    path: Path,
    *,
    max_bytes: int,
    description: str,
) -> bytes:
    """FIFO·장치에서 block하지 않고 일반 파일 한 세대의 바이트를 읽는다."""
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


def _download() -> Path:
    handle = tempfile.NamedTemporaryFile(
        prefix="tossquant-plotly-", suffix=".csv", delete=False
    )
    path = Path(handle.name)
    try:
        with urllib.request.urlopen(SOURCE_URL, timeout=30) as response, handle:
            shutil.copyfileobj(response, handle)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return path


def _normalize_symbol(raw: str | None, line_number: int) -> str:
    symbol = (raw or "").strip().upper()
    if not SAFE_SYMBOL.fullmatch(symbol) or symbol in {".", ".."}:
        raise ValueError(
            f"원본 {line_number}행의 심볼이 안전한 파일명이 아닙니다: {raw!r}"
        )
    if symbol.split(".", 1)[0] in WINDOWS_RESERVED_BASENAMES:
        raise ValueError(
            f"원본 {line_number}행의 심볼이 Windows 예약 파일명입니다: {raw!r}"
        )
    return symbol


def _output_leaf(path: Path) -> Path:
    """이미 존재하는 부모만 해석하고 최종 경로 요소는 따라가지 않는다."""
    path = Path(path)
    parent = path.parent
    if parent.is_symlink():
        raise ValueError(f"출력 부모 폴더는 심볼릭 링크일 수 없습니다: {parent}")
    try:
        resolved_parent = parent.resolve(strict=True)
    except FileNotFoundError as exc:
        raise ValueError(
            f"출력 부모 폴더를 먼저 만들어야 합니다: {parent}"
        ) from exc
    if not resolved_parent.is_dir():
        raise ValueError(f"출력 부모 경로가 폴더가 아닙니다: {parent}")
    return resolved_parent / path.name


def _require_output_absent(output: Path) -> None:
    """게시 대상은 기존 파일·폴더·깨진 링크를 포함해 존재하면 안 된다."""
    if output.is_symlink():
        raise ValueError(f"출력 경로는 심볼릭 링크일 수 없습니다: {output}")
    if output.exists():
        raise ValueError(
            f"출력 경로가 이미 존재합니다. 새 경로를 사용하세요: {output}"
        )


def _publish_no_replace(source: Path, target: Path) -> None:
    """같은 파일시스템에서 target을 절대 덮어쓰지 않고 원자적으로 게시한다.

    `Path.replace()`와 POSIX `rename()`은 검사 직후 다른 프로세스가 만든 빈 폴더를
    조용히 교체할 수 있다. 운영체제의 no-replace 원자 연산이 없는 플랫폼에서는
    안전한 척하지 않고 실패한다.
    """
    source_bytes = os.fsencode(source)
    target_bytes = os.fsencode(target)
    result: int
    if sys.platform == "darwin":
        libc = ctypes.CDLL(None, use_errno=True)
        renamex = libc.renamex_np
        renamex.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        renamex.restype = ctypes.c_int
        result = renamex(source_bytes, target_bytes, 0x00000004)  # RENAME_EXCL
    elif sys.platform.startswith("linux"):
        libc = ctypes.CDLL(None, use_errno=True)
        renameat2 = getattr(libc, "renameat2", None)
        if renameat2 is None:
            raise OSError(
                errno.ENOTSUP,
                "이 Linux libc에는 원자적 no-replace rename이 없습니다",
                str(target),
            )
        renameat2.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        renameat2.restype = ctypes.c_int
        result = renameat2(-100, source_bytes, -100, target_bytes, 1)
    elif os.name == "nt":
        _publish_windows_no_replace(source, target)
        return
    else:
        raise OSError(
            errno.ENOTSUP,
            "이 플랫폼은 원자적 no-replace rename을 지원하지 않습니다",
            str(target),
        )

    if result == 0:
        return
    error_number = ctypes.get_errno()
    if error_number in {errno.EEXIST, errno.ENOTEMPTY}:
        raise FileExistsError(
            error_number, "출력 경로가 이미 존재합니다", str(target)
        )
    raise OSError(error_number, os.strerror(error_number), str(target))


def _publish_windows_no_replace(
    source: Path,
    target: Path,
    *,
    library_loader=None,
    last_error=None,
) -> None:
    """MoveFileExW를 last-error 캡처가 활성화된 DLL 핸들로 호출한다."""
    if library_loader is None:
        library_loader = ctypes.WinDLL
    if last_error is None:
        last_error = ctypes.get_last_error
    kernel32 = library_loader("kernel32", use_last_error=True)
    move = kernel32.MoveFileExW
    move.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint]
    move.restype = ctypes.c_int
    if move(str(source), str(target), 0):
        return
    winerror = last_error()
    if winerror in {80, 183}:
        raise FileExistsError(winerror, "출력 경로가 이미 존재합니다", str(target))
    raise OSError(winerror, "원자적 출력 게시에 실패했습니다", str(target))


def _prepared_csv_paths(directory: Path) -> list[Path]:
    paths: list[Path] = []
    for path in directory.iterdir():
        if path.name == REPORT_FILENAME:
            continue
        if path.is_symlink() or not path.is_file() or path.suffix != ".csv":
            raise ValueError(f"준비 결과에 예상하지 않은 항목이 있습니다: {path}")
        paths.append(path)
    return sorted(paths, key=lambda path: path.name)


def _aggregate_output_sha256(directory: Path) -> str:
    """CSV 파일명·크기·내용을 순서 독립적인 단일 SHA-256으로 묶는다."""
    paths = _prepared_csv_paths(directory)
    aggregate = hashlib.sha256()
    aggregate.update(OUTPUT_DIGEST_ALGORITHM.encode("ascii") + b"\0")
    aggregate.update(len(paths).to_bytes(8, "big"))
    for path in paths:
        name = path.name.encode("utf-8")
        content = hashlib.sha256()
        size = 0
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                size += len(chunk)
                content.update(chunk)
        aggregate.update(len(name).to_bytes(4, "big"))
        aggregate.update(name)
        aggregate.update(size.to_bytes(8, "big"))
        aggregate.update(content.digest())
    return aggregate.hexdigest()


def _report_payload_sha256(report: dict) -> str:
    """자기 해시 필드를 제외한 보고서를 결정적 JSON으로 해시한다."""
    payload = {key: value for key, value in report.items() if key != "report_sha256"}
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _canonical_json_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _reject_duplicate_json_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"중복 JSON 키: {key}")
        result[key] = value
    return result


def _is_sha256(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def _plain_nonnegative_int(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"준비 보고서의 {field} 값이 잘못됐습니다")
    return value


def _actual_symbol_rows(directory: Path) -> dict[str, int]:
    """현재 CSV를 소비자 파서로 읽어 실제 심볼별 행 수를 계산한다."""
    result: dict[str, int] = {}
    source = CsvSource(directory)
    for path in _prepared_csv_paths(directory):
        symbol = path.stem
        if path.name != f"{symbol}.csv" or not SAFE_SYMBOL.fullmatch(symbol):
            raise ValueError(f"준비 결과 CSV 파일명이 잘못됐습니다: {path.name}")
        candles = source.fetch(symbol, "1d", 0)
        if not candles:
            raise ValueError(f"준비 결과 CSV가 비어 있습니다: {path.name}")
        result[symbol] = len(candles)
    if not result:
        raise ValueError("준비 결과에 종목 CSV가 없습니다")
    return result


def _timestamp_sha256(candles: list) -> str:
    digest = hashlib.sha256()
    for candle in candles:
        digest.update(candle.ts.isoformat().encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def _timestamp_bounds(candles: list) -> dict[str, str]:
    return {
        "first": candles[0].ts.isoformat(),
        "last": candles[-1].ts.isoformat(),
    }


def _actual_symbol_timestamp_evidence(
    directory: Path,
) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    """소비자 파서가 본 각 심볼의 UTC timestamp 열 해시와 경계를 고정한다."""
    digests: dict[str, str] = {}
    bounds: dict[str, dict[str, str]] = {}
    source = CsvSource(directory)
    for path in _prepared_csv_paths(directory):
        symbol = path.stem
        if path.name != f"{symbol}.csv" or not SAFE_SYMBOL.fullmatch(symbol):
            raise ValueError(f"준비 결과 CSV 파일명이 잘못됐습니다: {path.name}")
        candles = source.fetch(symbol, "1d", 0)
        if not candles:
            raise ValueError(f"준비 결과 CSV가 비어 있습니다: {path.name}")
        digests[symbol] = _timestamp_sha256(candles)
        bounds[symbol] = _timestamp_bounds(candles)
    if not digests:
        raise ValueError("준비 결과에 종목 CSV가 없습니다")
    return digests, bounds


def _validate_dropped_rows(value: object, input_rows: int) -> list[dict]:
    if not isinstance(value, list):
        raise ValueError("준비 보고서의 dropped_rows 형식이 잘못됐습니다")
    seen_lines: set[int] = set()
    allowed_base = {"line", "symbol", "date"}
    for entry in value:
        if not isinstance(entry, dict):
            raise ValueError("준비 보고서의 dropped_rows 항목이 잘못됐습니다")
        reason_keys = {"missing", "invalid"}.intersection(entry)
        if len(reason_keys) != 1 or set(entry) != allowed_base | reason_keys:
            raise ValueError("준비 보고서의 dropped_rows 근거가 잘못됐습니다")
        line = _plain_nonnegative_int(entry.get("line"), "dropped_rows.line")
        if line < 2 or line > input_rows + 1 or line in seen_lines:
            raise ValueError("준비 보고서의 dropped_rows 행 번호가 잘못됐습니다")
        seen_lines.add(line)
        symbol = entry.get("symbol")
        if not isinstance(symbol, str) or not SAFE_SYMBOL.fullmatch(symbol):
            raise ValueError("준비 보고서의 dropped_rows 심볼이 잘못됐습니다")
        if not isinstance(entry.get("date"), str):
            raise ValueError("준비 보고서의 dropped_rows 날짜가 잘못됐습니다")
        if "missing" in entry:
            missing = entry["missing"]
            if (
                not isinstance(missing, list)
                or not missing
                or any(not isinstance(field, str) for field in missing)
                or len(missing) != len(set(missing))
                or any(field not in REQUIRED_FIELDS for field in missing)
            ):
                raise ValueError("준비 보고서의 dropped_rows 누락 근거가 잘못됐습니다")
        else:
            invalid = entry["invalid"]
            if not isinstance(invalid, str) or not invalid:
                raise ValueError("준비 보고서의 dropped_rows 오류 근거가 잘못됐습니다")
    return value


def _validate_source_provenance(report: dict, input_rows: int) -> None:
    source_kind = report.get("source_kind")
    source_sha256 = report.get("source_sha256")
    if not _is_sha256(source_sha256):
        raise ValueError("준비 보고서의 원본 SHA-256이 잘못됐습니다")
    if source_kind == "plotly_pinned":
        expected = {
            "source_url": SOURCE_URL,
            "source_commit": SOURCE_COMMIT,
            "source_path": None,
            "source_sha256": SOURCE_SHA256,
        }
        for field, value in expected.items():
            if report.get(field) != value:
                raise ValueError(f"핀 고정 원본의 {field} 값이 일치하지 않습니다")
        if input_rows != SOURCE_INPUT_ROWS:
            raise ValueError(
                "핀 고정 원본의 input_rows 값이 일치하지 않습니다: "
                f"expected={SOURCE_INPUT_ROWS} actual={input_rows}"
            )
        return
    if source_kind != "local_unpinned":
        raise ValueError("준비 보고서의 source_kind 값이 잘못됐습니다")
    if report.get("source_url") is not None or report.get("source_commit") is not None:
        raise ValueError("로컬 원본이 Plotly 출처를 주장할 수 없습니다")
    source_path = report.get("source_path")
    if not isinstance(source_path, str) or not Path(source_path).is_absolute():
        raise ValueError("로컬 원본의 source_path 값이 잘못됐습니다")


def verify_prepared_output(output: Path) -> dict:
    """보고서의 바이트·행수·출처·도구 증명이 현재 결과와 맞는지 확인한다."""
    code_provenance = _code_provenance_sha256()
    output = _output_leaf(Path(output))
    if output.is_symlink():
        raise ValueError(f"준비 결과 경로는 심볼릭 링크일 수 없습니다: {output}")
    if not output.is_dir():
        raise ValueError(f"준비 결과 폴더가 없습니다: {output}")
    report_path = output / REPORT_FILENAME
    if report_path.is_symlink():
        raise ValueError(f"준비 보고서는 심볼릭 링크일 수 없습니다: {report_path}")
    report_bytes = _read_regular_file_bytes(
        report_path,
        max_bytes=MAX_REPORT_BYTES,
        description="준비 보고서",
    )
    try:
        report = json.loads(
            report_bytes,
            object_pairs_hook=_reject_duplicate_json_keys,
        )
    except json.JSONDecodeError as exc:
        raise ValueError(f"준비 보고서를 읽을 수 없습니다: {report_path}") from exc
    except ValueError as exc:
        raise ValueError(f"준비 보고서의 {exc}") from exc
    if not isinstance(report, dict):
        raise ValueError(f"준비 보고서 형식이 잘못됐습니다: {report_path}")
    if set(report) != REPORT_FIELDS:
        raise ValueError("준비 보고서의 필드 집합이 현재 스키마와 다릅니다")
    if report.get("preparation_schema_version") != PREPARATION_SCHEMA_VERSION:
        raise ValueError("지원하지 않는 준비 보고서 스키마입니다")
    if report.get("output_digest_algorithm") != OUTPUT_DIGEST_ALGORITHM:
        raise ValueError("지원하지 않는 출력 무결성 알고리즘입니다")
    if report.get("report_digest_algorithm") != REPORT_DIGEST_ALGORITHM:
        raise ValueError("지원하지 않는 보고서 무결성 알고리즘입니다")
    expected_report_sha256 = report.get("report_sha256")
    try:
        actual_report_sha256 = _report_payload_sha256(report)
    except (TypeError, ValueError) as exc:
        raise ValueError("준비 보고서를 결정적으로 해시할 수 없습니다") from exc
    if (
        not _is_sha256(expected_report_sha256)
        or expected_report_sha256 != actual_report_sha256
    ):
        raise ValueError(
            "보고서 무결성 불일치: "
            f"expected={expected_report_sha256!r} actual={actual_report_sha256}"
        )

    if report.get("preparation_tool_version") != PREPARATION_TOOL_VERSION:
        raise ValueError("준비 도구 버전이 현재 검증기와 일치하지 않습니다")
    actual_tool_sha256 = code_provenance["preparation_tool_sha256"]
    if report.get("preparation_tool_sha256") != actual_tool_sha256:
        raise ValueError("준비 도구 SHA-256이 현재 검증기와 일치하지 않습니다")
    if report.get("backtest_data_module") != BACKTEST_DATA_MODULE:
        raise ValueError("CSV 소비자 모듈 출처가 일치하지 않습니다")
    actual_data_sha256 = code_provenance["backtest_data_sha256"]
    if report.get("backtest_data_sha256") != actual_data_sha256:
        raise ValueError("CSV 소비자 SHA-256이 현재 모듈과 일치하지 않습니다")
    if report.get("candle_model_module") != CANDLE_MODEL_MODULE:
        raise ValueError("캔들 모델 모듈 출처가 일치하지 않습니다")
    actual_model_sha256 = code_provenance["candle_model_sha256"]
    if report.get("candle_model_sha256") != actual_model_sha256:
        raise ValueError("캔들 모델 SHA-256이 현재 모듈과 일치하지 않습니다")
    if report.get("python_version") != platform.python_version():
        raise ValueError("Python 버전이 현재 검증기와 일치하지 않습니다")

    expected = report.get("output_sha256")
    actual = _aggregate_output_sha256(output)
    if not _is_sha256(expected) or actual != expected:
        raise ValueError(
            f"출력 무결성 불일치: expected={expected!r} actual={actual}"
        )

    actual_symbol_rows = _actual_symbol_rows(output)
    actual_symbols = len(actual_symbol_rows)
    actual_written_rows = sum(actual_symbol_rows.values())
    reported_symbol_rows = report.get("symbol_rows")
    if not isinstance(reported_symbol_rows, dict) or any(
        not isinstance(symbol, str)
        or not SAFE_SYMBOL.fullmatch(symbol)
        or isinstance(rows, bool)
        or not isinstance(rows, int)
        or rows <= 0
        for symbol, rows in reported_symbol_rows.items()
    ):
        raise ValueError("보고서의 symbol_rows 형식이 잘못됐습니다")
    if reported_symbol_rows != actual_symbol_rows:
        raise ValueError(
            "보고서와 CSV의 symbol_rows 행 수가 다릅니다: "
            f"expected={reported_symbol_rows!r} actual={actual_symbol_rows!r}"
        )
    if report.get("timestamp_digest_algorithm") != TIMESTAMP_DIGEST_ALGORITHM:
        raise ValueError("지원하지 않는 timestamp 무결성 알고리즘입니다")
    reported_timestamp_sha256 = report.get("symbol_timestamp_sha256")
    if not isinstance(reported_timestamp_sha256, dict) or any(
        not isinstance(symbol, str)
        or not SAFE_SYMBOL.fullmatch(symbol)
        or not _is_sha256(digest)
        for symbol, digest in reported_timestamp_sha256.items()
    ):
        raise ValueError("보고서의 symbol_timestamp_sha256 형식이 잘못됐습니다")
    actual_timestamp_sha256, actual_timestamp_bounds = (
        _actual_symbol_timestamp_evidence(output)
    )
    if reported_timestamp_sha256 != actual_timestamp_sha256:
        raise ValueError(
            "보고서와 CSV의 timestamp 열 SHA-256이 다릅니다: "
            f"expected={reported_timestamp_sha256!r} "
            f"actual={actual_timestamp_sha256!r}"
        )
    reported_timestamp_bounds = report.get("symbol_timestamp_bounds")
    if not isinstance(reported_timestamp_bounds, dict) or any(
        not isinstance(symbol, str)
        or not SAFE_SYMBOL.fullmatch(symbol)
        or not isinstance(bounds, dict)
        or set(bounds) != {"first", "last"}
        or not all(isinstance(value, str) for value in bounds.values())
        for symbol, bounds in reported_timestamp_bounds.items()
    ):
        raise ValueError("보고서의 symbol_timestamp_bounds 형식이 잘못됐습니다")
    if reported_timestamp_bounds != actual_timestamp_bounds:
        raise ValueError(
            "보고서와 CSV의 timestamp 경계가 다릅니다: "
            f"expected={reported_timestamp_bounds!r} "
            f"actual={actual_timestamp_bounds!r}"
        )
    reported_symbols = _plain_nonnegative_int(report.get("symbols"), "symbols")
    if reported_symbols != actual_symbols:
        raise ValueError(
            "보고서와 CSV의 symbols 수가 다릅니다: "
            f"expected={reported_symbols!r} actual={actual_symbols}"
        )
    reported_written_rows = _plain_nonnegative_int(
        report.get("written_rows"), "written_rows"
    )
    if reported_written_rows != actual_written_rows:
        raise ValueError(
            "보고서와 CSV의 written_rows 행 수가 다릅니다: "
            f"expected={reported_written_rows!r} actual={actual_written_rows}"
        )
    input_rows = _plain_nonnegative_int(report.get("input_rows"), "input_rows")
    dropped_rows = _validate_dropped_rows(report.get("dropped_rows"), input_rows)
    if input_rows != actual_written_rows + len(dropped_rows):
        raise ValueError(
            "보고서의 input_rows가 written_rows + dropped_rows와 다릅니다"
        )
    _validate_source_provenance(report, input_rows)
    if (
        report.get("source_kind") == "plotly_pinned"
        and report.get("source_sha256") == PINNED_SOURCE_SHA256
    ):
        if expected != PINNED_OUTPUT_SHA256:
            raise ValueError(
                "핀 고정 Plotly 출력 SHA-256이 외부 신뢰점과 일치하지 않습니다"
            )
        if _canonical_json_sha256(dropped_rows) != PINNED_DROPPED_ROWS_SHA256:
            raise ValueError(
                "핀 고정 Plotly 제외 행 감사 기록이 외부 신뢰점과 일치하지 않습니다"
            )

    # 해시와 의미 검사가 서로 다른 파일 세대를 읽지 않았는지 마지막에 재확인한다.
    final_actual = _aggregate_output_sha256(output)
    final_report_bytes = _read_regular_file_bytes(
        report_path,
        max_bytes=MAX_REPORT_BYTES,
        description="준비 보고서",
    )
    if final_actual != actual or final_report_bytes != report_bytes:
        raise ValueError("준비 결과가 검증 중 변경됐습니다")
    if _code_provenance_sha256() != code_provenance:
        raise ValueError("준비 도구 또는 소비자 코드가 검증 중 변경됐습니다")
    return report


def prepare(source: Path, output: Path, *, expected_sha256: str | None) -> dict:
    """원본을 검증·분할해 아직 존재하지 않는 output에 게시한다."""
    code_provenance = _code_provenance_sha256()
    output = _output_leaf(output)
    _require_output_absent(output)
    source = source.resolve()
    snapshot, actual_sha256 = _snapshot_source(source)
    staging: Path | None = None
    try:
        if expected_sha256 is not None and actual_sha256 != expected_sha256:
            raise ValueError(
                f"원본 SHA-256 불일치: expected={expected_sha256} "
                f"actual={actual_sha256}"
            )
        staging = Path(
            tempfile.mkdtemp(
                prefix=f".{output.name}.staging-", dir=str(output.parent)
            )
        )

        writers: OrderedDict[str, tuple[object, csv.DictWriter]] = OrderedDict()
        initialized: set[str] = set()
        symbol_rows: dict[str, int] = {}
        seen_timestamps: dict[str, set] = {}
        dropped: list[dict[str, object]] = []
        input_rows = 0
        written_rows = 0
        source_label = (
            "all_stocks_5yr.csv"
            if expected_sha256 == SOURCE_SHA256
            else source.name
        )

        def writer_for(symbol: str) -> csv.DictWriter:
            if symbol in writers:
                handle, writer = writers.pop(symbol)
                writers[symbol] = (handle, writer)
                return writer
            if len(writers) >= MAX_OPEN_FILES:
                old_handle, _ = writers.popitem(last=False)[1]
                old_handle.close()
            path = staging / f"{symbol}.csv"
            handle = path.open("a", newline="", encoding="utf-8")
            writer = csv.DictWriter(handle, fieldnames=OUTPUT_FIELDS)
            if symbol not in initialized:
                writer.writeheader()
                initialized.add(symbol)
            writers[symbol] = (handle, writer)
            return writer

        try:
            with snapshot.open(newline="", encoding="utf-8-sig") as handle:
                reader = csv.DictReader(handle, strict=True)
                headers = tuple(reader.fieldnames or ())
                seen_headers: set[str] = set()
                duplicate_headers: set[str] = set()
                for header in headers:
                    if header in seen_headers:
                        duplicate_headers.add(header)
                    seen_headers.add(header)
                if duplicate_headers:
                    raise ValueError(
                        "원본 컬럼 중복: " + ", ".join(sorted(duplicate_headers))
                    )
                missing_headers = set(REQUIRED_FIELDS) - set(headers)
                unexpected_headers = set(headers) - set(REQUIRED_FIELDS)
                if missing_headers or unexpected_headers:
                    details: list[str] = []
                    if missing_headers:
                        details.append("누락=" + ",".join(sorted(missing_headers)))
                    if unexpected_headers:
                        details.append("예상 외=" + ",".join(sorted(unexpected_headers)))
                    raise ValueError("원본 컬럼 집합 불일치: " + " · ".join(details))
                for line_number, row in enumerate(reader, start=2):
                    input_rows += 1
                    if None in row:
                        raise ValueError(
                            f"원본 {line_number}행은 헤더보다 값이 더 많습니다"
                        )
                    symbol = _normalize_symbol(row.get("Name"), line_number)
                    missing_values = [
                        field
                        for field in REQUIRED_FIELDS
                        if not (row.get(field) or "").strip()
                    ]
                    if missing_values:
                        dropped.append(
                            {
                                "line": line_number,
                                "symbol": symbol,
                                "date": row.get("date", ""),
                                "missing": missing_values,
                            }
                        )
                        continue
                    values = {
                        "ts": row["date"].strip(),
                        **{
                            field: row[field].strip()
                            for field in ("open", "high", "low", "close", "volume")
                        },
                    }
                    try:
                        candle = parse_candle_values(
                            symbol,
                            values,
                            context=f"{source_label}:{line_number}",
                        )
                    except ValueError as exc:
                        dropped.append(
                            {
                                "line": line_number,
                                "symbol": symbol,
                                "date": row.get("date", ""),
                                "invalid": str(exc),
                            }
                        )
                        continue
                    symbol_seen = seen_timestamps.setdefault(symbol, set())
                    if candle.ts in symbol_seen:
                        dropped.append(
                            {
                                "line": line_number,
                                "symbol": symbol,
                                "date": row.get("date", ""),
                                "invalid": (
                                    "중복 timestamp " + candle.ts.isoformat()
                                ),
                            }
                        )
                        continue
                    symbol_seen.add(candle.ts)
                    writer_for(symbol).writerow(
                        {field: row[field] for field in OUTPUT_FIELDS}
                    )
                    symbol_rows[symbol] = symbol_rows.get(symbol, 0) + 1
                    written_rows += 1
        except csv.Error as exc:
            raise ValueError(f"원본 CSV 파싱 실패: {exc}") from exc
        finally:
            for writer_handle, _ in writers.values():
                writer_handle.close()

        if not symbol_rows:
            audit_parts: list[str] = []
            for entry in dropped[:5]:
                if "missing" in entry:
                    reason = "missing=" + ",".join(entry["missing"])
                else:
                    reason = "invalid=" + str(entry["invalid"])
                audit_parts.append(
                    f"line={entry['line']} symbol={entry['symbol']} {reason}"
                )
            audit = "; ".join(audit_parts) if audit_parts else "no input rows"
            raise ValueError(
                "사용 가능한 행이 없어 종목 CSV를 만들지 못했습니다 "
                f"(input_rows={input_rows}, dropped_rows={len(dropped)}): {audit}"
            )

        # 생산자가 쓴 모든 파일을 실제 소비자와 같은 파서로 다시 읽는다. 비어 있지
        # 않다는 사실만으로 숫자·날짜·OHLC 의미가 유효하다고 간주하지 않는다.
        validator = CsvSource(staging)
        symbol_timestamp_sha256: dict[str, str] = {}
        symbol_timestamp_bounds: dict[str, dict[str, str]] = {}
        for symbol, expected_rows in sorted(symbol_rows.items()):
            parsed = validator.fetch(symbol, "1d", 0)
            if len(parsed) != expected_rows:
                raise ValueError(
                    f"{symbol}: 기록 {expected_rows}행과 재검증 {len(parsed)}행이 다릅니다"
                )
            symbol_timestamp_sha256[symbol] = _timestamp_sha256(parsed)
            symbol_timestamp_bounds[symbol] = _timestamp_bounds(parsed)

        pinned_plotly = (
            expected_sha256 == SOURCE_SHA256 and actual_sha256 == SOURCE_SHA256
        )
        output_sha256 = _aggregate_output_sha256(staging)
        if pinned_plotly and actual_sha256 == PINNED_SOURCE_SHA256:
            if output_sha256 != PINNED_OUTPUT_SHA256:
                raise ValueError(
                    "핀 고정 Plotly 출력이 기준 SHA-256과 다릅니다: "
                    f"expected={PINNED_OUTPUT_SHA256} actual={output_sha256}"
                )
            dropped_sha256 = _canonical_json_sha256(dropped)
            if dropped_sha256 != PINNED_DROPPED_ROWS_SHA256:
                raise ValueError(
                    "핀 고정 Plotly 제외 행 감사 기록이 기준과 다릅니다: "
                    f"expected={PINNED_DROPPED_ROWS_SHA256} actual={dropped_sha256}"
                )
        report = {
            "preparation_schema_version": PREPARATION_SCHEMA_VERSION,
            "preparation_tool_version": PREPARATION_TOOL_VERSION,
            "preparation_tool_sha256": code_provenance[
                "preparation_tool_sha256"
            ],
            "backtest_data_module": BACKTEST_DATA_MODULE,
            "backtest_data_sha256": code_provenance["backtest_data_sha256"],
            "candle_model_module": CANDLE_MODEL_MODULE,
            "candle_model_sha256": code_provenance["candle_model_sha256"],
            "python_version": platform.python_version(),
            "source_kind": "plotly_pinned" if pinned_plotly else "local_unpinned",
            "source_url": SOURCE_URL if pinned_plotly else None,
            "source_commit": SOURCE_COMMIT if pinned_plotly else None,
            "source_path": None if pinned_plotly else str(source),
            "source_sha256": actual_sha256,
            "input_rows": input_rows,
            "written_rows": written_rows,
            "dropped_rows": dropped,
            "symbols": len(symbol_rows),
            "symbol_rows": dict(sorted(symbol_rows.items())),
            "timestamp_digest_algorithm": TIMESTAMP_DIGEST_ALGORITHM,
            "symbol_timestamp_sha256": symbol_timestamp_sha256,
            "symbol_timestamp_bounds": symbol_timestamp_bounds,
            "output_digest_algorithm": OUTPUT_DIGEST_ALGORITHM,
            "output_sha256": output_sha256,
            "report_digest_algorithm": REPORT_DIGEST_ALGORITHM,
        }
        report["report_sha256"] = _report_payload_sha256(report)
        report_bytes = (
            json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        ).encode("utf-8")
        if len(report_bytes) > MAX_REPORT_BYTES:
            raise ValueError(
                f"준비 보고서가 {MAX_REPORT_BYTES}바이트 제한을 넘습니다: "
                f"actual={len(report_bytes)}"
            )
        (staging / REPORT_FILENAME).write_bytes(report_bytes)

        # 검증 중 다른 프로세스가 같은 경로를 차지했으면 그 경로를 건드리지 않는다.
        if _code_provenance_sha256() != code_provenance:
            raise ValueError("준비 도구 또는 소비자 코드가 준비 중 변경됐습니다")
        _require_output_absent(output)
        _publish_no_replace(staging, output)
        staging = None
        return report
    finally:
        snapshot.unlink(missing_ok=True)
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "output", type=Path, help="종목별 CSV를 게시할, 아직 존재하지 않는 경로"
    )
    parser.add_argument("--source", type=Path, help="이미 받은 원본 CSV")
    parser.add_argument(
        "--allow-unpinned-source",
        action="store_true",
        help="로컬 원본의 SHA-256이 핀과 달라도 허용",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="기존 준비 결과와 preparation-report.json의 무결성만 확인",
    )
    args = parser.parse_args()
    if args.allow_unpinned_source and args.source is None:
        parser.error("--allow-unpinned-source는 --source와 함께 사용해야 합니다")
    if args.verify_only and (args.source is not None or args.allow_unpinned_source):
        parser.error("--verify-only에는 --source/--allow-unpinned-source를 쓸 수 없습니다")
    return args


def main() -> None:
    args = parse_args()
    if args.verify_only:
        report = verify_prepared_output(args.output)
        print(
            f"verified {report['symbols']} symbols · {report['written_rows']} rows · "
            f"output_sha256={report['output_sha256']}"
        )
        return
    # 잘못된 출력 경로 때문에 불필요한 네트워크 다운로드를 하지 않는다. prepare도
    # 직접 호출자와 경합을 위해 같은 검사를 다시 수행한다.
    _require_output_absent(_output_leaf(args.output))
    downloaded = args.source is None
    source = _download() if downloaded else args.source
    try:
        report = prepare(
            source,
            args.output,
            expected_sha256=None if args.allow_unpinned_source else SOURCE_SHA256,
        )
    finally:
        if downloaded:
            source.unlink(missing_ok=True)
    print(
        f"{report['symbols']} symbols · {report['written_rows']} rows · "
        f"{len(report['dropped_rows'])} dropped · sha256={report['source_sha256']}"
    )


if __name__ == "__main__":
    main()
