from __future__ import annotations

import csv
import hashlib
import importlib.util
import json
import os
import platform
import subprocess
import sys
from pathlib import Path

import pytest


SCRIPT = Path(__file__).parents[1] / "scripts" / "prepare_plotly_data.py"
SPEC = importlib.util.spec_from_file_location("prepare_plotly_data", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
prepare_plotly_data = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare_plotly_data)


def write_source(path: Path, rows: list[list[str]]) -> str:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["date", "open", "high", "low", "close", "volume", "Name"])
        writer.writerows(rows)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_prepare_verifies_hash_splits_symbols_and_records_dropped_rows(tmp_path):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [
            ["2026-01-02", "1", "2", "0.5", "1.5", "100", "AAA"],
            ["2026-01-02", "", "2", "0.5", "1.5", "100", "BAD"],
            ["2026-01-03", "3", "4", "2", "3.5", "200", "BBB"],
        ],
    )
    output = tmp_path / "prepared"

    report = prepare_plotly_data.prepare(
        source, output, expected_sha256=digest
    )

    assert report["input_rows"] == 3
    assert report["written_rows"] == 2
    assert report["symbols"] == 2
    assert report["symbol_rows"] == {"AAA": 1, "BBB": 1}
    assert report["dropped_rows"] == [
        {"line": 3, "symbol": "BAD", "date": "2026-01-02", "missing": ["open"]}
    ]
    assert sorted(path.name for path in output.glob("*.csv")) == ["AAA.csv", "BBB.csv"]
    persisted = json.loads((output / "preparation-report.json").read_text())
    assert persisted == report
    assert report["preparation_schema_version"] == 5
    assert report["preparation_tool_version"] == "prepare_plotly_data/5"
    assert len(report["preparation_tool_sha256"]) == 64
    assert report["backtest_data_module"] == "tossquant.backtest.data"
    assert len(report["backtest_data_sha256"]) == 64
    assert report["candle_model_module"] == "tossquant.models"
    assert len(report["candle_model_sha256"]) == 64
    assert report["python_version"] == platform.python_version()
    assert report["report_digest_algorithm"]
    assert len(report["report_sha256"]) == 64
    assert report["output_digest_algorithm"]
    assert len(report["output_sha256"]) == 64
    assert report["timestamp_digest_algorithm"] == (
        "sha256-iso-utc-timestamp-newline-v1"
    )
    assert report["symbol_timestamp_sha256"] == {
        "AAA": hashlib.sha256(
            b"2026-01-02T00:00:00+00:00\n"
        ).hexdigest(),
        "BBB": hashlib.sha256(
            b"2026-01-03T00:00:00+00:00\n"
        ).hexdigest(),
    }
    assert report["symbol_timestamp_bounds"] == {
        "AAA": {
            "first": "2026-01-02T00:00:00+00:00",
            "last": "2026-01-02T00:00:00+00:00",
        },
        "BBB": {
            "first": "2026-01-03T00:00:00+00:00",
            "last": "2026-01-03T00:00:00+00:00",
        },
    }
    assert prepare_plotly_data.verify_prepared_output(output) == report


@pytest.mark.parametrize(
    ("header", "row"),
    [
        (
            ["date", "open", "high", "low", "close", "volume", "Name", "junk"],
            ["2026-01-02", "1", "1", "1", "1", "1", "AAA", "ignored"],
        ),
        (
            ["date", "open", "high", "low", "close", "volume", "Name", "close"],
            ["2026-01-02", "1", "1", "1", "1", "1", "AAA", "1"],
        ),
    ],
)
def test_prepare_rejects_extra_and_duplicate_source_headers(
    tmp_path, header, row
):
    source = tmp_path / "source.csv"
    with source.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerow(row)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    output = tmp_path / "prepared"

    with pytest.raises(ValueError, match="원본 컬럼"):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert not output.exists()


def test_prepare_rejects_row_with_more_values_than_the_header(tmp_path):
    source = tmp_path / "source.csv"
    source.write_text(
        "date,open,high,low,close,volume,Name\n"
        "2026-01-02,1,1,1,1,1,AAA,surplus\n",
        encoding="utf-8",
    )
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    output = tmp_path / "prepared"

    with pytest.raises(ValueError, match="헤더보다 값"):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert not output.exists()


def test_prepare_rejects_unterminated_quoted_field_instead_of_swallowing_rows(
    tmp_path,
):
    source = tmp_path / "source.csv"
    source.write_text(
        "date,open,high,low,close,Name,volume\n"
        "2026-01-02,1,1,1,1,AAA,100\n"
        '2026-01-03,2,2,2,2,BBB,"200\n'
        "2026-01-04,3,3,3,3,CCC,300\n",
        encoding="utf-8",
    )
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    output = tmp_path / "prepared"

    with pytest.raises(ValueError, match="CSV 파싱 실패"):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert not output.exists()


def test_prepare_normalizes_csv_parser_errors_and_leaves_no_output(tmp_path):
    source = tmp_path / "source.csv"
    oversized = "x" * (csv.field_size_limit() + 1)
    with source.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(prepare_plotly_data.REQUIRED_FIELDS)
        writer.writerow(["2026-01-02", "1", "1", "1", "1", "1", "AAA"])
        writer.writerow(
            ["2026-01-03", oversized, "1", "1", "1", "1", "BAD"]
        )
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    output = tmp_path / "prepared"

    with pytest.raises(ValueError, match="CSV 파싱 실패"):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert not output.exists()


def test_prepare_refuses_to_publish_report_larger_than_verifier_limit(
    tmp_path, monkeypatch
):
    source = tmp_path / "source.csv"
    invalid_value = "x" * 4_000
    digest = write_source(
        source,
        [
            ["2026-01-02", "1", "1", "1", "1", "1", "AAA"],
            ["2026-01-03", invalid_value, "1", "1", "1", "1", "BAD"],
        ],
    )
    output = tmp_path / "prepared"
    monkeypatch.setattr(prepare_plotly_data, "MAX_REPORT_BYTES", 2_000)

    with pytest.raises(ValueError, match="준비 보고서.*제한"):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert not output.exists()
    assert list(tmp_path.glob(".prepared.staging-*")) == []


@pytest.mark.parametrize(
    "duplicate_key",
    ["source_sha256", r"\u0073ource_sha256"],
)
def test_verify_rejects_duplicate_json_keys_including_escaped_aliases(
    tmp_path, duplicate_key
):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "2", "0.5", "1.5", "100", "AAA"]],
    )
    output = tmp_path / "prepared"
    prepare_plotly_data.prepare(source, output, expected_sha256=digest)
    report_path = output / prepare_plotly_data.REPORT_FILENAME
    original = report_path.read_text(encoding="utf-8")
    report_path.write_text(
        original.replace(
            '  "source_sha256":',
            f'  "{duplicate_key}": "{"0" * 64}",\n  "source_sha256":',
            1,
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="중복 JSON 키"):
        prepare_plotly_data.verify_prepared_output(output)


def test_prepare_preserves_unequal_ohlcv_values_exactly(tmp_path):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1.25", "3.5", "0.75", "2.25", "123", "AAA"]],
    )
    output = tmp_path / "prepared"

    prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    with (output / "AAA.csv").open(newline="", encoding="utf-8") as handle:
        assert list(csv.DictReader(handle)) == [
            {
                "date": "2026-01-02",
                "open": "1.25",
                "high": "3.5",
                "low": "0.75",
                "close": "2.25",
                "volume": "123",
            }
        ]


def test_prepare_rejects_wrong_hash_before_creating_output(tmp_path):
    source = tmp_path / "source.csv"
    write_source(
        source,
        [["2026-01-02", "1", "2", "0.5", "1.5", "100", "AAA"]],
    )
    output = tmp_path / "prepared"

    with pytest.raises(ValueError, match="SHA-256 불일치"):
        prepare_plotly_data.prepare(source, output, expected_sha256="0" * 64)

    assert not output.exists()


def test_prepare_does_not_duplicate_headers_when_writer_is_reopened(tmp_path, monkeypatch):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [
            ["2026-01-02", "1", "1", "1", "1", "1", "AAA"],
            ["2026-01-02", "2", "2", "2", "2", "2", "BBB"],
            ["2026-01-03", "3", "3", "3", "3", "3", "AAA"],
        ],
    )
    monkeypatch.setattr(prepare_plotly_data, "MAX_OPEN_FILES", 1)
    output = tmp_path / "prepared"

    prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    lines = (output / "AAA.csv").read_text().splitlines()
    assert lines[0] == "date,open,high,low,close,volume"
    assert lines.count(lines[0]) == 1
    assert len(lines) == 3


@pytest.mark.parametrize("symbol", ["../escape", "A/B", "..", ""])
def test_prepare_rejects_symbols_that_can_escape_or_alias_output_path(
    tmp_path, symbol
):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "1", "1", "1", "1", symbol]],
    )
    output = tmp_path / "prepared"

    with pytest.raises(ValueError, match="심볼"):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert not (tmp_path / "escape.csv").exists()


def test_prepare_refuses_to_mix_with_existing_csv(tmp_path):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "1", "1", "1", "1", "AAA"]],
    )
    output = tmp_path / "prepared"
    output.mkdir()
    (output / "OLD.csv").write_text("old")

    with pytest.raises(ValueError, match="이미 존재"):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)


def test_prepare_requires_output_leaf_not_to_exist_and_preserves_empty_dir(tmp_path):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "1", "1", "1", "1", "AAA"]],
    )
    output = tmp_path / "prepared"
    output.mkdir()

    with pytest.raises(ValueError, match="이미 존재"):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert output.is_dir()
    assert list(output.iterdir()) == []


def test_output_preflight_runs_before_source_snapshot(tmp_path, monkeypatch):
    source = tmp_path / "source.csv"
    source.write_text("snapshot must not run", encoding="utf-8")
    output = tmp_path / "prepared"
    output.mkdir()

    def fail_if_called(path):
        pytest.fail(f"snapshot unexpectedly called for {path}")

    monkeypatch.setattr(prepare_plotly_data, "_snapshot_source", fail_if_called)

    with pytest.raises(ValueError, match="이미 존재"):
        prepare_plotly_data.prepare(source, output, expected_sha256=None)

    assert output.is_dir()


def test_validation_failure_preserves_concurrently_created_output_dir(
    tmp_path, monkeypatch
):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "1", "1", "1", "1", "AAA"]],
    )
    output = tmp_path / "prepared"

    def create_output_then_fail(self, symbol, interval, count):
        output.mkdir()
        raise ValueError("injected validation failure")

    monkeypatch.setattr(
        prepare_plotly_data.CsvSource, "fetch", create_output_then_fail
    )

    with pytest.raises(ValueError, match="injected validation failure"):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert output.is_dir()
    assert list(output.iterdir()) == []


def test_prepare_rechecks_output_before_publish_and_preserves_concurrent_dir(
    tmp_path, monkeypatch
):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "1", "1", "1", "1", "AAA"]],
    )
    output = tmp_path / "prepared"
    original_fetch = prepare_plotly_data.CsvSource.fetch

    def create_output_after_validation(self, symbol, interval, count):
        parsed = original_fetch(self, symbol, interval, count)
        output.mkdir()
        return parsed

    monkeypatch.setattr(
        prepare_plotly_data.CsvSource, "fetch", create_output_after_validation
    )

    with pytest.raises(ValueError, match="이미 존재"):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert output.is_dir()
    assert list(output.iterdir()) == []


def test_publish_failure_preserves_directory_created_in_final_race(
    tmp_path, monkeypatch
):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "1", "1", "1", "1", "AAA"]],
    )
    output = tmp_path / "prepared"
    original_publish = prepare_plotly_data._publish_no_replace

    def create_output_then_publish(source_path, target):
        if Path(target) == output:
            output.mkdir()
        return original_publish(source_path, target)

    monkeypatch.setattr(
        prepare_plotly_data, "_publish_no_replace", create_output_then_publish
    )

    with pytest.raises(FileExistsError):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert output.is_dir()
    assert list(output.iterdir()) == []
    assert list(tmp_path.glob(".prepared.staging-*")) == []


def test_publish_no_replace_never_replaces_existing_empty_directory(tmp_path):
    source = tmp_path / "staging"
    target = tmp_path / "concurrent-output"
    source.mkdir()
    target.mkdir()
    target_inode = target.stat().st_ino

    with pytest.raises(FileExistsError):
        prepare_plotly_data._publish_no_replace(source, target)

    assert source.is_dir()
    assert target.is_dir()
    assert target.stat().st_ino == target_inode


def test_late_invalid_row_leaves_no_partial_output_and_retry_succeeds(tmp_path):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [
            ["2026-01-02", "1", "1", "1", "1", "1", "AAA"],
            ["2026-01-03", "2", "2", "2", "2", "2", "../escape"],
        ],
    )
    output = tmp_path / "prepared"

    with pytest.raises(ValueError, match="심볼"):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert not output.exists()
    digest = write_source(
        source,
        [["2026-01-02", "1", "1", "1", "1", "1", "AAA"]],
    )
    report = prepare_plotly_data.prepare(source, output, expected_sha256=digest)
    assert report["symbols"] == 1


def test_unpinned_local_source_does_not_claim_plotly_provenance(tmp_path):
    source = tmp_path / "custom.csv"
    write_source(
        source,
        [["2099-01-02", "1", "1", "1", "1", "1", "CUSTOM"]],
    )

    report = prepare_plotly_data.prepare(
        source, tmp_path / "prepared", expected_sha256=None
    )

    assert report["source_kind"] == "local_unpinned"
    assert report["source_url"] is None
    assert report["source_commit"] is None
    assert report["source_path"] == str(source.resolve())


@pytest.mark.parametrize(
    "row",
    [
        ["2026-01-02", "not-a-number", "1", "1", "1", "1", "AAA"],
        ["2026-01-02", "1", "0.5", "1", "1", "1", "AAA"],
        ["not-a-date", "1", "1", "1", "1", "1", "AAA"],
    ],
)
def test_prepare_audits_and_drops_rows_its_csv_consumer_cannot_read(tmp_path, row):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-01", "1", "1", "1", "1", "1", "AAA"], row],
    )
    output = tmp_path / "prepared"

    report = prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert report["written_rows"] == 1
    assert len(report["dropped_rows"]) == 1
    assert report["dropped_rows"][0]["line"] == 3
    assert "invalid" in report["dropped_rows"][0]
    assert len((output / "AAA.csv").read_text().splitlines()) == 2


def test_prepare_rejects_source_with_no_usable_symbols(tmp_path):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "", "1", "1", "1", "1", "AAA"]],
    )
    output = tmp_path / "prepared"

    with pytest.raises(ValueError, match="사용 가능한 행"):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert not output.exists()


def test_prepare_all_invalid_error_summarizes_audit_without_partial_output(tmp_path):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [
            ["2026-01-02", "", "1", "1", "1", "1", "AAA"],
            ["2026-01-03", "2", "1", "2", "2", "2", "BBB"],
        ],
    )
    output = tmp_path / "prepared"

    with pytest.raises(ValueError) as exc_info:
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    message = str(exc_info.value)
    assert "input_rows=2" in message
    assert "dropped_rows=2" in message
    assert "line=2" in message
    assert "line=3" in message
    assert not output.exists()


def test_prepare_rejects_output_symlink_without_touching_target(tmp_path):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "1", "1", "1", "1", "AAA"]],
    )
    target = tmp_path / "real-output"
    target.mkdir()
    output = tmp_path / "prepared"
    output.symlink_to(target, target_is_directory=True)

    with pytest.raises(ValueError, match="심볼릭 링크"):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert output.is_symlink()
    assert list(target.iterdir()) == []


def test_prepare_requires_output_parent_to_exist_before_snapshot(tmp_path):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "1", "1", "1", "1", "AAA"]],
    )
    output = tmp_path / "late-parent" / "prepared"

    with pytest.raises(ValueError, match="부모 폴더.*먼저"):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert not output.parent.exists()


def test_prepare_does_not_resolve_output_leaf_during_symlink_race(
    tmp_path, monkeypatch
):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "1", "1", "1", "1", "AAA"]],
    )
    target = tmp_path / "redirected"
    target.mkdir()
    output = tmp_path / "prepared"
    original_resolve = Path.resolve

    def inject_symlink_if_leaf_is_resolved(self, *args, **kwargs):
        if self == output and not output.exists() and not output.is_symlink():
            output.symlink_to(target, target_is_directory=True)
        return original_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", inject_symlink_if_leaf_is_resolved)

    prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    assert output.is_dir()
    assert not output.is_symlink()
    assert (output / "AAA.csv").is_file()
    assert list(target.iterdir()) == []


def test_output_digest_is_deterministic_and_detects_valid_content_mutation(tmp_path):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "3", "0.5", "2", "100", "AAA"]],
    )
    first = tmp_path / "first"
    second = tmp_path / "second"

    first_report = prepare_plotly_data.prepare(
        source, first, expected_sha256=digest
    )
    second_report = prepare_plotly_data.prepare(
        source, second, expected_sha256=digest
    )

    assert first_report["output_sha256"] == second_report["output_sha256"]
    assert prepare_plotly_data.verify_prepared_output(first) == first_report

    csv_path = first / "AAA.csv"
    csv_path.write_text(
        csv_path.read_text(encoding="utf-8").replace(",2,100", ",2.5,100"),
        encoding="utf-8",
    )
    assert str(
        prepare_plotly_data.CsvSource(first).fetch("AAA", "1d", 0)[0].close
    ) == "2.5"

    with pytest.raises(ValueError, match="무결성"):
        prepare_plotly_data.verify_prepared_output(first)


def _rewrite_report(output: Path, mutate, *, refresh_report_digest: bool) -> None:
    report_path = output / prepare_plotly_data.REPORT_FILENAME
    report = json.loads(report_path.read_text(encoding="utf-8"))
    mutate(report)
    if refresh_report_digest:
        report["report_sha256"] = prepare_plotly_data._report_payload_sha256(report)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


@pytest.mark.parametrize(
    ("case", "refresh_report_digest"),
    [
        ("symbols", True),
        ("written_rows", True),
        ("symbol_rows", True),
        ("input_rows", True),
        ("dropped_rows", False),
        ("source_url", True),
        ("source_commit", True),
        ("source_sha256", True),
        ("source_path", True),
        ("preparation_tool_version", True),
        ("preparation_tool_sha256", True),
        ("backtest_data_sha256", True),
        ("candle_model_sha256", True),
        ("python_version", True),
    ],
)
def test_verify_rejects_tampered_accounting_source_and_tool_provenance(
    tmp_path, monkeypatch, case, refresh_report_digest
):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [
            ["2026-01-02", "1", "2", "0.5", "1.5", "100", "AAA"],
            ["2026-01-03", "", "2", "0.5", "1.5", "100", "BAD"],
        ],
    )
    monkeypatch.setattr(prepare_plotly_data, "SOURCE_SHA256", digest)
    monkeypatch.setattr(prepare_plotly_data, "SOURCE_INPUT_ROWS", 2)
    output = tmp_path / "prepared"
    prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    def mutate(report):
        if case == "symbols":
            report["symbols"] = 2
        elif case == "written_rows":
            report["written_rows"] = 2
        elif case == "symbol_rows":
            report["symbol_rows"] = {"AAA": 2}
        elif case == "input_rows":
            report["input_rows"] = 3
        elif case == "dropped_rows":
            report["dropped_rows"][0]["missing"] = ["close"]
        elif case == "source_url":
            report["source_url"] = "https://example.invalid/tampered.csv"
        elif case == "source_commit":
            report["source_commit"] = "f" * 40
        elif case == "source_sha256":
            report["source_sha256"] = "0" * 64
        elif case == "source_path":
            report["source_path"] = "/tmp/tampered.csv"
        elif case == "preparation_tool_version":
            report["preparation_tool_version"] = "tampered/999"
        elif case == "preparation_tool_sha256":
            report["preparation_tool_sha256"] = "0" * 64
        elif case == "backtest_data_sha256":
            report["backtest_data_sha256"] = "0" * 64
        elif case == "candle_model_sha256":
            report["candle_model_sha256"] = "0" * 64
        elif case == "python_version":
            report["python_version"] = "0.0.0"
        else:  # pragma: no cover - parametrization guard
            raise AssertionError(case)

    _rewrite_report(
        output, mutate, refresh_report_digest=refresh_report_digest
    )

    with pytest.raises(ValueError):
        prepare_plotly_data.verify_prepared_output(output)


def test_verify_recomputes_csv_semantics_not_only_file_digest(tmp_path):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "2", "0.5", "1.5", "100", "AAA"]],
    )
    output = tmp_path / "prepared"
    prepare_plotly_data.prepare(source, output, expected_sha256=digest)

    csv_path = output / "AAA.csv"
    csv_path.write_text(
        "date,open,high,low,close,volume\n"
        "2026-01-02,1,2,0.5,1.5,100\n"
        "2026-01-03,2,3,1.5,2.5,200\n",
        encoding="utf-8",
    )

    def update_only_byte_digests(report):
        report["output_sha256"] = prepare_plotly_data._aggregate_output_sha256(
            output
        )

    _rewrite_report(output, update_only_byte_digests, refresh_report_digest=True)

    with pytest.raises(ValueError, match="행 수|written_rows"):
        prepare_plotly_data.verify_prepared_output(output)


def test_verify_rejects_rehashed_tampered_pinned_output_and_dropped_audit(
    tmp_path, monkeypatch
):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [
            ["2026-01-02", "1", "2", "0.5", "1.5", "100", "AAA"],
            ["2026-01-03", "", "2", "0.5", "1.5", "100", "BAD"],
        ],
    )
    monkeypatch.setattr(prepare_plotly_data, "SOURCE_SHA256", digest)
    monkeypatch.setattr(prepare_plotly_data, "SOURCE_INPUT_ROWS", 2)
    output = tmp_path / "prepared"
    report = prepare_plotly_data.prepare(source, output, expected_sha256=digest)
    monkeypatch.setattr(prepare_plotly_data, "PINNED_SOURCE_SHA256", digest)
    monkeypatch.setattr(
        prepare_plotly_data,
        "PINNED_OUTPUT_SHA256",
        report["output_sha256"],
    )
    monkeypatch.setattr(
        prepare_plotly_data,
        "PINNED_DROPPED_ROWS_SHA256",
        prepare_plotly_data._canonical_json_sha256(report["dropped_rows"]),
    )

    csv_path = output / "AAA.csv"
    csv_path.write_text(
        csv_path.read_text(encoding="utf-8").replace(
            "1,2,0.5,1.5,100", "1,2,0.5,1.6,100"
        ),
        encoding="utf-8",
    )

    def rewrite_claims(tampered):
        tampered["output_sha256"] = prepare_plotly_data._aggregate_output_sha256(
            output
        )
        tampered["dropped_rows"][0] = {
            "line": 3,
            "symbol": "AAA",
            "date": "2099-12-31",
            "missing": ["close"],
        }

    _rewrite_report(output, rewrite_claims, refresh_report_digest=True)

    with pytest.raises(ValueError, match="핀 고정.*출력|제외 행"):
        prepare_plotly_data.verify_prepared_output(output)


def test_verify_detects_csv_change_between_digest_and_semantic_parse(
    tmp_path, monkeypatch
):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "2", "0.5", "1.5", "100", "AAA"]],
    )
    output = tmp_path / "prepared"
    prepare_plotly_data.prepare(source, output, expected_sha256=digest)
    original = prepare_plotly_data._actual_symbol_rows

    def mutate_then_parse(directory):
        csv_path = directory / "AAA.csv"
        csv_path.write_text(
            csv_path.read_text(encoding="utf-8").replace(
                "1,2,0.5,1.5,100", "1,2,0.5,1.6,100"
            ),
            encoding="utf-8",
        )
        return original(directory)

    monkeypatch.setattr(prepare_plotly_data, "_actual_symbol_rows", mutate_then_parse)

    with pytest.raises(ValueError, match="검증 중 변경"):
        prepare_plotly_data.verify_prepared_output(output)


def test_verify_detects_provenance_module_change_during_semantic_parse(
    tmp_path, monkeypatch
):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "2", "0.5", "1.5", "100", "AAA"]],
    )
    output = tmp_path / "prepared"
    prepare_plotly_data.prepare(source, output, expected_sha256=digest)
    dependency = tmp_path / "data.py"
    dependency.write_text("before\n", encoding="utf-8")
    monkeypatch.setattr(prepare_plotly_data, "BACKTEST_DATA_PATH", dependency)

    def bind_dependency(report):
        report["backtest_data_sha256"] = prepare_plotly_data._file_sha256(
            dependency
        )

    _rewrite_report(output, bind_dependency, refresh_report_digest=True)
    original = prepare_plotly_data._actual_symbol_rows

    def mutate_dependency_then_parse(directory):
        dependency.write_text("after\n", encoding="utf-8")
        return original(directory)

    monkeypatch.setattr(
        prepare_plotly_data,
        "_actual_symbol_rows",
        mutate_dependency_then_parse,
    )

    with pytest.raises(ValueError, match="코드가 검증 중 변경"):
        prepare_plotly_data.verify_prepared_output(output)


def test_prepare_detects_provenance_module_change_before_publish(
    tmp_path, monkeypatch
):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "2", "0.5", "1.5", "100", "AAA"]],
    )
    output = tmp_path / "prepared"
    dependency = tmp_path / "data.py"
    dependency.write_text("before\n", encoding="utf-8")
    monkeypatch.setattr(prepare_plotly_data, "BACKTEST_DATA_PATH", dependency)
    original = prepare_plotly_data._aggregate_output_sha256

    def mutate_dependency_then_hash(directory):
        dependency.write_text("after\n", encoding="utf-8")
        return original(directory)

    monkeypatch.setattr(
        prepare_plotly_data,
        "_aggregate_output_sha256",
        mutate_dependency_then_hash,
    )

    with pytest.raises(ValueError, match="코드가 준비 중 변경"):
        prepare_plotly_data.prepare(source, output, expected_sha256=digest)
    assert not output.exists()


@pytest.mark.parametrize("symbol", ["CON", "PRN.csv", "AUX.X", "NUL", "COM1", "LPT9"])
def test_prepare_rejects_windows_reserved_symbol_names(tmp_path, symbol):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "1", "1", "1", "1", symbol]],
    )

    with pytest.raises(ValueError, match="Windows 예약"):
        prepare_plotly_data.prepare(
            source,
            tmp_path / "prepared",
            expected_sha256=digest,
        )


def test_windows_publish_loads_kernel32_with_last_error_tracking(tmp_path):
    calls = {}

    class FakeMoveFileEx:
        argtypes = None
        restype = None

        def __call__(self, source, target, flags):
            calls["move"] = (source, target, flags)
            return 0

    class FakeKernel32:
        MoveFileExW = FakeMoveFileEx()

    def load_library(name, *, use_last_error):
        calls["load"] = (name, use_last_error)
        return FakeKernel32()

    with pytest.raises(FileExistsError) as exc_info:
        prepare_plotly_data._publish_windows_no_replace(
            tmp_path / "source",
            tmp_path / "target",
            library_loader=load_library,
            last_error=lambda: 183,
        )

    assert calls["load"] == ("kernel32", True)
    assert calls["move"][2] == 0
    assert exc_info.value.errno == 183


def test_allow_unpinned_source_requires_explicit_local_source(
    tmp_path, monkeypatch, capsys
):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "prepare_plotly_data.py",
            str(tmp_path / "prepared"),
            "--allow-unpinned-source",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        prepare_plotly_data.parse_args()

    assert exc_info.value.code == 2
    assert "--source" in capsys.readouterr().err


def test_allow_unpinned_source_accepts_explicit_local_source(tmp_path, monkeypatch):
    source = tmp_path / "custom.csv"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "prepare_plotly_data.py",
            str(tmp_path / "prepared"),
            "--source",
            str(source),
            "--allow-unpinned-source",
        ],
    )

    args = prepare_plotly_data.parse_args()

    assert args.source == source
    assert args.allow_unpinned_source is True


def test_verify_only_cli_checks_existing_prepared_output(tmp_path, monkeypatch, capsys):
    source = tmp_path / "source.csv"
    digest = write_source(
        source,
        [["2026-01-02", "1", "1", "1", "1", "1", "AAA"]],
    )
    output = tmp_path / "prepared"
    report = prepare_plotly_data.prepare(source, output, expected_sha256=digest)
    monkeypatch.setattr(
        sys,
        "argv",
        ["prepare_plotly_data.py", str(output), "--verify-only"],
    )

    prepare_plotly_data.main()

    text = capsys.readouterr().out
    assert "verified" in text
    assert report["output_sha256"] in text


def test_verify_only_fifo_report_fails_fast_instead_of_blocking(tmp_path):
    if not hasattr(os, "mkfifo"):
        return
    output = tmp_path / "prepared"
    output.mkdir()
    (output / "AAA.csv").write_text(
        "date,open,high,low,close,volume\n"
        "2026-01-02,1,1,1,1,1\n",
        encoding="utf-8",
    )
    os.mkfifo(output / prepare_plotly_data.REPORT_FILENAME)
    process = subprocess.Popen(
        [sys.executable, str(SCRIPT), str(output), "--verify-only"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=2)
    except subprocess.TimeoutExpired:
        timed_out = True
        process.kill()
        stdout, stderr = process.communicate()

    assert not timed_out, (stdout, stderr)
    assert process.returncode != 0
    assert "일반 파일" in stdout + stderr


def test_prepare_fifo_source_fails_fast_instead_of_blocking(tmp_path):
    if not hasattr(os, "mkfifo"):
        return
    source = tmp_path / "source.csv"
    os.mkfifo(source)
    output = tmp_path / "prepared"
    process = subprocess.Popen(
        [
            sys.executable,
            str(SCRIPT),
            str(output),
            "--source",
            str(source),
            "--allow-unpinned-source",
        ],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=2)
    except subprocess.TimeoutExpired:
        timed_out = True
        process.kill()
        stdout, stderr = process.communicate()

    assert not timed_out, (stdout, stderr)
    assert process.returncode != 0
    assert "일반 파일" in stdout + stderr
