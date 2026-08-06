"""백테스트 결과 출력."""

from __future__ import annotations

import csv
from pathlib import Path

from rich.console import Console
from rich.table import Table

from .metrics import Metrics
from .simulator import BacktestResult


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
    console.print(f"[bold]종목[/bold] {', '.join(result.symbols)}\n")

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
