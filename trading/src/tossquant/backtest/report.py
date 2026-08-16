"""백테스트 결과 출력."""

from __future__ import annotations

import csv
import hashlib
import math
import os
import stat
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

try:  # POSIX에서는 같은 출력 디렉터리를 쓰는 별도 프로세스도 직렬화한다.
    import fcntl
except ImportError:  # pragma: no cover - 현재 export의 fsync 계약도 POSIX 중심이다.
    fcntl = None  # type: ignore[assignment]

from rich.console import Console
from rich.table import Table

from .metrics import Metrics
from .simulator import BacktestResult
from .walkforward import WalkForwardResult


class ExportError(RuntimeError):
    """CSV 산출물을 완전하게 게시하지 못한 경우."""


_EQUITY_HEADER = ["ts", "equity", "cash", "invested", "benchmark"]
_TRADES_HEADER = [
    "symbol",
    "entry_ts",
    "exit_ts",
    "quantity",
    "entry_price",
    "exit_price",
    "pnl",
    "return_pct",
    "bars_held",
]
_PROCESS_EXPORT_LOCK = threading.RLock()


@dataclass(frozen=True)
class _FileSnapshot:
    device: int
    inode: int
    mode: int
    size: int
    mtime_ns: int
    ctime_ns: int
    sha256: str


@dataclass
class _ExportTarget:
    path: Path
    initial_snapshot: _FileSnapshot | None
    stage: Path
    stage_snapshot: _FileSnapshot
    backup: Path | None = None
    backup_snapshot: _FileSnapshot | None = None


def _same_inode_content(left: _FileSnapshot, right: _FileSnapshot) -> bool:
    """rename이 갱신할 수 있는 ctime만 제외하고 같은 게시 파일인지 본다."""
    return (
        left.device,
        left.inode,
        left.mode,
        left.size,
        left.mtime_ns,
        left.sha256,
    ) == (
        right.device,
        right.inode,
        right.mode,
        right.size,
        right.mtime_ns,
        right.sha256,
    )


def _pct(value: float) -> str:
    return f"{value * 100:+.2f}%"


def _ratio(value: float) -> str:
    if value == math.inf:
        return "∞"
    if value == -math.inf:
        return "-∞"
    if math.isnan(value):
        return "정의 불가"
    return f"{value:.2f}"


def _summary_table(result: BacktestResult) -> Table:
    strategy = result.metrics
    benchmark = result.benchmark_metrics

    table = Table(title=f"{result.strategy_name} vs 바이앤홀드")
    table.add_column("지표")
    table.add_column("전략", justify="right")
    table.add_column("바이앤홀드", justify="right")

    def row(label: str, fmt, s_value, b_value) -> None:
        table.add_row(label, fmt(s_value), fmt(b_value))

    money = lambda v: f"{v:,.2f}"  # noqa: E731

    row("최종 평가액", money, strategy.end_equity, benchmark.end_equity)
    row("총 수익률", _pct, strategy.total_return, benchmark.total_return)
    row("연평균 (CAGR)", _pct, strategy.cagr, benchmark.cagr)
    row("최대 낙폭 (MDD)", lambda v: f"-{v * 100:.2f}%", strategy.max_drawdown, benchmark.max_drawdown)
    row("변동성 (연율)", lambda v: f"{v * 100:.2f}%", strategy.volatility, benchmark.volatility)
    row("Sharpe", _ratio, strategy.sharpe, benchmark.sharpe)
    row("Sortino", _ratio, strategy.sortino, benchmark.sortino)
    row("시장 노출", lambda v: f"{v * 100:.1f}%", strategy.exposure, benchmark.exposure)
    return table


def _trade_table(metrics: Metrics) -> Table:
    table = Table(title="거래 통계")
    table.add_column("지표")
    table.add_column("값", justify="right")
    table.add_row("거래 횟수", str(metrics.trades))
    table.add_row("승률", f"{metrics.win_rate * 100:.1f}%")
    table.add_row("평균 이익", f"{metrics.avg_win:,.2f}")
    table.add_row("평균 손실", f"{metrics.avg_loss:,.2f}")
    if metrics.profit_factor is None:
        profit_factor = "—"
    elif metrics.profit_factor == float("inf"):
        profit_factor = "∞"
    else:
        profit_factor = f"{metrics.profit_factor:.2f}"
    table.add_row("손익비 (PF)", profit_factor)
    return table


def render(result: BacktestResult, console: Console, show_trades: int = 10) -> None:
    metrics = result.metrics
    console.print(
        f"[bold]기간[/bold] {result.curve[0].ts:%Y-%m-%d} ~ {result.curve[-1].ts:%Y-%m-%d} "
        f"({metrics.bars}봉 / {metrics.years:.2f}년, {result.interval})"
    )
    console.print(f"[bold]종목[/bold] {', '.join(result.symbols)}")
    protection = " · ".join(result.protection) if result.protection else "[red]없음[/red]"
    console.print(f"[bold]보호 청산[/bold] {protection}\n")

    console.print(_summary_table(result))

    excess = result.excess_return
    verdict = "[green]초과[/green]" if excess > 0 else "[red]미달[/red]"
    console.print(f"\n벤치마크 대비 {verdict} {_pct(excess)}\n")

    console.print(_trade_table(metrics))

    if metrics.trades == 0:
        console.print(
            "\n[yellow]거래가 한 건도 없습니다.[/yellow] 워밍업 대비 데이터가 짧거나, "
            "리스크 한도가 모든 신호를 막고 있을 수 있습니다."
        )

    if result.rejections:
        table = Table(title="신호 기각 사유")
        table.add_column("사유")
        table.add_column("횟수", justify="right")
        for code, count in result.rejections.most_common():
            table.add_row(code, str(count))
        console.print(table)

    if show_trades and result.trades:
        table = Table(title=f"최근 거래 {min(show_trades, len(result.trades))}건")
        for column in ("종목", "진입", "청산", "수량", "진입가", "청산가", "손익", "수익률", "보유봉"):
            table.add_column(column)
        for trade in result.trades[-show_trades:]:
            color = "green" if trade.is_win else "red"
            table.add_row(
                trade.symbol,
                f"{trade.entry_ts:%Y-%m-%d}",
                f"{trade.exit_ts:%Y-%m-%d}",
                str(trade.quantity),
                f"{trade.entry_price:,.2f}",
                f"{trade.exit_price:,.2f}",
                f"[{color}]{trade.pnl:+,.2f}[/{color}]",
                f"[{color}]{_pct(trade.return_pct)}[/{color}]",
                str(trade.bars_held),
            )
        console.print(table)


def render_walkforward(result: WalkForwardResult, console: Console) -> None:
    metrics = result.metrics
    console.print(
        f"[bold]워크포워드[/bold] {len(result.folds)}구간 × {result.grid_size}조합 "
        f"(목적함수 {result.objective})"
    )
    console.print(
        f"[bold]평가 기간[/bold] {result.curve[0].ts:%Y-%m-%d} ~ "
        f"{result.curve[-1].ts:%Y-%m-%d} ({metrics.bars}봉 / {metrics.years:.2f}년)\n"
    )

    folds = Table(title="구간별 결과")
    folds.add_column("#", justify="right")
    folds.add_column("학습 기간")
    folds.add_column("평가 기간")
    folds.add_column("선택 파라미터")
    folds.add_column("IS 점수", justify="right")
    folds.add_column("OOS 점수", justify="right")
    folds.add_column("OOS 수익", justify="right")
    for item in result.folds:
        oos_return = item.test.metrics.total_return
        color = "green" if oos_return > 0 else "red"
        folds.add_row(
            str(item.fold.index + 1),
            f"{item.train.curve[0].ts:%Y-%m-%d}~{item.train.curve[-1].ts:%m-%d}",
            f"{item.test.curve[0].ts:%Y-%m-%d}~{item.test.curve[-1].ts:%m-%d}",
            ", ".join(f"{k}={v}" for k, v in sorted(item.params.items())),
            _ratio(item.train_score),
            _ratio(item.test_score),
            f"[{color}]{_pct(oos_return)}[/{color}]",
        )
    console.print(folds)

    summary = Table(title="이어붙인 아웃오브샘플 성과")
    summary.add_column("지표")
    summary.add_column("값", justify="right")
    summary.add_row("최종 평가액", f"{metrics.end_equity:,.2f}")
    summary.add_row("총 수익률", _pct(metrics.total_return))
    summary.add_row("연평균 (CAGR)", _pct(metrics.cagr))
    summary.add_row("최대 낙폭 (MDD)", f"-{metrics.max_drawdown * 100:.2f}%")
    summary.add_row("Sharpe", _ratio(metrics.sharpe))
    summary.add_row("거래 횟수", str(metrics.trades))
    summary.add_row("승률", f"{metrics.win_rate * 100:.1f}%")
    summary.add_row(
        "수익 구간", f"{result.positive_folds}/{len(result.folds)}"
    )
    console.print(summary)

    _render_verdict(result, console)


def _render_verdict(result: WalkForwardResult, console: Console) -> None:
    """숫자를 어떻게 읽어야 하는지까지 같이 찍는다.

    워크포워드는 '얼마 벌었나'가 아니라 '이 성과를 믿어도 되나'를 보는 도구다.
    유지율과 파라미터 안정성을 해석 없이 던져두면 대개 무시된다.
    """
    retention = result.retention
    stability = result.param_stability

    console.print("\n[bold]과최적화 점검[/bold]")

    if retention is None:
        console.print(
            "  성과 유지율 (OOS/IS)  [yellow]정의 불가[/yellow]  "
            "인샘플 평균 점수가 양의 유한값이 아니라 "
            "비율을 해석할 수 없습니다."
        )
    else:
        if retention >= 0.7:
            note = "[green]인샘플 성과가 밖에서도 대체로 유지됐습니다.[/green]"
        elif retention >= 0.3:
            note = "[yellow]밖에서 성과가 상당히 깎였습니다. 흔한 수준이지만 기대치를 낮추세요.[/yellow]"
        elif retention >= 0:
            note = "[red]인샘플 성과 대부분이 과거에 맞춘 것이었습니다.[/red]"
        else:
            note = "[red]인샘플 우승 조합이 밖에서는 손해였습니다.[/red]"
        console.print(
            f"  성과 유지율 (OOS/IS)  {_ratio(retention):>6}  {note}"
        )

    if stability >= 0.6:
        note = "[green]구간이 바뀌어도 비슷한 파라미터가 뽑혔습니다.[/green]"
    elif stability >= 0.4:
        note = "[yellow]파라미터가 다소 흔들립니다.[/yellow]"
    else:
        note = "[red]구간마다 최적값이 널뜁니다 — 잡음일 수 있습니다.[/red]"
    console.print(f"  파라미터 안정성       {stability:6.2f}  {note}")

    if len(result.folds) < 5:
        console.print(
            f"\n[yellow]구간이 {len(result.folds)}개뿐입니다. "
            "통계적으로 의미를 두기엔 부족하니 데이터를 늘리거나 "
            "--test-bars를 줄이세요.[/yellow]"
        )


def _stat_version(details: os.stat_result) -> tuple[int, int, int, int, int, int]:
    return (
        details.st_dev,
        details.st_ino,
        details.st_mode,
        details.st_size,
        details.st_mtime_ns,
        details.st_ctime_ns,
    )


def _regular_snapshot(path: Path, *, missing_ok: bool) -> _FileSnapshot | None:
    """경로와 열린 fd가 같은 안정된 일반 파일인지 콘텐츠까지 확인한다."""
    try:
        path_before = path.lstat()
    except FileNotFoundError:
        if missing_ok:
            return None
        raise ExportError(f"내보내기 임시 파일이 사라졌습니다: {path.name}") from None
    except OSError as exc:
        raise ExportError(f"내보내기 대상 확인 실패 ({path.name}): {exc}") from None

    if not stat.S_ISREG(path_before.st_mode):
        kind = (
            "심볼릭 링크" if stat.S_ISLNK(path_before.st_mode) else "일반 파일 아님"
        )
        raise ExportError(f"내보내기 대상은 일반 파일이어야 합니다: {path} ({kind})")

    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise ExportError(f"내보내기 대상 열기 실패 ({path.name}): {exc}") from None
    try:
        fd_before = os.fstat(descriptor)
        if not stat.S_ISREG(fd_before.st_mode):
            raise ExportError(f"내보내기 대상은 일반 파일이어야 합니다: {path}")
        digest = hashlib.sha256()
        while True:
            content = os.read(descriptor, 1024 * 1024)
            if not content:
                break
            digest.update(content)
        fd_after = os.fstat(descriptor)
    finally:
        os.close(descriptor)

    try:
        path_after = path.lstat()
    except OSError as exc:
        raise ExportError(f"내보내기 대상이 확인 중 변경됐습니다 ({path}): {exc}") from None
    if not (
        _stat_version(path_before)
        == _stat_version(fd_before)
        == _stat_version(fd_after)
        == _stat_version(path_after)
    ):
        raise ExportError(f"내보내기 대상이 확인 중 변경됐습니다: {path}")
    return _FileSnapshot(*_stat_version(fd_after), digest.hexdigest())


def _prepare_directory(directory: Path) -> None:
    """출력 디렉터리 자체도 링크로 우회되지 않게 한다."""
    try:
        details = directory.lstat()
    except FileNotFoundError:
        try:
            # 다른 협력 프로세스도 같은 미존재 경로를 동시에 만들 수 있다.
            # exist_ok는 생성 경합만 흡수하고, 바로 아래 lstat으로 링크/파일
            # 대체를 다시 확인한다.
            directory.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise ExportError(f"내보내기 폴더 생성 실패 ({directory}): {exc}") from None
        try:
            details = directory.lstat()
        except OSError as exc:
            raise ExportError(f"내보내기 폴더 확인 실패 ({directory}): {exc}") from None
    except OSError as exc:
        raise ExportError(f"내보내기 폴더 확인 실패 ({directory}): {exc}") from None

    if stat.S_ISLNK(details.st_mode) or not stat.S_ISDIR(details.st_mode):
        raise ExportError(f"내보내기 경로는 실제 디렉터리여야 합니다: {directory}")


@contextmanager
def _export_directory_lock(directory: Path) -> Iterator[None]:
    """이 API를 쓰는 thread/process의 같은 디렉터리 게시를 직렬화한다."""
    with _PROCESS_EXPORT_LOCK:
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(directory, flags)
        except OSError as exc:
            raise ExportError(
                f"내보내기 폴더 잠금 실패 ({directory}): {exc}"
            ) from None
        try:
            details = os.fstat(descriptor)
            try:
                current = directory.lstat()
            except OSError as exc:
                raise ExportError(
                    f"내보내기 폴더가 잠금 전에 변경됐습니다 "
                    f"({directory}): {exc}"
                ) from None
            if (
                not stat.S_ISDIR(details.st_mode)
                or (details.st_dev, details.st_ino)
                != (current.st_dev, current.st_ino)
            ):
                raise ExportError(
                    f"내보내기 폴더가 잠금 전에 변경됐습니다: {directory}"
                )
            if fcntl is not None:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_EX)
                except OSError as exc:
                    raise ExportError(
                        f"내보내기 폴더 잠금 실패 ({directory}): {exc}"
                    ) from None
            # 잠금을 기다리는 동안 경로가 다른 inode로 바뀌지 않았는지 재확인한다.
            try:
                current = directory.lstat()
            except OSError as exc:
                raise ExportError(
                    f"내보내기 폴더가 잠금 중 변경됐습니다 "
                    f"({directory}): {exc}"
                ) from None
            if (details.st_dev, details.st_ino) != (
                current.st_dev,
                current.st_ino,
            ):
                raise ExportError(
                    f"내보내기 폴더가 잠금 중 변경됐습니다: {directory}"
                )
            yield
        finally:
            os.close(descriptor)


def _fsync_directory(directory: Path) -> None:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(directory, flags)
    try:
        details = os.fstat(descriptor)
        if not stat.S_ISDIR(details.st_mode):
            raise OSError("출력 경로가 디렉터리가 아닙니다")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _validate_staged_csv(
    path: Path, header: list[str], expected_rows: int
) -> _FileSnapshot:
    snapshot = _regular_snapshot(path, missing_ok=False)
    assert snapshot is not None
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    details = os.fstat(descriptor)
    if (
        not stat.S_ISREG(details.st_mode)
        or (details.st_dev, details.st_ino) != (snapshot.device, snapshot.inode)
    ):
        os.close(descriptor)
        raise ExportError(f"{path.name}: CSV 검증 전에 임시 파일이 변경됐습니다")
    with os.fdopen(descriptor, "r", newline="", encoding="utf-8") as handle:
        reader = csv.reader(handle)
        actual_header = next(reader, None)
        if actual_header != header:
            raise ExportError(f"{path.name}: CSV 헤더 검증 실패")
        rows = 0
        for rows, row in enumerate(reader, start=1):
            if len(row) != len(header):
                raise ExportError(f"{path.name}: CSV {rows + 1}행 열 수 검증 실패")
        if rows != expected_rows:
            raise ExportError(
                f"{path.name}: CSV 행 수 검증 실패 "
                f"(기대 {expected_rows}, 실제 {rows})"
            )
    if _regular_snapshot(path, missing_ok=False) != snapshot:
        raise ExportError(f"{path.name}: CSV 검증 중 임시 파일이 변경됐습니다")
    return snapshot


def _stage_csv(
    directory: Path,
    target_name: str,
    header: list[str],
    expected_rows: int,
    write_rows: Callable[[Any], None],
    *,
    target_mode: int | None = None,
) -> tuple[Path, _FileSnapshot]:
    descriptor, raw_path = tempfile.mkstemp(
        prefix=f".{target_name}.", suffix=".tmp", dir=directory
    )
    path = Path(raw_path)
    descriptor_owned = True
    try:
        handle = os.fdopen(descriptor, "w", newline="", encoding="utf-8")
        descriptor_owned = False
        with handle:
            writer = csv.writer(handle)
            writer.writerow(header)
            write_rows(writer)
            handle.flush()
            if target_mode is not None:
                os.fchmod(handle.fileno(), stat.S_IMODE(target_mode))
            os.fsync(handle.fileno())
        return path, _validate_staged_csv(path, header, expected_rows)
    except BaseException:
        if descriptor_owned:
            os.close(descriptor)
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        raise


def _write_all(descriptor: int, content: bytes) -> None:
    remaining = memoryview(content)
    while remaining:
        written = os.write(descriptor, remaining)
        if written <= 0:
            raise OSError("백업 파일 쓰기가 완료되지 않았습니다")
        remaining = remaining[written:]


def _backup_regular_target(
    target: Path, expected: _FileSnapshot
) -> tuple[Path, _FileSnapshot]:
    descriptor, raw_path = tempfile.mkstemp(
        prefix=f".{target.name}.", suffix=".bak", dir=target.parent
    )
    backup = Path(raw_path)
    source_descriptor: int | None = None
    try:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        source_descriptor = os.open(target, flags)
        source_details = os.fstat(source_descriptor)
        if (
            not stat.S_ISREG(source_details.st_mode)
            or _stat_version(source_details)
            != (
                expected.device,
                expected.inode,
                expected.mode,
                expected.size,
                expected.mtime_ns,
                expected.ctime_ns,
            )
        ):
            raise ExportError(f"내보내기 대상이 준비 중 변경됐습니다: {target}")
        digest = hashlib.sha256()
        while True:
            content = os.read(source_descriptor, 1024 * 1024)
            if not content:
                break
            digest.update(content)
            _write_all(descriptor, content)
        source_after = os.fstat(source_descriptor)
        if (
            _stat_version(source_after) != _stat_version(source_details)
            or digest.hexdigest() != expected.sha256
        ):
            raise ExportError(f"내보내기 대상이 백업 중 변경됐습니다: {target}")
        os.fchmod(descriptor, stat.S_IMODE(expected.mode))
        os.fsync(descriptor)
    except BaseException:
        try:
            backup.unlink()
        except FileNotFoundError:
            pass
        raise
    finally:
        if source_descriptor is not None:
            os.close(source_descriptor)
        os.close(descriptor)

    if _regular_snapshot(target, missing_ok=False) != expected:
        try:
            backup.unlink()
        except FileNotFoundError:
            pass
        raise ExportError(f"내보내기 대상이 준비 중 변경됐습니다: {target}")
    backup_snapshot = _regular_snapshot(backup, missing_ok=False)
    assert backup_snapshot is not None
    if (
        backup_snapshot.size != expected.size
        or backup_snapshot.sha256 != expected.sha256
        or stat.S_IMODE(backup_snapshot.mode) != stat.S_IMODE(expected.mode)
    ):
        try:
            backup.unlink()
        except FileNotFoundError:
            pass
        raise ExportError(f"내보내기 백업 검증 실패: {target}")
    return backup, backup_snapshot


def _restore_verified_backup(
    backup: Path,
    expected: _FileSnapshot,
    target: Path,
) -> None:
    """검증한 백업 inode를 새 임시 파일로 복제한 뒤에만 복원한다.

    경로를 확인하고 곧바로 rename하면 확인 직후 다른 inode로 바뀌는 경합이 남는다.
    열린 fd가 기록된 백업 inode와 같은지 확인하고 그 fd의 바이트만 새 파일로
    복제하면, 이후 백업 경로가 바뀌어도 교체 대상에 그 바이트가 들어가지 않는다.
    """
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        source_descriptor = os.open(backup, flags)
    except OSError as exc:
        raise ExportError(f"롤백 백업 열기 실패 ({target}): {exc}") from None

    restore_descriptor: int | None = None
    restore_path: Path | None = None
    try:
        source_before = os.fstat(source_descriptor)
        if (
            not stat.S_ISREG(source_before.st_mode)
            or _stat_version(source_before)
            != (
                expected.device,
                expected.inode,
                expected.mode,
                expected.size,
                expected.mtime_ns,
                expected.ctime_ns,
            )
        ):
            raise ExportError(f"롤백 백업이 준비 후 변경됐습니다: {target}")

        restore_descriptor, raw_path = tempfile.mkstemp(
            prefix=f".{target.name}.", suffix=".rollback", dir=target.parent
        )
        restore_path = Path(raw_path)
        digest = hashlib.sha256()
        while True:
            content = os.read(source_descriptor, 1024 * 1024)
            if not content:
                break
            digest.update(content)
            _write_all(restore_descriptor, content)

        source_after = os.fstat(source_descriptor)
        observed = _FileSnapshot(
            *_stat_version(source_after), digest.hexdigest()
        )
        if not _same_inode_content(observed, expected):
            raise ExportError(f"롤백 백업이 복원 준비 중 변경됐습니다: {target}")

        os.fchmod(restore_descriptor, stat.S_IMODE(expected.mode))
        os.fsync(restore_descriptor)
        os.close(restore_descriptor)
        restore_descriptor = None

        restore_snapshot = _regular_snapshot(restore_path, missing_ok=False)
        assert restore_snapshot is not None
        if (
            restore_snapshot.size != expected.size
            or restore_snapshot.sha256 != expected.sha256
            or stat.S_IMODE(restore_snapshot.mode) != stat.S_IMODE(expected.mode)
        ):
            raise ExportError(f"롤백 복원 임시 파일 검증에 실패했습니다: {target}")

        os.replace(restore_path, target)
        restore_path = None
        restored = _regular_snapshot(target, missing_ok=False)
        assert restored is not None
        if not _same_inode_content(restored, restore_snapshot):
            raise ExportError(f"롤백 복원 파일 검증에 실패했습니다: {target}")
    finally:
        os.close(source_descriptor)
        if restore_descriptor is not None:
            os.close(restore_descriptor)
        if restore_path is not None:
            try:
                restore_path.unlink()
            except OSError:
                pass


def _remove_temporary(paths: list[Path]) -> None:
    for path in paths:
        try:
            path.unlink()
        except OSError:
            pass


def _rollback_published(
    published: list[_ExportTarget], directory: Path
) -> list[str]:
    errors: list[str] = []
    for item in reversed(published):
        try:
            current = _regular_snapshot(item.path, missing_ok=False)
            assert current is not None
            if not _same_inode_content(current, item.stage_snapshot):
                raise ExportError(f"게시된 대상이 롤백 전 변경됐습니다: {item.path}")
            if item.initial_snapshot is None:
                item.path.unlink()
            else:
                if item.backup is None or item.backup_snapshot is None:
                    raise ExportError(f"롤백 백업이 없습니다: {item.path}")
                current_backup = _regular_snapshot(item.backup, missing_ok=False)
                if current_backup != item.backup_snapshot:
                    raise ExportError(f"롤백 백업이 준비 후 변경됐습니다: {item.path}")
                _restore_verified_backup(
                    item.backup, item.backup_snapshot, item.path
                )
                item.backup = None
                item.backup_snapshot = None
        except BaseException as exc:  # 취소 중에도 나머지 대상을 계속 복구한다.
            errors.append(f"{item.path.name}: {exc}")
    try:
        _fsync_directory(directory)
    except OSError as exc:
        errors.append(f"directory fsync: {exc}")
    return errors


def _validate_published(targets: list[_ExportTarget]) -> None:
    for item in targets:
        current = _regular_snapshot(item.path, missing_ok=False)
        assert current is not None
        if not _same_inode_content(current, item.stage_snapshot):
            raise ExportError(f"게시된 대상이 게시 중 변경됐습니다: {item.path}")


def _export_transaction(result: BacktestResult, directory: Path) -> list[Path]:
    """평가액 곡선과 거래 내역을 원자적 파일 교체로 함께 게시한다.

    두 CSV를 같은 디렉터리의 임시 파일에 모두 직렬화·fsync·재검증한 뒤에만
    ``os.replace`` 한다. 두 번째 교체나 디렉터리 fsync가 실패하면 첫 번째도
    원래 파일로 되돌려, 호출이 실패했는데 한 산출물만 새 버전인 상태를 막는다.
    """
    if len(result.curve) != len(result.benchmark_curve):
        raise ExportError(
            "전략 평가액 곡선과 벤치마크 곡선의 길이가 일치해야 합니다 "
            f"({len(result.curve)} != {len(result.benchmark_curve)})"
        )

    _prepare_directory(directory)
    equity_path = directory / "equity_curve.csv"
    trades_path = directory / "trades.csv"
    initial = {
        equity_path: _regular_snapshot(equity_path, missing_ok=True),
        trades_path: _regular_snapshot(trades_path, missing_ok=True),
    }
    temporary: list[Path] = []
    targets: list[_ExportTarget] = []
    published: list[_ExportTarget] = []

    def write_equity(writer: Any) -> None:
        for point, benchmark in zip(result.curve, result.benchmark_curve, strict=True):
            writer.writerow(
                [
                    point.ts.isoformat(),
                    point.equity,
                    point.cash,
                    point.invested,
                    benchmark.equity,
                ]
            )

    def write_trades(writer: Any) -> None:
        for trade in result.trades:
            writer.writerow(
                [
                    trade.symbol,
                    trade.entry_ts.isoformat(),
                    trade.exit_ts.isoformat(),
                    trade.quantity,
                    trade.entry_price,
                    trade.exit_price,
                    trade.pnl,
                    f"{trade.return_pct:.6f}",
                    trade.bars_held,
                ]
            )

    try:
        equity_stage, equity_identity = _stage_csv(
            directory,
            equity_path.name,
            _EQUITY_HEADER,
            len(result.curve),
            write_equity,
            target_mode=(
                initial[equity_path].mode
                if initial[equity_path] is not None
                else None
            ),
        )
        temporary.append(equity_stage)
        targets.append(
            _ExportTarget(equity_path, initial[equity_path], equity_stage, equity_identity)
        )
        trades_stage, trades_identity = _stage_csv(
            directory,
            trades_path.name,
            _TRADES_HEADER,
            len(result.trades),
            write_trades,
            target_mode=(
                initial[trades_path].mode
                if initial[trades_path] is not None
                else None
            ),
        )
        temporary.append(trades_stage)
        targets.append(
            _ExportTarget(trades_path, initial[trades_path], trades_stage, trades_identity)
        )

        for item in targets:
            if item.initial_snapshot is not None:
                item.backup, item.backup_snapshot = _backup_regular_target(
                    item.path, item.initial_snapshot
                )
                temporary.append(item.backup)
        _fsync_directory(directory)

        for item in targets:
            if _regular_snapshot(item.path, missing_ok=True) != item.initial_snapshot:
                raise ExportError(f"내보내기 대상이 게시 직전 변경됐습니다: {item.path}")
            if _regular_snapshot(item.stage, missing_ok=False) != item.stage_snapshot:
                raise ExportError(f"내보내기 임시 파일이 게시 직전 변경됐습니다: {item.stage}")
            try:
                os.replace(item.stage, item.path)
            except BaseException:
                # 일부 파일시스템 오류는 교체가 반영된 뒤 보고될 수 있다. 실제
                # inode를 확인해 반영됐다면 롤백 목록에 포함한다.
                current = _regular_snapshot(item.path, missing_ok=True)
                if current is not None and _same_inode_content(
                    current, item.stage_snapshot
                ):
                    published.append(item)
                raise
            published.append(item)
        _validate_published(published)
        _fsync_directory(directory)
        _validate_published(published)
    except BaseException as exc:
        rollback_errors = _rollback_published(published, directory) if published else []
        if not rollback_errors:
            _remove_temporary(temporary)
        if rollback_errors:
            detail = "; ".join(rollback_errors)
            raise ExportError(
                f"CSV 내보내기 실패 ({exc}); 자동 롤백도 실패했습니다: {detail}"
            ) from None
        if isinstance(exc, ExportError):
            raise
        if not isinstance(exc, Exception):
            raise
        raise ExportError(f"CSV 내보내기 실패: {exc}") from None

    # 게시 자체는 위 directory fsync로 확정됐다. 백업 정리는 출력의 성공 여부를
    # 바꾸지 않으므로 best effort로 처리한다.
    _remove_temporary(temporary)
    try:
        _fsync_directory(directory)
    except OSError:
        pass
    return [equity_path, trades_path]


def export(result: BacktestResult, directory: Path) -> list[Path]:
    """두 CSV를 검증·복구 가능한 한 게시 세대로 내보낸다.

    같은 API를 쓰는 thread/process는 디렉터리 잠금을 공유한다. 게시 도중의
    일반 예외와 ``KeyboardInterrupt`` 같은 취소도 원래 두 파일로 롤백한다.
    """
    # 입력 결함은 폴더 생성이라는 부수 효과 전에 거절한다.
    if len(result.curve) != len(result.benchmark_curve):
        raise ExportError(
            "전략 평가액 곡선과 벤치마크 곡선의 길이가 일치해야 합니다 "
            f"({len(result.curve)} != {len(result.benchmark_curve)})"
        )
    _prepare_directory(directory)
    with _export_directory_lock(directory):
        return _export_transaction(result, directory)
