from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import os
import platform
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest

from tossquant.backtest.corporate import load_verified_splits
from tossquant.backtest.data import CsvSource


ROOT = Path(__file__).parents[1]
EVIDENCE = ROOT / "evidence"
MEASUREMENT_FILE = "plotly-measurement-v5.json"
GENERATED_ARTIFACT_VERSION = "v5"
GENERATED_EFFECTIVE_DATE = "2026-08-09"
TIMESTAMP_DIGEST_ALGORITHM = "sha256-iso-utc-timestamp-newline-v1"
COHORT_DIGEST_ALGORITHM = "sha256-symbols-timestamp-range-v3"
PACKAGE_CODE_DIGEST_ALGORITHM = "sha256-package-relative-path-content-v1"
PLOTLY_SOURCE_COMMIT = "0c447c47b757ad74edecab31f0d72f849d2e67c2"
PLOTLY_SOURCE_URL = (
    "https://raw.githubusercontent.com/plotly/datasets/"
    f"{PLOTLY_SOURCE_COMMIT}/all_stocks_5yr.csv"
)
PLOTLY_SOURCE_SHA256 = (
    "6aea253cd19de60b568143991aaf1fa482456565c389205658d236e595e716cf"
)
PLOTLY_OUTPUT_SHA256 = (
    "63e3d9d0bf1c71c5d5a330506a22db6b46589a6b8b99ecc12d1c498f4bd912ef"
)
PLOTLY_DROPPED_ROWS_SHA256 = (
    "9685034f58c8b4969e7de4a72cfe5ef9d9b5cf887731d911895610852cbd7b6c"
)
PLOTLY_INPUT_ROWS = 619_040
PLOTLY_DISCK_FILE_SHA256 = (
    "5e940c8f658b0bf14fa1e952da9a65237873a890e9c0a941ff653baf1be77c68"
)
DISCK_ISSUER_CANONICAL_URL = (
    "https://ir.wbd.com/stock-information/cost-basis-and-debt-information/"
    "series-c-dividend/default.aspx"
)
DISCK_ISSUER_FORM_8937_URL = (
    "https://s201.q4cdn.com/336605034/files/doc_downloads/"
    "Form-8937-%28Executed%29.pdf"
)
DISCK_ISSUER_FORM_8937_SHA256 = (
    "bd7ce36068b8e2be3a9713e9818997fa0282b164d0efba12bc3353c5da796060"
)


def reject_duplicate_json_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def reject_nonfinite_json_constant(value: str):
    raise ValueError(f"non-finite JSON number: {value}")


def strict_json_loads(text: str):
    return json.loads(
        text,
        object_pairs_hook=reject_duplicate_json_keys,
        parse_constant=reject_nonfinite_json_constant,
    )


def load_json(name: str) -> dict:
    return strict_json_loads((EVIDENCE / name).read_text(encoding="utf-8"))


def terminal_json_record(text: str, prefix: str) -> dict:
    matches = [
        line.removeprefix(prefix)
        for line in text.splitlines()
        if line.startswith(prefix)
    ]
    assert len(matches) == 1, (prefix, len(matches))
    payload = strict_json_loads(matches[0])
    assert isinstance(payload, dict)
    return payload


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_json_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def one_file_dataset_sha256(logical_name: str, content: bytes) -> str:
    name = logical_name.encode("utf-8")
    aggregate = hashlib.sha256()
    aggregate.update(b"sha256-filename-size-content-v1\0")
    aggregate.update((1).to_bytes(8, "big"))
    aggregate.update(len(name).to_bytes(4, "big"))
    aggregate.update(name)
    aggregate.update(len(content).to_bytes(8, "big"))
    aggregate.update(hashlib.sha256(content).digest())
    return aggregate.hexdigest()


def markdown_table_row(text: str, first_cell: str, columns: int) -> list[str]:
    matches: list[list[str]] = []
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        cells = [
            cell.strip().replace("**", "").replace("`", "")
            for cell in line.split("|")[1:-1]
        ]
        if len(cells) == columns and cells[0] == first_cell:
            matches.append(cells)
    assert len(matches) == 1, (first_cell, matches)
    return matches[0]


def markdown_section(text: str, heading: str) -> str | None:
    lines = text.splitlines()
    try:
        start = lines.index(heading)
    except ValueError:
        return None
    level = len(heading) - len(heading.lstrip("#"))
    end = len(lines)
    for index in range(start + 1, len(lines)):
        match = re.match(r"^(#+)\s", lines[index])
        if match and len(match.group(1)) <= level:
            end = index
            break
    return "\n".join(lines[start:end])


def markdown_section_containing(text: str, needle: str) -> str | None:
    position = text.find(needle)
    if position < 0:
        return None
    headings = [
        match.group(0)
        for match in re.finditer(r"(?m)^#+\s.+$", text)
        if match.start() < position
    ]
    assert headings, needle
    return markdown_section(text, headings[-1])


def workflow_step(text: str, name: str) -> str:
    marker = f"      - name: {name}"
    lines = text.splitlines()
    start = lines.index(marker)
    end = len(lines)
    for index in range(start + 1, len(lines)):
        if lines[index].startswith("      - name:") or re.match(
            r"^  [A-Za-z0-9_-]+:\s*$", lines[index]
        ):
            end = index
            break
    return "\n".join(lines[start:end])


def measurement_code_sha256() -> str:
    paths = [
        ROOT / "scripts" / "sweep.py",
        ROOT / "scripts" / "prepare_plotly_data.py",
        ROOT / "pyproject.toml",
    ]
    paths.extend(sorted((ROOT / "src" / "tossquant").rglob("*.py")))
    aggregate = hashlib.sha256()
    aggregate.update(b"sha256-relative-path-content-v1\0")
    for path in paths:
        relative = path.relative_to(ROOT).as_posix().encode("utf-8")
        aggregate.update(len(relative).to_bytes(4, "big"))
        aggregate.update(relative)
        aggregate.update(bytes.fromhex(sha256(path)))
    return aggregate.hexdigest()


def package_code_sha256() -> str:
    root = ROOT / "src" / "tossquant"
    paths = sorted(root.rglob("*.py"))
    aggregate = hashlib.sha256()
    aggregate.update(PACKAGE_CODE_DIGEST_ALGORITHM.encode("ascii") + b"\0")
    aggregate.update(len(paths).to_bytes(8, "big"))
    for path in paths:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        aggregate.update(len(relative).to_bytes(4, "big"))
        aggregate.update(relative)
        aggregate.update(bytes.fromhex(sha256(path)))
    return aggregate.hexdigest()


def locked_measurement_versions(path: Path) -> dict[str, str]:
    versions: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        name, separator, version = line.partition("==")
        assert separator == "==", f"unpinned measurement dependency: {line}"
        canonical_name = re.sub(r"[-_.]+", "-", name).lower()
        assert canonical_name not in versions
        versions[canonical_name] = version
    return versions


@pytest.mark.parametrize(
    "payload",
    [
        '{"metric": NaN}',
        '{"metric": Infinity}',
        '{"metric": -Infinity}',
        '{"metric": 1, "metric": 2}',
    ],
)
def test_evidence_json_loader_rejects_nonstandard_or_ambiguous_json(payload):
    with pytest.raises(ValueError):
        strict_json_loads(payload)


def full_config(measurement: dict, strategy: str) -> dict:
    return {
        **measurement["simulation_config_without_strategy"],
        "strategy": strategy,
    }


def assert_sweep_invocation(entry: dict, text: str) -> dict:
    result = terminal_json_record(text, "sweep_result=")
    assert result["kind"] == "tossquant.sweep_result"
    assert result["schema_version"] == 1
    assert result["reported_exit_status"] == 0
    for field in (
        "request",
        "invocation",
        "input",
        "verified_splits",
        "code",
        "runtime",
        "simulation_config",
        "cohort",
        "posthoc_exclusion",
        "aggregates",
        "ranked",
        "skipped",
    ):
        assert entry[field] == result[field]
    assert entry["strategy"] == result["simulation_config"]["strategy"]

    observation = result["producer_observation"]
    assert set(observation) == {
        "actual_exit_status",
        "capture",
        "command",
        "environment",
    }
    assert entry["capture"] == observation["capture"] == "stdout_stderr_merged"
    assert entry["actual_exit_status"] == observation["actual_exit_status"] == 0
    assert entry["producer_command"] == observation["command"]
    invocation = entry["invocation"]
    context_line = next(
        line for line in text.splitlines()
        if line.startswith("실행 컨텍스트 ")
    )
    assert json.loads(
        context_line.removeprefix("실행 컨텍스트 "),
        object_pairs_hook=reject_duplicate_json_keys,
    ) == invocation
    assert '실행 종료 {"exit_status": 0}' in text
    return result


def assert_sweep_log(measurement: dict, entry: dict) -> str:
    path = EVIDENCE / entry["log_file"]
    text = path.read_text(encoding="utf-8")
    assert sha256(path) == entry["log_sha256"]
    assert not re.search(r"^(real|user|sys)\s", text, re.MULTILINE)
    assert_sweep_invocation(entry, text)

    aggregates = entry["aggregates"]
    entry_cohort = entry["cohort"]
    assert isinstance(entry_cohort["planned_symbols"], list)
    assert isinstance(entry_cohort["completed_symbols"], list)
    assert entry_cohort["planned_symbols"]
    assert entry_cohort["planned_symbols"] == entry_cohort["completed_symbols"]
    total = aggregates["completed_symbol_count"]
    assert total == len(entry_cohort["completed_symbols"])
    for field in (
        "symbols_strategy_return_gt_benchmark",
        "positive_strategy_returns",
    ):
        assert isinstance(aggregates[field], int) and not isinstance(
            aggregates[field], bool
        )
        assert 0 <= aggregates[field] <= total
    for field in (
        "strategy_return_median",
        "benchmark_return_median",
        "strategy_mdd_median",
        "benchmark_mdd_median",
        "strategy_sharpe_median",
        "benchmark_sharpe_median",
        "cross_sectional_beat_rate",
        "mean_trades",
    ):
        assert isinstance(aggregates[field], (int, float))
        assert not isinstance(aggregates[field], bool)
        assert math.isfinite(aggregates[field])
    assert aggregates["strategy_mdd_median"] >= 0
    assert aggregates["benchmark_mdd_median"] >= 0
    assert aggregates["mean_trades"] >= 0
    assert aggregates["cross_sectional_beat_rate"] == (
        aggregates["symbols_strategy_return_gt_benchmark"] / total
    )

    preparation = measurement["preparation"]
    cohort = measurement["cohort"]
    runtime = measurement["runtime"]
    code = measurement["measurement_code"]
    assert entry["input"]["digest_algorithm"] == preparation[
        "output_digest_algorithm"
    ]
    assert entry["input"]["sha256"] == preparation["output_sha256"]
    entry_preparation = entry["input"]["preparation"]
    assert entry_preparation is not None
    for field in (
        "source_sha256",
        "output_sha256",
        "preparation_schema_version",
        "preparation_tool_sha256",
        "report_sha256",
    ):
        assert entry_preparation[field] == preparation[field]
    assert entry["code"] == code
    assert entry["runtime"] == {
        "python": runtime["python"],
        "pydantic": runtime["pydantic"],
        "pydantic_settings": runtime["pydantic_settings"],
    }
    assert (
        f"입력 발견 {preparation['symbols']}개 · 유효 {preparation['symbols']}개 · "
        f"코호트 {cohort['count']}개 · "
        f"코호트 제외 {preparation['symbols'] - cohort['count']}개 · 오류 0개"
    ) in text
    assert f"기본 코호트 SHA-256={cohort['cohort_sha256']}" in text
    assert (
        f"기본 코호트 timestamp_sha256={cohort['timestamp_sha256']}"
        in text
    )
    assert (
        f"기본 코호트 기간={cohort['first_session']}.."
        f"{cohort['last_session']} · bars={cohort['bars']}"
        in text
    )
    assert (
        "준비 산출물 검증 완료 · "
        f"output_sha256={preparation['output_sha256']} · "
        f"source_sha256={preparation['source_sha256']} · "
        f"schema={preparation['preparation_schema_version']} · "
        f"tool_sha256={preparation['preparation_tool_sha256']} · "
        f"report_sha256={preparation['report_sha256']}"
    ) in text
    assert (
        "측정 요청 "
        + json.dumps(entry["request"], ensure_ascii=False, sort_keys=True)
    ) in text
    assert (
        f"계획 대상 {len(entry_cohort['planned_symbols'])}개 · "
        f"cohort_sha256={entry_cohort['planned_sha256']}"
    ) in text
    assert (
        f"완료 결과 {len(entry_cohort['completed_symbols'])}개 · "
        f"cohort_sha256={entry_cohort['completed_sha256']}"
    ) in text
    assert entry_cohort["planned_sha256"] == entry_cohort["completed_sha256"]
    assert (
        f"측정 코드 SHA-256={code['sha256']} · "
        f"Python={runtime['python']} · pydantic={runtime['pydantic']} · "
        f"pydantic-settings={runtime['pydantic_settings']}"
    ) in text
    assert (
        "고정 시뮬레이션 설정 "
        + json.dumps(
            full_config(measurement, entry["strategy"]),
            ensure_ascii=False,
            sort_keys=True,
        )
    ) in text

    assert f"종목 {total}개 × {cohort['bars']}봉" in text
    assert re.search(
        rf"총수익률 중앙값\s+{aggregates['strategy_return_median'] * 100:.1f}%\s+"
        rf"{aggregates['benchmark_return_median'] * 100:.1f}%",
        text,
    )
    assert re.search(
        rf"MDD 중앙값\s+{aggregates['strategy_mdd_median'] * 100:.1f}%\s+"
        rf"{aggregates['benchmark_mdd_median'] * 100:.1f}%",
        text,
    )
    assert re.search(
        rf"Sharpe 중앙값\s+{aggregates['strategy_sharpe_median']:.2f}\s+"
        rf"{aggregates['benchmark_sharpe_median']:.2f}",
        text,
    )
    assert (
        "바이앤홀드를 이긴 종목  "
        f"{aggregates['symbols_strategy_return_gt_benchmark']}/{total} "
        f"({aggregates['cross_sectional_beat_rate'] * 100:.1f}%)"
    ) in text
    assert (
        "수익이 난 종목          "
        f"{aggregates['positive_strategy_returns']}/{total}"
    ) in text
    assert f"평균 거래 횟수          {aggregates['mean_trades']:.1f}" in text
    return text


def test_preparation_report_and_measurement_are_bound_to_current_code():
    report = load_json("plotly-preparation-report-v5.json")
    measurement = load_json(MEASUREMENT_FILE)
    prepared = measurement["preparation"]
    code = measurement["measurement_code"]

    assert measurement["measurement_schema_version"] == 6
    assert measurement["artifact_version"] == GENERATED_ARTIFACT_VERSION
    assert measurement["effective_date"] == GENERATED_EFFECTIVE_DATE
    assert "measured_on" not in measurement
    execution_started_at = datetime.fromisoformat(
        measurement["execution_started_at_utc"].replace("Z", "+00:00")
    )
    assert execution_started_at.tzinfo == timezone.utc
    assert report["preparation_schema_version"] == 5
    assert report["preparation_tool_version"] == "prepare_plotly_data/5"
    assert report["output_digest_algorithm"] == "sha256-filename-size-content-v1"
    assert report["timestamp_digest_algorithm"] == TIMESTAMP_DIGEST_ALGORITHM
    assert report["report_digest_algorithm"] == "sha256-canonical-json-v1"
    report_payload = {
        key: value for key, value in report.items() if key != "report_sha256"
    }
    assert canonical_json_sha256(report_payload) == report["report_sha256"]
    assert {
        "source_kind": report["source_kind"],
        "source_url": report["source_url"],
        "source_commit": report["source_commit"],
        "source_path": report["source_path"],
        "source_sha256": report["source_sha256"],
        "input_rows": report["input_rows"],
        "output_sha256": report["output_sha256"],
        "dropped_rows_sha256": canonical_json_sha256(report["dropped_rows"]),
    } == {
        "source_kind": "plotly_pinned",
        "source_url": PLOTLY_SOURCE_URL,
        "source_commit": PLOTLY_SOURCE_COMMIT,
        "source_path": None,
        "source_sha256": PLOTLY_SOURCE_SHA256,
        "input_rows": PLOTLY_INPUT_ROWS,
        "output_sha256": PLOTLY_OUTPUT_SHA256,
        "dropped_rows_sha256": PLOTLY_DROPPED_ROWS_SHA256,
    }

    live_hashes = {
        "preparation_tool_sha256": sha256(
            ROOT / "scripts" / "prepare_plotly_data.py"
        ),
        "backtest_data_sha256": sha256(
            ROOT / "src" / "tossquant" / "backtest" / "data.py"
        ),
        "candle_model_sha256": sha256(
            ROOT / "src" / "tossquant" / "models.py"
        ),
    }
    for field, live in live_hashes.items():
        assert report[field] == live
        assert prepared[field] == live

    for field in (
        "preparation_schema_version",
        "preparation_tool_version",
        "backtest_data_module",
        "candle_model_module",
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
    ):
        assert prepared[field] == report[field]
    assert canonical_json_sha256(report["dropped_rows"]) == (
        PLOTLY_DROPPED_ROWS_SHA256
    )
    assert prepared["dropped_rows"] == len(report["dropped_rows"])
    assert prepared["missing_rows"] == sum(
        "missing" in row for row in report["dropped_rows"]
    )
    assert prepared["invalid_ohlcv_rows"] == sum(
        "invalid" in row for row in report["dropped_rows"]
    )
    assert set(report["symbol_rows"]) == set(report["symbol_timestamp_sha256"])
    assert set(report["symbol_rows"]) == set(report["symbol_timestamp_bounds"])
    assert all(
        re.fullmatch(r"[0-9a-f]{64}", digest)
        for digest in report["symbol_timestamp_sha256"].values()
    )
    assert all(
        isinstance(bounds, dict)
        and set(bounds) == {"first", "last"}
        and all(isinstance(value, str) for value in bounds.values())
        for bounds in report["symbol_timestamp_bounds"].values()
    )

    assert code["digest_algorithm"] == "sha256-relative-path-content-v1"
    assert measurement_code_sha256() == code["sha256"]


def test_measurement_runtime_is_bound_to_the_tracked_lockfile():
    measurement = load_json(MEASUREMENT_FILE)
    runtime = measurement["runtime"]
    lock_path = EVIDENCE / runtime["requirements_file"]
    build_lock_path = EVIDENCE / runtime["build_requirements_file"]

    assert lock_path.name == "requirements-measurement.txt"
    assert sha256(lock_path) == runtime["requirements_sha256"]
    assert build_lock_path.name == "requirements-build.txt"
    assert sha256(build_lock_path) == runtime["build_requirements_sha256"]
    locked = locked_measurement_versions(lock_path)
    build_locked = locked_measurement_versions(build_lock_path)
    for name in locked.keys() & build_locked.keys():
        assert locked[name] == build_locked[name]
    all_locked = {**build_locked, **locked}
    assert locked["pydantic"] == runtime["pydantic"]
    assert locked["pydantic-settings"] == runtime["pydantic_settings"]

    workflow = (ROOT.parent / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )
    for fragment in (
        "pip install -r evidence/requirements-build.txt",
        "pip install -r evidence/requirements-measurement.txt",
        "pip install -e . --no-deps --no-build-isolation",
        "pip install -e '.[dev]' --no-build-isolation",
        "python -m pip wheel . --no-deps --no-build-isolation",
    ):
        assert fragment in workflow

    runtime_step = workflow_step(workflow, "Verify recorded measurement runtime")
    matrix_versions = re.search(
        r"(?m)^        python-version: (\[[^\n]+\])$", workflow
    )
    assert matrix_versions is not None
    assert "3.12.13" in json.loads(matrix_versions.group(1))
    assert re.search(
        r"(?m)^        if: matrix\.python-version == ['\"]3\.12\.13['\"]$",
        runtime_step,
    )
    assert re.search(
        r'(?m)^        env:\n          '
        r'TOSSQUANT_ASSERT_EVIDENCE_RUNTIME: ["\']1["\']$',
        runtime_step,
    )
    assert re.search(
        r"(?m)^        run: pytest -q tests/test_evidence\.py$",
        runtime_step,
    )

    if os.environ.get("TOSSQUANT_ASSERT_EVIDENCE_RUNTIME") == "1":
        assert platform.python_version() == runtime["python"]
        installed = {
            re.sub(r"[-_.]+", "-", distribution.metadata["Name"]).lower():
            distribution.version
            for distribution in importlib.metadata.distributions()
            if distribution.metadata["Name"]
        }
        assert {
            name: installed.get(name) for name in all_locked
        } == all_locked


def test_ci_runs_the_standalone_tracked_v5_bundle_check_on_exact_runtime():
    workflow = (ROOT.parent / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )
    step = workflow_step(workflow, "Verify tracked evidence bundle")
    assert re.search(
        r"(?m)^        if: matrix\.python-version == ['\"]3\.12\.13['\"]$",
        step,
    )
    for fragment in (
        "python -I scripts/build_plotly_evidence.py",
        "--output-dir evidence",
        "--manifest evidence/plotly-verified-splits.csv",
        "--readme README.md",
        f"--artifact-version {GENERATED_ARTIFACT_VERSION}",
        "--check",
    ):
        assert fragment in step
    assert "--prepared-dir" not in step
    assert "--effective-date" not in step
    assert "--measured-on" not in step


@pytest.mark.skipif(
    platform.python_version() != "3.12.13",
    reason="tracked evidence bundle은 고정 Python 3.12.13에서 검증",
)
def test_tracked_v5_bundle_is_rederived_without_external_prepared_csv():
    completed = subprocess.run(
        [
            sys.executable,
            "-I",
            "scripts/build_plotly_evidence.py",
            "--output-dir",
            "evidence",
            "--manifest",
            "evidence/plotly-verified-splits.csv",
            "--readme",
            "README.md",
            "--artifact-version",
            GENERATED_ARTIFACT_VERSION,
            "--check",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_exact_timestamp_cohort_is_bound_to_prepared_report_and_logs():
    report = load_json("plotly-preparation-report-v5.json")
    measurement = load_json(MEASUREMENT_FILE)
    cohort = load_json(measurement["cohort"]["manifest"])

    max_rows = max(report["symbol_rows"].values())
    eligible_symbols = sorted(
        symbol
        for symbol, rows in report["symbol_rows"].items()
        if rows == max_rows
    )
    groups: dict[str, list[str]] = defaultdict(list)
    for symbol in eligible_symbols:
        groups[report["symbol_timestamp_sha256"][symbol]].append(symbol)
    expected_timestamp_sha256, expected_symbols = min(
        groups.items(),
        key=lambda item: (-len(item[1]), tuple(sorted(item[1]))),
    )
    expected_symbols = sorted(expected_symbols)
    expected_bounds = report["symbol_timestamp_bounds"][expected_symbols[0]]
    assert all(
        report["symbol_timestamp_bounds"][symbol] == expected_bounds
        for symbol in expected_symbols
    )
    expected_first_session = expected_bounds["first"].split("T", 1)[0]
    expected_last_session = expected_bounds["last"].split("T", 1)[0]
    assert cohort["selection"] == measurement["cohort"]["selection"]
    assert cohort["prepared_output_sha256"] == measurement["preparation"][
        "output_sha256"
    ]
    assert cohort["bars"] == max_rows == measurement["cohort"]["bars"]
    assert cohort["symbols"] == expected_symbols
    assert cohort["symbols"] == measurement["cohort"]["symbols"]
    assert cohort["count"] == len(expected_symbols)
    assert cohort["count"] == measurement["cohort"]["count"]
    assert cohort["first_session"] == expected_first_session
    assert cohort["first_session"] == measurement["cohort"]["first_session"]
    assert cohort["last_session"] == expected_last_session
    assert cohort["last_session"] == measurement["cohort"]["last_session"]
    assert cohort["timestamp_digest_algorithm"] == TIMESTAMP_DIGEST_ALGORITHM
    assert cohort["timestamp_digest_algorithm"] == measurement["cohort"][
        "timestamp_digest_algorithm"
    ]
    assert cohort["timestamp_sha256"] == expected_timestamp_sha256
    assert cohort["timestamp_sha256"] == measurement["cohort"][
        "timestamp_sha256"
    ]
    assert cohort["cohort_digest_algorithm"] == COHORT_DIGEST_ALGORITHM
    assert cohort["cohort_digest_algorithm"] == measurement["cohort"][
        "cohort_digest_algorithm"
    ]
    expected_cohort_sha256 = canonical_json_sha256(
        {
            "algorithm": COHORT_DIGEST_ALGORITHM,
            "bars": max_rows,
            "first_session": expected_first_session,
            "last_session": expected_last_session,
            "symbols": expected_symbols,
            "timestamp_sha256": expected_timestamp_sha256,
        }
    )
    assert cohort["cohort_sha256"] == expected_cohort_sha256
    assert cohort["cohort_sha256"] == measurement["cohort"]["cohort_sha256"]


def test_scan_and_all_sweep_logs_match_the_structured_measurement():
    measurement = load_json(MEASUREMENT_FILE)
    scan = measurement["scan"]
    scan_path = EVIDENCE / scan["log_file"]
    scan_text = scan_path.read_text(encoding="utf-8")

    assert sha256(scan_path) == scan["log_sha256"]
    result = terminal_json_record(scan_text, "scan_result=")
    assert result["kind"] == "tossquant.scan_result"
    assert result["schema_version"] == 1
    assert result["reported_exit_status"] == 0
    for field in (
        "request",
        "invocation",
        "input",
        "code",
        "runtime",
        "processed",
        "skipped_files",
        "break_count",
        "categories",
    ):
        assert scan[field] == result[field]
    observation = result["producer_observation"]
    assert set(observation) == {
        "actual_exit_status",
        "capture",
        "command",
        "environment",
    }
    assert scan["capture"] == observation["capture"] == "stdout_stderr_merged"
    assert scan["actual_exit_status"] == observation["actual_exit_status"] == 0
    assert scan["producer_command"] == observation["command"]
    scan_context = next(
        line for line in scan_text.splitlines()
        if line.startswith("scan_context=")
    )
    assert json.loads(
        scan_context.removeprefix("scan_context="),
        object_pairs_hook=reject_duplicate_json_keys,
    ) == scan["invocation"]
    assert "scan_exit_status=0" in scan_text
    assert scan["input"]["digest_algorithm"] == measurement["preparation"][
        "output_digest_algorithm"
    ]
    assert scan["input"]["sha256"] == measurement["preparation"]["output_sha256"]
    assert scan["code"]["digest_algorithm"] == PACKAGE_CODE_DIGEST_ALGORITHM
    assert scan["code"]["sha256"] == package_code_sha256()
    assert scan["processed"] + len(scan["skipped_files"]) == measurement[
        "preparation"
    ]["symbols"]
    assert scan["break_count"] == sum(
        len(scan["categories"][field])
        for field in (
            "candidate_adjustments",
            "transient_or_roundtrip",
            "unknown_down",
            "unknown_up",
        )
    )
    assert f"scan_input={scan['input']['sha256']}" in scan_text
    assert f"scan_code={scan['code']['sha256']}" in scan_text
    assert (
        f"{scan['processed']}개 처리 · {len(scan['skipped_files'])}개 건너뜀 · "
        f"불연속 {scan['break_count']}건"
    ) in scan_text
    for label, key in (
        ("분할비 후보", "candidate_adjustments"),
        ("왕복·일시 불연속", "transient_or_roundtrip"),
        ("미확인 하락 갭", "unknown_down"),
        ("원인 불명 상승 갭", "unknown_up"),
    ):
        assert re.search(
            rf"{label}.*\({len(scan['categories'][key])}건\)", scan_text
        )

    for entry in measurement["raw_sweeps"].values():
        assert entry["cohort"]["planned_symbols"] == measurement["cohort"][
            "symbols"
        ]
        assert_sweep_log(measurement, entry)

    sensitivity = measurement["posthoc_sensitivity"]
    cohort_manifest = load_json(measurement["cohort"]["manifest"])
    assert sensitivity["warning"] == (
        "Full-period exclusions use future information and are not an "
        "unbiased cleaned estimate."
    )
    warn_text = assert_sweep_log(measurement, sensitivity["warn_exclude"])
    adjust_text = assert_sweep_log(
        measurement, sensitivity["verified_adjust_exclude"]
    )
    for entry, text in (
        (sensitivity["warn_exclude"], warn_text),
        (sensitivity["verified_adjust_exclude"], adjust_text),
    ):
        assert "사후 전체기간 민감도 필터" in text
        assert "편향 없는 성과로 해석할 수 없습니다" in text
        exclusion = entry["posthoc_exclusion"]
        excluded = exclusion["symbols"]
        assert exclusion["uses_future_information"] is True
        assert exclusion["unbiased_estimate"] is False
        assert excluded == sorted(set(excluded))
        planned_symbols = entry["cohort"]["planned_symbols"]
        assert len(planned_symbols) == measurement["cohort"]["count"] - len(
            excluded
        )
        remaining_symbols = sorted(
            set(cohort_manifest["symbols"]) - set(excluded)
        )
        assert planned_symbols == remaining_symbols
        expected_filtered_cohort_sha256 = canonical_json_sha256(
            {
                "algorithm": COHORT_DIGEST_ALGORITHM,
                "bars": measurement["cohort"]["bars"],
                "first_session": measurement["cohort"]["first_session"],
                "last_session": measurement["cohort"]["last_session"],
                "symbols": remaining_symbols,
                "timestamp_sha256": measurement["cohort"]["timestamp_sha256"],
            }
        )
        assert entry["cohort"]["planned_sha256"] == expected_filtered_cohort_sha256
        assert entry["cohort"]["completed_sha256"] == expected_filtered_cohort_sha256
        assert (
            '사후 민감도 계약 {"unbiased_estimate": false, '
            '"uses_future_information": true}'
        ) in text
        assert (
            f"사후 의심 종목 {len(excluded)}개 제외: "
            + ", ".join(excluded)
        ) in text
    adjusted = sensitivity["verified_adjust_exclude"]
    manifest_sha256 = measurement["verified_splits"]["sha256"]
    assert adjusted["verified_splits"] == {"sha256": manifest_sha256}
    assert sha256(EVIDENCE / "plotly-verified-splits.csv") == manifest_sha256
    assert f"검증 승수 SHA-256={manifest_sha256}" in adjust_text


def test_tracked_disck_fixture_binds_the_one_symbol_runs_to_prepared_output():
    fixture = EVIDENCE / "plotly-DISCK.csv"
    content = fixture.read_bytes()
    assert hashlib.sha256(content).hexdigest() == PLOTLY_DISCK_FILE_SHA256

    measurement = load_json(MEASUREMENT_FILE)
    report = load_json("plotly-preparation-report-v5.json")
    entries = measurement["posthoc_sensitivity"]["disck"]
    candles = CsvSource(EVIDENCE).fetch("plotly-DISCK", "1d", 0)
    timestamp_sha256 = hashlib.sha256(
        b"".join(candle.ts.isoformat().encode("utf-8") + b"\n" for candle in candles)
    ).hexdigest()
    first_session = candles[0].ts.date().isoformat()
    last_session = candles[-1].ts.date().isoformat()
    one_file_sha256 = one_file_dataset_sha256("DISCK.csv", content)
    cohort_sha256 = canonical_json_sha256(
        {
            "algorithm": COHORT_DIGEST_ALGORITHM,
            "bars": len(candles),
            "first_session": first_session,
            "last_session": last_session,
            "symbols": ["DISCK"],
            "timestamp_sha256": timestamp_sha256,
        }
    )

    assert len(candles) == report["symbol_rows"]["DISCK"]
    assert timestamp_sha256 == report["symbol_timestamp_sha256"]["DISCK"]
    assert report["symbol_timestamp_bounds"]["DISCK"] == {
        "first": candles[0].ts.isoformat(),
        "last": candles[-1].ts.isoformat(),
    }
    for entry in entries.values():
        assert entry["input"] == {
            "digest_algorithm": "sha256-filename-size-content-v1",
            "preparation": None,
            "sha256": one_file_sha256,
        }
        entry_cohort = entry["cohort"]
        assert entry_cohort["timestamp_digest_algorithm"] == (
            TIMESTAMP_DIGEST_ALGORITHM
        )
        assert entry_cohort["timestamp_sha256"] == timestamp_sha256
        assert entry_cohort["first_session"] == first_session
        assert entry_cohort["last_session"] == last_session
        assert entry_cohort["bars"] == len(candles)
        assert entry_cohort["base_symbols"] == ["DISCK"]
        assert entry_cohort["planned_symbols"] == ["DISCK"]
        assert entry_cohort["completed_symbols"] == ["DISCK"]
        assert entry_cohort["base_sha256"] == cohort_sha256
        assert entry_cohort["planned_sha256"] == cohort_sha256
        assert entry_cohort["completed_sha256"] == cohort_sha256


def test_disck_exact_byte_fixture_is_exempt_from_git_text_normalization():
    relative = (EVIDENCE / "plotly-DISCK.csv").relative_to(ROOT.parent)
    result = subprocess.run(
        ["git", "check-attr", "text", "--", relative.as_posix()],
        cwd=ROOT.parent,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == f"{relative.as_posix()}: text: unset"


def test_hash_bound_text_files_have_checkout_stable_lf_attributes():
    relative_paths = [
        "trading/pyproject.toml",
        "trading/README.md",
        "trading/scripts/build_plotly_evidence.py",
        "trading/scripts/prepare_plotly_data.py",
        "trading/scripts/sweep.py",
        "trading/src/tossquant/cli.py",
        "trading/src/tossquant/strategy/sma_cross.py",
        "trading/evidence/README.md",
        "trading/evidence/requirements-build.txt",
        "trading/evidence/requirements-measurement.txt",
        "trading/evidence/plotly-verified-splits.csv",
        "trading/evidence/disck-issuer-citation.json",
        "trading/evidence/plotly-measurement-v5.json",
        "trading/evidence/plotly-scan-v5.txt",
    ]
    result = subprocess.run(
        ["git", "check-attr", "text", "eol", "--", *relative_paths],
        cwd=ROOT.parent,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    attributes: dict[tuple[str, str], str] = {}
    for line in result.stdout.splitlines():
        path, attribute, value = line.rsplit(": ", 2)
        attributes[(path, attribute)] = value
    for path in relative_paths:
        assert attributes[(path, "text")] == "set"
        assert attributes[(path, "eol")] == "lf"


def test_evidence_docs_include_non_destructive_full_regeneration_recipe():
    evidence_readme = (EVIDENCE / "README.md").read_text(encoding="utf-8")
    required_fragments = (
        'evidence_scratch="$(mktemp -d)"',
        'cp README.md "$evidence_scratch/README.md"',
        'mkdir "$evidence_scratch/evidence"',
        "python -I scripts/build_plotly_evidence.py \\",
        "--prepared-dir ./data \\",
        f"--effective-date {GENERATED_EFFECTIVE_DATE} \\",
        '--output-dir "$evidence_scratch/evidence" \\',
        '--readme "$evidence_scratch/README.md" \\',
        '--artifact-version v5',
        '--artifact-version v5 \\\n  --check',
        'cmp "evidence/$evidence_file" \\\n    "$evidence_scratch/evidence/$evidence_file"',
        'cmp README.md "$evidence_scratch/README.md"',
    )
    for fragment in required_fragments:
        assert fragment in evidence_readme
    assert evidence_readme.count("python -I scripts/build_plotly_evidence.py") == 3
    regeneration_start = evidence_readme.index('evidence_scratch="$(mktemp -d)"')
    regeneration_end = evidence_readme.index("```", regeneration_start)
    regeneration = evidence_readme[regeneration_start:regeneration_end]
    first_command_end = regeneration.index("\n\n", regeneration.index("python -I"))
    first_command = regeneration[:first_command_end]
    assert "--prepared-dir ./data" in first_command
    assert f"--effective-date {GENERATED_EFFECTIVE_DATE}" in first_command
    assert "--check" not in first_command
    commands = re.findall(
        r"python -I scripts/build_plotly_evidence\.py .*?(?=\n\n|```)",
        evidence_readme,
        flags=re.DOTALL,
    )
    check_commands = [command for command in commands if "--check" in command]
    assert check_commands
    assert all("--effective-date" not in command for command in check_commands)
    assert "execution_started_at_utc" in evidence_readme
    assert re.search(r"사용자\s+선언 유효일", evidence_readme)
    expected_artifacts = (
        "plotly-scan-v5.txt",
        "plotly-sweep-sma-raw-v5.txt",
        "plotly-sweep-momentum-v5.txt",
        "plotly-sweep-breakout-v5.txt",
        "plotly-sweep-mean-reversion-v5.txt",
        "plotly-sweep-sma-posthoc-exclude-v5.txt",
        "plotly-sweep-sma-verified-adjust-posthoc-exclude-v5.txt",
        "plotly-sweep-disck-raw-v5.txt",
        "plotly-sweep-disck-adjust-v5.txt",
        "plotly-cohort-v5.json",
        "plotly-preparation-report-v5.json",
        "plotly-measurement-v5.json",
        "plotly-readme-v5.json",
    )
    for name in expected_artifacts:
        assert name in regeneration


def test_disck_logs_support_only_the_displayed_precision_and_class_change():
    measurement = load_json(MEASUREMENT_FILE)
    entries = measurement["posthoc_sensitivity"]["disck"]
    for label, expected_wins in (("raw", 1), ("adjusted", 0)):
        entry = entries[label]
        path = EVIDENCE / entry["log_file"]
        text = path.read_text(encoding="utf-8")
        assert sha256(path) == entry["log_sha256"]
        assert_sweep_invocation(entry, text)
        aggregates = entry["aggregates"]
        entry_cohort = entry["cohort"]
        assert isinstance(aggregates["symbols_strategy_return_gt_benchmark"], int)
        assert 0 <= aggregates["symbols_strategy_return_gt_benchmark"] <= 1
        assert all(
            isinstance(aggregates[field], (int, float))
            and not isinstance(aggregates[field], bool)
            and math.isfinite(aggregates[field])
            for field in (
                "strategy_return_median",
                "benchmark_return_median",
            )
        )
        assert re.search(
            rf"총수익률 중앙값\s+"
            rf"{aggregates['strategy_return_median'] * 100:.1f}%\s+"
            rf"{aggregates['benchmark_return_median'] * 100:.1f}%",
            text,
        )
        assert aggregates["symbols_strategy_return_gt_benchmark"] == expected_wins
        assert aggregates["completed_symbol_count"] == 1
        assert entry_cohort["planned_symbols"] == ["DISCK"]
        assert entry_cohort["completed_symbols"] == ["DISCK"]
        assert entry["input"]["digest_algorithm"] == measurement["preparation"][
            "output_digest_algorithm"
        ]
        assert (
            "측정 요청 "
            + json.dumps(entry["request"], ensure_ascii=False, sort_keys=True)
        ) in text
        assert f"바이앤홀드를 이긴 종목  {expected_wins}/1" in text
        assert f"측정 코드 SHA-256={measurement['measurement_code']['sha256']}" in text
        assert f"기본 코호트 SHA-256={entry_cohort['base_sha256']}" in text
        assert (
            f"기본 코호트 timestamp_sha256={entry_cohort['timestamp_sha256']}"
            in text
        )
        assert f"input_sha256={entry['input']['sha256']}" in text
        assert (
            f"계획 대상 1개 · cohort_sha256={entry_cohort['planned_sha256']}"
            in text
        )
        assert (
            f"완료 결과 1개 · cohort_sha256={entry_cohort['completed_sha256']}"
            in text
        )
    manifest_sha = measurement["verified_splits"]["sha256"]
    assert entries["raw"]["verified_splits"] is None
    assert entries["adjusted"]["verified_splits"] == {"sha256": manifest_sha}
    adjusted_text = (
        EVIDENCE / entries["adjusted"]["log_file"]
    ).read_text(encoding="utf-8")
    assert f"검증 승수 SHA-256={manifest_sha}" in adjusted_text


def test_verified_manifest_and_readme_match_tracked_measurement():
    measurement = load_json(MEASUREMENT_FILE)
    manifest = EVIDENCE / "plotly-verified-splits.csv"
    actions = load_verified_splits(manifest)
    manifest_sha256 = measurement["verified_splits"]["sha256"]
    assert sha256(manifest) == manifest_sha256
    assert measurement["posthoc_sensitivity"]["verified_adjust_exclude"][
        "verified_splits"
    ] == {"sha256": manifest_sha256}
    assert set(actions) == {"DISCK"}
    action = actions["DISCK"][0]
    assert action.effective_date.isoformat() == "2014-08-07"
    assert action.ratio == Decimal("0.5")
    assert action.event_type == "same_class_stock_dividend"
    assert action.source.startswith("https://ir.wbd.com/")

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    preparation = measurement["preparation"]
    scan = measurement["scan"]
    sensitivity = measurement["posthoc_sensitivity"]
    metric_entries = (
        measurement["raw_sweeps"]["sma_cross"],
        sensitivity["warn_exclude"],
        sensitivity["verified_adjust_exclude"],
    )
    fragments = [
        f"schema {preparation['preparation_schema_version']}",
        f"출력 {preparation['written_rows']:,}행",
        f"불연속 {scan['break_count']}건",
    ]
    fragments.extend(
        (
            f"{entry['aggregates']['symbols_strategy_return_gt_benchmark']}/"
            f"{entry['aggregates']['completed_symbol_count']} "
            f"({entry['aggregates']['cross_sectional_beat_rate'] * 100:.1f}%)"
        )
        for entry in metric_entries
    )
    for fragment in fragments:
        assert fragment in readme

    evidence_readme = (EVIDENCE / "README.md").read_text(encoding="utf-8")
    for fragment in (
        "scripts/prepare_plotly_data.py",
        measurement["preparation"]["report_file"],
        "preparation_tool_version",
        "preparation_tool_sha256",
        "measurement_code.sha256",
        "scan.code.sha256",
        measurement["cohort"]["manifest"],
        MEASUREMENT_FILE,
    ):
        assert fragment in evidence_readme

    # Derived hashes change whenever the reviewed implementation changes. Keep
    # one canonical value in the structured artifacts instead of copying stale
    # values into this static regeneration guide. The pinned upstream source is
    # the guide's only literal SHA-256 identity.
    documented_sha256 = set(re.findall(r"\b[0-9a-f]{64}\b", evidence_readme))
    assert documented_sha256 == {measurement["preparation"]["source_sha256"]}


def test_disck_manifest_and_docs_are_bound_to_an_auditable_issuer_record():
    citation = load_json("disck-issuer-citation.json")
    assert citation["citation_schema_version"] == 1
    assert citation["issuer"] == "Discovery Communications, Inc."

    canonical = citation["canonical_page"]
    assert canonical == {
        "url": DISCK_ISSUER_CANONICAL_URL,
        "page_title": (
            "Warner Bros. Discovery - Stock Information - Cost Basis & Debt "
            "Information - Series C Dividend"
        ),
        "retrieved_on": "2026-08-08",
        "direct_fetch_status": "cloudflare_challenge",
        "raw_content_archived": False,
        "raw_content_sha256": None,
    }

    fetched = citation["fetched_content"]
    assert fetched == {
        "url": DISCK_ISSUER_FORM_8937_URL,
        "page_title": (
            "Form 8937 Report of Organizational Actions Affecting Basis of "
            "Securities"
        ),
        "retrieved_on": "2026-08-08",
        "media_type": "application/pdf",
        "fetch_method": (
            "curl -fsSL --max-time 30 -A tossquant-evidence-audit/1.0 "
            "-H 'Accept-Encoding: identity'"
        ),
        "fetch_count": 2,
        "repeat_fetches_byte_identical": True,
        "byte_length": 1_255_915,
        "sha256": DISCK_ISSUER_FORM_8937_SHA256,
        "content_archived": False,
    }

    facts = citation["facts"]
    assert facts == {
        "source": "fetched_content",
        "record_date": "2014-07-28",
        "distribution_date": "2014-08-06",
        "first_post_distribution_trading_date": "2014-08-07",
        "same_class_distribution": {
            "held_class": "Series C common stock",
            "held_symbol": "DISCK",
            "shares_held": 1,
            "distributed_class": "Series C common stock",
            "distributed_symbol": "DISCK",
            "shares_distributed": 1,
        },
        "basis_allocation": {
            "status": "illustrative_example",
            "method": "volume-weighted average prices on 2014-08-07",
            "existing_series_c": "50.00",
            "distributed_series_c": "50.00",
        },
    }
    derivation = citation["adjustment_ratio_derivation"]
    assert derivation == {
        "old_shares": 1,
        "new_shares": 2,
        "formula": "old_shares / new_shares",
        "ratio": "0.5",
    }
    distribution = facts["same_class_distribution"]
    assert derivation["old_shares"] == distribution["shares_held"]
    assert derivation["new_shares"] == (
        distribution["shares_held"] + distribution["shares_distributed"]
    )
    assert Decimal(derivation["ratio"]) == Decimal(derivation["old_shares"]) / Decimal(
        derivation["new_shares"]
    )
    basis = facts["basis_allocation"]
    assert Decimal(basis["existing_series_c"]) + Decimal(
        basis["distributed_series_c"]
    ) == Decimal("100.00")

    limitations = citation["limitations"]
    assert isinstance(limitations, list) and len(limitations) == 2
    assert any(
        "canonical live page is mutable" in limitation
        and "not archived or hashed" in limitation
        for limitation in limitations
    )
    assert any(
        "issuer PDF is not archived" in limitation
        and "URL remains mutable" in limitation
        for limitation in limitations
    )

    manifest = EVIDENCE / "plotly-verified-splits.csv"
    action = load_verified_splits(manifest)["DISCK"][0]
    assert action.source == canonical["url"]
    assert action.effective_date.isoformat() == facts[
        "first_post_distribution_trading_date"
    ]
    assert action.event_type == "same_class_stock_dividend"
    assert action.ratio == Decimal(derivation["ratio"])
    assert distribution["held_class"] == distribution["distributed_class"]
    assert distribution["held_symbol"] == distribution["distributed_symbol"]

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    evidence_readme = (EVIDENCE / "README.md").read_text(encoding="utf-8")
    readme_disck = markdown_section_containing(
        readme, "현재 예시 매니페스트가 조정하는 것은 DISCK 한 건뿐이다."
    )
    evidence_disck = markdown_section(
        evidence_readme,
        "### DISCK — 첫 post-action 거래일 2014-08-07, 이론 계수 0.5",
    )
    assert readme_disck is not None
    assert evidence_disck is not None
    assert f"]({canonical['url']})" in readme_disck
    assert "evidence/disck-issuer-citation.json" in readme_disck
    assert f"]({canonical['url']})" in evidence_disck
    assert "disck-issuer-citation.json" in evidence_disck


def test_evidence_reproduction_docs_pin_the_recorded_runtime_and_bootstrap():
    measurement = load_json(MEASUREMENT_FILE)
    assert measurement["runtime"]["python"] == "3.12.13"
    assert 'requires-python = ">=3.11"' in (ROOT / "pyproject.toml").read_text(
        encoding="utf-8"
    )

    normal_runtime_statement = "일반 앱은 Python 3.11 이상을 지원한다."
    evidence_runtime_statement = (
        "게시된 증거의 재현·검증 런타임은 Python 3.12.13으로 고정한다."
    )
    bootstrap_commands = (
        "uv venv --python 3.12.13 .venv-evidence",
        (
            "uv pip install --python .venv-evidence/bin/python "
            "-r evidence/requirements-build.txt"
        ),
        (
            "uv pip install --python .venv-evidence/bin/python "
            "-r evidence/requirements-measurement.txt"
        ),
        (
            "uv pip install --python .venv-evidence/bin/python -e . "
            "--no-deps --no-build-isolation"
        ),
        "source .venv-evidence/bin/activate",
    )
    for path in (ROOT / "README.md", EVIDENCE / "README.md"):
        text = path.read_text(encoding="utf-8")
        assert normal_runtime_statement in text
        assert evidence_runtime_statement in text
        for command in bootstrap_commands:
            assert command in text


def test_every_current_readme_metric_row_matches_the_structured_measurement():
    measurement = load_json(MEASUREMENT_FILE)
    readme = (ROOT / "README.md").read_text(encoding="utf-8")

    def signed_pct(value: float) -> str:
        return f"{value:+.1f}%"

    for strategy in ("sma_cross", "momentum", "breakout", "mean_reversion"):
        entry = measurement["raw_sweeps"][strategy]
        aggregates = entry["aggregates"]
        assert markdown_table_row(readme, strategy, 6) == [
            strategy,
            (
                f"{signed_pct(aggregates['strategy_return_median'] * 100)} / "
                f"{signed_pct(aggregates['benchmark_return_median'] * 100)}"
            ),
            (
                f"{aggregates['strategy_mdd_median'] * 100:.1f}% / "
                f"{aggregates['benchmark_mdd_median'] * 100:.1f}%"
            ),
            (
                f"{aggregates['strategy_sharpe_median']:.2f} / "
                f"{aggregates['benchmark_sharpe_median']:.2f}"
            ),
            f"{aggregates['cross_sectional_beat_rate'] * 100:.1f}%",
            f"{aggregates['mean_trades']:.1f}",
        ]

    raw = measurement["raw_sweeps"]["sma_cross"]
    warn = measurement["posthoc_sensitivity"]["warn_exclude"]
    adjusted = measurement["posthoc_sensitivity"]["verified_adjust_exclude"]
    entries = (raw, warn, adjusted)
    assert markdown_table_row(readme, "대상 종목", 4) == [
        "대상 종목",
        str(raw["aggregates"]["completed_symbol_count"]),
        (
            f"{warn['aggregates']['completed_symbol_count']} "
            f"({len(warn['posthoc_exclusion']['symbols'])} 제외)"
        ),
        (
            f"{adjusted['aggregates']['completed_symbol_count']} "
            f"({len(adjusted['posthoc_exclusion']['symbols'])} 제외)"
        ),
    ]
    assert markdown_table_row(readme, "전략 수익 중앙값", 4) == [
        "전략 수익 중앙값",
        *(
            signed_pct(entry["aggregates"]["strategy_return_median"] * 100)
            for entry in entries
        ),
    ]
    assert markdown_table_row(readme, "바이앤홀드 수익 중앙값", 4) == [
        "바이앤홀드 수익 중앙값",
        *(
            signed_pct(entry["aggregates"]["benchmark_return_median"] * 100)
            for entry in entries
        ),
    ]
    assert markdown_table_row(readme, "전략/벤치 MDD 중앙값", 4) == [
        "전략/벤치 MDD 중앙값",
        *(
            f"{entry['aggregates']['strategy_mdd_median'] * 100:.1f}% / "
            f"{entry['aggregates']['benchmark_mdd_median'] * 100:.1f}%"
            for entry in entries
        ),
    ]
    assert markdown_table_row(readme, "전략/벤치 Sharpe 중앙값", 4) == [
        "전략/벤치 Sharpe 중앙값",
        *(
            f"{entry['aggregates']['strategy_sharpe_median']:.2f} / "
            f"{entry['aggregates']['benchmark_sharpe_median']:.2f}"
            for entry in entries
        ),
    ]
    assert markdown_table_row(readme, "바이앤홀드 초과 종목 비율", 4) == [
        "바이앤홀드 초과 종목 비율",
        *(
            f"{entry['aggregates']['symbols_strategy_return_gt_benchmark']}/"
            f"{entry['aggregates']['completed_symbol_count']} "
            f"({entry['aggregates']['cross_sectional_beat_rate'] * 100:.1f}%)"
            for entry in entries
        ),
    ]

    prose = re.sub(r"\s+", " ", readme)
    disck = measurement["posthoc_sensitivity"]["disck"]
    assert (
        "DISCK는 원본에서 전략 "
        f"{signed_pct(disck['raw']['aggregates']['strategy_return_median'] * 100)}, "
        f"벤치 {signed_pct(disck['raw']['aggregates']['benchmark_return_median'] * 100)}"
    ) in prose
    assert (
        "조정 후 전략 "
        f"{signed_pct(disck['adjusted']['aggregates']['strategy_return_median'] * 100)}, "
        f"벤치 {signed_pct(disck['adjusted']['aggregates']['benchmark_return_median'] * 100)}"
    ) in prose


@pytest.mark.parametrize(
    "exact_claim",
    (
        "MDD 9.00% → 8.42%",
        "| 전구간 1990–2018 | 보호없음 | +65.1%",
        "성과 유지율 (OOS/IS)   -0.14",
        "3년 아웃오브샘플 수익   +3.07%",
    ),
)
def test_untracked_historical_exact_results_are_removed_or_marked_unverified(
    exact_claim,
):
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    section = markdown_section_containing(readme, exact_claim)
    assert section is None or "검증되지 않은 과거 탐색" in section
