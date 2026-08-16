#!/usr/bin/env python3
"""Plotly 측정 로그, 구조화 증거, README 수치 블록을 한 계약으로 만든다.

측정값을 CLI 인자로 받지 않는다. scan/sweep가 마지막 줄에 출력한 canonical JSON
레코드만 구조화 수치의 원본으로 삼고, 사람이 읽는 출력은 그 레코드와 다시 대조한다.
`--check`는 추적 로그에서 같은 구조화 파일과 README 블록을 재구성해 차이를 찾는다.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
import pathlib
import platform
import re
import stat
import subprocess
import sys
import tempfile
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from zoneinfo import reset_tzpath


PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = PROJECT_ROOT.parent
SCRIPT_PATH = pathlib.Path(__file__).resolve()
SWEEP_SCRIPT = PROJECT_ROOT / "scripts" / "sweep.py"
PREPARE_SCRIPT = PROJECT_ROOT / "scripts" / "prepare_plotly_data.py"
README_DEFAULT = PROJECT_ROOT / "README.md"
RESULT_SCHEMA_VERSION = 1
MEASUREMENT_SCHEMA_VERSION = 6
README_DATA_SCHEMA_VERSION = 2
PRODUCER_VERSION = "build_plotly_evidence/3"
EVIDENCE_PYTHON_VERSION = "3.12.13"
SWEEP_RESULT_PREFIX = "sweep_result="
SCAN_RESULT_PREFIX = "scan_result="
COHORT_SELECTION = (
    "maximum validated row count, then largest identical UTC-midnight "
    "timestamp sequence"
)
COHORT_DIGEST_ALGORITHM = "sha256-symbols-timestamp-range-v3"
TIMESTAMP_DIGEST_ALGORITHM = "sha256-iso-utc-timestamp-newline-v1"
CANONICAL_JSON_DIGEST_ALGORITHM = "sha256-canonical-json-v1"
MEASUREMENT_CODE_DIGEST_ALGORITHM = "sha256-relative-path-content-v1"
PACKAGE_CODE_DIGEST_ALGORITHM = "sha256-package-relative-path-content-v1"
PATH_TOKENS = {
    "$CLI": "scan-data module entrypoint inside $PROJECT",
    "$DISCK_DIR": "single-symbol input derived from $PREPARED_DIR/DISCK.csv",
    "$ISOLATED_BOOTSTRAP": "fixed launcher that imports the reviewed source tree",
    "$MANIFEST": "verified split manifest bound by SHA-256",
    "$PREPARED_DIR": "prepared CSV input bound by dataset SHA-256",
    "$PROJECT": "trading project root inside $REPO",
    "$PYTHON": "exact measurement interpreter bound by runtime provenance",
    "$PYTHON_DIR": "directory containing the isolated measurement interpreter",
    "$REPO": "repository root; actual machine path intentionally omitted",
    "$SOURCE": "local preparation source path; absent for pinned input",
    "$SWEEP": "sweep producer entrypoint inside $PROJECT",
    "$SYSTEMROOT": "Windows system root required to start the interpreter",
    "$TEMP": "private temporary directory for one measurement command",
}
FIXED_COMMAND_ENVIRONMENT = {
    "COLUMNS": "80",
    "LC_ALL": "C.UTF-8",
    "NO_COLOR": "1",
    "PATH": "$PYTHON_DIR",
    "PYTHONTZPATH": "",
    "TEMP": "$TEMP",
    "TMP": "$TEMP",
    "TMPDIR": "$TEMP",
    "TZ": "UTC",
}
WINDOWS_COMMAND_ENVIRONMENT = {
    "PATHEXT": ".COM;.EXE;.BAT;.CMD",
    "SystemRoot": "$SYSTEMROOT",
}
ISOLATED_PYTHON_FLAGS = ["-I", "-u", "-X", "utf8"]
ISOLATED_MODULE_BOOTSTRAP = (
    "import runpy,sys;"
    "source_root=sys.argv.pop(1);"
    "module_name=sys.argv.pop(1);"
    "entrypoint=sys.argv.pop(1);"
    "sys.path.insert(0,source_root);"
    "sys.argv[0]=entrypoint;"
    "runpy.run_module(module_name,run_name='__main__')"
)
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_REPORT_BYTES = 10 * 1024 * 1024
MAX_README_BYTES = 10 * 1024 * 1024
MAX_LOCK_BYTES = 1024 * 1024
MAX_SINGLE_CSV_BYTES = 100 * 1024 * 1024
EXECUTION_TIMESTAMP_PATTERN = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T"
    r"[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\Z"
)
README_MARKERS = {
    "scan": "PLOTLY SCAN",
    "sensitivity": "PLOTLY SENSITIVITY",
    "strategies": "PLOTLY STRATEGIES",
    "ranked": "PLOTLY RANKED",
}


class EvidenceBuildError(ValueError):
    pass


@dataclass(frozen=True)
class RegularFileSnapshot:
    content: bytes
    device: int
    inode: int
    size: int


@dataclass(frozen=True)
class DirectorySnapshot:
    device: int
    inode: int


def reject_duplicate_json_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise EvidenceBuildError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def reject_nonfinite_json_constant(value: str):
    raise EvidenceBuildError(f"non-finite JSON number: {value}")


def strict_json_loads(text: str):
    return json.loads(
        text,
        object_pairs_hook=reject_duplicate_json_keys,
        parse_constant=reject_nonfinite_json_constant,
    )


def canonical_json_bytes(value: object, *, pretty: bool = False) -> bytes:
    if pretty:
        text = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
            allow_nan=False,
        )
    else:
        text = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    return (text + "\n").encode("utf-8")


def canonical_json_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def validate_effective_date(value: object) -> str:
    """Validate the user-declared canonical analysis date, not execution time."""
    if not isinstance(value, str) or not re.fullmatch(
        r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value
    ):
        raise EvidenceBuildError("effective_date는 YYYY-MM-DD여야 합니다")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise EvidenceBuildError("effective_date는 유효한 날짜여야 합니다") from exc
    if parsed.isoformat() != value:
        raise EvidenceBuildError("effective_date는 canonical YYYY-MM-DD여야 합니다")
    return value


def utc_execution_started_at() -> str:
    """Return an unforgeable-by-CLI UTC receipt for this measurement run."""
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace(
        "+00:00", "Z"
    )


def validate_execution_started_at(value: object) -> str:
    if not isinstance(value, str) or not EXECUTION_TIMESTAMP_PATTERN.fullmatch(value):
        raise EvidenceBuildError(
            "execution_started_at_utc는 microsecond 정밀도의 UTC timestamp여야 합니다"
        )
    try:
        parsed = datetime.fromisoformat(value.removesuffix("Z") + "+00:00")
    except ValueError as exc:
        raise EvidenceBuildError(
            "execution_started_at_utc timestamp가 잘못됐습니다"
        ) from exc
    if parsed.tzinfo != timezone.utc:
        raise EvidenceBuildError("execution_started_at_utc는 UTC여야 합니다")
    return value


def tracked_execution_contract(content: bytes, artifact_version: str) -> tuple[str, str]:
    """Read the immutable date contract used to rederive a tracked bundle."""
    try:
        measurement = strict_json_loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, EvidenceBuildError) as exc:
        raise EvidenceBuildError("추적 measurement JSON을 읽을 수 없습니다") from exc
    if not isinstance(measurement, dict):
        raise EvidenceBuildError("추적 measurement JSON 형식이 잘못됐습니다")
    if measurement.get("measurement_schema_version") != MEASUREMENT_SCHEMA_VERSION:
        raise EvidenceBuildError("추적 measurement schema가 현재 생산자와 다릅니다")
    if measurement.get("artifact_version") != artifact_version:
        raise EvidenceBuildError("추적 measurement artifact_version이 다릅니다")
    if "measured_on" in measurement:
        raise EvidenceBuildError("모호한 measured_on 필드는 지원하지 않습니다")
    return (
        validate_effective_date(measurement.get("effective_date")),
        validate_execution_started_at(measurement.get("execution_started_at_utc")),
    )


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sha256_file(path: pathlib.Path) -> str:
    return sha256_bytes(path.read_bytes())


def current_measurement_code() -> dict[str, str]:
    """Recompute the exact source aggregate reported by scripts/sweep.py."""
    paths = [
        SWEEP_SCRIPT,
        PREPARE_SCRIPT,
        PROJECT_ROOT / "pyproject.toml",
    ]
    paths.extend(sorted((PROJECT_ROOT / "src" / "tossquant").rglob("*.py")))
    aggregate = hashlib.sha256()
    aggregate.update(MEASUREMENT_CODE_DIGEST_ALGORITHM.encode("ascii") + b"\0")
    for path in paths:
        relative = path.relative_to(PROJECT_ROOT).as_posix().encode("utf-8")
        aggregate.update(len(relative).to_bytes(4, "big"))
        aggregate.update(relative)
        aggregate.update(bytes.fromhex(sha256_file(path)))
    return {
        "digest_algorithm": MEASUREMENT_CODE_DIGEST_ALGORITHM,
        "sha256": aggregate.hexdigest(),
    }


def current_scan_code() -> dict[str, str]:
    """Recompute the exact package aggregate reported by scan-data."""
    package_root = PROJECT_ROOT / "src" / "tossquant"
    paths = sorted(package_root.rglob("*.py"))
    aggregate = hashlib.sha256()
    aggregate.update(PACKAGE_CODE_DIGEST_ALGORITHM.encode("ascii") + b"\0")
    aggregate.update(len(paths).to_bytes(8, "big"))
    for path in paths:
        relative = path.relative_to(package_root).as_posix().encode("utf-8")
        aggregate.update(len(relative).to_bytes(4, "big"))
        aggregate.update(relative)
        aggregate.update(bytes.fromhex(sha256_file(path)))
    return {
        "digest_algorithm": PACKAGE_CODE_DIGEST_ALGORITHM,
        "sha256": aggregate.hexdigest(),
    }


def current_code_provenance() -> dict[str, dict[str, str]]:
    return {
        "measurement": current_measurement_code(),
        "scan": current_scan_code(),
    }


STARTUP_PRODUCER_SHA256 = sha256_file(SCRIPT_PATH)


def resolve_leaf(path: pathlib.Path, description: str) -> pathlib.Path:
    """부모만 해석하고 마지막 경로 요소는 절대 따라가지 않는다."""
    path = pathlib.Path(path)
    if path.name in {"", ".", ".."}:
        raise EvidenceBuildError(f"{description}의 마지막 경로 요소가 잘못됐습니다")
    try:
        parent = path.parent.resolve(strict=True)
    except (FileNotFoundError, OSError) as exc:
        raise EvidenceBuildError(
            f"{description}의 부모 폴더를 확인할 수 없습니다: {path.parent}"
        ) from exc
    if not parent.is_dir():
        raise EvidenceBuildError(
            f"{description}의 부모 경로가 폴더가 아닙니다: {path.parent}"
        )
    return parent / path.name


def snapshot_regular_file(
    path: pathlib.Path,
    description: str,
    *,
    max_bytes: int,
) -> RegularFileSnapshot:
    """leaf symlink를 거부하고 한 FD에서 identity와 바이트를 함께 고정한다."""
    path = pathlib.Path(path)
    flags = (
        os.O_RDONLY
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_NONBLOCK", 0)
    )
    try:
        before = os.lstat(path)
        if stat.S_ISLNK(before.st_mode):
            raise EvidenceBuildError(
                f"{description}은 심볼릭 링크일 수 없습니다: {path}"
            )
        descriptor = os.open(path, flags)
    except EvidenceBuildError:
        raise
    except OSError as exc:
        raise EvidenceBuildError(
            f"{description}은 읽을 수 있는 일반 파일이어야 합니다: {path}"
        ) from exc
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise EvidenceBuildError(
                f"{description}은 일반 파일이어야 합니다: {path}"
            )
        if (before.st_dev, before.st_ino) != (
            metadata.st_dev,
            metadata.st_ino,
        ):
            raise EvidenceBuildError(f"{description} leaf가 여는 중 교체됐습니다")
        with os.fdopen(descriptor, "rb", closefd=False) as handle:
            content = handle.read(max_bytes + 1)
        if len(content) > max_bytes:
            raise EvidenceBuildError(
                f"{description}이 {max_bytes}바이트 제한을 넘습니다: {path}"
            )
        after = os.fstat(descriptor)
        if (
            metadata.st_dev,
            metadata.st_ino,
            metadata.st_size,
            metadata.st_mtime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
        ):
            raise EvidenceBuildError(f"{description}이 읽는 중 변경됐습니다")
        return RegularFileSnapshot(
            content=content,
            device=metadata.st_dev,
            inode=metadata.st_ino,
            size=metadata.st_size,
        )
    finally:
        os.close(descriptor)


def assert_regular_file_unchanged(
    path: pathlib.Path,
    snapshot: RegularFileSnapshot,
    description: str,
    *,
    max_bytes: int,
) -> None:
    current = snapshot_regular_file(path, description, max_bytes=max_bytes)
    if (
        current.device,
        current.inode,
        current.size,
        current.content,
    ) != (
        snapshot.device,
        snapshot.inode,
        snapshot.size,
        snapshot.content,
    ):
        raise EvidenceBuildError(f"{description} leaf가 측정 중 교체 또는 변경됐습니다")


def snapshot_directory(path: pathlib.Path, description: str) -> DirectorySnapshot:
    path = pathlib.Path(path)
    flags = (
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_NONBLOCK", 0)
    )
    try:
        before = os.lstat(path)
        if stat.S_ISLNK(before.st_mode):
            raise EvidenceBuildError(
                f"{description}은 심볼릭 링크일 수 없습니다: {path}"
            )
        descriptor = os.open(path, flags)
    except EvidenceBuildError:
        raise
    except OSError as exc:
        raise EvidenceBuildError(f"{description} 폴더를 열 수 없습니다: {path}") from exc
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISDIR(metadata.st_mode):
            raise EvidenceBuildError(f"{description}은 폴더여야 합니다: {path}")
        if (before.st_dev, before.st_ino) != (
            metadata.st_dev,
            metadata.st_ino,
        ):
            raise EvidenceBuildError(f"{description} leaf가 여는 중 교체됐습니다")
        return DirectorySnapshot(metadata.st_dev, metadata.st_ino)
    finally:
        os.close(descriptor)


def assert_directory_unchanged(
    path: pathlib.Path,
    snapshot: DirectorySnapshot,
    description: str,
) -> None:
    current = snapshot_directory(path, description)
    if current != snapshot:
        raise EvidenceBuildError(f"{description} leaf가 측정 중 교체됐습니다")


def require_regular_file(path: pathlib.Path, description: str) -> bytes:
    return snapshot_regular_file(
        path, description, max_bytes=MAX_REPORT_BYTES
    ).content


def load_prepare_module():
    spec = importlib.util.spec_from_file_location(
        "tossquant_evidence_prepare", PREPARE_SCRIPT
    )
    if spec is None or spec.loader is None:
        raise EvidenceBuildError("prepare_plotly_data.py를 불러올 수 없습니다")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify_prepared_output(directory: pathlib.Path) -> dict:
    try:
        return load_prepare_module().verify_prepared_output(directory)
    except (KeyError, OSError, ValueError) as exc:
        raise EvidenceBuildError(f"준비 입력 검증 실패: {exc}") from exc


def validate_tracked_preparation_report(content: bytes) -> dict:
    """CSV 없이도 추적 보고서의 스키마·자기해시·핀 신뢰점을 검증한다."""
    module = load_prepare_module()
    try:
        report = strict_json_loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, EvidenceBuildError) as exc:
        raise EvidenceBuildError("추적 준비 보고서를 읽을 수 없습니다") from exc
    if not isinstance(report, dict) or set(report) != module.REPORT_FIELDS:
        raise EvidenceBuildError("추적 준비 보고서 필드 집합이 다릅니다")
    expected_constants = {
        "preparation_schema_version": module.PREPARATION_SCHEMA_VERSION,
        "preparation_tool_version": module.PREPARATION_TOOL_VERSION,
        "timestamp_digest_algorithm": module.TIMESTAMP_DIGEST_ALGORITHM,
        "output_digest_algorithm": module.OUTPUT_DIGEST_ALGORITHM,
        "report_digest_algorithm": module.REPORT_DIGEST_ALGORITHM,
    }
    for field, expected in expected_constants.items():
        if report.get(field) != expected:
            raise EvidenceBuildError(
                f"추적 준비 보고서 {field} 신뢰점 불일치"
            )
    expected_report_sha256 = report.get("report_sha256")
    actual_report_sha256 = canonical_json_sha256(
        {key: value for key, value in report.items() if key != "report_sha256"}
    )
    if expected_report_sha256 != actual_report_sha256:
        raise EvidenceBuildError("추적 준비 보고서 자기해시가 다릅니다")

    code_provenance = module._code_provenance_sha256()
    for field, actual in code_provenance.items():
        if report.get(field) != actual:
            raise EvidenceBuildError(
                f"추적 준비 보고서 {field} 코드 신뢰점 불일치"
            )
    if report.get("backtest_data_module") != module.BACKTEST_DATA_MODULE:
        raise EvidenceBuildError("추적 준비 보고서 CSV 소비자 모듈이 다릅니다")
    if report.get("candle_model_module") != module.CANDLE_MODEL_MODULE:
        raise EvidenceBuildError("추적 준비 보고서 캔들 모델 모듈이 다릅니다")
    if report.get("python_version") != EVIDENCE_PYTHON_VERSION:
        raise EvidenceBuildError("추적 준비 보고서 Python 신뢰점이 다릅니다")

    def plain_nonnegative_int(field: str) -> int:
        value = report.get(field)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise EvidenceBuildError(f"추적 준비 보고서 {field} 값이 잘못됐습니다")
        return value

    input_rows = plain_nonnegative_int("input_rows")
    written_rows = plain_nonnegative_int("written_rows")
    symbols = plain_nonnegative_int("symbols")
    symbol_rows = report.get("symbol_rows")
    if not isinstance(symbol_rows, dict) or any(
        not isinstance(symbol, str)
        or not module.SAFE_SYMBOL.fullmatch(symbol)
        or isinstance(rows, bool)
        or not isinstance(rows, int)
        or rows <= 0
        for symbol, rows in symbol_rows.items()
    ):
        raise EvidenceBuildError("추적 준비 보고서 symbol_rows가 잘못됐습니다")
    if symbols != len(symbol_rows) or written_rows != sum(symbol_rows.values()):
        raise EvidenceBuildError("추적 준비 보고서 심볼/행 집계가 다릅니다")
    timestamp_sha256 = report.get("symbol_timestamp_sha256")
    timestamp_bounds = report.get("symbol_timestamp_bounds")
    if (
        not isinstance(timestamp_sha256, dict)
        or set(timestamp_sha256) != set(symbol_rows)
        or any(
            not isinstance(value, str)
            or not re.fullmatch(r"[0-9a-f]{64}", value)
            for value in timestamp_sha256.values()
        )
        or not isinstance(timestamp_bounds, dict)
        or set(timestamp_bounds) != set(symbol_rows)
        or any(
            not isinstance(bounds, dict)
            or set(bounds) != {"first", "last"}
            or not all(isinstance(value, str) for value in bounds.values())
            for bounds in timestamp_bounds.values()
        )
    ):
        raise EvidenceBuildError("추적 준비 보고서 timestamp 근거가 잘못됐습니다")
    try:
        dropped_rows = module._validate_dropped_rows(
            report.get("dropped_rows"), input_rows
        )
        module._validate_source_provenance(report, input_rows)
    except ValueError as exc:
        raise EvidenceBuildError(f"추적 준비 보고서 provenance 불일치: {exc}") from exc
    if input_rows != written_rows + len(dropped_rows):
        raise EvidenceBuildError("추적 준비 보고서 입력/출력 행 집계가 다릅니다")
    if report.get("source_kind") == "plotly_pinned":
        if report.get("output_sha256") != module.PINNED_OUTPUT_SHA256:
            raise EvidenceBuildError("핀 고정 준비 출력 SHA-256 신뢰점이 다릅니다")
        if canonical_json_sha256(dropped_rows) != module.PINNED_DROPPED_ROWS_SHA256:
            raise EvidenceBuildError("핀 고정 제외 행 SHA-256 신뢰점이 다릅니다")
    elif not re.fullmatch(r"[0-9a-f]{64}", str(report.get("output_sha256"))):
        raise EvidenceBuildError("로컬 준비 출력 SHA-256이 잘못됐습니다")
    return report


def normalize_scalar(value: str, replacements: dict[str, str]) -> str:
    result = value
    for actual in sorted(replacements, key=len, reverse=True):
        token = replacements[actual]
        # JSON 안의 Windows 경로는 역슬래시가 한 번 더 escape되어 있다.
        result = result.replace(actual.replace("\\", "\\\\"), token)
        result = result.replace(actual, token)
    return result


def normalize_value(value, replacements: dict[str, str]):
    if isinstance(value, str):
        return normalize_scalar(value, replacements)
    if isinstance(value, list):
        return [normalize_value(item, replacements) for item in value]
    if isinstance(value, dict):
        return {
            key: normalize_value(item, replacements)
            for key, item in value.items()
        }
    return value


def recorded_command_environment() -> dict[str, str]:
    """Return the complete logical environment recorded in every child log."""
    environment = dict(FIXED_COMMAND_ENVIRONMENT)
    if os.name == "nt":
        environment.update(WINDOWS_COMMAND_ENVIRONMENT)
    return environment


def command_environment(
    command_temp: pathlib.Path,
) -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    """Build a closed child environment and its path-normalized provenance."""
    python_directory = pathlib.Path(sys.executable).resolve().parent
    actual = {
        "COLUMNS": FIXED_COMMAND_ENVIRONMENT["COLUMNS"],
        "LC_ALL": FIXED_COMMAND_ENVIRONMENT["LC_ALL"],
        "NO_COLOR": FIXED_COMMAND_ENVIRONMENT["NO_COLOR"],
        "PATH": str(python_directory),
        "PYTHONTZPATH": FIXED_COMMAND_ENVIRONMENT["PYTHONTZPATH"],
        "TEMP": str(command_temp),
        "TMP": str(command_temp),
        "TMPDIR": str(command_temp),
        "TZ": FIXED_COMMAND_ENVIRONMENT["TZ"],
    }
    replacements = {
        str(python_directory): "$PYTHON_DIR",
        str(command_temp): "$TEMP",
    }
    if os.name == "nt":
        system_root = os.environ.get("SystemRoot") or os.environ.get("SYSTEMROOT")
        if not system_root:
            raise EvidenceBuildError(
                "Windows isolated child 실행에 SystemRoot가 필요합니다"
            )
        actual.update(
            {
                "PATHEXT": WINDOWS_COMMAND_ENVIRONMENT["PATHEXT"],
                "SystemRoot": system_root,
            }
        )
        replacements[system_root] = "$SYSTEMROOT"
    return actual, recorded_command_environment(), replacements


def terminal_result(log: bytes, prefix: str, kind: str) -> dict:
    try:
        text = log.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise EvidenceBuildError("측정 로그가 UTF-8이 아닙니다") from exc
    lines = text.rstrip().splitlines()
    matches = [line for line in lines if line.startswith(prefix)]
    if len(matches) != 1:
        raise EvidenceBuildError(
            f"{prefix} terminal record가 정확히 하나여야 합니다"
        )
    if not lines or lines[-1] != matches[0]:
        raise EvidenceBuildError(f"{prefix} record가 로그의 마지막 줄이 아닙니다")
    payload = strict_json_loads(matches[0].removeprefix(prefix))
    if payload.get("schema_version") != RESULT_SCHEMA_VERSION:
        raise EvidenceBuildError(f"지원하지 않는 {prefix} schema")
    if payload.get("kind") != kind:
        raise EvidenceBuildError(f"잘못된 terminal result kind: {payload.get('kind')}")
    if payload.get("reported_exit_status") != 0:
        raise EvidenceBuildError("명령이 성공 terminal result를 내지 않았습니다")
    return payload


def normalize_captured_log(
    raw: bytes,
    *,
    prefix: str,
    kind: str,
    replacements: dict[str, str],
    actual_exit_status: int,
    command: list[str],
    recorded_environment: dict[str, str],
) -> tuple[bytes, dict]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise EvidenceBuildError("명령 출력이 UTF-8이 아닙니다") from exc
    text = normalize_scalar(text, replacements)
    payload = terminal_result(text.encode("utf-8"), prefix, kind)
    payload = normalize_value(payload, replacements)
    payload["producer_observation"] = {
        "actual_exit_status": actual_exit_status,
        "capture": "stdout_stderr_merged",
        "command": normalize_value(command, replacements),
        "environment": recorded_environment,
    }
    lines = text.rstrip().splitlines()
    lines[-1] = prefix + canonical_json_bytes(payload).decode("utf-8").rstrip()
    normalized = ("\n".join(lines) + "\n").encode("utf-8")
    return normalized, payload


def producer_observation(payload: dict) -> dict:
    observation = payload.get("producer_observation")
    if not isinstance(observation, dict):
        raise EvidenceBuildError("producer observation이 없습니다")
    expected_fields = {
        "actual_exit_status": 0,
        "capture": "stdout_stderr_merged",
        "environment": recorded_command_environment(),
    }
    if any(observation.get(key) != value for key, value in expected_fields.items()):
        raise EvidenceBuildError(
            "producer observation 불일치: "
            f"expected={expected_fields} actual={observation}"
        )
    command = observation.get("command")
    if not isinstance(command, list) or not command or any(
        not isinstance(item, str) for item in command
    ):
        raise EvidenceBuildError("producer command provenance가 잘못됐습니다")
    if set(observation) != {
        "actual_exit_status",
        "capture",
        "command",
        "environment",
    }:
        raise EvidenceBuildError("producer observation 필드 집합이 잘못됐습니다")
    return observation


def assert_contains(text: str, expected: str, description: str) -> None:
    if expected not in text:
        raise EvidenceBuildError(f"사람용 로그와 result 불일치 ({description})")


def validate_sweep_human_log(log: bytes, result: dict) -> None:
    text = log.decode("utf-8")
    invocation = json.dumps(
        result["invocation"], ensure_ascii=False, sort_keys=True
    )
    request = json.dumps(result["request"], ensure_ascii=False, sort_keys=True)
    config = json.dumps(
        result["simulation_config"], ensure_ascii=False, sort_keys=True
    )
    cohort = result["cohort"]
    aggregates = result["aggregates"]
    assert_contains(text, "실행 컨텍스트 " + invocation, "invocation")
    assert_contains(text, "측정 요청 " + request, "request")
    assert_contains(text, "고정 시뮬레이션 설정 " + config, "simulation config")
    assert_contains(
        text,
        f"계획 대상 {len(cohort['planned_symbols'])}개 · "
        f"cohort_sha256={cohort['planned_sha256']}",
        "planned cohort",
    )
    assert_contains(
        text,
        f"완료 결과 {len(cohort['completed_symbols'])}개 · "
        f"cohort_sha256={cohort['completed_sha256']}",
        "completed cohort",
    )
    assert_contains(
        text,
        f"{'총수익률 중앙값':20} "
        f"{float(aggregates['strategy_return_median']) * 100:9.1f}% "
        f"{float(aggregates['benchmark_return_median']) * 100:11.1f}%",
        "return aggregate",
    )
    assert_contains(
        text,
        f"{'MDD 중앙값':20} "
        f"{float(aggregates['strategy_mdd_median']) * 100:9.1f}% "
        f"{float(aggregates['benchmark_mdd_median']) * 100:11.1f}%",
        "MDD aggregate",
    )
    assert_contains(
        text,
        f"{'Sharpe 중앙값':20} "
        f"{float(aggregates['strategy_sharpe_median']):10.2f} "
        f"{float(aggregates['benchmark_sharpe_median']):12.2f}",
        "Sharpe aggregate",
    )
    total = int(aggregates["completed_symbol_count"])
    wins = int(aggregates["symbols_strategy_return_gt_benchmark"])
    assert_contains(
        text,
        f"바이앤홀드를 이긴 종목  {wins}/{total} "
        f"({float(aggregates['cross_sectional_beat_rate']) * 100:.1f}%)",
        "wins",
    )
    assert_contains(
        text,
        f"수익이 난 종목          {aggregates['positive_strategy_returns']}/{total}",
        "positive returns",
    )
    assert_contains(
        text,
        f"평균 거래 횟수          {float(aggregates['mean_trades']):.1f}",
        "mean trades",
    )
    excluded = result["posthoc_exclusion"]["symbols"]
    if excluded:
        assert_contains(
            text,
            f"사후 의심 종목 {len(excluded)}개 제외: {', '.join(excluded)}",
            "posthoc exclusions",
        )
    for group in ("top", "bottom"):
        for item in result["ranked"][group]:
            expected = (
                f"  {item['symbol']:6} "
                f"전략 {float(item['strategy_return']) * 100:+8.1f}%  "
                f"벤치 {float(item['benchmark_return']) * 100:+8.1f}%  "
                f"차이 {float(item['excess_return']) * 100:+9.1f}%p"
            )
            assert_contains(text, expected, f"ranked {group} {item['symbol']}")
    assert_contains(text, '실행 종료 {"exit_status": 0}', "success marker")


def validate_scan_human_log(log: bytes, result: dict) -> None:
    text = log.decode("utf-8")
    invocation = json.dumps(
        result["invocation"],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    assert_contains(text, "scan_context=" + invocation, "scan invocation")
    assert_contains(text, f"scan_input={result['input']['sha256']}", "scan input")
    assert_contains(text, f"scan_code={result['code']['sha256']}", "scan code")
    assert_contains(
        text,
        f"{result['processed']}개 처리 · {len(result['skipped_files'])}개 건너뜀 · "
        f"불연속 {result['break_count']}건",
        "scan counts",
    )
    for events in result["categories"].values():
        for event in events:
            assert_contains(
                text,
                event["description"],
                f"scan event {event['symbol']} {event['timestamp']}",
            )
    assert_contains(text, "scan_exit_status=0", "scan success marker")


def run_command(
    command: list[str],
    *,
    prefix: str,
    kind: str,
    replacements: dict[str, str],
) -> tuple[bytes, dict]:
    with tempfile.TemporaryDirectory(
        prefix="tossquant-evidence-command-"
    ) as raw_temp:
        command_temp = pathlib.Path(raw_temp).resolve()
        env, recorded_environment, environment_replacements = (
            command_environment(command_temp)
        )
        command_replacements = {
            **replacements,
            **environment_replacements,
        }
        completed = subprocess.run(
            command,
            cwd=PROJECT_ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
            env=env,
        )
    if completed.returncode != 0:
        rendered = completed.stdout.decode("utf-8", errors="replace")
        raise EvidenceBuildError(
            f"측정 명령 실패 ({completed.returncode}): "
            f"{' '.join(command)}\n{rendered}"
        )
    normalized, result = normalize_captured_log(
        completed.stdout,
        prefix=prefix,
        kind=kind,
        replacements=command_replacements,
        actual_exit_status=completed.returncode,
        command=command,
        recorded_environment=recorded_environment,
    )
    if kind == "tossquant.sweep_result":
        validate_sweep_human_log(normalized, result)
    else:
        validate_scan_human_log(normalized, result)
    return normalized, result


def artifact_names(version: str) -> dict[str, str]:
    return {
        "scan": f"plotly-scan-{version}.txt",
        "sma_cross": f"plotly-sweep-sma-raw-{version}.txt",
        "momentum": f"plotly-sweep-momentum-{version}.txt",
        "breakout": f"plotly-sweep-breakout-{version}.txt",
        "mean_reversion": f"plotly-sweep-mean-reversion-{version}.txt",
        "warn_exclude": f"plotly-sweep-sma-posthoc-exclude-{version}.txt",
        "adjust_exclude": (
            f"plotly-sweep-sma-verified-adjust-posthoc-exclude-{version}.txt"
        ),
        "disck_raw": f"plotly-sweep-disck-raw-{version}.txt",
        "disck_adjusted": f"plotly-sweep-disck-adjust-{version}.txt",
        "cohort": f"plotly-cohort-{version}.json",
        "preparation_report": f"plotly-preparation-report-{version}.json",
        "measurement": f"plotly-measurement-{version}.json",
        "readme_data": f"plotly-readme-{version}.json",
    }


def collect_new_logs(
    *,
    prepared_dir: pathlib.Path,
    manifest_snapshot: pathlib.Path,
    disck_dir: pathlib.Path,
    version: str,
    source_path: str | None,
) -> tuple[dict[str, bytes], dict[str, dict]]:
    names = artifact_names(version)
    replacements = {
        ISOLATED_MODULE_BOOTSTRAP: "$ISOLATED_BOOTSTRAP",
        str(PROJECT_ROOT / "src" / "tossquant" / "cli.py"): "$CLI",
        str(SWEEP_SCRIPT): "$SWEEP",
        str(pathlib.Path(sys.executable)): "$PYTHON",
        str(pathlib.Path(sys.executable).resolve()): "$PYTHON",
        str(disck_dir.resolve()): "$DISCK_DIR",
        str(prepared_dir.resolve()): "$PREPARED_DIR",
        str(manifest_snapshot.resolve()): "$MANIFEST",
        str(PROJECT_ROOT.resolve()): "$PROJECT",
        str(REPOSITORY_ROOT.resolve()): "$REPO",
    }
    if source_path is not None:
        replacements[str(pathlib.Path(source_path))] = "$SOURCE"
    commands: dict[str, tuple[list[str], str, str]] = {
        "scan": (
            [
                sys.executable,
                *ISOLATED_PYTHON_FLAGS,
                "-c",
                ISOLATED_MODULE_BOOTSTRAP,
                str(PROJECT_ROOT / "src"),
                "tossquant.cli",
                str(PROJECT_ROOT / "src" / "tossquant" / "cli.py"),
                "scan-data",
                "--csv-dir",
                str(prepared_dir.resolve()),
                "--strict",
            ],
            SCAN_RESULT_PREFIX,
            "tossquant.scan_result",
        )
    }
    for strategy in ("sma_cross", "momentum", "breakout", "mean_reversion"):
        commands[strategy] = (
            [
                sys.executable,
                *ISOLATED_PYTHON_FLAGS,
                str(SWEEP_SCRIPT),
                str(prepared_dir.resolve()),
                "--strategy",
                strategy,
                "--on-break",
                "warn",
            ],
            SWEEP_RESULT_PREFIX,
            "tossquant.sweep_result",
        )
    commands["warn_exclude"] = (
        [
            sys.executable,
            *ISOLATED_PYTHON_FLAGS,
            str(SWEEP_SCRIPT),
            str(prepared_dir.resolve()),
            "--strategy",
            "sma_cross",
            "--on-break",
            "warn",
            "--exclude-contaminated",
        ],
        SWEEP_RESULT_PREFIX,
        "tossquant.sweep_result",
    )
    commands["adjust_exclude"] = (
        [
            sys.executable,
            *ISOLATED_PYTHON_FLAGS,
            str(SWEEP_SCRIPT),
            str(prepared_dir.resolve()),
            "--strategy",
            "sma_cross",
            "--on-break",
            "adjust",
            "--verified-splits",
            str(manifest_snapshot.resolve()),
            "--exclude-contaminated",
        ],
        SWEEP_RESULT_PREFIX,
        "tossquant.sweep_result",
    )
    commands["disck_raw"] = (
        [
            sys.executable,
            *ISOLATED_PYTHON_FLAGS,
            str(SWEEP_SCRIPT),
            str(disck_dir.resolve()),
            "--strategy",
            "sma_cross",
            "--on-break",
            "warn",
        ],
        SWEEP_RESULT_PREFIX,
        "tossquant.sweep_result",
    )
    commands["disck_adjusted"] = (
        [
            sys.executable,
            *ISOLATED_PYTHON_FLAGS,
            str(SWEEP_SCRIPT),
            str(disck_dir.resolve()),
            "--strategy",
            "sma_cross",
            "--on-break",
            "adjust",
            "--verified-splits",
            str(manifest_snapshot.resolve()),
        ],
        SWEEP_RESULT_PREFIX,
        "tossquant.sweep_result",
    )

    logs: dict[str, bytes] = {}
    results: dict[str, dict] = {}
    for key, (command, prefix, kind) in commands.items():
        log, result = run_command(
            command,
            prefix=prefix,
            kind=kind,
            replacements=replacements,
        )
        logs[names[key]] = log
        results[key] = result
    return logs, results


def collect_tracked_logs(
    output_dir: pathlib.Path,
    version: str,
) -> tuple[dict[str, bytes], dict[str, dict]]:
    names = artifact_names(version)
    logs: dict[str, bytes] = {}
    results: dict[str, dict] = {}
    for key in (
        "scan",
        "sma_cross",
        "momentum",
        "breakout",
        "mean_reversion",
        "warn_exclude",
        "adjust_exclude",
        "disck_raw",
        "disck_adjusted",
    ):
        name = names[key]
        try:
            content = require_regular_file(output_dir / name, "추적 측정 로그")
            prefix = SCAN_RESULT_PREFIX if key == "scan" else SWEEP_RESULT_PREFIX
            kind = (
                "tossquant.scan_result"
                if key == "scan"
                else "tossquant.sweep_result"
            )
            result = terminal_result(content, prefix, kind)
            producer_observation(result)
            if key == "scan":
                validate_scan_human_log(content, result)
            else:
                validate_sweep_human_log(content, result)
        except (OSError, EvidenceBuildError) as exc:
            raise EvidenceBuildError(f"{name}: {exc}") from exc
        logs[name] = content
        results[key] = result
    return logs, results


def derive_cohort_manifest(report: dict) -> dict:
    rows = report["symbol_rows"]
    timestamps = report["symbol_timestamp_sha256"]
    bounds = report["symbol_timestamp_bounds"]
    if not rows:
        raise EvidenceBuildError("준비 보고서에 심볼이 없습니다")
    if set(rows) != set(timestamps) or set(rows) != set(bounds):
        raise EvidenceBuildError("준비 보고서의 심볼 provenance 키가 다릅니다")
    maximum_rows = max(rows.values())
    eligible = sorted(symbol for symbol, count in rows.items() if count == maximum_rows)
    groups: dict[str, list[str]] = defaultdict(list)
    for symbol in eligible:
        groups[timestamps[symbol]].append(symbol)
    timestamp_sha256, symbols = min(
        groups.items(),
        key=lambda item: (-len(item[1]), tuple(sorted(item[1]))),
    )
    symbols = sorted(symbols)
    first_bounds = bounds[symbols[0]]
    if any(bounds[symbol] != first_bounds for symbol in symbols):
        raise EvidenceBuildError("같은 timestamp 해시의 timestamp 경계가 다릅니다")
    first_session = first_bounds["first"].split("T", 1)[0]
    last_session = first_bounds["last"].split("T", 1)[0]
    digest_payload = {
        "algorithm": COHORT_DIGEST_ALGORITHM,
        "bars": maximum_rows,
        "first_session": first_session,
        "last_session": last_session,
        "symbols": symbols,
        "timestamp_sha256": timestamp_sha256,
    }
    return {
        "prepared_output_sha256": report["output_sha256"],
        "selection": COHORT_SELECTION,
        "bars": maximum_rows,
        "count": len(symbols),
        "first_session": first_session,
        "last_session": last_session,
        "timestamp_digest_algorithm": TIMESTAMP_DIGEST_ALGORITHM,
        "timestamp_sha256": timestamp_sha256,
        "cohort_digest_algorithm": COHORT_DIGEST_ALGORITHM,
        "cohort_sha256": canonical_json_sha256(digest_payload),
        "symbols": symbols,
    }


def finite_numbers(value: object, path: str = "result") -> None:
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            raise EvidenceBuildError(f"비유한 수치: {path}={value}")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            finite_numbers(item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            finite_numbers(item, f"{path}.{key}")
        return
    raise EvidenceBuildError(f"JSON이 아닌 result 값: {path}={type(value).__name__}")


def expected_command_contracts() -> dict[str, dict[str, object]]:
    def sweep_contract(
        *,
        input_token: str,
        strategy: str,
        on_break: str,
        exclude: bool = False,
        manifest: bool = False,
    ) -> dict[str, object]:
        argv = [
            "$SWEEP",
            input_token,
            "--strategy",
            strategy,
            "--on-break",
            on_break,
        ]
        if manifest:
            argv.extend(["--verified-splits", "$MANIFEST"])
        if exclude:
            argv.append("--exclude-contaminated")
        return {
            "invocation": {"argv": argv, "cwd": "$PROJECT"},
            "producer_command": ["$PYTHON", *ISOLATED_PYTHON_FLAGS, *argv],
            "request": {
                "exclude_contaminated": exclude,
                "limit": 0,
                "min_bars": 0,
                "on_break": on_break,
                "verified_splits": manifest,
            },
            "strategy": strategy,
        }

    return {
        "scan": {
            "invocation": {
                "argv": [
                    "$CLI",
                    "scan-data",
                    "--csv-dir",
                    "$PREPARED_DIR",
                    "--strict",
                ],
                "cwd": "$PROJECT",
            },
            "producer_command": [
                "$PYTHON",
                *ISOLATED_PYTHON_FLAGS,
                "-c",
                "$ISOLATED_BOOTSTRAP",
                "$PROJECT/src",
                "tossquant.cli",
                "$CLI",
                "scan-data",
                "--csv-dir",
                "$PREPARED_DIR",
                "--strict",
            ],
            "request": {"strict": True, "threshold": "0.25"},
        },
        "sma_cross": sweep_contract(
            input_token="$PREPARED_DIR",
            strategy="sma_cross",
            on_break="warn",
        ),
        "momentum": sweep_contract(
            input_token="$PREPARED_DIR",
            strategy="momentum",
            on_break="warn",
        ),
        "breakout": sweep_contract(
            input_token="$PREPARED_DIR",
            strategy="breakout",
            on_break="warn",
        ),
        "mean_reversion": sweep_contract(
            input_token="$PREPARED_DIR",
            strategy="mean_reversion",
            on_break="warn",
        ),
        "warn_exclude": sweep_contract(
            input_token="$PREPARED_DIR",
            strategy="sma_cross",
            on_break="warn",
            exclude=True,
        ),
        "adjust_exclude": sweep_contract(
            input_token="$PREPARED_DIR",
            strategy="sma_cross",
            on_break="adjust",
            exclude=True,
            manifest=True,
        ),
        "disck_raw": sweep_contract(
            input_token="$DISCK_DIR",
            strategy="sma_cross",
            on_break="warn",
        ),
        "disck_adjusted": sweep_contract(
            input_token="$DISCK_DIR",
            strategy="sma_cross",
            on_break="adjust",
            manifest=True,
        ),
    }


def validate_command_contracts(results: dict[str, dict], report: dict) -> None:
    contracts = expected_command_contracts()
    if set(results) != set(contracts):
        raise EvidenceBuildError(
            "측정 명령 계약 key가 다릅니다: "
            f"expected={sorted(contracts)} actual={sorted(results)}"
        )
    for key, contract in contracts.items():
        result = results[key]
        for field in ("invocation", "request"):
            if result.get(field) != contract[field]:
                raise EvidenceBuildError(
                    f"{key}: {field} 명령 계약 불일치: "
                    f"expected={contract[field]} actual={result.get(field)}"
                )
        observation = producer_observation(result)
        if observation["command"] != contract["producer_command"]:
            raise EvidenceBuildError(
                f"{key}: producer command 명령 계약 불일치: "
                f"expected={contract['producer_command']} "
                f"actual={observation['command']}"
            )
        if key != "scan" and result.get("simulation_config", {}).get(
            "strategy"
        ) != contract["strategy"]:
            raise EvidenceBuildError(f"{key}: strategy 명령 계약 불일치")

    expected_source_path = "$SOURCE" if report.get("source_path") else None
    for key in (
        "sma_cross",
        "momentum",
        "breakout",
        "mean_reversion",
        "warn_exclude",
        "adjust_exclude",
    ):
        preparation = results[key]["input"].get("preparation")
        if preparation is None or preparation.get("source_path") != expected_source_path:
            raise EvidenceBuildError(
                f"{key}: preparation 논리 경로 토큰 계약 불일치"
            )


def validate_results(
    results: dict[str, dict],
    report: dict,
    manifest_sha256: str,
    expected_code: dict[str, dict[str, str]],
) -> None:
    validate_command_contracts(results, report)
    cohort = derive_cohort_manifest(report)
    main_keys = (
        "sma_cross",
        "momentum",
        "breakout",
        "mean_reversion",
        "warn_exclude",
        "adjust_exclude",
    )
    for key, result in results.items():
        finite_numbers(result, key)
        producer_observation(result)
        if key == "scan":
            if result.get("code") != expected_code["scan"]:
                raise EvidenceBuildError(
                    "scan: 현재 scan 코드와 terminal code hash가 다릅니다: "
                    f"expected={expected_code['scan']} actual={result.get('code')}"
                )
            categories = result["categories"]
            if result["break_count"] != sum(len(items) for items in categories.values()):
                raise EvidenceBuildError("scan break_count와 categories가 다릅니다")
            if result["input"]["sha256"] != report["output_sha256"]:
                raise EvidenceBuildError("scan 입력과 준비 출력 해시가 다릅니다")
            continue
        aggregates = result["aggregates"]
        result_cohort = result["cohort"]
        if aggregates["completed_symbol_count"] != len(
            result_cohort["completed_symbols"]
        ):
            raise EvidenceBuildError(f"{key}: completed count 불일치")
        total = aggregates["completed_symbol_count"]
        wins = aggregates["symbols_strategy_return_gt_benchmark"]
        if aggregates["cross_sectional_beat_rate"] != wins / total:
            raise EvidenceBuildError(f"{key}: beat rate 불일치")
        if result_cohort["completed_symbols"] != result_cohort["planned_symbols"]:
            raise EvidenceBuildError(f"{key}: 계획/완료 심볼이 다릅니다")
        if result["skipped"]:
            raise EvidenceBuildError(f"{key}: 성공 증거에 skipped 심볼이 있습니다")

    for key in main_keys:
        result = results[key]
        result_cohort = result["cohort"]
        if result["input"]["sha256"] != report["output_sha256"]:
            raise EvidenceBuildError(f"{key}: 준비 입력 SHA-256 불일치")
        preparation = result["input"]["preparation"]
        if preparation is None or preparation["report_sha256"] != report["report_sha256"]:
            raise EvidenceBuildError(f"{key}: 준비 보고서 provenance 불일치")
        if result_cohort["base_symbols"] != cohort["symbols"]:
            raise EvidenceBuildError(f"{key}: 기본 코호트 심볼 불일치")
        if result_cohort["bars"] != cohort["bars"]:
            raise EvidenceBuildError(f"{key}: 기본 코호트 bars 불일치")
        if result_cohort["timestamp_sha256"] != cohort["timestamp_sha256"]:
            raise EvidenceBuildError(f"{key}: timestamp SHA-256 불일치")
        if result_cohort["base_sha256"] != cohort["cohort_sha256"]:
            raise EvidenceBuildError(f"{key}: 기본 코호트 SHA-256 불일치")

    baseline_code = results["sma_cross"]["code"]
    if baseline_code != expected_code["measurement"]:
        raise EvidenceBuildError(
            "현재 측정 코드와 terminal code hash가 다릅니다: "
            f"expected={expected_code['measurement']} actual={baseline_code}"
        )
    baseline_runtime = results["sma_cross"]["runtime"]
    baseline_config = dict(results["sma_cross"]["simulation_config"])
    baseline_config.pop("strategy")
    for key in main_keys + ("disck_raw", "disck_adjusted"):
        result = results[key]
        if result["code"] != baseline_code:
            raise EvidenceBuildError(f"{key}: sweep code provenance 불일치")
        if result["runtime"] != baseline_runtime:
            raise EvidenceBuildError(f"{key}: runtime provenance 불일치")
        config = dict(result["simulation_config"])
        config.pop("strategy")
        if config != baseline_config:
            raise EvidenceBuildError(f"{key}: 전략 외 시뮬레이션 설정 불일치")

    for key in ("sma_cross", "momentum", "breakout", "mean_reversion", "disck_raw", "disck_adjusted"):
        exclusion = results[key]["posthoc_exclusion"]
        if exclusion != {
            "symbols": [],
            "unbiased_estimate": True,
            "uses_future_information": False,
        }:
            raise EvidenceBuildError(f"{key}: 비민감도 실행 exclusion 계약 불일치")
    for key in ("warn_exclude", "adjust_exclude"):
        exclusion = results[key]["posthoc_exclusion"]
        if exclusion["unbiased_estimate"] is not False or exclusion[
            "uses_future_information"
        ] is not True:
            raise EvidenceBuildError(f"{key}: 사후 민감도 계약 불일치")

    if results["adjust_exclude"]["verified_splits"] != {
        "sha256": manifest_sha256
    }:
        raise EvidenceBuildError("adjust sensitivity manifest SHA-256 불일치")
    if results["disck_adjusted"]["verified_splits"] != {
        "sha256": manifest_sha256
    }:
        raise EvidenceBuildError("DISCK adjusted manifest SHA-256 불일치")
    if results["disck_raw"]["verified_splits"] is not None:
        raise EvidenceBuildError("DISCK raw 실행에 verified manifest가 있습니다")
    for key in ("disck_raw", "disck_adjusted"):
        if results[key]["cohort"]["base_symbols"] != ["DISCK"]:
            raise EvidenceBuildError(f"{key}: DISCK 단독 코호트가 아닙니다")


def canonical_distribution_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def locked_versions(path: pathlib.Path) -> dict[str, str]:
    versions: dict[str, str] = {}
    content = snapshot_regular_file(
        path, "의존성 lock", max_bytes=MAX_LOCK_BYTES
    ).content
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise EvidenceBuildError(f"의존성 lock이 UTF-8이 아닙니다: {path}") from exc
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        name, separator, version = line.partition("==")
        if separator != "==":
            raise EvidenceBuildError(f"고정되지 않은 의존성: {line}")
        canonical = canonical_distribution_name(name)
        if canonical in versions:
            raise EvidenceBuildError(f"중복 의존성: {canonical}")
        versions[canonical] = version
    return versions


def installed_locked_versions(expected: dict[str, str]) -> dict[str, str]:
    installed: dict[str, str] = {}
    for name in sorted(expected):
        try:
            installed[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError as exc:
            raise EvidenceBuildError(
                f"고정 의존성이 설치되지 않았습니다: {name}"
            ) from exc
    if installed != expected:
        differences = {
            name: {"expected": expected.get(name), "actual": installed.get(name)}
            for name in sorted(set(expected) | set(installed))
            if expected.get(name) != installed.get(name)
        }
        raise EvidenceBuildError(f"실행 runtime과 lock이 다릅니다: {differences}")
    return installed


def result_entry(result: dict, log_file: str, log: bytes) -> dict:
    observation = producer_observation(result)
    return {
        "strategy": result["simulation_config"]["strategy"],
        "request": result["request"],
        "invocation": result["invocation"],
        "capture": observation["capture"],
        "actual_exit_status": observation["actual_exit_status"],
        "producer_command": observation["command"],
        "input": result["input"],
        "verified_splits": result["verified_splits"],
        "code": result["code"],
        "runtime": result["runtime"],
        "simulation_config": result["simulation_config"],
        "cohort": result["cohort"],
        "posthoc_exclusion": result["posthoc_exclusion"],
        "aggregates": result["aggregates"],
        "ranked": result["ranked"],
        "skipped": result["skipped"],
        "log_file": log_file,
        "log_sha256": sha256_bytes(log),
    }


def scan_entry(result: dict, log_file: str, log: bytes) -> dict:
    observation = producer_observation(result)
    return {
        "request": result["request"],
        "invocation": result["invocation"],
        "capture": observation["capture"],
        "actual_exit_status": observation["actual_exit_status"],
        "producer_command": observation["command"],
        "input": result["input"],
        "code": result["code"],
        "runtime": result["runtime"],
        "processed": result["processed"],
        "skipped_files": result["skipped_files"],
        "break_count": result["break_count"],
        "categories": result["categories"],
        "log_file": log_file,
        "log_sha256": sha256_bytes(log),
    }


def displayed_aggregates(entry: dict) -> dict[str, object]:
    aggregates = entry["aggregates"]
    return {
        "completed_symbols": aggregates["completed_symbol_count"],
        "strategy_return_pct": float(
            f"{float(aggregates['strategy_return_median']) * 100:.1f}"
        ),
        "benchmark_return_pct": float(
            f"{float(aggregates['benchmark_return_median']) * 100:.1f}"
        ),
        "strategy_mdd_pct": float(
            f"{float(aggregates['strategy_mdd_median']) * 100:.1f}"
        ),
        "benchmark_mdd_pct": float(
            f"{float(aggregates['benchmark_mdd_median']) * 100:.1f}"
        ),
        "strategy_sharpe": float(
            f"{float(aggregates['strategy_sharpe_median']):.2f}"
        ),
        "benchmark_sharpe": float(
            f"{float(aggregates['benchmark_sharpe_median']):.2f}"
        ),
        "wins": aggregates["symbols_strategy_return_gt_benchmark"],
        "beat_rate_pct": float(
            f"{float(aggregates['cross_sectional_beat_rate']) * 100:.1f}"
        ),
        "positive_strategy_returns": aggregates["positive_strategy_returns"],
        "mean_trades": float(f"{float(aggregates['mean_trades']):.1f}"),
    }


def build_measurement(
    *,
    results: dict[str, dict],
    logs: dict[str, bytes],
    report: dict,
    report_bytes: bytes,
    effective_date: str,
    execution_started_at_utc: str,
    manifest_sha256: str,
    version: str,
    expected_code: dict[str, dict[str, str]],
) -> tuple[dict, dict, dict]:
    names = artifact_names(version)
    validate_results(results, report, manifest_sha256, expected_code)
    cohort = derive_cohort_manifest(report)
    raw_sweeps = {
        strategy: result_entry(
            results[strategy], names[strategy], logs[names[strategy]]
        )
        for strategy in ("sma_cross", "momentum", "breakout", "mean_reversion")
    }
    warn = result_entry(
        results["warn_exclude"],
        names["warn_exclude"],
        logs[names["warn_exclude"]],
    )
    adjusted = result_entry(
        results["adjust_exclude"],
        names["adjust_exclude"],
        logs[names["adjust_exclude"]],
    )
    disck_raw = result_entry(
        results["disck_raw"], names["disck_raw"], logs[names["disck_raw"]]
    )
    disck_adjusted = result_entry(
        results["disck_adjusted"],
        names["disck_adjusted"],
        logs[names["disck_adjusted"]],
    )

    runtime = results["sma_cross"]["runtime"]
    measurement_lock = PROJECT_ROOT / "evidence" / "requirements-measurement.txt"
    build_lock = PROJECT_ROOT / "evidence" / "requirements-build.txt"
    locked = locked_versions(measurement_lock)
    build_locked = locked_versions(build_lock)
    installed = installed_locked_versions(locked)
    build_installed = installed_locked_versions(build_locked)
    if platform.python_version() != EVIDENCE_PYTHON_VERSION:
        raise EvidenceBuildError(
            "증거 runtime Python 불일치: "
            f"expected={EVIDENCE_PYTHON_VERSION} actual={platform.python_version()}"
        )
    for key, result in results.items():
        result_runtime = result["runtime"]
        expected_runtime = {
            "python": EVIDENCE_PYTHON_VERSION,
            "pydantic": installed["pydantic"],
            "pydantic_settings": installed["pydantic-settings"],
        }
        if result_runtime != expected_runtime:
            raise EvidenceBuildError(
                f"{key}: terminal runtime과 고정 runtime이 다릅니다: "
                f"expected={expected_runtime} actual={result_runtime}"
            )
    simulation_config = dict(results["sma_cross"]["simulation_config"])
    simulation_config.pop("strategy")
    scan = scan_entry(results["scan"], names["scan"], logs[names["scan"]])
    measurement = {
        "measurement_schema_version": MEASUREMENT_SCHEMA_VERSION,
        "effective_date": validate_effective_date(effective_date),
        "execution_started_at_utc": validate_execution_started_at(
            execution_started_at_utc
        ),
        "artifact_version": version,
        "producer": {
            "version": PRODUCER_VERSION,
            "file": "scripts/build_plotly_evidence.py",
            "sha256": STARTUP_PRODUCER_SHA256,
            "result_source": (
                "canonical terminal JSON records; no metric CLI inputs"
            ),
        },
        "path_tokens": PATH_TOKENS,
        "preparation": {
            "report_file": names["preparation_report"],
            "report_file_sha256": sha256_bytes(report_bytes),
            **results["sma_cross"]["input"]["preparation"],
        },
        "measurement_code": results["sma_cross"]["code"],
        "runtime": {
            **runtime,
            "environment": recorded_command_environment(),
            "locked_packages": installed,
            "requirements_file": "requirements-measurement.txt",
            "requirements_sha256": sha256_file(measurement_lock),
            "build_locked_packages": build_installed,
            "build_requirements_file": "requirements-build.txt",
            "build_requirements_sha256": sha256_file(build_lock),
        },
        "verified_splits": {
            "logical_path": "$MANIFEST",
            "sha256": manifest_sha256,
        },
        "scan": scan,
        "cohort": {"manifest": names["cohort"], **cohort},
        "simulation_config_without_strategy": simulation_config,
        "raw_sweeps": raw_sweeps,
        "posthoc_sensitivity": {
            "warning": (
                "Full-period exclusions use future information and are not "
                "an unbiased cleaned estimate."
            ),
            "warn_exclude": warn,
            "verified_adjust_exclude": adjusted,
            "disck": {"raw": disck_raw, "adjusted": disck_adjusted},
        },
    }
    readme_data = build_readme_data(measurement)
    return measurement, cohort, readme_data


def build_readme_data(measurement: dict) -> dict:
    scan = measurement["scan"]
    categories = scan["categories"]
    raw = measurement["raw_sweeps"]
    sensitivity = measurement["posthoc_sensitivity"]
    return {
        "readme_data_schema_version": README_DATA_SCHEMA_VERSION,
        "artifact_version": measurement["artifact_version"],
        "effective_date": measurement["effective_date"],
        "scan": {
            "threshold": scan["request"]["threshold"],
            "processed": scan["processed"],
            "skipped": len(scan["skipped_files"]),
            "break_count": scan["break_count"],
            "counts": {
                key: len(events) for key, events in categories.items()
            },
            "examples": {
                key: events[:3] for key, events in categories.items()
            },
        },
        "strategies": {
            strategy: displayed_aggregates(raw[strategy])
            for strategy in ("sma_cross", "momentum", "breakout", "mean_reversion")
        },
        "sensitivity": {
            "raw": displayed_aggregates(raw["sma_cross"]),
            "warn_exclude": displayed_aggregates(sensitivity["warn_exclude"]),
            "verified_adjust_exclude": displayed_aggregates(
                sensitivity["verified_adjust_exclude"]
            ),
            "warn_excluded": sensitivity["warn_exclude"][
                "posthoc_exclusion"
            ]["symbols"],
            "adjusted_excluded": sensitivity["verified_adjust_exclude"][
                "posthoc_exclusion"
            ]["symbols"],
            "disck": {
                "raw": displayed_aggregates(sensitivity["disck"]["raw"]),
                "adjusted": displayed_aggregates(
                    sensitivity["disck"]["adjusted"]
                ),
            },
        },
        "ranked": {
            "top": raw["sma_cross"]["ranked"]["top"][:2],
            "bottom": raw["sma_cross"]["ranked"]["bottom"][-2:],
        },
    }


def signed_pct(value: float) -> str:
    return f"{value:+.1f}%"


def scan_example(event: dict) -> str:
    return (
        f"{event['symbol']} "
        f"{Decimal(event['change_percent']):+.1f}%"
    )


def render_scan_block(data: dict) -> str:
    scan = data["scan"]
    counts = scan["counts"]
    examples = scan["examples"]
    labels = (
        ("candidate_adjustments", "분할비 **후보** (자동 보정 안 함)"),
        ("transient_or_roundtrip", "왕복·일시 불연속"),
        ("unknown_down", "원인 불명 **하락** 갭"),
        ("unknown_up", "원인 불명 **상승** 갭"),
    )
    lines = [
        f"### 실측 — 고정 입력 {scan['processed']}종목에서 {scan['break_count']}건",
        "",
        "```",
        f"{scan['processed']}개 처리 · {scan['skipped']}개 건너뜀 · "
        f"불연속 {scan['break_count']}건 "
        f"(기준 {Decimal(scan['threshold']) * 100:g}%)",
        "```",
        "",
        "| 휴리스틱 분류 | 건수 | 결정론적 예시 (심볼순 앞 3건) |",
        "| --- | ---: | --- |",
    ]
    for key, label in labels:
        rendered_examples = ", ".join(
            scan_example(event) for event in examples[key]
        ) or "—"
        lines.append(
            f"| {label} | {counts[key]} | {rendered_examples} |"
        )
    return "\n".join(lines)


def sensitivity_row(label: str, entries: tuple[dict, dict, dict], field: str) -> str:
    values = []
    for entry in entries:
        value = entry[field]
        if field.endswith("_pct") and field not in {
            "strategy_mdd_pct",
            "benchmark_mdd_pct",
        }:
            values.append(signed_pct(value))
        else:
            values.append(str(value))
    return f"| {label} | " + " | ".join(values) + " |"


def render_sensitivity_block(data: dict) -> str:
    sensitivity = data["sensitivity"]
    raw = sensitivity["raw"]
    warn = sensitivity["warn_exclude"]
    adjusted = sensitivity["verified_adjust_exclude"]
    entries = (raw, warn, adjusted)
    rates = sorted((warn["beat_rate_pct"], adjusted["beat_rate_pct"]))
    lines = [
        "### 사후 민감도 — 바이앤홀드 초과 종목 비율은 "
        f"{raw['beat_rate_pct']:.1f}%에서 {rates[0]:.1f}~{rates[1]:.1f}%로 내려갔다",
        "",
        "여기서 비율은 거래별 승률이 아니다. **독립 종목 백테스트 중 전략 "
        "총수익률이 같은 평가 구간의 바이앤홀드 총수익률보다 큰 종목의 비율**이다.",
        "",
        "```bash",
        "python scripts/sweep.py ./data --strategy sma_cross --on-break warn",
        "python scripts/sweep.py ./data --strategy sma_cross --on-break warn \\",
        "  --exclude-contaminated",
        "python scripts/sweep.py ./data --strategy sma_cross --on-break adjust \\",
        "  --verified-splits evidence/plotly-verified-splits.csv \\",
        "  --exclude-contaminated",
        "```",
        "",
        "| | 원본 `warn` | 사후 제외 | DISCK 검증 조정 + 사후 제외 |",
        "| --- | ---: | ---: | ---: |",
        "| 대상 종목 | "
        f"{raw['completed_symbols']} | "
        f"{warn['completed_symbols']} ({len(sensitivity['warn_excluded'])} 제외) | "
        f"{adjusted['completed_symbols']} "
        f"({len(sensitivity['adjusted_excluded'])} 제외) |",
        sensitivity_row("전략 수익 중앙값", entries, "strategy_return_pct"),
        sensitivity_row("바이앤홀드 수익 중앙값", entries, "benchmark_return_pct"),
        "| 전략/벤치 MDD 중앙값 | "
        + " | ".join(
            f"{entry['strategy_mdd_pct']:.1f}% / "
            f"{entry['benchmark_mdd_pct']:.1f}%"
            for entry in entries
        )
        + " |",
        "| 전략/벤치 Sharpe 중앙값 | "
        + " | ".join(
            f"{entry['strategy_sharpe']:.2f} / "
            f"{entry['benchmark_sharpe']:.2f}"
            for entry in entries
        )
        + " |",
        "| **바이앤홀드 초과 종목 비율** | "
        + " | ".join(
            f"**{entry['wins']}/{entry['completed_symbols']} "
            f"({entry['beat_rate_pct']:.1f}%)**"
            for entry in entries
        )
        + " |",
        "",
        f"`warn` 민감도에서 제외된 종목은 {', '.join(sensitivity['warn_excluded'])}이다. "
        "검증 조정 실행은 매니페스트로 해소된 종목만 코호트에 되돌린다.",
        "",
    ]
    disck_raw = sensitivity["disck"]["raw"]
    disck_adjusted = sensitivity["disck"]["adjusted"]
    lines.append(
        "DISCK는 원본에서 전략 "
        f"{signed_pct(disck_raw['strategy_return_pct'])}, 벤치 "
        f"{signed_pct(disck_raw['benchmark_return_pct'])}; 조정 후 전략 "
        f"{signed_pct(disck_adjusted['strategy_return_pct'])}, 벤치 "
        f"{signed_pct(disck_adjusted['benchmark_return_pct'])}다."
    )
    return "\n".join(lines)


def render_strategies_block(data: dict) -> str:
    lines = [
        "| 전략 | 수익 중앙값 전략/벤치 | MDD 전략/벤치 | Sharpe 전략/벤치 | "
        "바이앤홀드 초과 종목 | 평균 거래 |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for strategy in ("sma_cross", "momentum", "breakout", "mean_reversion"):
        entry = data["strategies"][strategy]
        lines.append(
            f"| `{strategy}` | {signed_pct(entry['strategy_return_pct'])} / "
            f"{signed_pct(entry['benchmark_return_pct'])} | "
            f"{entry['strategy_mdd_pct']:.1f}% / {entry['benchmark_mdd_pct']:.1f}% | "
            f"{entry['strategy_sharpe']:.2f} / {entry['benchmark_sharpe']:.2f} | "
            f"{entry['beat_rate_pct']:.1f}% | {entry['mean_trades']:.1f} |"
        )
    return "\n".join(lines)


def render_ranked_block(data: dict) -> str:
    lines = ["```"]
    for label, key in (("초과수익 상위", "top"), ("초과수익 하위", "bottom")):
        for index, item in enumerate(data["ranked"][key]):
            prefix = label if index == 0 else " " * len(label)
            lines.append(
                f"{prefix}    {item['symbol']}  "
                f"전략 {float(item['strategy_return']) * 100:+.1f}%  "
                f"벤치 {float(item['benchmark_return']) * 100:+.1f}%"
            )
    lines.append("```")
    return "\n".join(lines)


def rendered_readme_blocks(data: dict) -> dict[str, str]:
    return {
        "scan": render_scan_block(data),
        "sensitivity": render_sensitivity_block(data),
        "strategies": render_strategies_block(data),
        "ranked": render_ranked_block(data),
    }


def apply_readme_blocks(readme: bytes, data: dict) -> bytes:
    try:
        text = readme.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise EvidenceBuildError("README가 UTF-8이 아닙니다") from exc
    for key, block in rendered_readme_blocks(data).items():
        marker = README_MARKERS[key]
        start = f"<!-- BEGIN GENERATED {marker} -->"
        end = f"<!-- END GENERATED {marker} -->"
        if text.count(start) != 1 or text.count(end) != 1:
            raise EvidenceBuildError(
                f"README marker가 정확히 하나여야 합니다: {marker}"
            )
        start_index = text.index(start) + len(start)
        end_index = text.index(end, start_index)
        text = text[:start_index] + "\n" + block + "\n" + text[end_index:]
    return text.encode("utf-8")


def make_bundle(
    *,
    logs: dict[str, bytes],
    results: dict[str, dict],
    report: dict,
    report_bytes: bytes,
    effective_date: str,
    execution_started_at_utc: str,
    manifest_sha256: str,
    version: str,
    readme: bytes,
    expected_code: dict[str, dict[str, str]],
) -> tuple[dict[str, bytes], bytes]:
    names = artifact_names(version)
    measurement, cohort, readme_data = build_measurement(
        results=results,
        logs=logs,
        report=report,
        report_bytes=report_bytes,
        effective_date=effective_date,
        execution_started_at_utc=execution_started_at_utc,
        manifest_sha256=manifest_sha256,
        version=version,
        expected_code=expected_code,
    )
    readme_data_bytes = canonical_json_bytes(readme_data, pretty=True)
    updated_readme = apply_readme_blocks(readme, readme_data)
    measurement["readme_binding"] = {
        "data_file": names["readme_data"],
        "data_sha256": sha256_bytes(readme_data_bytes),
        "readme_file": "README.md",
        "readme_sha256": sha256_bytes(updated_readme),
        "markers": README_MARKERS,
    }
    files = dict(logs)
    files[names["cohort"]] = canonical_json_bytes(cohort, pretty=True)
    files[names["preparation_report"]] = report_bytes
    files[names["readme_data"]] = readme_data_bytes
    files[names["measurement"]] = canonical_json_bytes(
        measurement, pretty=True
    )
    return files, updated_readme


def compare_bundle(
    output_dir: pathlib.Path,
    output_snapshot: DirectorySnapshot,
    expected_files: dict[str, bytes],
    readme_path: pathlib.Path,
    readme_snapshot: RegularFileSnapshot,
    expected_readme: bytes,
) -> list[str]:
    assert_directory_unchanged(output_dir, output_snapshot, "output-dir")
    mismatches: list[str] = []
    actual_snapshots: dict[pathlib.Path, RegularFileSnapshot] = {}
    for name, expected in expected_files.items():
        path = output_dir / name
        try:
            actual_snapshot = snapshot_regular_file(
                path,
                f"추적 evidence 파일 {name}",
                max_bytes=MAX_REPORT_BYTES,
            )
        except (OSError, EvidenceBuildError):
            mismatches.append(name)
            continue
        actual_snapshots[path] = actual_snapshot
        if actual_snapshot.content != expected:
            mismatches.append(name)
    current_readme_snapshot: RegularFileSnapshot | None = None
    try:
        current_readme_snapshot = snapshot_regular_file(
            readme_path,
            "README",
            max_bytes=MAX_README_BYTES,
        )
    except (OSError, EvidenceBuildError):
        mismatches.append(readme_path.name)
    else:
        if current_readme_snapshot.content != expected_readme:
            mismatches.append(readme_path.name)
    for path, snapshot in actual_snapshots.items():
        assert_regular_file_unchanged(
            path,
            snapshot,
            f"추적 evidence 파일 {path.name}",
            max_bytes=MAX_REPORT_BYTES,
        )
    if current_readme_snapshot is not None:
        assert_regular_file_unchanged(
            readme_path,
            current_readme_snapshot,
            "README",
            max_bytes=MAX_README_BYTES,
        )
    assert_regular_file_unchanged(
        readme_path,
        readme_snapshot,
        "README",
        max_bytes=MAX_README_BYTES,
    )
    assert_directory_unchanged(output_dir, output_snapshot, "output-dir")
    return mismatches


def stage_adjacent(path: pathlib.Path, content: bytes) -> pathlib.Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, raw = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = pathlib.Path(raw)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return temporary


def publish_bundle(
    output_dir: pathlib.Path,
    output_snapshot: DirectorySnapshot,
    files: dict[str, bytes],
    readme_path: pathlib.Path,
    readme_snapshot: RegularFileSnapshot,
    readme: bytes,
    measurement_name: str,
) -> None:
    assert_directory_unchanged(output_dir, output_snapshot, "output-dir")
    staged: dict[pathlib.Path, pathlib.Path] = {}
    try:
        for name, content in files.items():
            target = output_dir / name
            staged[target] = stage_adjacent(target, content)
        staged[readme_path] = stage_adjacent(readme_path, readme)
        assert_directory_unchanged(output_dir, output_snapshot, "output-dir")
        # measurement JSON이 bundle commit marker다. 중단 시 새 로그와 옛 measurement가
        # 섞여도 검증은 실패하며, 완성되지 않은 조합을 성공으로 해석하지 않는다.
        ordered = [
            path for path in staged if path != output_dir / measurement_name
        ] + [output_dir / measurement_name]
        for target in ordered:
            assert_directory_unchanged(output_dir, output_snapshot, "output-dir")
            if target == readme_path:
                assert_regular_file_unchanged(
                    readme_path,
                    readme_snapshot,
                    "README",
                    max_bytes=MAX_README_BYTES,
                )
            os.replace(staged[target], target)
        assert_directory_unchanged(output_dir, output_snapshot, "output-dir")
    finally:
        for temporary in staged.values():
            temporary.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--prepared-dir",
        type=pathlib.Path,
        help=(
            "재측정 입력. --check에서는 생략해 추적 준비 보고서만 검증하거나, "
            "지정해 CSV까지 추가 검증"
        ),
    )
    parser.add_argument(
        "--effective-date",
        help=(
            "사용자가 선언하는 canonical 분석 유효일(YYYY-MM-DD). "
            "실제 실행 시각은 자동 기록"
        ),
    )
    parser.add_argument("--output-dir", type=pathlib.Path, required=True)
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    parser.add_argument("--readme", type=pathlib.Path, default=README_DEFAULT)
    parser.add_argument("--artifact-version", default="v5")
    parser.add_argument(
        "--check",
        action="store_true",
        help="명령을 재실행하지 않고 추적 terminal records에서 bundle을 재도출",
    )
    args = parser.parse_args()
    if args.check and args.effective_date is not None:
        parser.error("--check에서는 --effective-date를 지정할 수 없습니다")
    if not args.check and args.effective_date is None:
        parser.error("재측정에는 --effective-date가 필요합니다")
    if args.effective_date is not None:
        try:
            validate_effective_date(args.effective_date)
        except EvidenceBuildError as exc:
            parser.error(str(exc))
    if not re.fullmatch(r"v[1-9][0-9]*", args.artifact_version):
        parser.error("--artifact-version은 v5 같은 형식이어야 합니다")
    return args


def path_is_within(path: pathlib.Path, directory: pathlib.Path) -> bool:
    return path == directory or directory in path.parents


def validate_path_separation(
    *,
    prepared_dir: pathlib.Path | None,
    output_dir: pathlib.Path,
    manifest_path: pathlib.Path,
    readme_path: pathlib.Path,
    artifact_files: set[str],
) -> None:
    if prepared_dir is not None and (
        path_is_within(output_dir, prepared_dir)
        or path_is_within(prepared_dir, output_dir)
    ):
        raise EvidenceBuildError("output-dir과 prepared-dir을 양방향으로 분리하세요")
    for path, description in (
        (manifest_path, "manifest"),
        (readme_path, "README"),
    ):
        if path == output_dir:
            raise EvidenceBuildError(
                f"output-dir과 {description}가 같은 경로일 수 없습니다"
            )
        if output_dir in path.parents and path.name in artifact_files:
            raise EvidenceBuildError(
                f"output-dir 산출물과 {description} 경로가 겹칠 수 없습니다"
            )
        if prepared_dir is not None and path_is_within(path, prepared_dir):
            raise EvidenceBuildError(
                f"prepared-dir과 {description} 경로가 겹칠 수 없습니다"
            )
    if manifest_path == readme_path:
        raise EvidenceBuildError("manifest와 README가 같은 파일일 수 없습니다")


def prepare_output_directory(
    output_dir: pathlib.Path, *, check: bool
) -> DirectorySnapshot:
    try:
        metadata = os.lstat(output_dir)
    except FileNotFoundError:
        if check:
            raise EvidenceBuildError(f"output-dir 폴더가 없습니다: {output_dir}")
        try:
            os.mkdir(output_dir)
        except FileExistsError:
            pass
        except OSError as exc:
            raise EvidenceBuildError(
                f"output-dir 폴더를 만들 수 없습니다: {output_dir}"
            ) from exc
    else:
        if stat.S_ISLNK(metadata.st_mode):
            raise EvidenceBuildError(
                f"output-dir은 심볼릭 링크일 수 없습니다: {output_dir}"
            )
    return snapshot_directory(output_dir, "output-dir")


def main() -> None:
    if not sys.flags.isolated:
        raise EvidenceBuildError(
            "증거 빌더는 Python isolated mode로 실행해야 합니다: python -I ..."
        )
    # Evidence runs use the pinned tzdata wheel on every OS instead of an
    # unrecorded system IANA database. This occurs before importing TossQuant.
    os.environ["PYTHONTZPATH"] = ""
    reset_tzpath()
    args = parse_args()
    execution_started_at_utc: str | None = None
    if not args.check:
        execution_started_at_utc = utc_execution_started_at()
    if sha256_file(SCRIPT_PATH) != STARTUP_PRODUCER_SHA256:
        raise EvidenceBuildError("producer 코드가 시작 뒤 변경됐습니다")
    if not args.check and args.prepared_dir is None:
        raise EvidenceBuildError("재측정에는 --prepared-dir이 필요합니다")
    prepared_dir = (
        resolve_leaf(args.prepared_dir, "prepared-dir")
        if args.prepared_dir is not None
        else None
    )
    output_dir = resolve_leaf(args.output_dir, "output-dir")
    readme_path = resolve_leaf(args.readme, "README")
    manifest_path = resolve_leaf(args.manifest, "manifest")
    names = artifact_names(args.artifact_version)
    validate_path_separation(
        prepared_dir=prepared_dir,
        output_dir=output_dir,
        manifest_path=manifest_path,
        readme_path=readme_path,
        artifact_files=set(names.values()),
    )
    prepared_snapshot = (
        snapshot_directory(prepared_dir, "prepared-dir")
        if prepared_dir is not None
        else None
    )
    output_snapshot = prepare_output_directory(output_dir, check=args.check)
    tracked_measurement_snapshot: RegularFileSnapshot | None = None
    if args.check:
        tracked_measurement_path = output_dir / names["measurement"]
        tracked_measurement_snapshot = snapshot_regular_file(
            tracked_measurement_path,
            "추적 measurement JSON",
            max_bytes=MAX_REPORT_BYTES,
        )
        effective_date, execution_started_at_utc = tracked_execution_contract(
            tracked_measurement_snapshot.content,
            args.artifact_version,
        )
    else:
        effective_date = args.effective_date
    assert isinstance(effective_date, str)
    assert execution_started_at_utc is not None
    manifest_file_snapshot = snapshot_regular_file(
        manifest_path, "검증 승수 manifest", max_bytes=MAX_MANIFEST_BYTES
    )
    readme_snapshot = snapshot_regular_file(
        readme_path, "README", max_bytes=MAX_README_BYTES
    )
    if (manifest_file_snapshot.device, manifest_file_snapshot.inode) == (
        readme_snapshot.device,
        readme_snapshot.inode,
    ):
        raise EvidenceBuildError("manifest와 README가 같은 파일일 수 없습니다")
    report_path = (
        output_dir / names["preparation_report"]
        if args.check
        else prepared_dir / "preparation-report.json"
    )
    report_snapshot = snapshot_regular_file(
        report_path, "준비 보고서", max_bytes=MAX_REPORT_BYTES
    )
    report = validate_tracked_preparation_report(report_snapshot.content)
    prepared_report_snapshot: RegularFileSnapshot | None = None
    if prepared_dir is not None:
        verified_report = verify_prepared_output(prepared_dir)
        prepared_report_snapshot = snapshot_regular_file(
            prepared_dir / "preparation-report.json",
            "준비 입력 보고서",
            max_bytes=MAX_REPORT_BYTES,
        )
        if (
            verified_report != report
            or prepared_report_snapshot.content != report_snapshot.content
        ):
            raise EvidenceBuildError(
                "준비 CSV가 검증한 보고서와 추적 준비 보고서가 다릅니다"
            )
    assert_regular_file_unchanged(
        report_path,
        report_snapshot,
        "준비 보고서",
        max_bytes=MAX_REPORT_BYTES,
    )
    if prepared_dir is not None and prepared_snapshot is not None:
        assert_directory_unchanged(prepared_dir, prepared_snapshot, "prepared-dir")
    manifest_bytes = manifest_file_snapshot.content
    manifest_sha256 = sha256_bytes(manifest_bytes)
    readme = readme_snapshot.content
    source_code_snapshot = current_code_provenance()

    if args.check:
        logs, results = collect_tracked_logs(output_dir, args.artifact_version)
    else:
        disck_source = prepared_dir / "DISCK.csv"
        disck_snapshot = snapshot_regular_file(
            disck_source, "DISCK 준비 CSV", max_bytes=MAX_SINGLE_CSV_BYTES
        )
        with tempfile.TemporaryDirectory(
            prefix="tossquant-evidence-build-"
        ) as raw:
            staging = pathlib.Path(raw)
            manifest_command_snapshot = staging / "verified-splits.csv"
            manifest_command_snapshot.write_bytes(manifest_bytes)
            disck_dir = staging / "disck"
            disck_dir.mkdir()
            (disck_dir / "DISCK.csv").write_bytes(disck_snapshot.content)
            logs, results = collect_new_logs(
                prepared_dir=prepared_dir,
                manifest_snapshot=manifest_command_snapshot,
                disck_dir=disck_dir,
                version=args.artifact_version,
                source_path=report.get("source_path"),
            )
        assert_regular_file_unchanged(
            manifest_path,
            manifest_file_snapshot,
            "검증 승수 manifest",
            max_bytes=MAX_MANIFEST_BYTES,
        )
        assert_regular_file_unchanged(
            disck_source,
            disck_snapshot,
            "DISCK 준비 CSV",
            max_bytes=MAX_SINGLE_CSV_BYTES,
        )
        after_report = verify_prepared_output(prepared_dir)
        if after_report["report_sha256"] != report["report_sha256"]:
            raise EvidenceBuildError("측정 중 준비 보고서가 변경됐습니다")
        assert_regular_file_unchanged(
            report_path,
            report_snapshot,
            "준비 보고서",
            max_bytes=MAX_REPORT_BYTES,
        )
        assert_directory_unchanged(prepared_dir, prepared_snapshot, "prepared-dir")

    files, expected_readme = make_bundle(
        logs=logs,
        results=results,
        report=report,
        report_bytes=report_snapshot.content,
        effective_date=effective_date,
        execution_started_at_utc=execution_started_at_utc,
        manifest_sha256=manifest_sha256,
        version=args.artifact_version,
        readme=readme,
        expected_code=source_code_snapshot,
    )
    if current_code_provenance() != source_code_snapshot:
        raise EvidenceBuildError("producer가 검증한 현재 source가 실행 중 변경됐습니다")
    if sha256_file(SCRIPT_PATH) != STARTUP_PRODUCER_SHA256:
        raise EvidenceBuildError("producer 코드가 실행 중 변경됐습니다")
    assert_regular_file_unchanged(
        manifest_path,
        manifest_file_snapshot,
        "검증 승수 manifest",
        max_bytes=MAX_MANIFEST_BYTES,
    )
    assert_regular_file_unchanged(
        readme_path,
        readme_snapshot,
        "README",
        max_bytes=MAX_README_BYTES,
    )
    assert_regular_file_unchanged(
        report_path,
        report_snapshot,
        "준비 보고서",
        max_bytes=MAX_REPORT_BYTES,
    )
    if tracked_measurement_snapshot is not None:
        assert_regular_file_unchanged(
            output_dir / names["measurement"],
            tracked_measurement_snapshot,
            "추적 measurement JSON",
            max_bytes=MAX_REPORT_BYTES,
        )
    if (
        prepared_dir is not None
        and prepared_snapshot is not None
        and prepared_report_snapshot is not None
    ):
        assert_regular_file_unchanged(
            prepared_dir / "preparation-report.json",
            prepared_report_snapshot,
            "준비 입력 보고서",
            max_bytes=MAX_REPORT_BYTES,
        )
        assert_directory_unchanged(prepared_dir, prepared_snapshot, "prepared-dir")
    assert_directory_unchanged(output_dir, output_snapshot, "output-dir")

    if args.check:
        mismatches = compare_bundle(
            output_dir,
            output_snapshot,
            files,
            readme_path,
            readme_snapshot,
            expected_readme,
        )
        if mismatches:
            raise EvidenceBuildError(
                "추적 evidence 불일치: " + ", ".join(sorted(mismatches))
            )
        print(
            f"verified {len(files)} evidence files and {readme_path.name} "
            f"from canonical terminal records"
        )
        return

    publish_bundle(
        output_dir,
        output_snapshot,
        files,
        readme_path,
        readme_snapshot,
        expected_readme,
        names["measurement"],
    )
    print(
        f"published {len(files)} evidence files and {readme_path.name} · "
        f"measurement={names['measurement']}"
    )


if __name__ == "__main__":
    try:
        main()
    except EvidenceBuildError as exc:
        print(f"evidence build failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
