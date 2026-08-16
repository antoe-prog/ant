from __future__ import annotations

import csv
import hashlib
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "build_plotly_evidence.py"
PREPARE_SCRIPT = ROOT / "scripts" / "prepare_plotly_data.py"
SPEC = importlib.util.spec_from_file_location(
    "prepare_plotly_data_for_evidence_builder", PREPARE_SCRIPT
)
assert SPEC is not None and SPEC.loader is not None
prepare_plotly_data = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare_plotly_data)
BUILDER_SPEC = importlib.util.spec_from_file_location(
    "build_plotly_evidence_for_tests", SCRIPT
)
assert BUILDER_SPEC is not None and BUILDER_SPEC.loader is not None
build_plotly_evidence = importlib.util.module_from_spec(BUILDER_SPEC)
sys.modules[BUILDER_SPEC.name] = build_plotly_evidence
BUILDER_SPEC.loader.exec_module(build_plotly_evidence)

README_MARKERS = (
    "PLOTLY SCAN",
    "PLOTLY SENSITIVITY",
    "PLOTLY STRATEGIES",
    "PLOTLY RANKED",
)
CANONICAL_EFFECTIVE_DATE = "2026-08-09"


def write_prepared_fixture(tmp_path: Path) -> tuple[Path, Path]:
    source = tmp_path / "source.csv"
    first = date(2025, 1, 1)
    with source.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            ["date", "open", "high", "low", "close", "volume", "Name"]
        )
        for offset in range(100):
            day = first + timedelta(days=offset)
            writer.writerow([day, 100, 100, 100, 100, 1000, "AAA"])
            price = 100 if offset < 50 else 50
            volume = 1000 if offset < 50 else 2000
            writer.writerow([day, price, price, price, price, volume, "DISCK"])
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    prepared = tmp_path / "prepared"
    prepare_plotly_data.prepare(source, prepared, expected_sha256=digest)

    manifest = tmp_path / "verified.csv"
    manifest.write_text(
        "symbol,date,ratio,event_type,source\n"
        f"DISCK,{(first + timedelta(days=50)).isoformat()},0.5,"
        "same_class_stock_dividend,issuer\n",
        encoding="utf-8",
    )
    return prepared, manifest


def write_readme_fixture(path: Path) -> None:
    parts = ["# Evidence fixture", ""]
    for marker in README_MARKERS:
        parts.extend(
            [
                f"<!-- BEGIN GENERATED {marker} -->",
                "manually supplied stale metric 999.9%",
                f"<!-- END GENERATED {marker} -->",
                "",
            ]
        )
    path.write_text("\n".join(parts), encoding="utf-8")


def run_builder(
    prepared: Path,
    manifest: Path,
    output: Path,
    readme: Path,
    *extra: str,
    env: dict[str, str] | None = None,
    isolated: bool = True,
) -> subprocess.CompletedProcess[str]:
    interpreter = [sys.executable, "-I"] if isolated else [sys.executable]
    effective_date = (
        []
        if "--check" in extra
        else ["--effective-date", CANONICAL_EFFECTIVE_DATE]
    )
    return subprocess.run(
        [
            *interpreter,
            str(SCRIPT),
            "--prepared-dir",
            str(prepared),
            *effective_date,
            "--output-dir",
            str(output),
            "--manifest",
            str(manifest),
            "--readme",
            str(readme),
            "--artifact-version",
            "v99",
            *extra,
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
        env=env,
    )


def run_standalone_check(
    manifest: Path,
    output: Path,
    readme: Path,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            "-I",
            str(SCRIPT),
            "--output-dir",
            str(output),
            "--manifest",
            str(manifest),
            "--readme",
            str(readme),
            "--artifact-version",
            "v99",
            "--check",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def reproducible_bundle(directory: Path) -> dict[str, bytes]:
    """Ignore only the truthful per-run execution receipt."""
    result: dict[str, bytes] = {}
    for path in sorted(directory.iterdir()):
        if path.name == "plotly-measurement-v99.json":
            measurement = json.loads(path.read_text(encoding="utf-8"))
            measurement.pop("execution_started_at_utc")
            result[path.name] = json.dumps(
                measurement,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        else:
            result[path.name] = path.read_bytes()
    return result


@pytest.mark.skipif(
    platform.python_version() != "3.12.13",
    reason="게시 evidence 통합은 고정 Python 3.12.13에서만 실행",
)
def test_builder_strips_hostile_python_environment_and_rebuilds_reproducibly(
    tmp_path,
):
    prepared, manifest = write_prepared_fixture(tmp_path)
    output = tmp_path / "evidence"
    output.mkdir()
    readme = tmp_path / "README.md"
    write_readme_fixture(readme)
    hostile_import_path = tmp_path / "hostile-import-path"
    hostile_import_path.mkdir()
    (hostile_import_path / "sitecustomize.py").write_text(
        "raise RuntimeError('hostile PYTHONPATH was executed')\n",
        encoding="utf-8",
    )
    hostile = os.environ.copy()
    hostile.update(
        {
            "PYTHONPATH": str(hostile_import_path),
            "PYTHONPROFILEIMPORTTIME": "1",
            "PYTHONWARNINGS": "error",
        }
    )

    first = run_builder(
        prepared, manifest, output, readme, env=hostile
    )
    assert first.returncode == 0, first.stdout + first.stderr
    first_bundle = reproducible_bundle(output)
    first_readme = readme.read_bytes()
    assert all(
        b"import time:" not in content for content in first_bundle.values()
    )

    second = run_builder(
        prepared, manifest, output, readme, env=hostile
    )
    assert second.returncode == 0, second.stdout + second.stderr
    assert reproducible_bundle(output) == first_bundle
    assert readme.read_bytes() == first_readme
    measurement = json.loads(
        (output / "plotly-measurement-v99.json").read_text(encoding="utf-8")
    )
    assert not any(
        key.startswith("PYTHON")
        for key in measurement["runtime"]["environment"]
        if key
        not in {
            "PYTHONHASHSEED",
            "PYTHONIOENCODING",
            "PYTHONTZPATH",
            "PYTHONUNBUFFERED",
            "PYTHONUTF8",
        }
    )


def test_builder_fails_closed_without_isolated_mode(tmp_path):
    prepared, manifest = write_prepared_fixture(tmp_path)
    output = tmp_path / "evidence"
    output.mkdir()
    readme = tmp_path / "README.md"
    write_readme_fixture(readme)

    completed = run_builder(
        prepared,
        manifest,
        output,
        readme,
        isolated=False,
    )

    assert completed.returncode != 0
    assert "-I" in completed.stdout + completed.stderr
    assert not any(output.iterdir())


def test_execution_receipt_cannot_be_supplied_or_backdated_by_cli(tmp_path):
    common = [
        sys.executable,
        "-I",
        str(SCRIPT),
        "--output-dir",
        str(tmp_path / "evidence"),
        "--manifest",
        str(tmp_path / "manifest.csv"),
    ]
    missing_effective_date = subprocess.run(
        common,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert missing_effective_date.returncode != 0
    assert "--effective-date" in (
        missing_effective_date.stdout + missing_effective_date.stderr
    )

    forged_check_date = subprocess.run(
        [*common, "--effective-date", "2099-12-31", "--check"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert forged_check_date.returncode != 0
    assert "--effective-date" in forged_check_date.stdout + forged_check_date.stderr
    assert "--check" in forged_check_date.stdout + forged_check_date.stderr

    for forbidden_flag in ("--measured-on", "--execution-started-at-utc"):
        forged_receipt = subprocess.run(
            [
                *common,
                "--effective-date",
                CANONICAL_EFFECTIVE_DATE,
                forbidden_flag,
                "2000-01-01T00:00:00.000000Z",
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        assert forged_receipt.returncode != 0
        assert forbidden_flag in forged_receipt.stdout + forged_receipt.stderr


def rewrite_terminal_result(
    path: Path,
    *,
    prefix: str,
    mutate,
) -> None:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    index = next(
        index for index, line in enumerate(lines) if line.startswith(prefix)
    )
    payload = json.loads(lines[index].removeprefix(prefix))
    old_request = json.dumps(
        payload.get("request"), ensure_ascii=False, sort_keys=True
    )
    old_invocation = json.dumps(
        payload.get("invocation"), ensure_ascii=False, sort_keys=True
    )
    mutate(payload)
    new_request = json.dumps(
        payload.get("request"), ensure_ascii=False, sort_keys=True
    )
    new_invocation = json.dumps(
        payload.get("invocation"), ensure_ascii=False, sort_keys=True
    )
    text = text.replace("측정 요청 " + old_request, "측정 요청 " + new_request)
    text = text.replace(
        "실행 컨텍스트 " + old_invocation,
        "실행 컨텍스트 " + new_invocation,
    )
    lines = text.splitlines()
    index = next(
        index for index, line in enumerate(lines) if line.startswith(prefix)
    )
    lines[index] = prefix + json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


@pytest.mark.skipif(
    platform.python_version() != "3.12.13",
    reason="게시 evidence 통합은 고정 Python 3.12.13에서만 실행",
)
def test_builder_derives_bundle_and_check_rejects_any_manual_transcription(
    tmp_path,
):
    prepared, manifest = write_prepared_fixture(tmp_path)
    output = tmp_path / "evidence"
    output.mkdir()
    readme = tmp_path / "README.md"
    write_readme_fixture(readme)

    before = datetime.now(timezone.utc)
    built = run_builder(prepared, manifest, output, readme)
    after = datetime.now(timezone.utc)

    assert built.returncode == 0, built.stdout + built.stderr
    measurement_path = output / "plotly-measurement-v99.json"
    cohort_path = output / "plotly-cohort-v99.json"
    readme_data_path = output / "plotly-readme-v99.json"
    preparation_report_path = output / "plotly-preparation-report-v99.json"
    assert measurement_path.is_file()
    assert cohort_path.is_file()
    assert readme_data_path.is_file()
    assert preparation_report_path.is_file()
    measurement = json.loads(measurement_path.read_text(encoding="utf-8"))
    assert measurement["measurement_schema_version"] == 6
    assert measurement["effective_date"] == CANONICAL_EFFECTIVE_DATE
    execution_started_at = datetime.fromisoformat(
        measurement["execution_started_at_utc"].replace("Z", "+00:00")
    )
    assert execution_started_at.tzinfo == timezone.utc
    assert before <= execution_started_at <= after
    assert measurement["producer"]["version"] == "build_plotly_evidence/3"
    assert measurement["path_tokens"] == {
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
    assert measurement["preparation"]["report_file"] == (
        "plotly-preparation-report-v99.json"
    )
    expected_report = (prepared / "preparation-report.json").read_bytes()
    assert preparation_report_path.read_bytes() == expected_report
    assert measurement["preparation"]["report_file_sha256"] == hashlib.sha256(
        expected_report
    ).hexdigest()
    measurement_lock = {
        line.split("==", 1)[0].lower().replace("_", "-"): line.split("==", 1)[1]
        for line in (ROOT / "evidence" / "requirements-measurement.txt")
        .read_text(encoding="utf-8")
        .splitlines()
        if line and not line.startswith("#")
    }
    assert measurement["runtime"]["python"] == "3.12.13"
    assert measurement["runtime"]["locked_packages"] == measurement_lock
    assert measurement["runtime"]["environment"] == {
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
    raw = measurement["raw_sweeps"]["sma_cross"]
    terminal_line = next(
        line
        for line in (output / raw["log_file"]).read_text(encoding="utf-8").splitlines()
        if line.startswith("sweep_result=")
    )
    terminal = json.loads(terminal_line.removeprefix("sweep_result="))
    assert raw["aggregates"] == terminal["aggregates"]
    assert raw["ranked"] == terminal["ranked"]
    assert raw["actual_exit_status"] == 0
    assert raw["capture"] == "stdout_stderr_merged"
    assert raw["producer_command"][:6] == [
        "$PYTHON",
        "-I",
        "-u",
        "-X",
        "utf8",
        "$SWEEP",
    ]
    assert "999.9%" not in readme.read_text(encoding="utf-8")

    checked = run_builder(prepared, manifest, output, readme, "--check")
    assert checked.returncode == 0, checked.stdout + checked.stderr
    standalone_checked = run_standalone_check(manifest, output, readme)
    assert standalone_checked.returncode == 0, (
        standalone_checked.stdout + standalone_checked.stderr
    )
    original_report = preparation_report_path.read_bytes()
    changed_report = json.loads(original_report)
    changed_report["report_sha256"] = "0" * 64
    preparation_report_path.write_text(
        json.dumps(changed_report, ensure_ascii=False, sort_keys=True, indent=2)
        + "\n",
        encoding="utf-8",
    )
    bad_report_check = run_standalone_check(manifest, output, readme)
    assert bad_report_check.returncode != 0
    assert "자기해시" in bad_report_check.stdout + bad_report_check.stderr
    preparation_report_path.write_bytes(original_report)

    first_bundle = reproducible_bundle(output)
    first_readme = readme.read_bytes()
    rebuilt = run_builder(prepared, manifest, output, readme)
    assert rebuilt.returncode == 0, rebuilt.stdout + rebuilt.stderr
    assert reproducible_bundle(output) == first_bundle
    assert readme.read_bytes() == first_readme
    for _ in range(2):
        repeated_check = run_builder(
            prepared, manifest, output, readme, "--check"
        )
        assert repeated_check.returncode == 0, (
            repeated_check.stdout + repeated_check.stderr
        )

    contract_logs = {
        "scan": measurement["scan"]["log_file"],
        "sma_cross": measurement["raw_sweeps"]["sma_cross"]["log_file"],
        "momentum": measurement["raw_sweeps"]["momentum"]["log_file"],
        "breakout": measurement["raw_sweeps"]["breakout"]["log_file"],
        "mean_reversion": measurement["raw_sweeps"]["mean_reversion"]["log_file"],
        "warn_exclude": measurement["posthoc_sensitivity"]["warn_exclude"][
            "log_file"
        ],
        "adjust_exclude": measurement["posthoc_sensitivity"][
            "verified_adjust_exclude"
        ]["log_file"],
        "disck_raw": measurement["posthoc_sensitivity"]["disck"]["raw"][
            "log_file"
        ],
        "disck_adjusted": measurement["posthoc_sensitivity"]["disck"][
            "adjusted"
        ]["log_file"],
    }
    for key, name in contract_logs.items():
        path = output / name
        original = path.read_bytes()

        def mutate_request(payload, *, command_key=key):
            if command_key == "scan":
                payload["request"]["threshold"] = "0.30"
            else:
                payload["request"]["limit"] = 1

        rewrite_terminal_result(
            path,
            prefix="scan_result=" if key == "scan" else "sweep_result=",
            mutate=mutate_request,
        )
        wrong_contract = run_builder(
            prepared, manifest, output, readme, "--check"
        )
        assert wrong_contract.returncode != 0
        assert "명령 계약" in wrong_contract.stdout + wrong_contract.stderr
        path.write_bytes(original)

    adjusted_log = output / contract_logs["disck_adjusted"]
    adjusted_original = adjusted_log.read_bytes()
    rewrite_terminal_result(
        adjusted_log,
        prefix="sweep_result=",
        mutate=lambda payload: payload["invocation"]["argv"].__setitem__(
            -1, "$OTHER_MANIFEST"
        ),
    )
    wrong_invocation = run_builder(
        prepared, manifest, output, readme, "--check"
    )
    assert wrong_invocation.returncode != 0
    assert "명령 계약" in wrong_invocation.stdout + wrong_invocation.stderr
    adjusted_log.write_bytes(adjusted_original)

    original_measurement = measurement_path.read_bytes()
    changed = json.loads(original_measurement)
    changed["raw_sweeps"]["sma_cross"]["aggregates"][
        "strategy_return_median"
    ] = 999.9
    measurement_path.write_text(
        json.dumps(changed, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    metric_check = run_builder(prepared, manifest, output, readme, "--check")
    assert metric_check.returncode != 0
    assert "plotly-measurement-v99.json" in metric_check.stdout + metric_check.stderr
    measurement_path.write_bytes(original_measurement)

    log_path = output / raw["log_file"]
    original_log = log_path.read_bytes()
    log_path.write_bytes(original_log.replace(b"sma_cross", b"manual_xx", 1))
    log_check = run_builder(prepared, manifest, output, readme, "--check")
    assert log_check.returncode != 0
    assert raw["log_file"] in log_check.stdout + log_check.stderr
    log_path.write_bytes(original_log)

    original_readme = readme.read_text(encoding="utf-8")
    readme.write_text(
        original_readme.replace("바이앤홀드", "수기변조", 1),
        encoding="utf-8",
    )
    readme_check = run_builder(prepared, manifest, output, readme, "--check")
    assert readme_check.returncode != 0
    assert "README.md" in readme_check.stdout + readme_check.stderr


@pytest.mark.skipif(
    platform.python_version() != "3.12.13",
    reason="게시 evidence 통합은 고정 Python 3.12.13에서만 실행",
)
def test_standalone_check_rejects_bundle_after_current_producer_or_code_changes(
    tmp_path,
):
    prepared, manifest = write_prepared_fixture(tmp_path)
    output = tmp_path / "evidence-output"
    output.mkdir()
    readme = tmp_path / "README.md"
    write_readme_fixture(readme)
    built = run_builder(prepared, manifest, output, readme)
    assert built.returncode == 0, built.stdout + built.stderr

    mutated_project = tmp_path / "mutated-project"
    (mutated_project / "scripts").mkdir(parents=True)
    for name in (
        "build_plotly_evidence.py",
        "prepare_plotly_data.py",
        "sweep.py",
    ):
        shutil.copy2(ROOT / "scripts" / name, mutated_project / "scripts" / name)
    shutil.copytree(ROOT / "src", mutated_project / "src")
    shutil.copy2(ROOT / "pyproject.toml", mutated_project / "pyproject.toml")
    (mutated_project / "evidence").mkdir()
    for name in ("requirements-build.txt", "requirements-measurement.txt"):
        shutil.copy2(ROOT / "evidence" / name, mutated_project / "evidence" / name)

    strategy_path = (
        mutated_project / "src" / "tossquant" / "strategy" / "sma_cross.py"
    )
    strategy_text = strategy_path.read_text(encoding="utf-8")
    old = "golden = fast_prev <= slow_prev and fast_now > slow_now"
    assert old in strategy_text
    strategy_path.write_text(
        strategy_text.replace(
            old,
            "golden = False  # hostile regression: disable every entry",
            1,
        ),
        encoding="utf-8",
    )

    checked = subprocess.run(
        [
            sys.executable,
            "-I",
            str(mutated_project / "scripts" / "build_plotly_evidence.py"),
            "--output-dir",
            str(output),
            "--manifest",
            str(manifest),
            "--readme",
            str(readme),
            "--artifact-version",
            "v99",
            "--check",
        ],
        cwd=mutated_project,
        text=True,
        capture_output=True,
        check=False,
    )

    assert checked.returncode != 0
    assert "현재 scan 코드" in checked.stdout + checked.stderr

    strategy_path.write_text(strategy_text, encoding="utf-8")
    sweep_path = mutated_project / "scripts" / "sweep.py"
    sweep_text = sweep_path.read_text(encoding="utf-8")
    sweep_path.write_text(
        sweep_text + "\n# hostile regression: changed sweep producer\n",
        encoding="utf-8",
    )
    checked = subprocess.run(
        checked.args,
        cwd=mutated_project,
        text=True,
        capture_output=True,
        check=False,
    )
    assert checked.returncode != 0
    assert "현재 측정 코드" in checked.stdout + checked.stderr

    sweep_path.write_text(sweep_text, encoding="utf-8")
    builder_path = mutated_project / "scripts" / "build_plotly_evidence.py"
    builder_text = builder_path.read_text(encoding="utf-8")
    builder_path.write_text(
        builder_text + "\n# hostile regression: changed bundle producer\n",
        encoding="utf-8",
    )
    checked = subprocess.run(
        checked.args,
        cwd=mutated_project,
        text=True,
        capture_output=True,
        check=False,
    )
    assert checked.returncode != 0
    assert "plotly-measurement-v99.json" in checked.stdout + checked.stderr


@pytest.mark.parametrize("leaf", ["manifest", "readme", "output"])
def test_builder_rejects_leaf_symlinks(tmp_path, leaf):
    prepared, manifest = write_prepared_fixture(tmp_path)
    output = tmp_path / "evidence"
    output.mkdir()
    readme = tmp_path / "README.md"
    write_readme_fixture(readme)

    if leaf == "manifest":
        target = manifest
        manifest = tmp_path / "manifest-link.csv"
        manifest.symlink_to(target)
    elif leaf == "readme":
        target = readme
        readme = tmp_path / "README-link.md"
        readme.symlink_to(target)
    else:
        target = output
        output = tmp_path / "evidence-link"
        output.symlink_to(target, target_is_directory=True)

    result = run_builder(prepared, manifest, output, readme)

    assert result.returncode != 0
    assert "심볼릭 링크" in result.stdout + result.stderr


def test_builder_rejects_output_prepared_overlap_and_input_aliases(tmp_path):
    prepared, manifest = write_prepared_fixture(tmp_path)
    readme = tmp_path / "README.md"
    write_readme_fixture(readme)

    inside_prepared = run_builder(
        prepared,
        manifest,
        prepared / "evidence",
        readme,
    )
    assert inside_prepared.returncode != 0
    assert "분리" in inside_prepared.stdout + inside_prepared.stderr

    output = tmp_path / "container"
    output.mkdir()
    nested_prepared = output / "prepared"
    prepared.rename(nested_prepared)
    contains_prepared = run_builder(
        nested_prepared,
        manifest,
        output,
        readme,
    )
    assert contains_prepared.returncode != 0
    assert "분리" in contains_prepared.stdout + contains_prepared.stderr

    separated = tmp_path / "separated"
    separated.mkdir()
    output_manifest = separated / "plotly-measurement-v99.json"
    output_manifest.write_bytes(manifest.read_bytes())
    manifest_inside_output = run_builder(
        nested_prepared,
        output_manifest,
        separated,
        readme,
    )
    assert manifest_inside_output.returncode != 0
    assert "겹" in manifest_inside_output.stdout + manifest_inside_output.stderr

    alias = tmp_path / "README-alias.md"
    os.link(manifest, alias)
    aliased_inputs = run_builder(
        nested_prepared,
        manifest,
        tmp_path / "final-output",
        alias,
    )
    assert aliased_inputs.returncode != 0
    assert "같은 파일" in aliased_inputs.stdout + aliased_inputs.stderr


def test_file_and_directory_snapshots_detect_leaf_replacement(tmp_path):
    leaf = tmp_path / "input.txt"
    leaf.write_bytes(b"same bytes")
    snapshot = build_plotly_evidence.snapshot_regular_file(
        leaf, "테스트 입력", max_bytes=1024
    )
    replacement = tmp_path / "replacement.txt"
    replacement.write_bytes(b"same bytes")
    os.replace(replacement, leaf)

    with pytest.raises(build_plotly_evidence.EvidenceBuildError, match="교체"):
        build_plotly_evidence.assert_regular_file_unchanged(
            leaf, snapshot, "테스트 입력", max_bytes=1024
        )

    directory = tmp_path / "output"
    directory.mkdir()
    directory_snapshot = build_plotly_evidence.snapshot_directory(
        directory, "테스트 출력"
    )
    original = tmp_path / "original-output"
    directory.rename(original)
    directory.mkdir()

    with pytest.raises(build_plotly_evidence.EvidenceBuildError, match="교체"):
        build_plotly_evidence.assert_directory_unchanged(
            directory, directory_snapshot, "테스트 출력"
        )


def test_compare_bundle_rejects_artifact_changed_after_first_comparison(
    tmp_path, monkeypatch
):
    output = tmp_path / "evidence"
    output.mkdir()
    artifact = output / "artifact.txt"
    artifact.write_bytes(b"expected")
    readme = tmp_path / "README.md"
    readme.write_bytes(b"readme")
    output_snapshot = build_plotly_evidence.snapshot_directory(
        output, "테스트 출력"
    )
    readme_snapshot = build_plotly_evidence.snapshot_regular_file(
        readme, "README", max_bytes=1024
    )
    original_snapshot = build_plotly_evidence.snapshot_regular_file
    changed = False

    def mutate_after_artifact_was_compared(
        path, description, *, max_bytes
    ):
        nonlocal changed
        if Path(path) == readme and not changed:
            artifact.write_bytes(b"corrupt-after-compare")
            changed = True
        return original_snapshot(
            path, description, max_bytes=max_bytes
        )

    monkeypatch.setattr(
        build_plotly_evidence,
        "snapshot_regular_file",
        mutate_after_artifact_was_compared,
    )

    with pytest.raises(
        build_plotly_evidence.EvidenceBuildError,
        match="교체 또는 변경",
    ):
        build_plotly_evidence.compare_bundle(
            output,
            output_snapshot,
            {"artifact.txt": b"expected"},
            readme,
            readme_snapshot,
            b"readme",
        )
