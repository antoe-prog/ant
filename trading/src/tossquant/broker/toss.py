"""토스증권 Open API 클라이언트.

주의 — 엔드포인트 경로와 응답 필드명은 아래 ENDPOINTS / _pick 호출부에
격리해 두었다. 공식 문서(https://developers.tossinvest.com/docs)와 다르면
그 두 곳만 고치면 되고, 나머지 코드는 손댈 필요가 없다. 실제 응답을 확인하려면
`tossquant verify` 를 먼저 돌릴 것.
"""

from __future__ import annotations

import logging
import random
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from ..config import Settings
from ..models import (
    Account,
    Candle,
    Order,
    OrderRequest,
    OrderStatus,
    OrderType,
    Position,
    Quote,
    Side,
)
from ..ratelimit import RateLimiter
from .base import (
    Broker,
    BrokerError,
    CredentialsRejected,
    IPNotAllowed,
    OrderRejected,
)

log = logging.getLogger(__name__)

# --- 검증이 필요한 부분 1: 엔드포인트 경로 --------------------------------
ENDPOINTS = {
    "token": "/oauth2/token",
    "accounts": "/api/v1/accounts",
    "balance": "/api/v1/accounts/balance",
    "positions": "/api/v1/accounts/positions",
    "quote": "/api/v1/market/quotes/{symbol}",
    "candles": "/api/v1/market/candles/{symbol}",
    "orders": "/api/v1/orders",
    "order_detail": "/api/v1/orders/{order_id}",
}
# --------------------------------------------------------------------------

RETRY_STATUS = {429, 500, 502, 503, 504}
MAX_RETRIES = 4


def _pick(payload: dict[str, Any], *keys: str, default: Any = None) -> Any:
    """응답 필드명 후보 중 먼저 존재하는 값을 고른다.

    토스 응답이 camelCase/snake_case 중 무엇을 쓰는지, 데이터가 한 겹 감싸여
    오는지가 계정 롤아웃 단계마다 달라질 수 있어 방어적으로 읽는다.
    """
    for key in keys:
        if key in payload and payload[key] is not None:
            return payload[key]
    return default


def _unwrap(payload: Any) -> Any:
    """{"data": ...} / {"result": ...} 래퍼를 벗긴다."""
    while isinstance(payload, dict):
        for key in ("data", "result", "body", "output"):
            if key in payload and isinstance(payload[key], (dict, list)):
                payload = payload[key]
                break
        else:
            return payload
    return payload


def _dec(value: Any, default: str = "0") -> Decimal:
    if value is None:
        return Decimal(default)
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return Decimal(default)


def _ts(value: Any) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if isinstance(value, (int, float)):
        # 밀리초 에폭이면 초로 낮춘다.
        seconds = value / 1000 if value > 1e11 else value
        return datetime.fromtimestamp(seconds, tz=timezone.utc)
    text = str(value).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return datetime.now(timezone.utc)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# 응답 본문에서 IP 차단을 시사하는 표현. 토스가 어떤 문구를 쓰는지 확인되지
# 않아 후보를 여러 개 두되, 단어 경계를 지켜야 한다 — 맨 "ip"로 검색하면
# "description" 같은 흔한 단어에 걸려 자격증명 오류를 IP 문제로 오진한다.
IP_HINT_PATTERN = re.compile(
    r"\bip\b|allow[\s_-]?list|white[\s_-]?list|허용\s*ip|화이트리스트|ip[\s_-]?address",
    re.IGNORECASE,
)

PUBLIC_IP_SERVICES = (
    "https://api.ipify.org",
    "https://ifconfig.me/ip",
)


def public_ip(timeout: float = 3.0) -> str | None:
    """현재 나가는 공인 IP. 실패하면 None.

    IP 차단으로 막혔을 때 '어느 IP를 등록해야 하는지'를 바로 알려주기 위한
    것이다. 진단 경로에서만 호출하고, 실패해도 조용히 넘어간다 — 이것 때문에
    에러 메시지가 안 뜨면 본말전도다.
    """
    for url in PUBLIC_IP_SERVICES:
        try:
            response = httpx.get(url, timeout=timeout)
            if response.status_code < 400:
                candidate = response.text.strip()
                if candidate and len(candidate) <= 45:
                    return candidate
        except httpx.RequestError:
            continue
    return None


def classify_auth_failure(status: int, body: str) -> BrokerError:
    """인증 실패 원인을 추정한다.

    자격증명이 틀린 것과 IP가 막힌 것은 대처가 완전히 다르다. 전자는 키를 다시
    발급받아야 하고, 후자는 키가 멀쩡한데 접속 위치만 바꾸면 된다. 구분해 주지
    않으면 멀쩡한 키를 재발급하며 시간을 버리게 된다.
    """
    snippet = body[:300]

    if status == 403 or IP_HINT_PATTERN.search(body):
        current = public_ip()
        where = f"현재 IP는 {current} 입니다." if current else "현재 IP를 확인하지 못했습니다."
        return IPNotAllowed(
            f"인증 거부 ({status}). 허용 IP 목록 문제일 가능성이 높습니다.\n"
            f"  {where}\n"
            "  토스증권 WTS > 설정 > Open API > 허용 IP 관리 에서 이 IP를 추가하세요.\n"
            "  (집 인터넷은 유동 IP라 재접속 시 바뀔 수 있습니다.)\n"
            f"  서버 응답: {snippet}"
        )

    if status in (400, 401):
        return CredentialsRejected(
            f"자격증명 거부 ({status}). client_id/secret이 틀렸거나 키가 만료·폐기됐습니다.\n"
            "  토스증권 WTS > 설정 > Open API 에서 상태와 만료일을 확인하세요.\n"
            f"  서버 응답: {snippet}"
        )

    return BrokerError(f"토큰 발급 실패 ({status}): {snippet}")


class _Token:
    __slots__ = ("value", "expires_at")

    def __init__(self, value: str, expires_in: int) -> None:
        self.value = value
        # 만료 60초 전에 미리 갱신해 장중에 401로 끊기지 않게 한다.
        self.expires_at = datetime.now(timezone.utc) + timedelta(seconds=max(30, expires_in - 60))

    @property
    def valid(self) -> bool:
        return datetime.now(timezone.utc) < self.expires_at


class TossClient(Broker):
    """OAuth2 client_credentials 기반 REST 클라이언트."""

    def __init__(
        self,
        settings: Settings,
        client: httpx.Client | None = None,
        limiter: RateLimiter | None = None,
    ) -> None:
        settings.require_credentials()
        self.settings = settings
        self._limiter = limiter or RateLimiter.toss_defaults()
        self._client = client or httpx.Client(
            base_url=settings.base_url,
            timeout=settings.request_timeout,
        )
        self._token: _Token | None = None
        self._token_lock = threading.Lock()

    # --- 인증 -------------------------------------------------------------

    def _access_token(self) -> str:
        with self._token_lock:
            if self._token and self._token.valid:
                return self._token.value
            self._limiter.acquire("auth")
            response = self._client.post(
                ENDPOINTS["token"],
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.settings.client_id,
                    "client_secret": self.settings.client_secret,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if response.status_code >= 400:
                raise classify_auth_failure(response.status_code, response.text)
            payload = _unwrap(response.json())
            token = _pick(payload, "access_token", "accessToken")
            if not token:
                raise BrokerError(f"토큰 응답에 access_token이 없습니다: {payload}")
            expires_in = int(_pick(payload, "expires_in", "expiresIn", default=3600))
            self._token = _Token(token, expires_in)
            log.info("토스 액세스 토큰 발급 (만료 %ds)", expires_in)
            return self._token.value

    def _headers(self, *, with_account: bool = False) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._access_token()}",
            "Accept": "application/json",
        }
        if with_account:
            if not self.settings.account_id:
                raise BrokerError(
                    "TOSSQUANT_ACCOUNT_ID가 비어 있습니다. `tossquant verify`로 계좌 목록을 확인하세요."
                )
            headers["X-Tossinvest-Account"] = self.settings.account_id
        return headers

    # --- 요청 -------------------------------------------------------------

    def request(
        self,
        method: str,
        path: str,
        *,
        bucket: str,
        with_account: bool = False,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> Any:
        last_error: Exception | None = None
        for attempt in range(MAX_RETRIES):
            self._limiter.acquire(bucket)
            try:
                response = self._client.request(
                    method,
                    path,
                    params=params,
                    json=json,
                    headers=self._headers(with_account=with_account),
                )
            except httpx.RequestError as exc:  # 네트워크 오류
                last_error = exc
                self._backoff(attempt)
                continue

            if response.status_code == 401 and attempt < MAX_RETRIES - 1:
                # 토큰이 서버 쪽에서 무효화된 경우 한 번 더 발급받아 재시도.
                with self._token_lock:
                    self._token = None
                continue

            if response.status_code in RETRY_STATUS:
                last_error = BrokerError(
                    f"{method} {path} -> {response.status_code}: {response.text[:200]}"
                )
                self._backoff(attempt, response.headers.get("Retry-After"))
                continue

            if response.status_code == 403:
                # 토큰이 캐시된 뒤 IP가 바뀌면 토큰 발급이 아니라 여기서 막힌다.
                raise classify_auth_failure(403, response.text)

            if response.status_code >= 400:
                raise BrokerError(
                    f"{method} {path} -> {response.status_code}: {response.text[:300]}"
                )

            if not response.content:
                return {}
            return response.json()

        raise BrokerError(f"{method} {path} 재시도 {MAX_RETRIES}회 실패") from last_error

    @staticmethod
    def _backoff(attempt: int, retry_after: str | None = None) -> None:
        if retry_after:
            try:
                time.sleep(min(30.0, float(retry_after)))
                return
            except ValueError:
                pass
        delay = min(16.0, 2**attempt) * (0.5 + random.random() / 2)
        time.sleep(delay)

    # --- 시세 -------------------------------------------------------------

    def get_quote(self, symbol: str) -> Quote:
        raw = _unwrap(
            self.request(
                "GET",
                ENDPOINTS["quote"].format(symbol=symbol),
                bucket="market",
            )
        )
        if isinstance(raw, list):
            raw = raw[0] if raw else {}
        last = _dec(_pick(raw, "price", "last", "closePrice", "currentPrice", "trdPrc"))
        bid = _dec(_pick(raw, "bidPrice", "bid", "bestBid"), default=str(last))
        ask = _dec(_pick(raw, "askPrice", "ask", "bestAsk"), default=str(last))
        return Quote(
            symbol=symbol,
            last=last,
            bid=bid,
            ask=ask,
            ts=_ts(_pick(raw, "timestamp", "ts", "datetime", "tradeTime")),
        )

    def get_candles(self, symbol: str, interval: str, count: int) -> list[Candle]:
        raw = _unwrap(
            self.request(
                "GET",
                ENDPOINTS["candles"].format(symbol=symbol),
                bucket="market",
                params={"interval": interval, "count": count},
            )
        )
        rows = raw if isinstance(raw, list) else _pick(raw, "candles", "items", default=[])
        candles = [
            Candle(
                symbol=symbol,
                ts=_ts(_pick(row, "timestamp", "ts", "datetime", "date")),
                open=_dec(_pick(row, "open", "openPrice", "o")),
                high=_dec(_pick(row, "high", "highPrice", "h")),
                low=_dec(_pick(row, "low", "lowPrice", "l")),
                close=_dec(_pick(row, "close", "closePrice", "c")),
                volume=int(_dec(_pick(row, "volume", "vol", "v"))),
            )
            for row in rows
        ]
        candles.sort(key=lambda c: c.ts)
        return candles

    # --- 계좌 -------------------------------------------------------------

    def list_accounts(self) -> list[dict[str, Any]]:
        raw = _unwrap(self.request("GET", ENDPOINTS["accounts"], bucket="account"))
        if isinstance(raw, list):
            return raw
        return _pick(raw, "accounts", "items", default=[])

    def get_positions(self) -> dict[str, Position]:
        raw = _unwrap(
            self.request("GET", ENDPOINTS["positions"], bucket="account", with_account=True)
        )
        rows = raw if isinstance(raw, list) else _pick(raw, "positions", "items", default=[])
        positions: dict[str, Position] = {}
        for row in rows:
            symbol = str(_pick(row, "symbol", "ticker", "code", default="")).upper()
            quantity = int(_dec(_pick(row, "quantity", "qty", "balanceQty")))
            if not symbol or quantity == 0:
                continue
            positions[symbol] = Position(
                symbol=symbol,
                quantity=quantity,
                avg_price=_dec(_pick(row, "averagePrice", "avgPrice", "avgBuyPrice")),
            )
        return positions

    def get_account(self) -> Account:
        raw = _unwrap(
            self.request("GET", ENDPOINTS["balance"], bucket="account", with_account=True)
        )
        cash = _dec(
            _pick(raw, "cash", "availableCash", "orderableAmount", "depositAmount")
        )
        return Account(cash=cash, positions=self.get_positions())

    # --- 주문 -------------------------------------------------------------

    def place_order(self, request: OrderRequest) -> Order:
        body: dict[str, Any] = {
            "clientOrderId": request.client_order_id,
            "symbol": request.symbol,
            "side": request.side.value,
            "orderType": request.order_type.value,
            "quantity": request.quantity,
        }
        if request.order_type is OrderType.LIMIT:
            body["price"] = str(request.limit_price)

        raw = _unwrap(
            self.request(
                "POST", ENDPOINTS["orders"], bucket="order", with_account=True, json=body
            )
        )
        return self._parse_order(raw, request)

    def cancel_order(self, order_id: str) -> Order:
        raw = _unwrap(
            self.request(
                "DELETE",
                ENDPOINTS["order_detail"].format(order_id=order_id),
                bucket="order",
                with_account=True,
            )
        )
        return self._parse_order(raw, None, fallback_id=order_id)

    def _parse_order(
        self,
        raw: dict[str, Any],
        request: OrderRequest | None,
        fallback_id: str = "",
    ) -> Order:
        status_text = str(_pick(raw, "status", "orderStatus", default="NEW")).upper()
        try:
            status = OrderStatus(status_text)
        except ValueError:
            status = OrderStatus.NEW
        if status is OrderStatus.REJECTED and request is not None:
            raise OrderRejected(
                str(_pick(raw, "message", "rejectReason", default="unknown")), request
            )

        side_text = str(_pick(raw, "side", default=request.side.value if request else "BUY")).upper()
        return Order(
            order_id=str(_pick(raw, "orderId", "id", default=fallback_id)),
            client_order_id=str(
                _pick(
                    raw,
                    "clientOrderId",
                    default=request.client_order_id if request else "",
                )
            ),
            symbol=str(
                _pick(raw, "symbol", "ticker", default=request.symbol if request else "")
            ).upper(),
            side=Side(side_text) if side_text in Side.__members__ else Side.BUY,
            quantity=int(
                _dec(_pick(raw, "quantity", "qty", default=request.quantity if request else 0))
            ),
            filled_quantity=int(_dec(_pick(raw, "filledQuantity", "executedQty"))),
            avg_fill_price=_dec(_pick(raw, "averagePrice", "avgFillPrice", "executedPrice")),
            status=status,
            ts=_ts(_pick(raw, "timestamp", "createdAt", "orderTime")),
        )

    @property
    def is_live(self) -> bool:
        return True

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> TossClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
