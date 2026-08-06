"""백테스트 결과 출력."""

from __future__ import annotations

import csv
from pathlib import Path

from rich.console import Console
from rich.table import Table

from .metrics import Metrics
from .simulator import BacktestResult
from .walkforward import WalkForwardResult


def _pct(value: float) -> str:
    return f"{value * 100:+.2f}%"


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
    ratio = lambda v: f"{v:.2f}"  # noqa: E731

    row("최종 평가액", money, strategy.end_equity, benchmark.end_equity)
    row("총 수익률", _pct, strategy.total_return, benchmark.total_return)
    row("연평균 (CAGR)", _pct, strategy.cagr, benchmark.cagr)
    row("최대 낙폭 (MDD)", lambda v: f"-{v * 100:.2f}%", strategy.max_drawdown, benchmark.max_drawdown)
    row("변동성 (연율)", lambda v: f"{v * 100:.2f}%", strategy.volatility, benchmark.volatility)
    row("Sharpe", ratio, strategy.sharpe, benchmark.sharpe)
    row("Sortino", ratio, strategy.sortino, benchmark.sortino)
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
    table.add_row(
        "손익비 (PF)",
        f"{metrics.profit_factor:.2f}" if metrics.profit_factor else "—",
    )
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
            f"{item.train_score:.2f}",
            f"{item.test_score:.2f}",
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
    summary.add_row("Sharpe", f"{metrics.sharpe:.2f}")
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

    if retention >= 0.7:
        note = "[green]인샘플 성과가 밖에서도 대체로 유지됐습니다.[/green]"
    elif retention >= 0.3:
        note = "[yellow]밖에서 성과가 상당히 깎였습니다. 흔한 수준이지만 기대치를 낮추세요.[/yellow]"
    elif retention >= 0:
        note = "[red]인샘플 성과 대부분이 과거에 맞춘 것이었습니다.[/red]"
    else:
        note = "[red]인샘플 우승 조합이 밖에서는 손해였습니다.[/red]"
    console.print(f"  성과 유지율 (OOS/IS)  {retention:6.2f}  {note}")

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


def export(result: BacktestResult, directory: Path) -> list[Path]:
    """평가액 곡선과 거래 내역을 CSV로 떨군다."""
    directory.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    equity_path = directory / "equity_curve.csv"
    with equity_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["ts", "equity", "cash", "invested", "benchmark"])
        for point, bench in zip(result.curve, result.benchmark_curve):
            writer.writerow(
                [point.ts.isoformat(), point.equity, point.cash, point.invested, bench.equity]
            )
    written.append(equity_path)

    trades_path = directory / "trades.csv"
    with trades_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            ["symbol", "entry_ts", "exit_ts", "quantity", "entry_price",
             "exit_price", "pnl", "return_pct", "bars_held"]
        )
        for trade in result.trades:
            writer.writerow(
                [trade.symbol, trade.entry_ts.isoformat(), trade.exit_ts.isoformat(),
                 trade.quantity, trade.entry_price, trade.exit_price, trade.pnl,
                 f"{trade.return_pct:.6f}", trade.bars_held]
            )
    written.append(trades_path)
    return written
