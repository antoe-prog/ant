"""CLI 진입점."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from decimal import Decimal

import typer
from rich.console import Console
from rich.table import Table

from .broker.base import BrokerError
from .broker.paper import PaperBroker
from .broker.toss import TossClient
from .calendar_us import describe
from .config import Mode, Settings
from .engine import TradingEngine
from .risk import RiskManager
from .store import Store
from .strategy.sma_cross import SmaCrossStrategy

app = typer.Typer(help="토스증권 Open API 기반 미국주식 자동매매", no_args_is_help=True)
console = Console()


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def _client(settings: Settings) -> TossClient:
    """자격증명 오류를 스택트레이스 대신 한 줄 메시지로 보여준다."""
    try:
        return TossClient(settings)
    except RuntimeError as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(1) from None


def _build(settings: Settings) -> tuple[TradingEngine, Store]:
    store = Store(settings.db_path)
    toss = _client(settings)
    broker = toss if settings.mode is Mode.LIVE else PaperBroker(toss, store, settings)
    strategy = SmaCrossStrategy(settings.sma_fast, settings.sma_slow)
    risk = RiskManager(
        store,
        max_position_pct=settings.max_position_pct,
        max_positions=settings.max_positions,
        max_daily_loss_pct=settings.max_daily_loss_pct,
        max_order_notional=settings.max_order_notional,
    )
    return TradingEngine(broker, strategy, risk, store, settings), store


@app.command()
def verify(verbose: bool = typer.Option(False, "--verbose", "-v")) -> None:
    """자격증명·계좌·시세 엔드포인트를 실제로 두드려 응답을 그대로 출력한다.

    엔드포인트 경로나 응답 필드명이 문서와 다르면 여기서 먼저 드러난다.
    처음 설정할 때 반드시 이 명령부터 돌릴 것.
    """
    _setup_logging(verbose)
    settings = Settings()
    console.print(f"[bold]base_url[/bold] {settings.base_url}")
    console.print(f"[bold]mode[/bold] {settings.mode.value}")
    console.print(f"[bold]market[/bold] {describe(datetime.now(timezone.utc))}\n")

    client = _client(settings)

    console.rule("1. 토큰 발급")
    try:
        token = client._access_token()  # noqa: SLF001 — 진단 목적
        console.print(f"[green]OK[/green] access_token …{token[-8:]}")
    except BrokerError as exc:
        console.print(f"[red]실패[/red] {exc}")
        raise typer.Exit(1)

    console.rule("2. 계좌 목록")
    try:
        accounts = client.list_accounts()
        console.print_json(json.dumps(accounts, ensure_ascii=False, default=str))
        if not settings.account_id and accounts:
            console.print(
                "[yellow]TOSSQUANT_ACCOUNT_ID가 비어 있습니다. "
                "위 응답에서 계좌 식별자를 골라 .env에 넣으세요.[/yellow]"
            )
    except BrokerError as exc:
        console.print(f"[red]실패[/red] {exc}")

    symbol = settings.symbols[0] if settings.symbols else "AAPL"

    console.rule(f"3. 시세 ({symbol})")
    try:
        console.print(client.get_quote(symbol))
    except BrokerError as exc:
        console.print(f"[red]실패[/red] {exc}")

    console.rule(f"4. 캔들 ({symbol}, {settings.candle_interval})")
    try:
        candles = client.get_candles(symbol, settings.candle_interval, 5)
        console.print(f"{len(candles)}개 수신")
        for candle in candles:
            console.print(candle)
    except BrokerError as exc:
        console.print(f"[red]실패[/red] {exc}")

    if settings.account_id:
        console.rule("5. 잔고")
        try:
            console.print(client.get_account())
        except BrokerError as exc:
            console.print(f"[red]실패[/red] {exc}")

    client.close()


@app.command()
def run(
    once: bool = typer.Option(False, "--once", help="한 사이클만 실행하고 종료"),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """매매 루프를 실행한다."""
    _setup_logging(verbose)
    settings = Settings()

    if settings.mode is Mode.LIVE:
        console.print(
            "[bold red]LIVE 모드입니다 — 실제 계좌에 주문이 들어갑니다.[/bold red]"
        )
        typer.confirm("계속할까요?", abort=True)

    engine, store = _build(settings)
    try:
        if once:
            orders = engine.run_once()
            console.print(f"{len(orders)}건 체결")
        else:
            engine.run_forever()
    except KeyboardInterrupt:
        console.print("\n중단됨")
    finally:
        store.close()


@app.command()
def status(verbose: bool = typer.Option(False, "--verbose", "-v")) -> None:
    """현재 포지션·현금·최근 주문을 출력한다."""
    _setup_logging(verbose)
    settings = Settings()
    store = Store(settings.db_path)

    console.print(f"[bold]모드[/bold] {settings.mode.value}")
    console.print(f"[bold]시장[/bold] {describe(datetime.now(timezone.utc))}")
    console.print(f"[bold]현금[/bold] {store.get_cash(settings.paper_cash)} USD\n")

    positions = store.load_positions()
    if positions:
        table = Table(title="포지션")
        table.add_column("종목")
        table.add_column("수량", justify="right")
        table.add_column("평단", justify="right")
        table.add_column("취득금액", justify="right")
        for pos in positions.values():
            table.add_row(
                pos.symbol, str(pos.quantity), f"{pos.avg_price:.2f}", f"{pos.cost_basis:.2f}"
            )
        console.print(table)
    else:
        console.print("보유 포지션 없음\n")

    orders = store.recent_orders(10)
    if orders:
        table = Table(title="최근 주문")
        for column in ("시각", "종목", "방향", "수량", "체결가", "상태"):
            table.add_column(column)
        for row in orders:
            table.add_row(
                row["ts"][:19], row["symbol"], row["side"],
                str(row["filled_quantity"]), row["avg_fill_price"], row["status"],
            )
        console.print(table)

    history = store.equity_history(2)
    if history:
        latest = Decimal(history[0]["equity"])
        console.print(f"\n[bold]최근 평가액[/bold] {latest:.2f} USD ({history[0]['ts'][:19]})")

    store.close()


@app.command()
def reset(
    yes: bool = typer.Option(False, "--yes", help="확인 없이 실행"),
) -> None:
    """페이퍼 트레이딩 상태(현금·포지션·주문 이력)를 초기화한다."""
    settings = Settings()
    if settings.mode is Mode.LIVE:
        console.print("[red]LIVE 모드에서는 reset을 실행할 수 없습니다.[/red]")
        raise typer.Exit(1)
    if not yes:
        typer.confirm(f"{settings.db_path} 의 페이퍼 상태를 모두 지울까요?", abort=True)
    if settings.db_path.exists():
        settings.db_path.unlink()
    console.print("초기화 완료")


if __name__ == "__main__":
    app()
