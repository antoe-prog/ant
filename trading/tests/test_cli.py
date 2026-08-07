"""CLI 출력 테스트.

사용자가 실제로 보는 문자열을 검증한다. 안내문은 깨져도 예외가 나지 않아서
테스트가 없으면 그대로 방치된다 — rich가 `[/dim]` 같은 유효한 태그를 조용히
먹어버리는 게 대표적이다. (`[-1]`처럼 태그가 아닌 대괄호는 그대로 출력되므로,
안전한 문자열로 테스트하면 아무것도 지키지 못한다.)
"""

from __future__ import annotations

import pytest
from rich.console import Console
from typer.testing import CliRunner

from tossquant import cli
from tossquant.cli import app

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
                    "walkforward", "reset"):
        assert command in output


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


def test_explicit_zero_means_all():
    assert cli._resolve_count(0, "toss", 500) == 0
