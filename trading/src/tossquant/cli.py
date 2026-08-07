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
from .backtest import walkforward as walkforward_mod
from .backtest.report import export, render, render_walkforward
from .backtest.simulator import Backtester
from .broker.base import BrokerError, CredentialsRejected, IPNotAllowed
from .broker.paper import PaperBroker
from .broker.toss import TossClient, public_ip
from .calendar_us import describe
from .config import Mode, Settings
from . import notify
from .engine import TradingEngine
from .notify import Notification, Notifier, NullNotifier
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


def _build(settings: Settings) -> tuple[TradingEngine, Store, Notifier]:
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
    notifier = notify.build(settings)
    engine = TradingEngine(broker, strategy, risk, store, settings, notifier=notifier)
    return engine, store, notifier


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
    console.print(f"[bold]market[/bold] {describe(datetime.now(timezone.utc))}")

    ip = public_ip()
    console.print(
        f"[bold]현재 공인 IP[/bold] {ip or '확인 실패'}"
        "  [dim](토스 허용 IP 목록에 등록돼 있어야 합니다)[/dim]"
    )

    if settings.key_expires_at:
        remaining = settings.days_until_key_expiry()
        warning = settings.key_expiry_warning()
        color = "red" if warning else "green"
        console.print(
            f"[bold]키 만료[/bold] [{color}]{settings.key_expires_at} "
            f"({remaining}일 남음)[/{color}]"
        )
        if warning:
            console.print(f"  [yellow]{warning}[/yellow]")
    else:
        console.print(
            "[bold]키 만료[/bold] [dim]미설정 — TOSSQUANT_KEY_EXPIRES_AT 을 넣으면 "
            "만료 전에 알려줍니다[/dim]"
        )
    console.print()

    client = _client(settings)

    console.rule("1. 토큰 발급")
    try:
        token = client._access_token()  # noqa: SLF001 — 진단 목적
        console.print(f"[green]OK[/green] access_token …{token[-8:]}")
    except IPNotAllowed as exc:
        console.print(f"[red]IP 차단[/red]\n{exc}")
        raise typer.Exit(1) from None
    except CredentialsRejected as exc:
        console.print(f"[red]자격증명 문제[/red]\n{exc}")
        raise typer.Exit(1) from None
    except BrokerError as exc:
        console.print(f"[red]실패[/red] {exc}")
        raise typer.Exit(1) from None

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

    engine, store, notifier = _build(settings)
    if isinstance(notifier, NullNotifier):
        console.print(
            "[yellow]알림이 설정되지 않았습니다. 체결·손절·오류를 로그로만 확인하게 됩니다.\n"
            "  → .env에 TOSSQUANT_TELEGRAM_* 또는 TOSSQUANT_SLACK_WEBHOOK_URL 설정 후 "
            "`tossquant notify-test`로 확인하세요.[/yellow]\n"
        )
    try:
        if once:
            orders = engine.run_once()
            console.print(f"{len(orders)}건 체결")
        else:
            engine.run_forever()
    except KeyboardInterrupt:
        console.print("\n중단됨")
    finally:
        notifier.close()
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


def _shell(command: str) -> None:
    """복사해서 쓸 명령/설정 줄.

    마크업을 끄지 않으면 `[-1]` 같은 대괄호가 rich 태그로 먹힌다. 또 rich가 줄을
    접으면 붙여넣은 명령이 깨지므로, 각 줄은 80칼럼 안에 들어가게 짧게 유지한다.
    """
    console.print(f"   {command}", markup=False, highlight=False, style="dim")


def _print_setup_guide(settings: Settings) -> None:
    """알림 채널이 하나도 없을 때의 설정 안내.

    막히는 지점이 정해져 있다: 봇에게 먼저 말을 걸지 않으면 getUpdates가 빈
    배열을 돌려주고, 응답 JSON에서 chat_id가 어디 박혀 있는지도 안 보인다.
    그 두 가지를 짚어준다.
    """
    console.print("[red]설정된 알림 채널이 없습니다.[/red]")
    console.print("둘 중 하나만 설정하면 됩니다.\n")

    console.rule("[bold]텔레그램[/bold]", align="left")
    console.print("1. 텔레그램에서 [bold]@BotFather[/bold] 를 찾아 [dim]/newbot[/dim] 으로 봇을 만듭니다.")
    console.print("   → 발급된 토큰을 복사해 둡니다.\n")
    console.print("2. [yellow]만든 봇과의 대화방을 열고 아무 메시지나 보냅니다.[/yellow]")
    console.print("   [dim]이걸 건너뛰면 다음 단계가 빈 배열만 돌려줍니다.[/dim]\n")
    console.print("3. chat_id 를 확인합니다:")
    _shell("curl -s https://api.telegram.org/bot<토큰>/getUpdates")
    console.print("   [dim]응답 JSON의 result → message → chat → id 가 chat_id 입니다.[/dim]")
    console.print("   [dim]jq를 쓴다면 뒤에 이어서:[/dim]")
    _shell("| jq .result[-1].message.chat.id")
    console.print()
    console.print(f"4. [bold]{settings.model_config['env_file']}[/bold] 에 넣습니다:")
    _shell("TOSSQUANT_TELEGRAM_BOT_TOKEN=발급받은토큰")
    _shell("TOSSQUANT_TELEGRAM_CHAT_ID=확인한숫자")
    console.print()

    console.rule("[bold]Slack[/bold]", align="left")
    console.print("워크스페이스 설정에서 Incoming Webhook을 만들고 URL을 넣습니다:")
    _shell("TOSSQUANT_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...")
    console.print()

    console.rule()
    console.print("설정한 뒤 [bold]tossquant notify-test[/bold] 를 다시 실행하세요.")


@app.command("notify-test")
def notify_test(verbose: bool = typer.Option(False, "--verbose", "-v")) -> None:
    """설정된 알림 채널로 테스트 메시지를 실제로 보낸다.

    봇을 밤새 돌리기 전에 이게 통과하는지 반드시 확인할 것. 알림이 안 오는 걸
    사고가 난 뒤에 알면 늦는다.
    """
    _setup_logging(verbose)
    settings = Settings()
    notifier = notify.build(settings)

    channels = []
    if settings.telegram_bot_token and settings.telegram_chat_id:
        channels.append(f"텔레그램 (chat_id {settings.telegram_chat_id})")
    if settings.slack_webhook_url:
        channels.append("Slack webhook")

    if isinstance(notifier, NullNotifier):
        _print_setup_guide(settings)
        raise typer.Exit(1)

    console.print(f"[bold]채널[/bold] {', '.join(channels)}")

    sent = notifier.notify(
        Notification(
            title="tossquant 알림 테스트",
            lines=[
                f"모드 {settings.mode.value}",
                f"종목 {', '.join(settings.symbols)}",
                f"시장 {describe(datetime.now(timezone.utc))}",
                "이 메시지가 보이면 알림 설정이 정상입니다.",
            ],
        )
    )
    notifier.close()

    if sent:
        console.print("[green]전송 성공[/green] — 기기에서 메시지를 확인하세요.")
    else:
        console.print(
            "[red]전송 실패[/red] — 토큰/chat_id/webhook URL을 확인하세요. "
            "자세한 원인은 -v로 다시 실행하면 보입니다."
        )
        raise typer.Exit(1)


def _resolve_count(count: int, source: str, toss_default: int) -> int:
    """--count 기본값을 소스에 맞게 정한다.

    토스는 호출 한도가 있어 개수를 제한하는 게 맞지만, 로컬 CSV에까지 같은
    상한이 걸리면 파일에 5년치가 있어도 조용히 뒷부분만 잘라 쓰게 된다.
    실제로 이 함정에 걸려 1259봉짜리 데이터로 440봉만 백테스트했다.
    """
    if count >= 0:
        return count
    return 0 if source == "csv" else toss_default



@app.command()
def backtest(
    source: str = typer.Option("csv", "--source", help="csv | toss"),
    csv_dir: Path = typer.Option(Path("data"), "--csv-dir", help="source=csv일 때 CSV 폴더"),
    symbols: str = typer.Option("", "--symbols", help="쉼표 구분. 비우면 .env 설정 사용"),
    interval: str = typer.Option("", "--interval", help="비우면 .env 설정 사용"),
    start: str = typer.Option("", "--from", help="시작일 YYYY-MM-DD"),
    end: str = typer.Option("", "--to", help="종료일 YYYY-MM-DD"),
    count: int = typer.Option(
        -1, "--count",
        help="사용할 봉 개수. 생략하면 csv는 전체, toss는 500. 0도 전체.",
    ),
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
            count=_resolve_count(count, source, 500),
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
def walkforward(
    source: str = typer.Option("csv", "--source", help="csv | toss"),
    csv_dir: Path = typer.Option(Path("data"), "--csv-dir"),
    symbols: str = typer.Option("", "--symbols", help="쉼표 구분"),
    start: str = typer.Option("", "--from", help="시작일 YYYY-MM-DD"),
    end: str = typer.Option("", "--to", help="종료일 YYYY-MM-DD"),
    count: int = typer.Option(
        -1, "--count",
        help="사용할 봉 개수. 생략하면 csv는 전체, toss는 1000. 0도 전체.",
    ),
    train_bars: int = typer.Option(250, "--train-bars", help="학습 구간 봉 수"),
    test_bars: int = typer.Option(60, "--test-bars", help="평가 구간 봉 수"),
    objective: str = typer.Option(
        "sharpe", "--objective", help="sharpe | sortino | calmar | cagr | return"
    ),
    anchored: bool = typer.Option(
        False, "--anchored", help="학습 구간을 처음부터 확장 (기본은 롤링)"
    ),
    fast_range: str = typer.Option("5,10,20,30", "--fast-range", help="단기선 후보"),
    slow_range: str = typer.Option("40,60,100,150", "--slow-range", help="장기선 후보"),
    cash: float = typer.Option(0.0, "--cash"),
    cache_path: Path = typer.Option(Path("candles.db"), "--cache"),
    refresh: bool = typer.Option(False, "--refresh"),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """구간을 나눠 앞에서 파라미터를 고르고 뒤에서 검증한다.

    단일 백테스트로 파라미터를 고르면 그 결과는 검증이 아니라 자기충족이다.
    여기서는 학습 구간에서만 고르고 한 번도 보지 않은 구간에서 평가해, 인샘플
    성과가 밖에서 얼마나 유지되는지를 숫자로 보여준다.
    """
    _setup_logging(verbose, quiet_level=logging.WARNING)
    # 구간마다 수십 번 백테스트를 돌리므로 보호 청산 로그가 화면을 덮는다.
    if not verbose:
        logging.getLogger("tossquant.stops").setLevel(logging.ERROR)
    settings = Settings()

    if symbols:
        settings.symbols = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if cash:
        settings.paper_cash = Decimal(str(cash))

    def parse_ints(text: str, label: str) -> list[int]:
        try:
            return sorted({int(v) for v in text.split(",") if v.strip()})
        except ValueError:
            console.print(f"[red]{label}는 쉼표로 구분된 정수여야 합니다: {text}[/red]")
            raise typer.Exit(1) from None

    grid = walkforward_mod.sma_grid(
        parse_ints(fast_range, "--fast-range"), parse_ints(slow_range, "--slow-range")
    )
    if len(grid) == 0:
        console.print("[red]유효한 파라미터 조합이 없습니다 (단기 < 장기 필요)[/red]")
        raise typer.Exit(1)

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
        return (
            datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            if text
            else None
        )

    try:
        history = load_history(
            settings.symbols,
            settings.candle_interval,
            history_source,
            count=_resolve_count(count, source, 1000),
            start=parse_day(start),
            end=parse_day(end),
            cache=cache,
            refresh=refresh,
        )
        with console.status("구간별 최적화 중…"):
            result = walkforward_mod.run(
                history,
                settings,
                grid=grid,
                train_bars=train_bars,
                test_bars=test_bars,
                objective=objective,
                anchored=anchored,
            )
    except (ValueError, FileNotFoundError) as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(1) from None
    finally:
        if cache is not None:
            cache.close()

    render_walkforward(result, console)


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
