"""알림.

밤 11시 반에 도는 봇이라 로그를 실시간으로 볼 수 없다. 손절이 발동했는지,
주문이 거부됐는지, 봇이 죽었는지를 손에 들고 있는 기기로 받아야 한다.

## 설계 원칙 세 가지

1. **알림 실패는 절대 매매를 막지 않는다.** `notify()`는 어떤 경우에도 예외를
   던지지 않는다. 텔레그램이 죽어도 봇은 계속 돌아야 한다.
2. **스팸 방지.** 사이클 오류는 매 분 반복될 수 있다. `dedup_key`가 같은 알림은
   throttle 구간 안에서 한 번만 나간다.
3. **짧은 타임아웃.** 매매 루프를 오래 붙잡으면 안 되므로 5초로 끊는다.
"""

from __future__ import annotations

import logging
import threading
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum

import httpx

log = logging.getLogger(__name__)

TIMEOUT = 5.0


class Level(str, Enum):
    INFO = "INFO"
    WARN = "WARN"
    ERROR = "ERROR"


ICONS = {Level.INFO: "✅", Level.WARN: "⚠️", Level.ERROR: "🚨"}


@dataclass(frozen=True)
class Notification:
    title: str
    lines: list[str] = field(default_factory=list)
    level: Level = Level.INFO
    # 같은 키를 가진 알림은 throttle 구간 안에서 한 번만 전송된다.
    # None이면 항상 전송 (체결처럼 매번 알아야 하는 것).
    dedup_key: str | None = None

    def render(self) -> str:
        head = f"{ICONS[self.level]} {self.title}"
        return "\n".join([head, *self.lines]) if self.lines else head


class Notifier(ABC):
    """전송 실패와 스로틀링을 여기서 흡수한다. 구현체는 _deliver만 신경 쓴다."""

    def __init__(self, throttle_seconds: int = 300) -> None:
        self.throttle_seconds = throttle_seconds
        self._last_sent: dict[str, float] = {}
        self._lock = threading.Lock()

    def notify(self, notification: Notification) -> bool:
        """전송 성공 여부. 예외는 절대 밖으로 나가지 않는다."""
        if self._throttled(notification.dedup_key):
            log.debug("알림 스로틀됨: %s", notification.dedup_key)
            return False
        try:
            self._deliver(notification)
            return True
        except Exception as exc:  # 알림 실패로 매매가 멈추면 안 된다
            log.warning("알림 전송 실패 (%s): %s", type(self).__name__, exc)
            return False

    def _throttled(self, key: str | None) -> bool:
        if key is None or self.throttle_seconds <= 0:
            return False
        now = time.monotonic()
        with self._lock:
            last = self._last_sent.get(key)
            if last is not None and now - last < self.throttle_seconds:
                return True
            self._last_sent[key] = now
            return False

    @abstractmethod
    def _deliver(self, notification: Notification) -> None: ...

    def close(self) -> None:
        """자원 정리. 기본은 아무것도 하지 않는다."""


class NullNotifier(Notifier):
    """알림을 설정하지 않았을 때의 기본값."""

    def _deliver(self, notification: Notification) -> None:
        log.debug("알림(비활성): %s", notification.title)

    def notify(self, notification: Notification) -> bool:
        return False


class ConsoleNotifier(Notifier):
    """설정 없이 동작을 확인하거나 로컬에서 돌릴 때 쓴다."""

    def _deliver(self, notification: Notification) -> None:
        print(notification.render(), flush=True)


class TelegramNotifier(Notifier):
    API = "https://api.telegram.org"

    def __init__(
        self,
        token: str,
        chat_id: str,
        throttle_seconds: int = 300,
        client: httpx.Client | None = None,
    ) -> None:
        super().__init__(throttle_seconds)
        if not token or not chat_id:
            raise ValueError("텔레그램 봇 토큰과 chat_id가 모두 필요합니다")
        self.token = token
        self.chat_id = chat_id
        self._client = client or httpx.Client(timeout=TIMEOUT)

    def _deliver(self, notification: Notification) -> None:
        response = self._client.post(
            f"{self.API}/bot{self.token}/sendMessage",
            json={
                "chat_id": self.chat_id,
                "text": notification.render(),
                "disable_web_page_preview": True,
            },
        )
        if response.status_code >= 400:
            raise RuntimeError(f"{response.status_code}: {response.text[:200]}")

    def close(self) -> None:
        self._client.close()


class SlackNotifier(Notifier):
    def __init__(
        self,
        webhook_url: str,
        throttle_seconds: int = 300,
        client: httpx.Client | None = None,
    ) -> None:
        super().__init__(throttle_seconds)
        if not webhook_url:
            raise ValueError("Slack webhook URL이 필요합니다")
        self.webhook_url = webhook_url
        self._client = client or httpx.Client(timeout=TIMEOUT)

    def _deliver(self, notification: Notification) -> None:
        response = self._client.post(
            self.webhook_url, json={"text": notification.render()}
        )
        if response.status_code >= 400:
            raise RuntimeError(f"{response.status_code}: {response.text[:200]}")

    def close(self) -> None:
        self._client.close()


class MultiNotifier(Notifier):
    """여러 채널로 동시에 보낸다. 하나가 실패해도 나머지는 계속 간다."""

    def __init__(self, notifiers: list[Notifier]) -> None:
        # 스로틀링은 각 하위 notifier가 담당하므로 여기선 끈다.
        super().__init__(throttle_seconds=0)
        self._notifiers = notifiers

    def notify(self, notification: Notification) -> bool:
        results = [n.notify(notification) for n in self._notifiers]
        return any(results)

    def _deliver(self, notification: Notification) -> None:  # pragma: no cover
        raise NotImplementedError("MultiNotifier는 notify를 직접 구현한다")

    def close(self) -> None:
        for notifier in self._notifiers:
            notifier.close()


def build(settings) -> Notifier:
    """설정에서 알림 채널을 조립한다. 아무것도 설정 안 했으면 NullNotifier."""
    channels: list[Notifier] = []
    throttle = settings.notify_throttle_seconds

    if settings.telegram_bot_token and settings.telegram_chat_id:
        channels.append(
            TelegramNotifier(
                settings.telegram_bot_token, settings.telegram_chat_id, throttle
            )
        )
    if settings.slack_webhook_url:
        channels.append(SlackNotifier(settings.slack_webhook_url, throttle))

    if not channels:
        return NullNotifier()
    if len(channels) == 1:
        return channels[0]
    return MultiNotifier(channels)
