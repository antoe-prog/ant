"""CLI 출력 테스트.

사용자가 실제로 보는 문자열을 검증한다. 안내문은 깨져도 예외가 나지 않아서
테스트가 없으면 그대로 방치된다 — rich가 `[/dim]` 같은 유효한 태그를 조용히
먹어버리는 게 대표적이다. (`[-1]`처럼 태그가 아닌 대괄호는 그대로 출력되므로,
안전한 문자열로 테스트하면 아무것도 지키지 못한다.)
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import typer
from pydantic import ValidationError
from rich.console import Console
from typer.testing import CliRunner

from tossquant import cli
from tossquant.broker.base import BrokerError
from tossquant.cli import app
from tossquant.config import Settings
from tossquant.store import Store

runner = CliRunner()


@pytest.fixture
def no_channels(monkeypatch, tmp_path):
    """알림 채널이 하나도 설정되지 않은 상태."""
    for key in (
        "TOSSQUANT_TELEGRAM_BOT_TOKEN",
        "TOSSQUANT_TELEGRAM_CHAT_ID",
        "TOSSQUANT_SLACK_WEBHOOK_URL",
    ):
        monkeypatch.setenv(key, "")
    monkeypatch.setenv("TOSSQUANT_DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.chdir(tmp_path)  # 실제 .env를 읽지 않게 한다


def guide(no_channels) -> str:
    return runner.invoke(app, ["notify-test"]).output


def test_paper_reset_refuses_live_bound_ledger(tmp_path, monkeypatch):
    path = tmp_path / "live-bound.db"
    scope = f"https://openapi.tossinvest.com|{tmp_path}-reset"
    bound = Store(path)
    bound.acquire_live_account_lease(scope)
    bound.close()

    monkeypatch.chdir(tmp_path)
    result = runner.invoke(
        app,
        ["reset", "--yes"],
        env={
            "TOSSQUANT_MODE": "paper",
            "TOSSQUANT_DB_PATH": str(path),
        },
    )

    assert result.exit_code == 1
    assert path.exists()
    assert "라이브" in result.output and ("원장" in result.output or "대사" in result.output)


def test_paper_reset_refuses_database_used_by_active_paper_broker(
    tmp_path, monkeypatch
):
    path = tmp_path / "active-paper.db"
    active = Store(path)
    active.acquire_paper_lease()
    try:
        monkeypatch.chdir(tmp_path)
        result = runner.invoke(
            app,
            ["reset", "--yes"],
            env={
                "TOSSQUANT_MODE": "paper",
                "TOSSQUANT_DB_PATH": str(path),
            },
        )
        assert result.exit_code == 1
        assert path.exists()
        assert "페이퍼" in result.output and "사용 중" in result.output
    finally:
        active.close()

    retried = runner.invoke(
        app,
        ["reset", "--yes"],
        env={
            "TOSSQUANT_MODE": "paper",
            "TOSSQUANT_DB_PATH": str(path),
        },
    )
    assert retried.exit_code == 0
    assert not path.exists()


def test_exits_nonzero_when_nothing_configured(no_channels):
    result = runner.invoke(app, ["notify-test"])
    assert result.exit_code == 1
    assert "설정된 알림 채널이 없습니다" in result.output


def test_guide_walks_through_botfather(no_channels):
    text = guide(no_channels)
    assert "@BotFather" in text
    assert "/newbot" in text


def test_guide_warns_to_message_the_bot_first(no_channels):
    """이 단계를 빼먹으면 getUpdates가 빈 배열을 준다 — 가장 흔한 막힘 지점."""
    text = guide(no_channels)
    assert "아무 메시지나 보냅니다" in text
    assert "빈 배열" in text


def test_guide_shows_getupdates_url(no_channels):
    assert "api.telegram.org/bot" in guide(no_channels)
    assert "getUpdates" in guide(no_channels)


def test_jq_filter_is_shown(no_channels):
    assert ".result[-1].message.chat.id" in guide(no_channels)


def test_shell_lines_do_not_interpret_rich_markup(monkeypatch):
    """복사용 줄에 대괄호 태그가 있어도 화면에서 사라지면 안 된다.

    rich는 유효한 태그를 조용히 먹어버린다. 예외가 나지 않으므로 안내문이
    깨진 채 방치되기 쉽다 — 실제로 한 번 깨졌었다.
    """
    recorder = Console(record=True, width=200)
    monkeypatch.setattr(cli, "console", recorder)

    cli._shell("jq .result[-1].x [/dim] [bold] [red]")

    output = recorder.export_text()
    for fragment in (".result[-1].x", "[/dim]", "[bold]", "[red]"):
        assert fragment in output, f"{fragment} 가 마크업으로 먹혔습니다"


def test_guide_explains_where_chat_id_lives_without_jq(no_channels):
    text = guide(no_channels)
    assert "result" in text and "chat" in text and "id" in text


def test_guide_names_the_env_keys(no_channels):
    text = guide(no_channels)
    assert "TOSSQUANT_TELEGRAM_BOT_TOKEN" in text
    assert "TOSSQUANT_TELEGRAM_CHAT_ID" in text


def test_guide_offers_slack_as_an_alternative(no_channels):
    text = guide(no_channels)
    assert "Slack" in text
    assert "TOSSQUANT_SLACK_WEBHOOK_URL" in text


def test_guide_tells_you_what_to_do_next(no_channels):
    assert "다시 실행" in guide(no_channels)


def test_copyable_lines_fit_in_eighty_columns(no_channels):
    """복사용 줄이 접히면 붙여넣은 명령이 깨진다."""
    for line in guide(no_channels).splitlines():
        if line.startswith("   ") and not line.startswith("    "):
            assert len(line) <= 80, f"너무 긴 복사용 줄: {line}"


def test_help_lists_every_command():
    output = runner.invoke(app, ["--help"]).output
    for command in ("verify", "run", "status", "notify-test", "backtest",
                    "walkforward", "scan-data", "reset"):
        assert command in output


def test_walkforward_help_exposes_data_break_policy():
    output = runner.invoke(app, ["walkforward", "--help"]).output
    assert "--on-break" in output
    assert "--verified-splits" in output
    assert "--regime" in output
    assert "--regime-ma" in output
    assert "필수" in output


def test_backtest_help_says_adjust_requires_verified_manifest():
    output = runner.invoke(app, ["backtest", "--help"]).output

    assert "--verified-splits" in output
    assert "필수" in output


def test_backtest_help_does_not_claim_live_and_replay_share_fill_code():
    output = runner.invoke(app, ["backtest", "--help"]).output
    normalized = " ".join(output.split())

    assert "같은 전략·리스크 코드를" in normalized
    assert "체결 모델은 라이브와 다릅니다" in normalized
    assert "같은 전략·리스크·체결 코드를 그대로" not in normalized


@pytest.mark.parametrize("policy", ["warn", "adjust"])
def test_walkforward_forwards_data_break_policy(monkeypatch, policy):
    captured = {}

    def stop_after_load(*args, **kwargs):
        captured["on_break"] = kwargs["on_break"]
        raise ValueError("stop after capture")

    monkeypatch.setattr(cli, "load_history", stop_after_load)

    result = runner.invoke(app, ["walkforward", "--on-break", policy])

    assert result.exit_code == 1
    assert captured["on_break"] == policy


@pytest.mark.parametrize(
    ("targets", "regime_symbol"),
    [
        (["AAPL"], "SPY"),
        (["AAPL", "SPY"], "SPY"),
        (["AAPL", "spy"], "SPY"),
        (["AAPL", "SPY", "sPy"], "spy"),
    ],
)
def test_walkforward_loads_enabled_regime_symbol_once_as_data_only(
    monkeypatch, targets, regime_symbol
):
    settings = Settings(
        _env_file=None,
        symbols=targets,
        regime_enabled=True,
        regime_symbol=regime_symbol,
    )
    captured = {}

    monkeypatch.setattr(cli, "Settings", lambda: settings)

    def capture_load(symbols, *args, **kwargs):
        captured["symbols"] = symbols
        return {symbol: [] for symbol in symbols}

    def stop_after_run(history, run_settings, **kwargs):
        captured["history_symbols"] = list(history)
        captured["regime_symbol"] = run_settings.regime_symbol
        raise ValueError("stop after capture")

    monkeypatch.setattr(cli, "load_history", capture_load)
    monkeypatch.setattr(cli.walkforward_mod, "run", stop_after_run)

    result = runner.invoke(app, ["walkforward"])

    assert result.exit_code == 1
    assert captured["symbols"] == ["AAPL", "SPY"]
    assert captured["history_symbols"] == ["AAPL", "SPY"]
    assert captured["regime_symbol"] == "SPY"


def test_backtest_canonicalizes_and_deduplicates_regime_data(monkeypatch):
    settings = Settings(
        _env_file=None,
        symbols=["AAPL", "SPY"],
        regime_enabled=True,
        regime_symbol="spy",
    )
    captured = {}
    monkeypatch.setattr(cli, "Settings", lambda: settings)

    def stop_after_load(symbols, *args, **kwargs):
        captured["symbols"] = symbols
        captured["regime_symbol"] = settings.regime_symbol
        raise ValueError("stop after capture")

    monkeypatch.setattr(cli, "load_history", stop_after_load)

    result = runner.invoke(app, ["backtest"])

    assert result.exit_code == 1
    assert captured == {"symbols": ["AAPL", "SPY"], "regime_symbol": "SPY"}


def test_regime_off_ignores_surrounding_whitespace(monkeypatch):
    settings = Settings(
        _env_file=None,
        symbols=["AAPL"],
        regime_enabled=True,
        regime_symbol="SPY",
    )
    captured = {}
    monkeypatch.setattr(cli, "Settings", lambda: settings)

    def stop_after_load(symbols, *args, **kwargs):
        captured["symbols"] = symbols
        captured["enabled"] = settings.regime_enabled
        raise ValueError("stop after capture")

    monkeypatch.setattr(cli, "load_history", stop_after_load)

    result = runner.invoke(app, ["backtest", "--regime", " off "])

    assert result.exit_code == 1
    assert captured == {"symbols": ["AAPL"], "enabled": False}


def test_blank_regime_flag_fails_before_loading_data(monkeypatch):
    monkeypatch.setattr(cli, "Settings", lambda: Settings(_env_file=None))

    def should_not_load(*args, **kwargs):
        raise AssertionError("blank regime reached the data loader")

    monkeypatch.setattr(cli, "load_history", should_not_load)

    result = runner.invoke(app, ["backtest", "--regime", "   "])

    assert result.exit_code == 1
    assert "--regime" in result.output
    assert not isinstance(result.exception, AssertionError)


def test_walkforward_regime_flags_enable_and_configure_filter(monkeypatch):
    settings = Settings(_env_file=None, symbols=["AAPL", "spy"])
    captured = {}
    monkeypatch.setattr(cli, "Settings", lambda: settings)

    def capture_load(symbols, *args, **kwargs):
        captured["symbols"] = symbols
        return {symbol: [] for symbol in symbols}

    def stop_after_run(history, run_settings, **kwargs):
        captured["enabled"] = run_settings.regime_enabled
        captured["regime_symbol"] = run_settings.regime_symbol
        captured["regime_ma_bars"] = run_settings.regime_ma_bars
        raise ValueError("stop after capture")

    monkeypatch.setattr(cli, "load_history", capture_load)
    monkeypatch.setattr(cli.walkforward_mod, "run", stop_after_run)

    result = runner.invoke(
        app, ["walkforward", "--regime", "sPy", "--regime-ma", "50"]
    )

    assert result.exit_code == 1
    assert captured == {
        "symbols": ["AAPL", "SPY"],
        "enabled": True,
        "regime_symbol": "SPY",
        "regime_ma_bars": 50,
    }


def test_walkforward_loads_and_forwards_verified_split_manifest(monkeypatch, tmp_path):
    manifest = tmp_path / "splits.csv"
    manifest.write_text(
        "symbol,date,ratio,event_type,source\n"
        "AAPL,2020-08-31,0.25,split,issuer\n",
        encoding="utf-8",
    )
    captured = {}

    def stop_after_load(*args, **kwargs):
        captured.update(kwargs)
        raise ValueError("stop after capture")

    monkeypatch.setattr(cli, "load_history", stop_after_load)

    result = runner.invoke(
        app,
        [
            "walkforward",
            "--on-break",
            "adjust",
            "--verified-splits",
            str(manifest),
        ],
    )

    assert result.exit_code == 1
    assert captured["verified_splits"]["AAPL"][0].source == "issuer"


def test_backtest_adjust_without_manifest_fails_clearly(tmp_path):
    result = runner.invoke(
        app,
        ["backtest", "--csv-dir", str(tmp_path), "--on-break", "adjust"],
    )

    assert result.exit_code == 1
    assert "verified_splits" in result.output


def _scan_csv(path, row: str) -> None:
    path.write_text(
        "date,open,high,low,close,volume\n" + row + "\n",
        encoding="utf-8",
    )


def test_scan_data_reports_processed_and_skipped_files(tmp_path):
    _scan_csv(tmp_path / "GOOD.csv", "2026-01-02,10,11,9,10,1000")
    _scan_csv(tmp_path / "BAD.csv", "2026-01-02,,11,9,10,1000")

    result = runner.invoke(app, ["scan-data", "--csv-dir", str(tmp_path)])

    assert result.exit_code == 0
    assert "1개 처리" in result.output
    assert "1개 건너뜀" in result.output
    assert "BAD.csv" in result.output


def test_scan_data_prints_dataset_and_package_code_provenance(tmp_path):
    _scan_csv(tmp_path / "GOOD.csv", "2026-01-02,10,11,9,10,1000")

    result = runner.invoke(app, ["scan-data", "--csv-dir", str(tmp_path)])

    assert result.exit_code == 0
    assert re.search(r"scan_input=[0-9a-f]{64}", result.output)
    assert f"scan_code={cli.STARTUP_CODE_SHA256}" in result.output


def test_scan_data_without_csv_reports_startup_code_provenance(tmp_path):
    result = runner.invoke(app, ["scan-data", "--csv-dir", str(tmp_path)])

    assert result.exit_code == 1
    assert "CSV가 없습니다" in result.output
    assert f"scan_code={cli.STARTUP_CODE_SHA256}" in result.output
    assert result.output.rstrip().endswith("scan_exit_status=1")


def test_scan_data_list_failure_reports_startup_code_provenance(
    tmp_path, monkeypatch
):
    def fail_glob(self, pattern):
        raise PermissionError("simulated directory failure")

    monkeypatch.setattr(Path, "glob", fail_glob)

    result = runner.invoke(app, ["scan-data", "--csv-dir", str(tmp_path)])

    assert result.exit_code == 1
    assert "CSV 목록 조회 실패" in result.output
    assert "simulated directory failure" in result.output
    assert f"scan_code={cli.STARTUP_CODE_SHA256}" in result.output
    assert result.output.rstrip().endswith("scan_exit_status=1")


def test_scan_rejects_package_code_changed_after_cli_import(tmp_path):
    copied_src = tmp_path / "src"
    copied_package = copied_src / "tossquant"
    shutil.copytree(Path(cli.__file__).resolve().parent, copied_package)
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    _scan_csv(csv_dir / "GOOD.csv", "2026-01-02,10,11,9,10,1000")
    runner_code = """
import pathlib
import sys
from typer.testing import CliRunner

sys.path.insert(0, sys.argv[1])
from tossquant import cli

corporate = pathlib.Path(sys.argv[1]) / "tossquant" / "backtest" / "corporate.py"
with corporate.open("a", encoding="utf-8") as handle:
    handle.write(
        "\\n# injected after cli import\\n"
        "def detect(*args, **kwargs):\\n"
        "    return ['NEW_DISK_CODE']\\n"
    )
result = CliRunner().invoke(
    cli.app, ["scan-data", "--csv-dir", sys.argv[2]]
)
print(result.output)
startup = getattr(cli, "STARTUP_CODE_SHA256", "missing")
valid = (
    result.exit_code == 1
    and "TossQuant 코드가" in result.output
    and f"scan_code={startup}" in result.output
)
raise SystemExit(0 if valid else 9)
"""

    completed = subprocess.run(
        [
            sys.executable,
            "-I",
            "-c",
            runner_code,
            str(copied_src),
            str(csv_dir),
        ],
        text=True,
        capture_output=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_scan_data_prints_machine_readable_context_and_success_status(
    tmp_path, monkeypatch
):
    _scan_csv(tmp_path / "GOOD.csv", "2026-01-02,10,11,9,10,1000")
    argv = ["tossquant", "scan-data", "--csv-dir", str(tmp_path)]
    monkeypatch.setattr(sys, "argv", argv)

    result = runner.invoke(app, argv[1:])

    assert result.exit_code == 0
    context_line = next(
        line for line in result.output.splitlines() if line.startswith("scan_context=")
    )
    assert json.loads(context_line.removeprefix("scan_context=")) == {
        "argv": argv,
        "cwd": str(tmp_path.cwd()),
    }
    assert "scan_exit_status=0" in result.output
    assert result.output.rstrip().splitlines()[-1].startswith("scan_result=")


def test_scan_data_terminal_result_contains_complete_structured_semantics(
    tmp_path, monkeypatch
):
    _scan_csv(tmp_path / "GOOD.csv", "2026-01-02,10,11,9,10,1000")
    argv = ["tossquant", "scan-data", "--csv-dir", str(tmp_path)]
    monkeypatch.setattr(sys, "argv", argv)

    completed = runner.invoke(app, argv[1:])

    assert completed.exit_code == 0
    lines = [
        line
        for line in completed.output.splitlines()
        if line.startswith("scan_result=")
    ]
    assert len(lines) == 1
    assert completed.output.rstrip().splitlines()[-1] == lines[0]
    payload = json.loads(lines[0].removeprefix("scan_result="))
    assert payload["schema_version"] == 1
    assert payload["kind"] == "tossquant.scan_result"
    assert payload["reported_exit_status"] == 0
    assert payload["invocation"] == {
        "argv": argv,
        "cwd": str(tmp_path.cwd()),
    }
    assert payload["request"] == {
        "strict": False,
        "threshold": "0.25",
    }
    assert payload["input"]["digest_algorithm"] == cli.CSV_DATASET_DIGEST_ALGORITHM
    assert len(payload["input"]["sha256"]) == 64
    assert payload["code"]["digest_algorithm"] == cli.PACKAGE_CODE_DIGEST_ALGORITHM
    assert payload["code"]["sha256"] == cli.STARTUP_CODE_SHA256
    assert payload["processed"] == 1
    assert payload["skipped_files"] == []
    assert payload["break_count"] == 0
    assert payload["categories"] == {
        "candidate_adjustments": [],
        "transient_or_roundtrip": [],
        "unknown_down": [],
        "unknown_up": [],
    }


def test_scan_data_fails_if_input_changes_during_scan(tmp_path, monkeypatch):
    csv_path = tmp_path / "GOOD.csv"
    _scan_csv(csv_path, "2026-01-02,10,11,9,10,1000")
    original_detect = cli.detect

    def mutate_after_read(candles, threshold):
        _scan_csv(csv_path, "2026-01-02,20,21,19,20,1000")
        return original_detect(candles, threshold)

    monkeypatch.setattr(cli, "detect", mutate_after_read)

    result = runner.invoke(app, ["scan-data", "--csv-dir", str(tmp_path)])

    assert result.exit_code == 1
    assert "스캔 중 CSV 입력 내용이 변경됐습니다" in result.output
    assert "불연속 0건" not in result.output
    assert result.output.rstrip().endswith("scan_exit_status=1")


def test_scan_data_classifies_the_hashed_snapshot_when_live_bytes_swap_and_restore(
    tmp_path, monkeypatch
):
    csv_path = tmp_path / "GOOD.csv"
    rows = ["date,open,high,low,close,volume"]
    rows.extend(
        f"2026-01-{day:02d},100,100,100,100,1000"
        for day in range(1, 29)
    )
    original_text = "\n".join(rows) + "\n"
    csv_path.write_text(original_text, encoding="utf-8")
    expected_digest = cli._csv_dataset_sha256([csv_path])
    original_fetch = cli.CsvSource.fetch
    classified_directories = []

    def swap_only_while_fetch_reads(self, symbol, interval, count):
        classified_directories.append(self.directory)
        changed = rows.copy()
        for index in range(15, len(changed)):
            fields = changed[index].split(",")
            fields[1:5] = ["50", "50", "50", "50"]
            fields[5] = "2000"
            changed[index] = ",".join(fields)
        csv_path.write_text("\n".join(changed) + "\n", encoding="utf-8")
        try:
            return original_fetch(self, symbol, interval, count)
        finally:
            csv_path.write_text(original_text, encoding="utf-8")

    monkeypatch.setattr(cli.CsvSource, "fetch", swap_only_while_fetch_reads)

    result = runner.invoke(app, ["scan-data", "--csv-dir", str(tmp_path)])

    assert result.exit_code == 0
    assert f"scan_input={expected_digest}" in result.output
    assert "불연속 0건" in result.output
    assert "불연속 1건" not in result.output
    assert csv_path.read_text(encoding="utf-8") == original_text
    assert classified_directories
    assert all(directory != tmp_path for directory in classified_directories)
    assert all(not directory.exists() for directory in classified_directories)
    assert "scan_exit_status=0" in result.output
    assert result.output.rstrip().splitlines()[-1].startswith("scan_result=")


def test_scan_data_strict_fails_when_any_file_is_invalid(tmp_path):
    _scan_csv(tmp_path / "GOOD.csv", "2026-01-02,10,11,9,10,1000")
    _scan_csv(tmp_path / "BAD.csv", "2026-01-02,,11,9,10,1000")

    result = runner.invoke(
        app, ["scan-data", "--csv-dir", str(tmp_path), "--strict"]
    )

    assert result.exit_code == 1
    assert re.search(r"scan_input=[0-9a-f]{64}", result.output)
    assert f"scan_code={cli.STARTUP_CODE_SHA256}" in result.output
    assert result.output.rstrip().endswith("scan_exit_status=1")


@pytest.mark.parametrize("strict", [False, True])
def test_scan_data_contains_post_hash_oserror_and_reports_failure_provenance(
    tmp_path, monkeypatch, strict
):
    _scan_csv(tmp_path / "GOOD.csv", "2026-01-02,10,11,9,10,1000")

    def unreadable(*args, **kwargs):
        raise PermissionError("simulated unreadable CSV")

    monkeypatch.setattr(cli.CsvSource, "fetch", unreadable)
    args = ["scan-data", "--csv-dir", str(tmp_path)]
    if strict:
        args.append("--strict")

    result = runner.invoke(app, args)

    assert result.exit_code == 1
    assert "GOOD.csv" in result.output
    assert "simulated unreadable CSV" in result.output
    assert "scan_context=" in result.output
    assert re.search(r"scan_input=[0-9a-f]{64}", result.output)
    assert f"scan_code={cli.STARTUP_CODE_SHA256}" in result.output
    assert result.output.rstrip().endswith("scan_exit_status=1")
    assert not isinstance(result.exception, OSError)


@pytest.mark.parametrize(
    ("command", "option", "value"),
    [
        ("backtest", "--cash", "inf"),
        ("backtest", "--cash", "-1"),
        ("backtest", "--stop-loss", "inf"),
        ("backtest", "--stop-loss", "1"),
        ("backtest", "--trailing", "1"),
        ("backtest", "--take-profit", "nan"),
        ("backtest", "--take-profit", "-0.5"),
        ("walkforward", "--cash", "inf"),
    ],
)
def test_numeric_overrides_fail_cleanly_before_loading_data(
    monkeypatch, command, option, value
):
    monkeypatch.setattr(cli, "Settings", lambda: Settings(_env_file=None))

    def should_not_load(*args, **kwargs):
        raise AssertionError("invalid CLI option reached the data loader")

    monkeypatch.setattr(cli, "load_history", should_not_load)

    result = runner.invoke(app, [command, option, value])

    assert result.exit_code == 1
    assert option in result.output
    assert not isinstance(result.exception, (ArithmeticError, BrokerError))


@pytest.mark.parametrize(
    ("args", "option"),
    [
        (["--fast", "-1"], "--fast"),
        (["--fast", "80"], "--fast"),
        (["--slow", "10"], "--slow"),
    ],
)
def test_invalid_sma_overrides_fail_cleanly_before_loading_data(
    monkeypatch, args, option
):
    monkeypatch.setattr(cli, "Settings", lambda: Settings(_env_file=None))

    def should_not_load(*args, **kwargs):
        raise AssertionError("invalid SMA override reached the data loader")

    monkeypatch.setattr(cli, "load_history", should_not_load)

    result = runner.invoke(app, ["backtest", *args])

    assert result.exit_code == 1
    assert option in result.output
    assert not isinstance(result.exception, (AssertionError, ValidationError))


def test_valid_sma_pair_is_applied_atomically(monkeypatch):
    monkeypatch.setattr(cli, "Settings", lambda: Settings(_env_file=None))
    captured = {}
    monkeypatch.setattr(cli, "load_history", lambda *args, **kwargs: {})

    def capture_build(name, settings):
        captured["pair"] = (settings.sma_fast, settings.sma_slow)
        raise ValueError("stop after capture")

    monkeypatch.setattr(cli.registry, "build", capture_build)

    result = runner.invoke(
        app, ["backtest", "--fast", "80", "--slow", "100"]
    )

    assert result.exit_code == 1
    assert captured["pair"] == (80, 100)


def test_max_holding_below_sentinel_fails_before_loading_data(monkeypatch):
    monkeypatch.setattr(cli, "Settings", lambda: Settings(_env_file=None))

    def should_not_load(*args, **kwargs):
        raise AssertionError("invalid max holding reached the data loader")

    monkeypatch.setattr(cli, "load_history", should_not_load)

    result = runner.invoke(app, ["backtest", "--max-holding", "-2"])

    assert result.exit_code == 1
    assert "--max-holding" in result.output
    assert not isinstance(result.exception, AssertionError)


@pytest.mark.parametrize(("raw", "expected"), [("-1", 30), ("0", 0)])
def test_max_holding_sentinel_and_disable_values(monkeypatch, raw, expected):
    settings = Settings(_env_file=None, max_holding_days=30)
    captured = {}
    monkeypatch.setattr(cli, "Settings", lambda: settings)

    def stop_after_load(*args, **kwargs):
        captured["max_holding_days"] = settings.max_holding_days
        raise ValueError("stop after capture")

    monkeypatch.setattr(cli, "load_history", stop_after_load)

    result = runner.invoke(app, ["backtest", "--max-holding", raw])

    assert result.exit_code == 1
    assert captured["max_holding_days"] == expected


@pytest.mark.parametrize("command", ["backtest", "walkforward"])
def test_history_broker_error_is_reported_without_exception_leak(monkeypatch, command):
    monkeypatch.setattr(cli, "Settings", lambda: Settings(_env_file=None))

    def fail_load(*args, **kwargs):
        raise BrokerError("simulated Toss API failure")

    monkeypatch.setattr(cli, "load_history", fail_load)

    result = runner.invoke(app, [command])

    assert result.exit_code == 1
    assert "simulated Toss API failure" in result.output
    assert not isinstance(result.exception, BrokerError)


def test_verify_returns_failure_when_any_post_token_stage_fails(monkeypatch):
    settings = Settings(
        _env_file=None,
        account_id="account",
        symbols=["AAPL"],
    )

    class FailingClient:
        closed = False

        def _access_token(self):
            return "token-12345678"

        def list_accounts(self):
            raise BrokerError("accounts failed")

        def get_quote(self, symbol):
            raise BrokerError("quote failed")

        def get_candles(self, symbol, interval, count):
            raise BrokerError("candles failed")

        def get_account(self):
            raise BrokerError("account failed")

        def close(self):
            self.closed = True

    client = FailingClient()
    monkeypatch.setattr(cli, "Settings", lambda: settings)
    monkeypatch.setattr(cli, "_client", lambda ignored: client)
    monkeypatch.setattr(cli, "public_ip", lambda: None)

    result = runner.invoke(app, ["verify"])

    assert result.exit_code == 1
    for message in ("accounts failed", "quote failed", "candles failed", "account failed"):
        assert message in result.output
    assert client.closed is True


def test_verify_help_describes_parsed_results_not_raw_response():
    output = runner.invoke(app, ["verify", "--help"]).output

    assert "파싱" in output
    assert "그대로" not in output


def test_scan_data_strict_rejects_header_only_csv(tmp_path):
    (tmp_path / "EMPTY.csv").write_text(
        "date,open,high,low,close,volume\n", encoding="utf-8"
    )

    result = runner.invoke(
        app, ["scan-data", "--csv-dir", str(tmp_path), "--strict"]
    )

    assert result.exit_code == 1
    assert "EMPTY.csv" in result.output
    assert "캔들이 없습니다" in result.output
    assert "scan_context=" in result.output
    assert re.search(r"scan_input=[0-9a-f]{64}", result.output)
    assert f"scan_code={cli.STARTUP_CODE_SHA256}" in result.output
    assert result.output.rstrip().endswith("scan_exit_status=1")


def test_scan_data_describes_unverified_down_gap_as_manual_lookahead_sensitivity(
    tmp_path,
):
    rows = ["date,open,high,low,close,volume"]
    rows.append("2026-01-01,100,100,100,100,1000")
    for day in range(2, 9):
        rows.append(f"2026-01-{day:02d},50,50,50,50,1000")
    (tmp_path / "GAP.csv").write_text("\n".join(rows) + "\n")

    result = runner.invoke(app, ["scan-data", "--csv-dir", str(tmp_path)])

    assert result.exit_code == 0
    assert "수동 확인" in result.output
    assert "사후 전체기간 민감도" in result.output
    assert "편향" in result.output
    assert "정제 결과가 아닙니다" in result.output


@pytest.mark.parametrize("threshold", ["0", "-0.1", "nan", "inf"])
def test_scan_data_rejects_invalid_threshold(tmp_path, threshold):
    _scan_csv(tmp_path / "GOOD.csv", "2026-01-02,10,11,9,10,1000")

    result = runner.invoke(
        app,
        ["scan-data", "--csv-dir", str(tmp_path), "--threshold", threshold],
    )

    assert result.exit_code == 1
    assert "threshold" in result.output
    assert f"scan_code={cli.STARTUP_CODE_SHA256}" in result.output
    assert result.output.rstrip().endswith("scan_exit_status=1")


# --- --count 기본값 ----------------------------------------------------------


def test_count_defaults_to_all_for_csv():
    """로컬 CSV에 상한을 걸면 파일에 5년치가 있어도 뒷부분만 잘라 쓰게 된다."""
    assert cli._resolve_count(-1, "csv", 500) == 0


def test_count_defaults_to_api_limit_for_toss():
    """토스는 호출 한도가 있으니 개수를 제한하는 게 맞다."""
    assert cli._resolve_count(-1, "toss", 500) == 500


def test_explicit_count_wins_for_both_sources():
    assert cli._resolve_count(300, "csv", 500) == 300
    assert cli._resolve_count(300, "toss", 500) == 300


def test_explicit_zero_is_rejected_for_unverified_toss_all_history_contract():
    with pytest.raises(ValueError, match="Toss.*0"):
        cli._resolve_count(0, "toss", 500)


@pytest.mark.parametrize("count", [-2, -10])
def test_count_rejects_negative_values_other_than_the_internal_default(count):
    with pytest.raises(ValueError, match="count|개수|-1"):
        cli._resolve_count(count, "csv", 500)


# --- 전략 선택 ---------------------------------------------------------------


def test_strategy_flag_overrides_settings():
    settings = Settings(_env_file=None, client_id="x", client_secret="y")
    cli._select_strategy(settings, "breakout")
    assert settings.strategy == "breakout"


def test_empty_strategy_flag_keeps_settings():
    settings = Settings(_env_file=None, client_id="x", client_secret="y",
                        strategy="momentum")
    cli._select_strategy(settings, "")
    assert settings.strategy == "momentum"


def test_unknown_strategy_exits():
    settings = Settings(_env_file=None, client_id="x", client_secret="y")
    with pytest.raises(typer.Exit):
        cli._select_strategy(settings, "없는전략")


# --- --grid 파싱 -------------------------------------------------------------


def test_empty_grid_spec_uses_strategy_default():
    grid = cli._parse_grid("", "breakout")
    assert set(grid.values) == {"entry_bars", "exit_bars"}


def test_grid_spec_overrides_one_axis_only():
    """지정하지 않은 축은 기본값을 유지해야 한다."""
    grid = cli._parse_grid("fast=5,7", "sma_cross")
    assert grid.values["fast"] == [5, 7]
    assert grid.values["slow"] == [40, 60, 100, 150]


def test_grid_spec_parses_floats():
    grid = cli._parse_grid("entry_z=-1.5,-2.5", "mean_reversion")
    assert grid.values["entry_z"] == [-1.5, -2.5]


def test_grid_spec_keeps_validity_rule():
    """축을 덮어써도 fast < slow 규칙은 살아 있어야 한다."""
    grid = cli._parse_grid("fast=30,100", "sma_cross")
    assert all(c["fast"] < c["slow"] for c in grid.combinations())


def test_malformed_grid_spec_exits():
    with pytest.raises(typer.Exit):
        cli._parse_grid("fast", "sma_cross")


def test_non_numeric_grid_value_exits():
    with pytest.raises(typer.Exit):
        cli._parse_grid("fast=abc", "sma_cross")


@pytest.mark.parametrize("spec", ["lookbak=5", "=5"])
def test_grid_rejects_unknown_or_blank_axis_names(spec):
    with pytest.raises(typer.Exit):
        cli._parse_grid(spec, "momentum")


@pytest.mark.parametrize(
    "spec",
    [
        "fast=5;fast=10",
        "fast=5,5",
        "fast=5,5.0",
        "fast=5,",
        "fast=5;",
    ],
)
def test_grid_rejects_duplicate_or_blank_keys_and_values(spec):
    with pytest.raises(typer.Exit):
        cli._parse_grid(spec, "sma_cross")


def test_grid_combinations_are_unique_after_a_partial_override():
    grid = cli._parse_grid("fast=5,10", "sma_cross")
    combinations = list(grid.combinations())
    identities = {tuple(sorted(item.items())) for item in combinations}

    assert len(combinations) == len(identities)


@pytest.mark.parametrize(
    ("spec", "strategy"),
    [
        ("fast=5.5", "sma_cross"),
        ("slow=40.0", "sma_cross"),
        ("lookback=20.0", "momentum"),
        ("entry_bars=20.0", "breakout"),
        ("entry=1.0e309", "momentum"),
        ("entry_z=-1.0e309", "mean_reversion"),
    ],
)
def test_grid_rejects_wrong_numeric_types_and_non_finite_thresholds(spec, strategy):
    with pytest.raises(typer.Exit):
        cli._parse_grid(spec, strategy)
