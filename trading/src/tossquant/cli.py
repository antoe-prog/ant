"""CLI 진입점."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from .backtest.data import CandleCache, CsvSource, TossSource, load_history
from .backtest.report import export, render
from .backtest.simulator import Backtester
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


def _setup_logging(verbose: bool, quiet_level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else quiet_level,
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
def backtest(
    source: str = typer.Option("csv", "--source", help="csv | toss"),
    csv_dir: Path = typer.Option(Path("data"), "--csv-dir", help="source=csv일 때 CSV 폴더"),
    symbols: str = typer.Option("", "--symbols", help="쉼표 구분. 비우면 .env 설정 사용"),
    interval: str = typer.Option("", "--interval", help="비우면 .env 설정 사용"),
    start: str = typer.Option("", "--from", help="시작일 YYYY-MM-DD"),
    end: str = typer.Option("", "--to", help="종료일 YYYY-MM-DD"),
    count: int = typer.Option(500, "--count", help="source=toss일 때 요청할 봉 개수"),
    fast: int = typer.Option(0, "--fast", help="SMA 단기 (0이면 .env 설정)"),
    slow: int = typer.Option(0, "--slow", help="SMA 장기 (0이면 .env 설정)"),
    cash: float = typer.Option(0.0, "--cash", help="시작 자본 (0이면 .env 설정)"),
    stop_loss: float = typer.Option(-1.0, "--stop-loss", help="손절 비율 (0.08 = 8%)"),
    trailing: float = typer.Option(-1.0, "--trailing", help="트레일링 스톱 비율"),
    take_profit: float = typer.Option(-1.0, "--take-profit", help="익절 비율"),
    max_holding: int = typer.Option(-1, "--max-holding", help="최대 보유 일수"),
    no_stops: bool = typer.Option(False, "--no-stops", help="보호 청산 전부 끄고 비교"),
    cache_path: Path = typer.Option(Path("candles.db"), "--cache", help="캔들 캐시 파일"),
    refresh: bool = typer.Option(False, "--refresh", help="캐시를 무시하고 다시 받는다"),
    export_dir: Path = typer.Option(None, "--export", help="결과 CSV를 쓸 폴더"),
    trades: int = typer.Option(10, "--trades", help="출력할 최근 거래 건수"),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """과거 캔들로 전략을 검증한다.

    신호는 봉 종가에서 나오고 체결은 다음 봉 시가에 일어난다 — 실시간 운용과
    같은 전략·리스크·체결 코드를 그대로 탄다.
    """
    _setup_logging(verbose, quiet_level=logging.WARNING)
    # 보호 청산은 라이브에선 WARNING이 맞지만, 백테스트에선 수백 건이 쏟아지고
    # 어차피 거래 표에 다 나온다. -v를 주면 다시 보인다.
    if not verbose:
        logging.getLogger("tossquant.stops").setLevel(logging.ERROR)
    settings = Settings()

    if symbols:
        settings.symbols = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if interval:
        settings.candle_interval = interval
    if fast:
        settings.sma_fast = fast
    if slow:
        settings.sma_slow = slow
    if cash:
        settings.paper_cash = Decimal(str(cash))
    if settings.sma_fast >= settings.sma_slow:
        console.print("[red]--fast 는 --slow 보다 작아야 합니다[/red]")
        raise typer.Exit(1)

    # -1 = 지정 안 함(.env 값 유지). 0은 '끄기'라는 유효한 값이라 구분이 필요하다.
    if stop_loss >= 0:
        settings.stop_loss_pct = Decimal(str(stop_loss))
    if trailing >= 0:
        settings.trailing_stop_pct = Decimal(str(trailing))
    if take_profit >= 0:
        settings.take_profit_pct = Decimal(str(take_profit))
    if max_holding >= 0:
        settings.max_holding_days = max_holding
    if no_stops:
        settings.stop_loss_pct = Decimal("0")
        settings.trailing_stop_pct = Decimal("0")
        settings.take_profit_pct = Decimal("0")
        settings.max_holding_days = 0

    if source == "csv":
        history_source = CsvSource(csv_dir)
        cache = None
    elif source == "toss":
        history_source = TossSource(_client(settings))
        cache = CandleCache(cache_path)
    else:
        console.print(f"[red]알 수 없는 소스: {source} (csv | toss)[/red]")
        raise typer.Exit(1)

    def parse_day(text: str) -> datetime | None:
        if not text:
            return None
        return datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    try:
        history = load_history(
            settings.symbols,
            settings.candle_interval,
            history_source,
            count=count,
            start=parse_day(start),
            end=parse_day(end),
            cache=cache,
            refresh=refresh,
        )
        result = Backtester(
            history, SmaCrossStrategy(settings.sma_fast, settings.sma_slow), settings
        ).run()
    except (ValueError, FileNotFoundError) as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(1) from None
    finally:
        if cache is not None:
            cache.close()

    render(result, console, show_trades=trades)

    if export_dir is not None:
        written = export(result, export_dir)
        console.print("\n" + "\n".join(f"기록: {path}" for path in written))


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
