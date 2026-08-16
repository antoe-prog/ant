"""Backtest CSV export is an all-or-nothing filesystem transaction."""

from __future__ import annotations

import csv
import os
import subprocess
import sys
import threading
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest
from typer.testing import CliRunner

from tossquant import cli
from tossquant.backtest import report
from tossquant.backtest.metrics import EquityPoint, compute
from tossquant.backtest.simulator import BacktestResult
from tossquant.cli import app
from tossquant.config import Settings


START = datetime(2026, 1, 5, tzinfo=timezone.utc)


def _result(*, trades: list[object] | None = None) -> BacktestResult:
    curve = [
        EquityPoint(START, Decimal("100"), Decimal("100"), Decimal("0")),
        EquityPoint(
            START + timedelta(days=1),
            Decimal("101"),
            Decimal("91"),
            Decimal("10"),
        ),
    ]
    benchmark = [
        EquityPoint(START, Decimal("100"), Decimal("0"), Decimal("100")),
        EquityPoint(
            START + timedelta(days=1),
            Decimal("102"),
            Decimal("0"),
            Decimal("102"),
        ),
    ]
    typed_trades = trades or []
    return BacktestResult(
        strategy_name="test",
        symbols=["AAPL"],
        interval="1d",
        curve=curve,
        trades=typed_trades,  # type: ignore[arg-type]
        metrics=compute(curve, typed_trades),  # type: ignore[arg-type]
        benchmark_curve=benchmark,
        benchmark_metrics=compute(benchmark),
        rejections=Counter(),
    )


def _seed_outputs(directory: Path) -> dict[str, bytes]:
    directory.mkdir()
    old = {
        "equity_curve.csv": b"old equity\n",
        "trades.csv": b"old trades\n",
    }
    for name, content in old.items():
        (directory / name).write_bytes(content)
    return old


def _assert_outputs(directory: Path, expected: dict[str, bytes]) -> None:
    for name, content in expected.items():
        assert (directory / name).read_bytes() == content


def test_success_publishes_both_validated_csv_files_without_staging_debris(tmp_path):
    output = tmp_path / "export"

    written = report.export(_result(), output)

    assert written == [output / "equity_curve.csv", output / "trades.csv"]
    with written[0].open(newline="", encoding="utf-8") as handle:
        equity_rows = list(csv.reader(handle))
    with written[1].open(newline="", encoding="utf-8") as handle:
        trade_rows = list(csv.reader(handle))
    assert equity_rows[0] == report._EQUITY_HEADER
    assert len(equity_rows) == 3
    assert trade_rows == [report._TRADES_HEADER]
    assert sorted(path.name for path in output.iterdir()) == [
        "equity_curve.csv",
        "trades.csv",
    ]


def test_success_preserves_each_existing_output_mode(tmp_path):
    output = tmp_path / "export"
    _seed_outputs(output)
    expected_modes = {
        "equity_curve.csv": 0o640,
        "trades.csv": 0o604,
    }
    for name, mode in expected_modes.items():
        (output / name).chmod(mode)

    report.export(_result(), output)

    assert {
        name: (output / name).stat().st_mode & 0o777
        for name in expected_modes
    } == expected_modes


def test_serialization_failure_preserves_both_existing_outputs(tmp_path):
    output = tmp_path / "export"
    old = _seed_outputs(output)

    class BrokenTrade:
        symbol = "AAPL"
        entry_ts = START
        exit_ts = START + timedelta(days=1)
        quantity = 1
        entry_price = Decimal("100")
        exit_price = Decimal("101")
        pnl = Decimal("1")
        bars_held = 1

        @property
        def return_pct(self) -> float:
            raise OSError("simulated serialization failure")

    with pytest.raises(Exception) as caught:
        report.export(_result(trades=[BrokenTrade()]), output)

    _assert_outputs(output, old)
    assert isinstance(caught.value, report.ExportError)
    assert "simulated serialization failure" in str(caught.value)
    assert sorted(path.name for path in output.iterdir()) == sorted(old)


def test_curve_length_mismatch_fails_before_replacing_outputs(tmp_path):
    output = tmp_path / "export"
    old = _seed_outputs(output)
    result = _result()
    result.benchmark_curve.pop()

    with pytest.raises(Exception) as caught:
        report.export(result, output)

    _assert_outputs(output, old)
    assert isinstance(caught.value, report.ExportError)
    assert "길이" in str(caught.value)


def test_curve_length_mismatch_does_not_create_output_directory(tmp_path):
    output = tmp_path / "export"
    result = _result()
    result.benchmark_curve.pop()

    with pytest.raises(report.ExportError, match="길이"):
        report.export(result, output)

    assert not output.exists()


def test_symlink_output_target_is_rejected_without_following_it(tmp_path):
    output = tmp_path / "export"
    output.mkdir()
    outside = tmp_path / "outside.csv"
    outside.write_bytes(b"outside must survive\n")
    (output / "equity_curve.csv").symlink_to(outside)
    (output / "trades.csv").write_bytes(b"old trades\n")

    with pytest.raises(Exception) as caught:
        report.export(_result(), output)

    assert isinstance(caught.value, report.ExportError)
    assert outside.read_bytes() == b"outside must survive\n"
    assert (output / "equity_curve.csv").is_symlink()
    assert (output / "trades.csv").read_bytes() == b"old trades\n"


def test_non_regular_output_target_is_rejected_before_any_publish(tmp_path):
    output = tmp_path / "export"
    output.mkdir()
    (output / "equity_curve.csv").mkdir()
    (output / "trades.csv").write_bytes(b"old trades\n")

    with pytest.raises(Exception) as caught:
        report.export(_result(), output)

    assert isinstance(caught.value, report.ExportError)
    assert (output / "equity_curve.csv").is_dir()
    assert (output / "trades.csv").read_bytes() == b"old trades\n"


def test_second_publish_failure_rolls_back_first_file(tmp_path, monkeypatch):
    output = tmp_path / "export"
    old = _seed_outputs(output)
    real_replace = os.replace
    failed = False

    def fail_second_publish(source, destination):
        nonlocal failed
        source_path = Path(source)
        destination_path = Path(destination)
        if (
            not failed
            and destination_path.name == "trades.csv"
            and source_path.suffix == ".tmp"
        ):
            failed = True
            raise OSError("simulated second publish failure")
        return real_replace(source, destination)

    monkeypatch.setattr(report.os, "replace", fail_second_publish)

    with pytest.raises(Exception) as caught:
        report.export(_result(), output)

    assert failed is True
    _assert_outputs(output, old)
    assert isinstance(caught.value, report.ExportError)
    assert "simulated second publish failure" in str(caught.value)
    assert sorted(path.name for path in output.iterdir()) == sorted(old)


def test_second_publish_failure_removes_first_new_output(tmp_path, monkeypatch):
    output = tmp_path / "export"
    output.mkdir()
    real_replace = os.replace

    def fail_second_publish(source, destination):
        if Path(destination).name == "trades.csv" and Path(source).suffix == ".tmp":
            raise OSError("simulated second publish failure")
        return real_replace(source, destination)

    monkeypatch.setattr(report.os, "replace", fail_second_publish)

    with pytest.raises(report.ExportError, match="second publish failure"):
        report.export(_result(), output)

    assert list(output.iterdir()) == []


def test_replace_that_succeeds_then_reports_failure_is_detected_and_rolled_back(
    tmp_path, monkeypatch
):
    output = tmp_path / "export"
    old = _seed_outputs(output)
    real_replace = os.replace
    injected = False

    def replace_then_fail(source, destination):
        nonlocal injected
        result = real_replace(source, destination)
        if not injected and Path(destination).name == "equity_curve.csv":
            injected = True
            raise OSError("simulated ambiguous publish failure")
        return result

    monkeypatch.setattr(report.os, "replace", replace_then_fail)

    with pytest.raises(report.ExportError, match="ambiguous publish failure"):
        report.export(_result(), output)

    assert injected is True
    _assert_outputs(output, old)
    assert sorted(path.name for path in output.iterdir()) == sorted(old)


def test_backup_failure_leaves_both_existing_outputs_untouched(tmp_path, monkeypatch):
    output = tmp_path / "export"
    old = _seed_outputs(output)
    real_backup = report._backup_regular_target
    calls = 0

    def fail_second_backup(target, expected):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("simulated backup failure")
        return real_backup(target, expected)

    monkeypatch.setattr(report, "_backup_regular_target", fail_second_backup)

    with pytest.raises(report.ExportError, match="backup failure"):
        report.export(_result(), output)

    _assert_outputs(output, old)
    assert sorted(path.name for path in output.iterdir()) == sorted(old)


@pytest.mark.parametrize("replace_backup_inode", [False, True])
def test_changed_backup_is_never_accepted_as_rollback_content(
    tmp_path, monkeypatch, replace_backup_inode
):
    output = tmp_path / "export"
    old = _seed_outputs(output)
    attacker_bytes = b"changed backup must not be restored\n"
    real_fsync_directory = report._fsync_directory
    real_replace = os.replace
    fsync_calls = 0

    def change_backup_after_snapshot(directory):
        nonlocal fsync_calls
        fsync_calls += 1
        if fsync_calls == 1:
            backups = list(output.glob(".equity_curve.csv.*.bak"))
            assert len(backups) == 1
            backup = backups[0]
            if replace_backup_inode:
                replacement = output / ".replacement-backup"
                replacement.write_bytes(attacker_bytes)
                real_replace(replacement, backup)
            else:
                backup.write_bytes(attacker_bytes)
        return real_fsync_directory(directory)

    def fail_second_publish(source, destination):
        if Path(destination).name == "trades.csv" and Path(source).suffix == ".tmp":
            raise OSError("force rollback after backup change")
        return real_replace(source, destination)

    monkeypatch.setattr(report, "_fsync_directory", change_backup_after_snapshot)
    monkeypatch.setattr(report.os, "replace", fail_second_publish)

    with pytest.raises(report.ExportError, match=r"자동 롤백도 실패.*백업|백업.*변경"):
        report.export(_result(), output)

    assert (output / "equity_curve.csv").read_bytes() != attacker_bytes
    assert (output / "trades.csv").read_bytes() == old["trades.csv"]


def test_in_place_change_after_backup_fails_closed_and_preserves_concurrent_bytes(
    tmp_path, monkeypatch
):
    output = tmp_path / "export"
    old = _seed_outputs(output)
    equity = output / "equity_curve.csv"
    before = equity.stat()
    replacement = b"new equity\n"
    assert len(replacement) == len(old["equity_curve.csv"])
    real_fsync_directory = report._fsync_directory
    injected = False

    def change_after_backups(directory):
        nonlocal injected
        if not injected:
            injected = True
            equity.write_bytes(replacement)
            os.utime(
                equity,
                ns=(before.st_atime_ns, before.st_mtime_ns),
                follow_symlinks=False,
            )
        return real_fsync_directory(directory)

    monkeypatch.setattr(report, "_fsync_directory", change_after_backups)

    with pytest.raises(report.ExportError, match="게시 직전 변경"):
        report.export(_result(), output)

    assert injected is True
    assert equity.read_bytes() == replacement
    assert (output / "trades.csv").read_bytes() == old["trades.csv"]
    assert sorted(path.name for path in output.iterdir()) == sorted(old)


def test_commit_directory_fsync_failure_rolls_back_both_files(tmp_path, monkeypatch):
    output = tmp_path / "export"
    old = _seed_outputs(output)
    real_fsync_directory = report._fsync_directory
    calls = 0

    def fail_commit_fsync(directory):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("simulated commit fsync failure")
        return real_fsync_directory(directory)

    monkeypatch.setattr(report, "_fsync_directory", fail_commit_fsync)

    with pytest.raises(Exception) as caught:
        report.export(_result(), output)

    assert calls == 3  # prepare, failed commit, successful rollback fsync
    _assert_outputs(output, old)
    assert isinstance(caught.value, report.ExportError)
    assert "simulated commit fsync failure" in str(caught.value)
    assert sorted(path.name for path in output.iterdir()) == sorted(old)


def test_commit_directory_fsync_failure_removes_both_new_files(tmp_path, monkeypatch):
    output = tmp_path / "export"
    output.mkdir()
    real_fsync_directory = report._fsync_directory
    calls = 0

    def fail_commit_fsync(directory):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("simulated commit fsync failure")
        return real_fsync_directory(directory)

    monkeypatch.setattr(report, "_fsync_directory", fail_commit_fsync)

    with pytest.raises(report.ExportError, match="commit fsync failure"):
        report.export(_result(), output)

    assert calls == 3
    assert list(output.iterdir()) == []


@pytest.mark.parametrize("replace_before_interrupt", [False, True])
def test_keyboard_interrupt_during_second_publish_rolls_back_the_pair(
    tmp_path, monkeypatch, replace_before_interrupt
):
    output = tmp_path / "export"
    old = _seed_outputs(output)
    real_replace = os.replace

    def interrupt_second_publish(source, destination):
        if Path(destination).name == "trades.csv" and Path(source).suffix == ".tmp":
            if replace_before_interrupt:
                real_replace(source, destination)
            raise KeyboardInterrupt("simulated publish interruption")
        return real_replace(source, destination)

    monkeypatch.setattr(report.os, "replace", interrupt_second_publish)

    with pytest.raises(KeyboardInterrupt, match="publish interruption"):
        report.export(_result(), output)

    _assert_outputs(output, old)
    assert sorted(path.name for path in output.iterdir()) == sorted(old)


def test_change_to_first_published_file_prevents_success_and_preserves_racer(
    tmp_path, monkeypatch
):
    output = tmp_path / "export"
    old = _seed_outputs(output)
    equity = output / "equity_curve.csv"
    concurrent = b"concurrent equity\n"
    real_replace = os.replace

    def change_first_before_second_publish(source, destination):
        if Path(destination).name == "trades.csv" and Path(source).suffix == ".tmp":
            equity.write_bytes(concurrent)
        return real_replace(source, destination)

    monkeypatch.setattr(report.os, "replace", change_first_before_second_publish)

    with pytest.raises(report.ExportError, match="변경|롤백"):
        report.export(_result(), output)

    assert equity.read_bytes() == concurrent
    assert (output / "trades.csv").read_bytes() == old["trades.csv"]


def test_cooperating_export_calls_are_serialized(tmp_path, monkeypatch):
    output = tmp_path / "export"
    real_transaction = report._export_transaction
    first_entered = threading.Event()
    release_first = threading.Event()
    second_entered = threading.Event()
    call_count = 0
    call_guard = threading.Lock()
    errors: list[BaseException] = []

    def observed_transaction(result, directory):
        nonlocal call_count
        with call_guard:
            call_count += 1
            call_number = call_count
        if call_number == 1:
            first_entered.set()
            assert release_first.wait(timeout=5)
        else:
            second_entered.set()
        return real_transaction(result, directory)

    def invoke_export():
        try:
            report.export(_result(), output)
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    monkeypatch.setattr(report, "_export_transaction", observed_transaction)
    first = threading.Thread(target=invoke_export)
    second = threading.Thread(target=invoke_export)
    first.start()
    assert first_entered.wait(timeout=5)
    second.start()
    assert not second_entered.wait(timeout=0.1)
    release_first.set()
    first.join(timeout=5)
    second.join(timeout=5)

    assert not first.is_alive() and not second.is_alive()
    assert errors == []
    assert second_entered.is_set()


def test_concurrent_first_exports_both_create_and_use_the_same_directory(
    tmp_path, monkeypatch
):
    output = tmp_path / "new-export"
    real_mkdir = Path.mkdir
    create_barrier = threading.Barrier(2)
    errors: list[BaseException] = []
    written: list[list[Path]] = []

    def synchronized_mkdir(path, *args, **kwargs):
        if path == output:
            create_barrier.wait(timeout=5)
        return real_mkdir(path, *args, **kwargs)

    def invoke_export():
        try:
            written.append(report.export(_result(), output))
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    monkeypatch.setattr(Path, "mkdir", synchronized_mkdir)
    first = threading.Thread(target=invoke_export)
    second = threading.Thread(target=invoke_export)
    first.start()
    second.start()
    first.join(timeout=5)
    second.join(timeout=5)

    assert not first.is_alive() and not second.is_alive()
    assert errors == []
    assert len(written) == 2
    assert sorted(path.name for path in output.iterdir()) == [
        "equity_curve.csv",
        "trades.csv",
    ]


def test_racing_directory_creator_cannot_substitute_a_symlink(tmp_path, monkeypatch):
    output = tmp_path / "new-export"
    outside = tmp_path / "outside"
    outside.mkdir()

    def substitute_symlink(path, *args, **kwargs):
        assert path == output
        path.symlink_to(outside, target_is_directory=True)

    monkeypatch.setattr(Path, "mkdir", substitute_symlink)

    with pytest.raises(report.ExportError, match="실제 디렉터리"):
        report.export(_result(), output)

    assert output.is_symlink()
    assert list(outside.iterdir()) == []


@pytest.mark.skipif(report.fcntl is None, reason="POSIX flock is unavailable")
def test_cooperating_process_waits_for_the_same_export_directory_lock(tmp_path):
    output = tmp_path / "export"
    output.mkdir()
    attempted = tmp_path / "attempted"
    acquired = tmp_path / "acquired"
    child = (
        "from pathlib import Path\n"
        "import sys\n"
        "from tossquant.backtest.report import _export_directory_lock\n"
        "directory, attempted, acquired = map(Path, sys.argv[1:])\n"
        "attempted.write_text('1', encoding='utf-8')\n"
        "with _export_directory_lock(directory):\n"
        "    acquired.write_text('1', encoding='utf-8')\n"
    )

    with report._export_directory_lock(output):
        process = subprocess.Popen(
            [
                sys.executable,
                "-c",
                child,
                str(output),
                str(attempted),
                str(acquired),
            ]
        )
        deadline = time.monotonic() + 5
        while not attempted.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert attempted.exists()
        time.sleep(0.1)
        assert not acquired.exists()

    assert process.wait(timeout=5) == 0
    assert acquired.read_text(encoding="utf-8") == "1"


def test_cli_reports_export_failure_without_exception_leak(tmp_path, monkeypatch):
    result_value = _result()
    monkeypatch.setattr(cli, "Settings", lambda: Settings(_env_file=None))
    monkeypatch.setattr(cli, "load_history", lambda *args, **kwargs: {})
    monkeypatch.setattr(cli.registry, "build", lambda *args, **kwargs: object())
    monkeypatch.setattr(
        cli,
        "Backtester",
        lambda *args, **kwargs: type("Finished", (), {"run": lambda self: result_value})(),
    )
    monkeypatch.setattr(cli, "render", lambda *args, **kwargs: None)

    def fail_export(*args, **kwargs):
        raise report.ExportError("simulated clean export failure")

    monkeypatch.setattr(cli, "export", fail_export)

    invoked = CliRunner().invoke(
        app, ["backtest", "--export", str(tmp_path / "result")]
    )

    assert invoked.exit_code == 1
    assert "simulated clean export failure" in invoked.output
    assert not isinstance(invoked.exception, (OSError, report.ExportError))
