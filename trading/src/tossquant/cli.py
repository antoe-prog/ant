"""CLI 진입점."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import logging
import platform
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

PACKAGE_CODE_DIGEST_ALGORITHM = "sha256-package-relative-path-content-v1"


def _package_code_sha256() -> str:
    root = Path(__file__).resolve().parent
    paths = sorted(root.rglob("*.py"))
    aggregate = hashlib.sha256()
    aggregate.update(PACKAGE_CODE_DIGEST_ALGORITHM.encode("ascii") + b"\0")
    aggregate.update(len(paths).to_bytes(8, "big"))
    for path in paths:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        aggregate.update(len(relative).to_bytes(4, "big"))
        aggregate.update(relative)
        aggregate.update(hashlib.sha256(path.read_bytes()).digest())
    return aggregate.hexdigest()


# Package modules must not be imported before the source bytes they will execute
# have been fixed.  A second check immediately after the imports closes that
# import window; scan-data rechecks the same startup digest before success.
STARTUP_CODE_SHA256 = _package_code_sha256()

import typer
from rich.console import Console
from rich.table import Table

from .backtest.corporate import detect, load_verified_splits
from .backtest.data import CandleCache, CsvSource, TossSource, load_history
from .backtest import walkforward as walkforward_mod
from .backtest.report import ExportError, export, render, render_walkforward
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
from .store import Store, StoreConflict
from .strategy import registry

if _package_code_sha256() != STARTUP_CODE_SHA256:
    raise RuntimeError("TossQuant 코드가 import 중 변경됐습니다")

app = typer.Typer(help="토스증권 Open API 기반 미국주식 자동매매", no_args_is_help=True)
console = Console()
CSV_DATASET_DIGEST_ALGORITHM = "sha256-filename-size-content-v1"
SCAN_RESULT_SCHEMA_VERSION = 1
SCAN_RESULT_PREFIX = "scan_result="


def _assert_package_code_unchanged() -> str:
    current = _package_code_sha256()
    if current != STARTUP_CODE_SHA256:
        raise ValueError(
            "스캔 중 TossQuant 코드가 변경됐습니다: "
            f"startup={STARTUP_CODE_SHA256} current={current}"
        )
    return STARTUP_CODE_SHA256


def _csv_dataset_sha256(files: list[Path]) -> str:
    aggregate = hashlib.sha256()
    aggregate.update(CSV_DATASET_DIGEST_ALGORITHM.encode("ascii") + b"\0")
    aggregate.update(len(files).to_bytes(8, "big"))
    for path in files:
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"CSV 입력은 일반 파일이어야 합니다: {path}")
        name = path.name.encode("utf-8")
        content = hashlib.sha256()
        size = 0
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                size += len(chunk)
                content.update(chunk)
        aggregate.update(len(name).to_bytes(4, "big"))
        aggregate.update(name)
        aggregate.update(size.to_bytes(8, "big"))
        aggregate.update(content.digest())
    return aggregate.hexdigest()


def _print_scan_provenance(
    context: dict[str, object],
    input_sha256: str | None = None,
    code_sha256: str | None = None,
) -> None:
    console.print(
        "scan_context="
        + json.dumps(context, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
        markup=False,
        highlight=False,
        soft_wrap=True,
    )
    if input_sha256 is not None:
        console.print(f"scan_input={input_sha256}")
    if code_sha256 is not None:
        console.print(f"scan_code={code_sha256}")


def _canonical_json(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _scan_break_result(symbol: str, item) -> dict[str, object]:
    return {
        "symbol": symbol,
        "index": item.index,
        "timestamp": item.ts.isoformat(),
        "previous_close": str(item.prev_close),
        "close": str(item.close),
        "observed_ratio": str(item.ratio),
        "change_percent": str(item.change_pct),
        "matched_split_ratio": (
            str(item.split_ratio) if item.split_ratio is not None else None
        ),
        "volume_confirms": item.volume_confirms,
        "persists": item.persists,
        "round_trip": item.round_trip,
        "looks_like_split": item.looks_like_split,
        "looks_like_bad_bar": item.looks_like_bad_bar,
        "distorts_backtest": item.distorts_backtest,
        "description": item.describe(),
    }


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
    strategy = registry.build(settings.strategy, settings)
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
    """자격증명·계좌·시세 엔드포인트를 실제로 두드려 파싱 결과를 출력한다.

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

    failed = False

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
        failed = True

    symbol = settings.symbols[0] if settings.symbols else "AAPL"

    console.rule(f"3. 시세 ({symbol})")
    try:
        console.print(client.get_quote(symbol))
    except BrokerError as exc:
        console.print(f"[red]실패[/red] {exc}")
        failed = True

    console.rule(f"4. 캔들 ({symbol}, {settings.candle_interval})")
    try:
        candles = client.get_candles(symbol, settings.candle_interval, 5)
        console.print(f"{len(candles)}개 수신")
        for candle in candles:
            console.print(candle)
    except BrokerError as exc:
        console.print(f"[red]실패[/red] {exc}")
        failed = True

    if settings.account_id:
        console.rule("5. 잔고")
        try:
            console.print(client.get_account())
        except BrokerError as exc:
            console.print(f"[red]실패[/red] {exc}")
            failed = True

    client.close()
    if failed:
        raise typer.Exit(1)


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


def _select_strategy(settings: Settings, name: str) -> None:
    """--strategy 를 설정에 반영하고 이름을 검증한다."""
    if name:
        settings.strategy = name
    if settings.strategy not in registry.NAMES:
        console.print(
            f"[red]알 수 없는 전략 '{settings.strategy}' "
            f"(가능: {', '.join(registry.NAMES)})[/red]"
        )
        raise typer.Exit(1)


def _parse_grid(spec: str, strategy: str) -> walkforward_mod.ParamGrid:
    """`fast=5,10;slow=40,60` 형태를 격자로. 비우면 전략 기본 격자."""
    if not spec:
        return registry.default_grid(strategy)

    base = registry.default_grid(strategy)
    allowed = set(base.values)
    values: dict[str, list] = {}
    for part in spec.split(";"):
        if not part.strip():
            console.print("[red]--grid에 빈 축이 있습니다[/red]")
            raise typer.Exit(1)
        key, separator, raw = part.partition("=")
        key = key.strip()
        if not separator or not key or not raw.strip():
            console.print(f"[red]--grid 형식 오류: '{part}' (key=v1,v2 이어야 합니다)[/red]")
            raise typer.Exit(1)
        if key not in allowed:
            console.print(
                f"[red]{strategy} 전략에 알 수 없는 --grid 축 '{key}' "
                f"(가능: {', '.join(sorted(allowed))})[/red]"
            )
            raise typer.Exit(1)
        if key in values:
            console.print(f"[red]--grid 축 '{key}'이 두 번 지정됐습니다[/red]")
            raise typer.Exit(1)
        parsed = []
        for token in raw.split(","):
            token = token.strip()
            if not token:
                console.print(f"[red]--grid 축 '{key}'에 빈 값이 있습니다[/red]")
                raise typer.Exit(1)
            try:
                value = int(token) if "." not in token else float(token)
            except ValueError:
                console.print(f"[red]--grid 값이 숫자가 아닙니다: '{token}'[/red]")
                raise typer.Exit(1) from None
            if value in parsed:
                console.print(
                    f"[red]--grid 축 '{key}'에 중복 값 {token}이 있습니다[/red]"
                )
                raise typer.Exit(1)
            parsed.append(value)
        values[key] = parsed

    # 지정하지 않은 축은 기본 격자의 값을 그대로 쓴다.
    merged = {**base.values, **values}
    grid = walkforward_mod.ParamGrid(values=merged, valid=base.valid)
    try:
        return registry.validate_grid(strategy, grid)
    except ValueError as exc:
        console.print(f"[red]--grid 값이 유효하지 않습니다: {exc}[/red]")
        raise typer.Exit(1) from None


def _apply_regime(settings: Settings, symbol: str, ma_bars: int) -> None:
    """--regime / --regime-ma 를 설정에 반영한다.

    'off'로 명시적으로 끌 수 있어야 .env에 켜둔 상태에서도 비교 실행이 된다.
    """
    if symbol:
        normalized = symbol.strip()
        if not normalized:
            console.print("[red]--regime 값은 비어 있을 수 없습니다[/red]")
            raise typer.Exit(1)
        if normalized.lower() == "off":
            settings.regime_enabled = False
        else:
            settings.regime_symbol = normalized
            settings.regime_enabled = True
    if ma_bars < 0:
        console.print("[red]--regime-ma 값은 1 이상이어야 합니다[/red]")
        raise typer.Exit(1)
    if ma_bars > 0:
        settings.regime_ma_bars = ma_bars


def _apply_decimal_override(
    settings: Settings,
    field: str,
    raw: float,
    option: str,
    *,
    unspecified: Decimal,
) -> None:
    """유한 CLI 실수를 Decimal 설정에 적용하고 도메인 오류를 한 줄로 보인다."""
    value = Decimal(str(raw))
    if not value.is_finite():
        console.print(f"[red]{option} 값은 유한해야 합니다[/red]")
        raise typer.Exit(1)
    if value == unspecified:
        return
    try:
        setattr(settings, field, value)
    except ValueError as exc:
        errors = getattr(exc, "errors", lambda: [])()
        detail = errors[0].get("msg", str(exc)) if errors else str(exc)
        console.print(f"[red]{option} 값이 유효하지 않습니다: {detail}[/red]")
        raise typer.Exit(1) from None


def _apply_sma_overrides(settings: Settings, fast: int, slow: int) -> Settings:
    """SMA 두 값을 완성된 쌍으로 검증해 중간의 잘못된 상태를 만들지 않는다."""
    if fast == 0 and slow == 0:
        return settings
    values = settings.model_dump()
    if fast != 0:
        values["sma_fast"] = fast
    if slow != 0:
        values["sma_slow"] = slow
    option = (
        "--fast/--slow"
        if fast != 0 and slow != 0
        else "--fast" if fast else "--slow"
    )
    try:
        return type(settings).model_validate(values)
    except ValueError as exc:
        errors = getattr(exc, "errors", lambda: [])()
        detail = errors[0].get("msg", str(exc)) if errors else str(exc)
        console.print(f"[red]{option} 값이 유효하지 않습니다: {detail}[/red]")
        raise typer.Exit(1) from None


def _apply_max_holding(settings: Settings, days: int) -> None:
    if days < -1:
        console.print("[red]--max-holding 값은 -1 또는 0 이상이어야 합니다[/red]")
        raise typer.Exit(1)
    if days >= 0:
        settings.max_holding_days = days


def _history_symbols(settings: Settings) -> list[str]:
    """국면 심볼을 대소문자와 무관하게 한 번만, 마지막 data-only로 둔다."""
    wanted = list(settings.symbols)
    if not settings.regime_enabled:
        return wanted
    regime_symbol = settings.regime_symbol
    return [s for s in wanted if s.upper() != regime_symbol] + [regime_symbol]


def _resolve_count(count: int, source: str, toss_default: int) -> int:
    """--count 기본값을 소스에 맞게 정한다.

    토스는 호출 한도가 있어 개수를 제한하는 게 맞지만, 로컬 CSV에까지 같은
    상한이 걸리면 파일에 5년치가 있어도 조용히 뒷부분만 잘라 쓰게 된다.
    실제로 이 함정에 걸려 1259봉짜리 데이터로 440봉만 백테스트했다.
    """
    if count < -1:
        raise ValueError("--count는 -1(기본값) 또는 0 이상의 개수여야 합니다")
    if count == 0 and source == "toss":
        raise ValueError(
            "Toss 소스는 전체 이력 완전성을 검증하지 못해 --count 0을 지원하지 않습니다"
        )
    if count >= 0:
        return count
    return 0 if source == "csv" else toss_default



@app.command()
def backtest(
    source: str = typer.Option("csv", "--source", help="csv | toss"),
    csv_dir: Path = typer.Option(Path("data"), "--csv-dir", help="source=csv일 때 CSV 폴더"),
    symbols: str = typer.Option("", "--symbols", help="쉼표 구분. 비우면 .env 설정 사용"),
    strategy: str = typer.Option(
        "", "--strategy",
        help="sma_cross | momentum | breakout | mean_reversion (비우면 .env)",
    ),
    interval: str = typer.Option("", "--interval", help="비우면 .env 설정 사용"),
    start: str = typer.Option("", "--from", help="시작일 YYYY-MM-DD"),
    end: str = typer.Option("", "--to", help="종료일 YYYY-MM-DD"),
    count: int = typer.Option(
        -1, "--count",
        help="사용할 봉 개수. 생략하면 csv는 전체, toss는 500. 0은 csv만 전체.",
    ),
    fast: int = typer.Option(0, "--fast", help="SMA 단기 (0이면 .env 설정)"),
    slow: int = typer.Option(0, "--slow", help="SMA 장기 (0이면 .env 설정)"),
    cash: float = typer.Option(0.0, "--cash", help="시작 자본 (0이면 .env 설정)"),
    stop_loss: float = typer.Option(-1.0, "--stop-loss", help="손절 비율 (0.08 = 8%)"),
    regime: str = typer.Option(
        "", "--regime",
        help="시장 국면 필터 지수 심볼 (예: SPY). 'off'면 끈다.",
    ),
    regime_ma: int = typer.Option(0, "--regime-ma", help="국면 판정 이동평균 봉 수"),
    on_break: str = typer.Option(
        "warn", "--on-break",
        help="가격 불연속 처리: ignore | warn(기본) | adjust(검증 매니페스트 필수)",
    ),
    verified_splits_file: Path = typer.Option(
        None,
        "--verified-splits",
        help=("adjust에 필수인 검증된 동일종목 승수 CSV "
              "(symbol,date,ratio,event_type,source)"),
    ),
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

    신호는 봉 종가에서 나오고 체결은 다음 봉 시가로 모델링한다. 라이브와 같은
    전략·리스크 코드를 쓰지만, 체결 모델은 라이브와 다릅니다.
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
    settings = _apply_sma_overrides(settings, fast, slow)
    _apply_decimal_override(
        settings, "paper_cash", cash, "--cash", unspecified=Decimal("0")
    )
    _select_strategy(settings, strategy)
    if settings.strategy == "sma_cross" and settings.sma_fast >= settings.sma_slow:
        console.print("[red]--fast 는 --slow 보다 작아야 합니다[/red]")
        raise typer.Exit(1)

    # -1 = 지정 안 함(.env 값 유지). 0은 '끄기'라는 유효한 값이라 구분이 필요하다.
    _apply_decimal_override(
        settings,
        "stop_loss_pct",
        stop_loss,
        "--stop-loss",
        unspecified=Decimal("-1"),
    )
    _apply_decimal_override(
        settings,
        "trailing_stop_pct",
        trailing,
        "--trailing",
        unspecified=Decimal("-1"),
    )
    _apply_decimal_override(
        settings,
        "take_profit_pct",
        take_profit,
        "--take-profit",
        unspecified=Decimal("-1"),
    )
    _apply_max_holding(settings, max_holding)
    _apply_regime(settings, regime, regime_ma)
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
        verified_splits = (
            load_verified_splits(verified_splits_file)
            if verified_splits_file is not None
            else None
        )
        wanted = _history_symbols(settings)
        history = load_history(
            wanted,
            settings.candle_interval,
            history_source,
            count=_resolve_count(count, source, 500),
            start=parse_day(start),
            end=parse_day(end),
            cache=cache,
            refresh=refresh,
            on_break=on_break,
            verified_splits=verified_splits,
        )
        result = Backtester(
            history, registry.build(settings.strategy, settings), settings
        ).run()
    except (BrokerError, ValueError, FileNotFoundError) as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(1) from None
    finally:
        if cache is not None:
            cache.close()

    render(result, console, show_trades=trades)

    if export_dir is not None:
        try:
            written = export(result, export_dir)
        except ExportError as exc:
            console.print(f"[red]내보내기 실패: {exc}[/red]")
            raise typer.Exit(1) from None
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
        help="사용할 봉 개수. 생략하면 csv는 전체, toss는 1000. 0은 csv만 전체.",
    ),
    train_bars: int = typer.Option(250, "--train-bars", help="학습 구간 봉 수"),
    test_bars: int = typer.Option(60, "--test-bars", help="평가 구간 봉 수"),
    objective: str = typer.Option(
        "sharpe", "--objective", help="sharpe | sortino | calmar | cagr | return"
    ),
    anchored: bool = typer.Option(
        False, "--anchored", help="학습 구간을 처음부터 확장 (기본은 롤링)"
    ),
    strategy: str = typer.Option(
        "", "--strategy",
        help="sma_cross | momentum | breakout | mean_reversion (비우면 .env)",
    ),
    grid_spec: str = typer.Option(
        "", "--grid",
        help="탐색 격자 `fast=5,10;slow=40,60`. 비우면 전략별 기본 격자.",
    ),
    cash: float = typer.Option(0.0, "--cash"),
    regime: str = typer.Option(
        "", "--regime",
        help="시장 국면 필터 지수 심볼 (예: SPY). 'off'면 끈다.",
    ),
    regime_ma: int = typer.Option(0, "--regime-ma", help="국면 판정 이동평균 봉 수"),
    on_break: str = typer.Option(
        "warn", "--on-break",
        help="가격 불연속 처리: ignore | warn(기본) | adjust(검증 매니페스트 필수)",
    ),
    verified_splits_file: Path = typer.Option(
        None,
        "--verified-splits",
        help=("adjust에 필수인 검증된 동일종목 승수 CSV "
              "(symbol,date,ratio,event_type,source)"),
    ),
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
    _apply_decimal_override(
        settings, "paper_cash", cash, "--cash", unspecified=Decimal("0")
    )
    _apply_regime(settings, regime, regime_ma)

    _select_strategy(settings, strategy)
    grid = _parse_grid(grid_spec, settings.strategy)
    if len(grid) == 0:
        console.print("[red]유효한 파라미터 조합이 없습니다[/red]")
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
        verified_splits = (
            load_verified_splits(verified_splits_file)
            if verified_splits_file is not None
            else None
        )
        wanted = _history_symbols(settings)
        history = load_history(
            wanted,
            settings.candle_interval,
            history_source,
            count=_resolve_count(count, source, 1000),
            start=parse_day(start),
            end=parse_day(end),
            cache=cache,
            refresh=refresh,
            on_break=on_break,
            verified_splits=verified_splits,
        )
        with console.status("구간별 최적화 중…"):
            result = walkforward_mod.run(
                history,
                settings,
                grid=grid,
                factory=registry.factory(settings.strategy),
                train_bars=train_bars,
                test_bars=test_bars,
                objective=objective,
                anchored=anchored,
            )
    except (BrokerError, ValueError, FileNotFoundError) as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(1) from None
    finally:
        if cache is not None:
            cache.close()

    render_walkforward(result, console)


@app.command("scan-data")
def scan_data(
    csv_dir: Path = typer.Option(Path("data"), "--csv-dir"),
    threshold: float = typer.Option(0.25, "--threshold", help="불연속 판정 기준 (0.25 = 25%)"),
    strict: bool = typer.Option(
        False, "--strict", help="읽지 못한 CSV가 하나라도 있으면 실패 종료"
    ),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """CSV 폴더 전체에서 가격 불연속을 찾아 분류한다.

    미조정 데이터에는 실제로 없던 급락이 섞여 있다. 액면분할은 -50%, 분사는
    -57%로 찍히고, 그대로 백테스트에 넣으면 손절이 발동해 전략이 폭락을 피한
    것처럼 보인다. 백테스트를 믿기 전에 이걸 먼저 돌릴 것.
    """
    _setup_logging(verbose, quiet_level=logging.ERROR)
    scan_context = {
        "argv": list(sys.argv),
        "cwd": str(Path.cwd()),
    }
    input_sha256: str | None = None
    code_sha256 = STARTUP_CODE_SHA256
    try:
        files = sorted(csv_dir.glob("*.csv"))
    except OSError as exc:
        console.print(f"[red]CSV 목록 조회 실패: {exc}[/red]")
        _print_scan_provenance(scan_context, code_sha256=code_sha256)
        console.print("scan_exit_status=1")
        raise typer.Exit(1) from None
    if not files:
        console.print(f"[red]{csv_dir} 에 CSV가 없습니다[/red]")
        _print_scan_provenance(scan_context, code_sha256=code_sha256)
        console.print("scan_exit_status=1")
        raise typer.Exit(1)

    threshold_decimal = Decimal(str(threshold))
    if not threshold_decimal.is_finite() or threshold_decimal <= 0:
        console.print("[red]--threshold는 0보다 큰 유한값이어야 합니다[/red]")
        _print_scan_provenance(scan_context, code_sha256=code_sha256)
        console.print("scan_exit_status=1")
        raise typer.Exit(1)
    try:
        input_sha256 = _csv_dataset_sha256(files)
        _assert_package_code_unchanged()
    except (OSError, ValueError) as exc:
        console.print(f"[red]스캔 입력 provenance 계산 실패: {exc}[/red]")
        _print_scan_provenance(scan_context, input_sha256, code_sha256)
        console.print("scan_exit_status=1")
        raise typer.Exit(1) from None
    _print_scan_provenance(scan_context, input_sha256, code_sha256)

    buckets: dict[str, list[tuple[str, object]]] = {
        "split": [], "bad": [], "unknown": [], "real": []
    }
    processed = 0
    skipped: list[str] = []
    original_names = [path.name for path in files]
    with tempfile.TemporaryDirectory(prefix="tossquant-scan-snapshot-") as raw:
        snapshot_dir = Path(raw)
        try:
            for path in files:
                shutil.copyfile(path, snapshot_dir / path.name)
            snapshot_files = [snapshot_dir / name for name in original_names]
            snapshot_input_sha256 = _csv_dataset_sha256(snapshot_files)
            files_after_copy = sorted(csv_dir.glob("*.csv"))
            input_after_copy_sha256 = _csv_dataset_sha256(files_after_copy)
        except (OSError, ValueError) as exc:
            console.print(f"[red]스캔 입력 스냅샷 실패: {exc}[/red]")
            console.print("scan_exit_status=1")
            raise typer.Exit(1) from None
        if [path.name for path in files_after_copy] != original_names:
            console.print("[red]스캔 중 CSV 파일 목록이 변경됐습니다[/red]")
            console.print("scan_exit_status=1")
            raise typer.Exit(1)
        if (
            snapshot_input_sha256 != input_sha256
            or input_after_copy_sha256 != input_sha256
        ):
            console.print("[red]스캔 중 CSV 입력 내용이 변경됐습니다[/red]")
            console.print("scan_exit_status=1")
            raise typer.Exit(1)

        source = CsvSource(snapshot_dir)
        for path in snapshot_files:
            try:
                candles = source.fetch(path.stem, "1d", 0)
                if not candles:
                    raise ValueError("캔들이 없습니다")
                breaks = detect(candles, threshold_decimal)
            except (OSError, ValueError) as exc:
                console.print(f"[yellow]{path.name} 건너뜀: {exc}[/yellow]")
                skipped.append(path.name)
                continue
            processed += 1
            for item in breaks:
                key = (
                    "split" if item.looks_like_split
                    else "bad" if item.looks_like_bad_bar
                    else "unknown" if item.distorts_backtest
                    else "real"
                )
                buckets[key].append((path.stem, item))

        if processed == 0:
            console.print("[red]읽을 수 있는 CSV가 없습니다[/red]")
            console.print("scan_exit_status=1")
            raise typer.Exit(1)

        try:
            final_files = sorted(csv_dir.glob("*.csv"))
            final_input_sha256 = _csv_dataset_sha256(final_files)
            _assert_package_code_unchanged()
        except (OSError, ValueError) as exc:
            console.print(f"[red]스캔 완료 provenance 계산 실패: {exc}[/red]")
            console.print("scan_exit_status=1")
            raise typer.Exit(1) from None
        if [path.name for path in final_files] != original_names:
            console.print("[red]스캔 중 CSV 파일 목록이 변경됐습니다[/red]")
            console.print("scan_exit_status=1")
            raise typer.Exit(1)
        if final_input_sha256 != input_sha256:
            console.print("[red]스캔 중 CSV 입력 내용이 변경됐습니다[/red]")
            console.print("scan_exit_status=1")
            raise typer.Exit(1)
    total = sum(len(v) for v in buckets.values())
    console.print(
        f"[bold]{processed}개 처리 · {len(skipped)}개 건너뜀 · "
        f"불연속 {total}건[/bold] (기준 {threshold * 100:g}%)\n"
    )

    sections = [
        ("split", "분할비 후보 — 외부 공시 확인 전 자동 조정 금지", "green"),
        ("bad", "왕복·일시 불연속 — 실제 움직임인지 원본 오류인지 확인", "yellow"),
        (
            "unknown",
            "미확인 하락 갭 — 기업행동·원본 오류 여부 수동 확인 필요",
            "red",
        ),
        ("real", "원인 불명 상승 갭 — 자동 제외하지 않음", "dim"),
    ]
    for key, title, colour in sections:
        rows = buckets[key]
        if not rows:
            continue
        table = Table(title=f"[{colour}]{title}[/{colour}] ({len(rows)}건)")
        table.add_column("종목")
        table.add_column("내용")
        for symbol, item in sorted(rows, key=lambda r: r[0]):
            table.add_row(symbol, item.describe())
        console.print(table)

    if buckets["unknown"]:
        console.print(
            f"\n[red]미확인 하락 갭 {len(buckets['unknown'])}건이 있습니다.[/red] "
            "기업행동이나 원본 오류라면 손절·벤치마크가 왜곡될 수 있으므로 "
            "원자료와 공시를 수동 확인하세요.\n"
            "종목 전체 제외는 미래의 갭까지 미리 보는 사후 전체기간 민감도 "
            "분석이며, 편향 없는 정제 결과가 아닙니다."
        )

    if strict and skipped:
        console.print(
            f"\n[red]strict 모드: {len(skipped)}개 CSV를 읽지 못했습니다.[/red]"
        )
        console.print("scan_exit_status=1")
        raise typer.Exit(1)

    result_categories = {
        "candidate_adjustments": [
            _scan_break_result(symbol, item)
            for symbol, item in sorted(buckets["split"], key=lambda row: row[0])
        ],
        "transient_or_roundtrip": [
            _scan_break_result(symbol, item)
            for symbol, item in sorted(buckets["bad"], key=lambda row: row[0])
        ],
        "unknown_down": [
            _scan_break_result(symbol, item)
            for symbol, item in sorted(buckets["unknown"], key=lambda row: row[0])
        ],
        "unknown_up": [
            _scan_break_result(symbol, item)
            for symbol, item in sorted(buckets["real"], key=lambda row: row[0])
        ],
    }
    result = {
        "schema_version": SCAN_RESULT_SCHEMA_VERSION,
        "kind": "tossquant.scan_result",
        "reported_exit_status": 0,
        "invocation": scan_context,
        "request": {
            "strict": strict,
            "threshold": str(threshold_decimal),
        },
        "input": {
            "digest_algorithm": CSV_DATASET_DIGEST_ALGORITHM,
            "sha256": input_sha256,
        },
        "code": {
            "digest_algorithm": PACKAGE_CODE_DIGEST_ALGORITHM,
            "sha256": code_sha256,
        },
        "runtime": {
            "python": platform.python_version(),
            "pydantic": importlib.metadata.version("pydantic"),
            "pydantic_settings": importlib.metadata.version(
                "pydantic-settings"
            ),
        },
        "processed": processed,
        "skipped_files": sorted(skipped),
        "break_count": total,
        "categories": result_categories,
    }
    try:
        _assert_package_code_unchanged()
    except (OSError, ValueError) as exc:
        console.print(f"[red]스캔 종료 provenance 계산 실패: {exc}[/red]")
        console.print("scan_exit_status=1")
        raise typer.Exit(1) from None
    console.print("scan_exit_status=0")
    console.print(
        SCAN_RESULT_PREFIX + _canonical_json(result),
        markup=False,
        highlight=False,
        soft_wrap=True,
    )


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
    try:
        Store.reset_paper_database(settings.db_path)
    except StoreConflict as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(1) from None
    console.print("초기화 완료")


if __name__ == "__main__":
    app()
