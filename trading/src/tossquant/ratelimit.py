"""토큰 버킷 레이트 리미터.

토스 Open API는 호출 한도가 빡빡하고(계좌 조회는 초당 1회 수준) 초과 시 429를
돌려준다. 엔드포인트 그룹별로 버킷을 따로 두어 시세 폴링이 계좌 조회 한도를
잡아먹지 않게 한다.
"""

from __future__ import annotations

import threading
import time


class TokenBucket:
    def __init__(self, rate_per_sec: float, capacity: float | None = None) -> None:
        if rate_per_sec <= 0:
            raise ValueError("rate_per_sec must be positive")
        self.rate = rate_per_sec
        self.capacity = capacity if capacity is not None else max(1.0, rate_per_sec)
        self._tokens = self.capacity
        self._updated = time.monotonic()
        self._lock = threading.Lock()

    def _refill(self, now: float) -> None:
        elapsed = now - self._updated
        if elapsed > 0:
            self._tokens = min(self.capacity, self._tokens + elapsed * self.rate)
            self._updated = now

    def try_acquire(self, tokens: float = 1.0) -> bool:
        with self._lock:
            self._refill(time.monotonic())
            if self._tokens >= tokens:
                self._tokens -= tokens
                return True
            return False

    def acquire(self, tokens: float = 1.0, sleep=time.sleep) -> float:
        """토큰을 얻을 때까지 대기하고, 실제로 기다린 시간을 반환한다."""
        waited = 0.0
        while True:
            with self._lock:
                now = time.monotonic()
                self._refill(now)
                if self._tokens >= tokens:
                    self._tokens -= tokens
                    return waited
                deficit = tokens - self._tokens
                delay = deficit / self.rate
            sleep(delay)
            waited += delay


class RateLimiter:
    """이름 붙은 버킷 모음. 알 수 없는 이름은 기본 버킷으로 떨어진다."""

    def __init__(self, buckets: dict[str, TokenBucket], default: TokenBucket) -> None:
        self._buckets = buckets
        self._default = default

    def acquire(self, name: str) -> float:
        return self._buckets.get(name, self._default).acquire()

    @classmethod
    def toss_defaults(cls) -> RateLimiter:
        """공개된 한도 정보를 보수적으로 반영한 기본값.

        토스 측 공식 수치가 변경될 수 있으므로 여유 있게 잡았다. 429가 계속
        발생하면 이 값을 먼저 낮출 것.
        """
        return cls(
            buckets={
                "account": TokenBucket(rate_per_sec=0.8, capacity=1),
                "market": TokenBucket(rate_per_sec=4.0, capacity=8),
                "order": TokenBucket(rate_per_sec=2.0, capacity=4),
                "auth": TokenBucket(rate_per_sec=0.2, capacity=1),
            },
            default=TokenBucket(rate_per_sec=1.0, capacity=2),
        )
