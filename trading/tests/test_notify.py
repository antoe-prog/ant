"""알림 테스트.

여기서 가장 중요한 건 '알림이 잘 간다'가 아니라 **'알림이 실패해도 매매가
멈추지 않는다'** 는 것이다. 텔레그램이 죽었다고 봇이 죽으면 알림을 붙인 게
오히려 손해다.
"""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from tossquant.config import Settings
from tossquant.notify import (
    ConsoleNotifier,
    Level,
    MultiNotifier,
    Notification,
    Notifier,
    NullNotifier,
    SlackNotifier,
    TelegramNotifier,
    build,
)


class Recorder(Notifier):
    """전송된 알림을 기록만 하는 테스트용 채널."""

    def __init__(self, throttle_seconds: int = 0, fail: bool = False) -> None:
        super().__init__(throttle_seconds)
        self.sent: list[Notification] = []
        self.fail = fail

    def _deliver(self, notification: Notification) -> None:
        if self.fail:
            raise RuntimeError("boom")
        self.sent.append(notification)


class FailOnceRecorder(Recorder):
    """첫 전달만 실패하고 다음 전달은 기록하는 채널."""

    def __init__(self, throttle_seconds: int = 0) -> None:
        super().__init__(throttle_seconds)
        self.attempts = 0

    def _deliver(self, notification: Notification) -> None:
        self.attempts += 1
        if self.attempts == 1:
            raise RuntimeError("transient")
        self.sent.append(notification)


# --- 실패 격리 ---------------------------------------------------------------


def test_delivery_failure_never_raises():
    notifier = Recorder(fail=True)
    assert notifier.notify(Notification(title="t")) is False


def test_delivery_success_returns_true():
    notifier = Recorder()
    assert notifier.notify(Notification(title="t")) is True
    assert len(notifier.sent) == 1


def test_failed_delivery_does_not_consume_dedup_throttle():
    notifier = FailOnceRecorder(throttle_seconds=300)
    notification = Notification(title="err", dedup_key="cycle")

    assert notifier.notify(notification) is False
    assert notifier.notify(notification) is True
    assert notifier.attempts == 2
    assert notifier.sent == [notification]


@respx.mock
def test_telegram_http_error_is_swallowed():
    respx.post(url__regex=r".*sendMessage").mock(
        return_value=httpx.Response(401, text="unauthorized")
    )
    notifier = TelegramNotifier("tok", "chat", client=httpx.Client())

    assert notifier.notify(Notification(title="t")) is False


@respx.mock
def test_telegram_network_error_is_swallowed():
    respx.post(url__regex=r".*sendMessage").mock(
        side_effect=httpx.ConnectError("no route")
    )
    notifier = TelegramNotifier("tok", "chat", client=httpx.Client())

    assert notifier.notify(Notification(title="t")) is False


# --- 스로틀링 ----------------------------------------------------------------


def test_same_dedup_key_is_throttled():
    notifier = Recorder(throttle_seconds=300)

    first = notifier.notify(Notification(title="err", dedup_key="cycle"))
    second = notifier.notify(Notification(title="err", dedup_key="cycle"))

    assert first is True
    assert second is False
    assert len(notifier.sent) == 1


def test_different_dedup_keys_both_pass():
    notifier = Recorder(throttle_seconds=300)
    notifier.notify(Notification(title="a", dedup_key="k1"))
    notifier.notify(Notification(title="b", dedup_key="k2"))
    assert len(notifier.sent) == 2


def test_no_dedup_key_is_never_throttled():
    """체결처럼 매번 알아야 하는 알림은 스로틀되면 안 된다."""
    notifier = Recorder(throttle_seconds=300)
    for _ in range(5):
        notifier.notify(Notification(title="fill"))
    assert len(notifier.sent) == 5


def test_zero_throttle_disables_dedup():
    notifier = Recorder(throttle_seconds=0)
    notifier.notify(Notification(title="a", dedup_key="k"))
    notifier.notify(Notification(title="a", dedup_key="k"))
    assert len(notifier.sent) == 2


# --- 렌더링 ------------------------------------------------------------------


def test_render_includes_icon_and_lines():
    text = Notification(
        title="AAPL BUY 10주 체결", lines=["체결가 100", "사유 골든크로스"], level=Level.INFO
    ).render()

    assert text.startswith("✅")
    assert "AAPL BUY 10주 체결" in text
    assert "사유 골든크로스" in text


def test_render_title_only():
    assert Notification(title="봇 종료", level=Level.WARN).render() == "⚠️ 봇 종료"


def test_error_level_uses_alarm_icon():
    assert Notification(title="x", level=Level.ERROR).render().startswith("🚨")


# --- 채널 구현 ---------------------------------------------------------------


@respx.mock
def test_telegram_posts_expected_payload():
    route = respx.post("https://api.telegram.org/bottok123/sendMessage").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )
    notifier = TelegramNotifier("tok123", "chat456", client=httpx.Client())

    assert notifier.notify(Notification(title="안녕", lines=["줄1"])) is True

    payload = json.loads(route.calls[0].request.content)
    assert payload["chat_id"] == "chat456"
    assert "안녕" in payload["text"]
    assert "줄1" in payload["text"]
    assert route.call_count == 1


@respx.mock
def test_slack_posts_text_field():
    route = respx.post("https://hooks.slack.test/abc").mock(
        return_value=httpx.Response(200, text="ok")
    )
    notifier = SlackNotifier("https://hooks.slack.test/abc", client=httpx.Client())

    assert notifier.notify(Notification(title="hi")) is True
    assert json.loads(route.calls[0].request.content)["text"].endswith("hi")


def test_telegram_requires_both_token_and_chat():
    with pytest.raises(ValueError):
        TelegramNotifier("tok", "")
    with pytest.raises(ValueError):
        TelegramNotifier("", "chat")


def test_slack_requires_url():
    with pytest.raises(ValueError):
        SlackNotifier("")


def test_null_notifier_reports_not_sent():
    assert NullNotifier().notify(Notification(title="t")) is False


def test_console_notifier_prints(capsys):
    ConsoleNotifier().notify(Notification(title="hello"))
    assert "hello" in capsys.readouterr().out


# --- 다중 채널 ---------------------------------------------------------------


def test_multi_sends_to_all_channels():
    a, b = Recorder(), Recorder()
    assert MultiNotifier([a, b]).notify(Notification(title="t")) is True
    assert len(a.sent) == len(b.sent) == 1


def test_multi_continues_when_one_channel_fails():
    broken, working = Recorder(fail=True), Recorder()

    result = MultiNotifier([broken, working]).notify(Notification(title="t"))

    assert result is True  # 하나라도 성공하면 True
    assert len(working.sent) == 1


def test_multi_reports_failure_when_all_fail():
    assert MultiNotifier([Recorder(fail=True), Recorder(fail=True)]).notify(
        Notification(title="t")
    ) is False


# --- 조립 --------------------------------------------------------------------


def base_settings(**kwargs) -> Settings:
    return Settings(_env_file=None, client_id="x", client_secret="y", **kwargs)


def test_build_without_config_returns_null():
    assert isinstance(build(base_settings()), NullNotifier)


def test_build_telegram_only():
    notifier = build(base_settings(telegram_bot_token="t", telegram_chat_id="c"))
    assert isinstance(notifier, TelegramNotifier)


def test_build_slack_only():
    notifier = build(base_settings(slack_webhook_url="https://hooks.slack.test/x"))
    assert isinstance(notifier, SlackNotifier)


def test_build_multi_when_both_configured():
    notifier = build(
        base_settings(
            telegram_bot_token="t",
            telegram_chat_id="c",
            slack_webhook_url="https://hooks.slack.test/x",
        )
    )
    assert isinstance(notifier, MultiNotifier)


def test_build_ignores_partial_telegram_config():
    """토큰만 있고 chat_id가 없으면 조용히 무시한다 (예외를 던지면 봇이 못 뜬다)."""
    assert isinstance(build(base_settings(telegram_bot_token="t")), NullNotifier)


def test_build_passes_throttle_setting():
    notifier = build(
        base_settings(
            telegram_bot_token="t", telegram_chat_id="c", notify_throttle_seconds=42
        )
    )
    assert notifier.throttle_seconds == 42
