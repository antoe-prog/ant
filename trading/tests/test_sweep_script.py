from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Mapping


SCRIPT = Path(__file__).parents[1] / "scripts" / "sweep.py"
PREPARE_SCRIPT = Path(__file__).parents[1] / "scripts" / "prepare_plotly_data.py"


def run_sweep(
    *args: str,
    env: Mapping[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        text=True,
        capture_output=True,
        check=False,
        env=env,
    )


def sweep_result(output: str) -> dict:
    lines = [
        line
        for line in output.splitlines()
        if line.startswith("sweep_result=")
    ]
    assert len(lines) == 1
    assert output.rstrip().splitlines()[-1] == lines[0]
    return json.loads(lines[0].removeprefix("sweep_result="))


def write_flat_history(
    path: Path,
    *,
    prices: list[int] | None = None,
    invalid_offset: int | None = None,
    first: date = date(2025, 1, 1),
) -> date:
    values = prices or [100] * 90
    rows = ["date,open,high,low,close,volume"]
    for offset, price in enumerate(values):
        day = first + timedelta(days=offset)
        if offset == invalid_offset:
            rows.append(f"{day.isoformat()},100,90,95,100,1000")
            continue
        volume = 2000 if prices is not None and offset >= len(values) // 2 else 1000
        rows.append(
            f"{day.isoformat()},{price},{price},{price},{price},{volume}"
        )
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return first


def write_history_with_missing_date(path: Path, missing_offset: int) -> date:
    rows = ["date,open,high,low,close,volume"]
    first = date(2025, 1, 1)
    for offset in range(91):
        if offset == missing_offset:
            continue
        day = first + timedelta(days=offset)
        rows.append(f"{day.isoformat()},100,100,100,100,1000")
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return first


def test_exclusion_help_calls_out_full_sample_lookahead():
    result = run_sweep("--help")

    assert result.returncode == 0
    assert "--exclude-contaminated" in result.stdout
    assert "미래정보" in result.stdout
    assert "민감도" in result.stdout


def test_exclusion_run_prints_bias_warning_even_when_nothing_is_dropped(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    rows = ["date,open,high,low,close,volume"]
    first = date(2025, 1, 1)
    for offset in range(90):
        day = first + timedelta(days=offset)
        rows.append(f"{day.isoformat()},100,100,100,100,1000")
    (csv_dir / "AAA.csv").write_text("\n".join(rows) + "\n")

    result = run_sweep(str(csv_dir), "--exclude-contaminated")

    assert result.returncode == 0, result.stderr
    assert "사후 전체기간 민감도" in result.stdout
    assert "편향 없는 성과로 해석할 수 없습니다" in result.stdout
    assert (
        '사후 민감도 계약 {"unbiased_estimate": false, '
        '"uses_future_information": true}'
    ) in result.stdout


def test_success_log_binds_argv_cwd_and_exit_status(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "AAA.csv")

    result = run_sweep(str(csv_dir))

    assert result.returncode == 0, result.stderr
    context_line = next(
        line for line in result.stdout.splitlines()
        if line.startswith("실행 컨텍스트 ")
    )
    context = json.loads(context_line.removeprefix("실행 컨텍스트 "))
    assert context == {
        "argv": [str(SCRIPT), str(csv_dir)],
        "cwd": str(Path.cwd().resolve()),
    }
    assert '실행 종료 {"exit_status": 0}' in result.stdout


def test_success_terminal_result_contains_complete_unrounded_semantics(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "AAA.csv")

    completed = run_sweep(str(csv_dir), "--strategy", "sma_cross")

    assert completed.returncode == 0, completed.stderr
    payload = sweep_result(completed.stdout)
    assert payload["schema_version"] == 1
    assert payload["kind"] == "tossquant.sweep_result"
    assert payload["reported_exit_status"] == 0
    assert payload["invocation"] == {
        "argv": [str(SCRIPT), str(csv_dir), "--strategy", "sma_cross"],
        "cwd": str(Path.cwd().resolve()),
    }
    assert payload["request"] == {
        "exclude_contaminated": False,
        "limit": 0,
        "min_bars": 0,
        "on_break": "warn",
        "verified_splits": False,
    }
    assert payload["input"]["digest_algorithm"]
    assert len(payload["input"]["sha256"]) == 64
    assert payload["code"]["digest_algorithm"]
    assert len(payload["code"]["sha256"]) == 64
    assert payload["runtime"]["python"]
    assert payload["runtime"]["pydantic"]
    assert payload["runtime"]["pydantic_settings"]
    assert payload["cohort"]["base_symbols"] == ["AAA"]
    assert payload["cohort"]["planned_symbols"] == ["AAA"]
    assert payload["cohort"]["completed_symbols"] == ["AAA"]
    assert payload["cohort"]["bars"] == 90
    assert payload["cohort"]["timestamp_digest_algorithm"]
    assert len(payload["cohort"]["timestamp_sha256"]) == 64
    assert len(payload["cohort"]["planned_sha256"]) == 64
    assert len(payload["cohort"]["completed_sha256"]) == 64
    assert payload["posthoc_exclusion"] == {
        "symbols": [],
        "unbiased_estimate": True,
        "uses_future_information": False,
    }
    assert payload["simulation_config"]["strategy"] == "sma_cross"
    aggregates = payload["aggregates"]
    assert aggregates["completed_symbol_count"] == 1
    assert isinstance(aggregates["strategy_return_median"], float)
    assert isinstance(aggregates["benchmark_return_median"], float)
    assert isinstance(aggregates["strategy_mdd_median"], float)
    assert isinstance(aggregates["benchmark_mdd_median"], float)
    assert isinstance(aggregates["strategy_sharpe_median"], float)
    assert isinstance(aggregates["benchmark_sharpe_median"], float)
    assert isinstance(aggregates["cross_sectional_beat_rate"], float)
    assert isinstance(aggregates["mean_trades"], float)
    assert aggregates["positive_strategy_returns"] >= 0
    assert payload["ranked"]["top"][0]["symbol"] == "AAA"
    assert payload["ranked"]["bottom"][0]["symbol"] == "AAA"
    assert payload["skipped"] == []


def test_skipped_symbol_fails_by_default_and_reports_reason(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "GOOD.csv")
    write_flat_history(csv_dir / "BAD.csv", invalid_offset=10)

    result = run_sweep(str(csv_dir))
    output = result.stdout + result.stderr

    assert result.returncode != 0
    assert "BAD" in output
    assert "OHLC" in output
    assert "처리 1개" in output
    assert "건너뜀 1개" in output
    assert "바이앤홀드를 이긴 종목" not in output


def test_allow_skipped_reports_reason_and_counts_and_continues(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "GOOD.csv")
    write_flat_history(csv_dir / "BAD.csv", invalid_offset=10)

    result = run_sweep(str(csv_dir), "--allow-skipped")

    assert result.returncode == 0, result.stderr
    assert "BAD" in result.stdout
    assert "OHLC" in result.stdout
    assert "처리 1개" in result.stdout
    assert "건너뜀 1개" in result.stdout
    assert "종목 1개" in result.stdout


def test_verified_manifest_lookup_normalizes_lowercase_filename_symbol(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    prices = [100] * 45 + [50] * 45
    first = write_flat_history(csv_dir / "aaa.csv", prices=prices)
    effective_date = first + timedelta(days=45)
    manifest = tmp_path / "verified.csv"
    manifest.write_text(
        "symbol,date,ratio,event_type,source\n"
        f"AAA,{effective_date.isoformat()},0.5,split,issuer\n",
        encoding="utf-8",
    )

    result = run_sweep(
        str(csv_dir),
        "--on-break",
        "adjust",
        "--verified-splits",
        str(manifest),
        "--exclude-contaminated",
    )

    assert result.returncode == 0, result.stderr
    assert "사후 의심 종목" not in result.stdout
    assert "종목 1개" in result.stdout


def test_allow_skipped_accounts_for_per_symbol_adjustment_error(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_history_with_missing_date(csv_dir / "GOOD.csv", 10)
    first = write_history_with_missing_date(csv_dir / "BAD.csv", 10)
    manifest = tmp_path / "verified.csv"
    manifest.write_text(
        "symbol,date,ratio,event_type,source\n"
        f"BAD,{(first + timedelta(days=10)).isoformat()},0.5,split,issuer\n",
        encoding="utf-8",
    )

    result = run_sweep(
        str(csv_dir),
        "--on-break",
        "adjust",
        "--verified-splits",
        str(manifest),
        "--allow-skipped",
    )

    assert result.returncode == 0, result.stderr
    assert "BAD" in result.stdout
    assert "검증" in result.stdout
    assert "날짜" in result.stdout
    assert "처리 1개" in result.stdout
    assert "건너뜀 1개" in result.stdout
    assert "계획 대상 2개" in result.stdout
    assert "완료 결과 1개" in result.stdout


def test_sweep_ignores_ambient_tossquant_settings(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    prices = [100] * 30 + list(range(100, 160))
    write_flat_history(csv_dir / "AAA.csv", prices=prices)
    clean_env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("TOSSQUANT_")
    }
    dirty_env = {
        **clean_env,
        "TOSSQUANT_PAPER_COMMISSION_BPS": "1000",
        "TOSSQUANT_PAPER_SLIPPAGE_BPS": "1000",
        "TOSSQUANT_BACKTEST_SPREAD_BPS": "1000",
        "TOSSQUANT_MAX_ORDER_NOTIONAL": "1",
        "TOSSQUANT_TAKE_PROFIT_PCT": "0.01",
    }

    clean = run_sweep(str(csv_dir), env=clean_env)
    dirty = run_sweep(str(csv_dir), env=dirty_env)

    assert clean.returncode == 0, clean.stderr
    assert dirty.returncode == 0, dirty.stderr
    assert dirty.stdout == clean.stdout


def test_warn_policy_keeps_corporate_action_warning_visible(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "AAA.csv", prices=[100] * 45 + [50] * 45)

    result = run_sweep(str(csv_dir), "--on-break", "warn")

    assert result.returncode == 0, result.stderr
    assert "AAA 분할비 후보" in result.stderr
    assert "외부 공시 확인 전에는 조정하지 않습니다" in result.stderr


def test_cohort_uses_validated_candle_count_not_physical_lines(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "AAA.csv")
    write_flat_history(csv_dir / "BBB.csv", prices=[100] * 89)
    with (csv_dir / "BBB.csv").open("a", encoding="utf-8") as handle:
        handle.write("\n")

    result = run_sweep(str(csv_dir))

    assert result.returncode == 0, result.stderr
    assert "종목 1개 × 90봉" in result.stdout
    assert "종목 2개 × 90봉" not in result.stdout
    assert "코호트 제외 1개" in result.stdout


def test_cohort_requires_the_same_validated_timestamps(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "AAA.csv")
    write_flat_history(
        csv_dir / "BBB.csv",
        first=date(2025, 1, 2),
    )

    result = run_sweep(str(csv_dir))

    assert result.returncode == 0, result.stderr
    assert "종목 1개 × 90봉" in result.stdout
    assert "종목 2개 × 90봉" not in result.stdout
    assert "코호트 제외 1개" in result.stdout


def test_cohort_hash_uses_report_compatible_timestamp_digest(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "AAA.csv")
    write_flat_history(csv_dir / "BBB.csv")
    timestamps = [
        f"{(date(2025, 1, 1) + timedelta(days=offset)).isoformat()}"
        "T00:00:00+00:00"
        for offset in range(90)
    ]
    timestamp_sha256 = hashlib.sha256(
        ("\n".join(timestamps) + "\n").encode("utf-8")
    ).hexdigest()
    payload = {
        "algorithm": "sha256-symbols-timestamp-range-v3",
        "bars": 90,
        "first_session": "2025-01-01",
        "last_session": "2025-03-31",
        "symbols": ["AAA", "BBB"],
        "timestamp_sha256": timestamp_sha256,
    }
    expected = hashlib.sha256(
        json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()

    result = run_sweep(str(csv_dir))

    assert result.returncode == 0, result.stderr
    assert f"기본 코호트 SHA-256={expected}" in result.stdout
    assert f"timestamp_sha256={timestamp_sha256}" in result.stdout
    assert "기본 코호트 기간=2025-01-01..2025-03-31 · bars=90" in result.stdout


def test_daily_sweep_rejects_intraday_timestamps_instead_of_mislabeling_them(
    tmp_path,
):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    rows = ["date,open,high,low,close,volume"]
    for offset in range(90):
        day = date(2025, 1, 1) + timedelta(days=offset)
        rows.append(
            f"{day.isoformat()}T01:00:00+00:00,100,100,100,100,1000"
        )
    (csv_dir / "AAA.csv").write_text(
        "\n".join(rows) + "\n",
        encoding="utf-8",
    )

    result = run_sweep(str(csv_dir))
    output = result.stdout + result.stderr

    assert result.returncode != 0
    assert "UTC 자정 일봉" in output
    assert "바이앤홀드를 이긴 종목" not in output
    assert "Traceback" not in output


def test_sweep_rejects_nonfinite_metrics_instead_of_reporting_infinity(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    rows = ["date,open,high,low,close,volume"]
    for offset in range(90):
        day = date(2025, 1, 1) + timedelta(days=offset)
        price = "1" if offset < 62 else "1e400"
        rows.append(
            f"{day.isoformat()},{price},{price},{price},{price},1000"
        )
    (csv_dir / "AAA.csv").write_text(
        "\n".join(rows) + "\n",
        encoding="utf-8",
    )

    result = run_sweep(str(csv_dir))
    output = result.stdout + result.stderr

    assert result.returncode != 0
    assert "유한하지 않은 측정값" in output
    assert "inf%" not in output
    assert "Traceback" not in output


def test_header_only_csv_is_reported_instead_of_silently_omitted(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "GOOD.csv")
    (csv_dir / "EMPTY.csv").write_text(
        "date,open,high,low,close,volume\n",
        encoding="utf-8",
    )

    result = run_sweep(str(csv_dir))
    output = result.stdout + result.stderr

    assert result.returncode != 0
    assert "EMPTY" in output
    assert "캔들이 없습니다" in output
    assert "Traceback" not in output


def test_only_regime_csv_fails_cleanly(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "SPY.csv")

    result = run_sweep(str(csv_dir), "--regime", "SPY")
    output = result.stdout + result.stderr

    assert result.returncode != 0
    assert "매매 대상" in output
    assert "Traceback" not in output


def test_regime_timeline_mismatch_fails_instead_of_shortening_replay(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "AAA.csv")
    write_flat_history(csv_dir / "SPY.csv", prices=[100] * 89)

    result = run_sweep(str(csv_dir), "--regime", "SPY")
    output = result.stdout + result.stderr

    assert result.returncode != 0
    assert "timestamp" in output
    assert "Traceback" not in output


def test_lowercase_regime_filename_is_data_only_and_filter_does_not_fail_open(
    tmp_path,
):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "aaa.csv")
    write_flat_history(csv_dir / "spy.csv")

    result = run_sweep(
        str(csv_dir),
        "--regime",
        "spy",
        "--regime-ma",
        "20",
    )
    output = result.stdout + result.stderr

    assert result.returncode == 0, output
    assert "종목 1개 × 90봉" in result.stdout
    assert "SPY 지수 캔들이 없어" not in output
    assert "계획 대상 1개" in result.stdout


def test_verified_manifest_must_be_regular_file(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "AAA.csv")
    real_manifest = tmp_path / "real.csv"
    real_manifest.write_text(
        "symbol,date,ratio,event_type,source\n"
        "AAA,2025-02-15,0.5,split,issuer\n",
        encoding="utf-8",
    )
    link = tmp_path / "manifest.csv"
    link.symlink_to(real_manifest)

    result = run_sweep(
        str(csv_dir),
        "--on-break",
        "adjust",
        "--verified-splits",
        str(link),
    )
    output = result.stdout + result.stderr

    assert result.returncode != 0
    assert "일반 파일" in output
    assert "바이앤홀드를 이긴 종목" not in output


def test_fifo_manifest_fails_fast_instead_of_blocking(tmp_path):
    if not hasattr(os, "mkfifo"):
        return
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "AAA.csv")
    fifo = tmp_path / "manifest.csv"
    os.mkfifo(fifo)
    process = subprocess.Popen(
        [
            sys.executable,
            str(SCRIPT),
            str(csv_dir),
            "--on-break",
            "adjust",
            "--verified-splits",
            str(fifo),
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


def test_fifo_preparation_report_fails_fast_instead_of_blocking(tmp_path):
    if not hasattr(os, "mkfifo"):
        return
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "AAA.csv")
    os.mkfifo(csv_dir / "preparation-report.json")
    process = subprocess.Popen(
        [sys.executable, str(SCRIPT), str(csv_dir)],
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


def test_sweep_order_cap_matches_initial_cash_for_fair_benchmark(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "AAA.csv")

    result = run_sweep(str(csv_dir))

    assert result.returncode == 0, result.stderr
    assert '"max_order_notional": "10000"' in result.stdout


def test_allow_skipped_output_does_not_leak_random_snapshot_path(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "GOOD.csv")
    write_flat_history(csv_dir / "BAD.csv", invalid_offset=10)

    first = run_sweep(str(csv_dir), "--allow-skipped")
    second = run_sweep(str(csv_dir), "--allow-skipped")

    assert first.returncode == second.returncode == 0
    assert first.stdout == second.stdout
    assert "tossquant-sweep-snapshot-" not in first.stdout


def test_whitespace_regime_is_reported_as_disabled(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "AAA.csv")

    result = run_sweep(str(csv_dir), "--regime", "   ")

    assert result.returncode == 0, result.stderr
    assert "국면필터 없음" in result.stdout
    assert "국면필터 200일선" not in result.stdout


def test_oversized_csv_field_fails_without_csv_traceback(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "GOOD.csv")
    (csv_dir / "BAD.csv").write_text(
        "date,open,high,low,close,volume\n"
        f"2025-01-01,{'1' * 140_000},1,1,1,1\n",
        encoding="utf-8",
    )

    result = run_sweep(str(csv_dir))
    output = result.stdout + result.stderr

    assert result.returncode != 0
    assert "BAD" in output
    assert "CSV" in output
    assert "Traceback" not in output


def test_duplicate_csv_header_is_rejected_instead_of_last_value_winning(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    (csv_dir / "BAD.csv").write_text(
        "date,open,high,low,close,close,volume\n"
        "2025-01-01,100,100,50,100,50,1000\n",
        encoding="utf-8",
    )

    result = run_sweep(str(csv_dir))
    output = result.stdout + result.stderr

    assert result.returncode != 0
    assert "중복" in output
    assert "close" in output
    assert "바이앤홀드를 이긴 종목" not in output


def test_invalid_numeric_arguments_fail_without_traceback(tmp_path):
    csv_dir = tmp_path / "data"
    csv_dir.mkdir()
    write_flat_history(csv_dir / "AAA.csv")
    invalid_arguments = (
        ("--limit", "-1"),
        ("--min-bars", "-1"),
        ("--stop-loss", "nan"),
        ("--stop-loss", "inf"),
        ("--stop-loss", "-inf"),
        ("--stop-loss", "-0.1"),
        ("--stop-loss", "1"),
        ("--fast", "0"),
        ("--slow", "0"),
        ("--fast", "60", "--slow", "20"),
        ("--regime-ma", "0"),
    )

    for arguments in invalid_arguments:
        result = run_sweep(str(csv_dir), *arguments)
        output = result.stdout + result.stderr
        assert result.returncode != 0, arguments
        assert "Traceback" not in output, (arguments, output)


def test_preparation_report_integrity_is_mandatory_even_with_allow_skipped(
    tmp_path,
):
    source = tmp_path / "source.csv"
    rows = ["date,open,high,low,close,volume,Name"]
    first = date(2025, 1, 1)
    for offset in range(90):
        day = first + timedelta(days=offset)
        rows.append(f"{day.isoformat()},100,100,100,100,1000,AAA")
    source.write_text("\n".join(rows) + "\n", encoding="utf-8")
    prepared = tmp_path / "prepared"
    prepare = subprocess.run(
        [
            sys.executable,
            str(PREPARE_SCRIPT),
            str(prepared),
            "--source",
            str(source),
            "--allow-unpinned-source",
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    assert prepare.returncode == 0, prepare.stderr
    clean = run_sweep(str(prepared))
    assert clean.returncode == 0, clean.stderr

    csv_path = prepared / "AAA.csv"
    text = csv_path.read_text(encoding="utf-8")
    csv_path.write_text(
        text.replace(",100,100,100,100,1000\n", ",101,101,101,101,1000\n", 1),
        encoding="utf-8",
    )

    tampered = run_sweep(str(prepared), "--allow-skipped")
    output = tampered.stdout + tampered.stderr
    assert tampered.returncode != 0
    assert "출력 무결성 불일치" in output
    assert "바이앤홀드를 이긴 종목" not in output
