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


def _strict_decimal_alias(
    payload: dict[str, Any],
    aliases: tuple[str, ...],
    *,
    context: str,
    required: bool,
    default: Decimal | None = None,
    positive: bool = False,
    nonnegative: bool = False,
) -> Decimal:
    """Parse a numeric response field without turning corruption into zero.

    Every present alias is checked.  Picking only the first alias would let a
    schema transition such as ``price=100, currentPrice=1`` pass silently.
    """
    fields = [
        (field, payload[field])
        for field in aliases
        if field in payload and payload[field] is not None
    ]
    label = "/".join(aliases)
    if not fields:
        if required:
            raise BrokerError(f"{context} {label}: 필수 값이 없습니다")
        if default is None:
            raise BrokerError(f"{context} {label}: 안전한 기본값이 없습니다")
        return default

    parsed: list[tuple[str, Decimal]] = []
    for field, raw in fields:
        if isinstance(raw, bool):
            raise BrokerError(f"{context} {field}: 숫자가 아닙니다: {raw!r}")
        try:
            value = Decimal(str(raw).strip())
        except (InvalidOperation, ValueError) as exc:
            raise BrokerError(
                f"{context} {field}: 숫자가 아닙니다: {raw!r}"
            ) from exc
        if not value.is_finite():
            raise BrokerError(f"{context} {field}: 유한값이어야 합니다")
        if positive and value <= 0:
            raise BrokerError(f"{context} {field}: 0보다 커야 합니다")
        if nonnegative and value < 0:
            raise BrokerError(f"{context} {field}: 음수일 수 없습니다")
        parsed.append((field, value))

    first_field, first_value = parsed[0]
    for field, value in parsed[1:]:
        if value != first_value:
            raise BrokerError(
                f"{context} {label}: 충돌하는 값 "
                f"{first_field}={first_value!r}, {field}={value!r}"
            )
    return first_value


def _strict_integer_alias(
    payload: dict[str, Any],
    aliases: tuple[str, ...],
    *,
    context: str,
    required: bool,
    default: int | None = None,
    minimum: int | None = None,
) -> int:
    decimal_default = Decimal(default) if default is not None else None
    value = _strict_decimal_alias(
        payload,
        aliases,
        context=context,
        required=required,
        default=decimal_default,
    )
    label = "/".join(aliases)
    if value != value.to_integral_value():
        raise BrokerError(f"{context} {label}: 정수여야 합니다")
    if minimum is not None and value < minimum:
        raise BrokerError(f"{context} {label}: {minimum} 이상이어야 합니다")
    if value > 2**63 - 1:
        raise BrokerError(f"{context} {label}: 지원하는 정수 범위를 벗어났습니다")
    return int(value)


def _strict_symbol_alias(
    payload: dict[str, Any], *, context: str, required: bool = True
) -> str:
    aliases = ("symbol", "ticker", "code")
    present = [
        (field, _normalized_symbol(payload[field]))
        for field in aliases
        if field in payload and payload[field] is not None
    ]
    if not present:
        if required:
            raise BrokerError(f"{context} symbol/ticker/code: 필수 값이 없습니다")
        return ""
    for field, value in present:
        if not value:
            raise BrokerError(f"{context} {field}: 빈 값일 수 없습니다")
    first_field, first_value = present[0]
    for field, value in present[1:]:
        if value != first_value:
            raise BrokerError(
                f"{context} symbol/ticker/code: 충돌하는 값 "
                f"{first_field}={first_value!r}, {field}={value!r}"
            )
    return first_value


def _ts(value: Any) -> datetime:
    """현재가·주문 이벤트 시각.

    이 둘은 응답 시각이 없으면 수신 시각을 쓰는 것이 안전하다. 과거 봉에는
    같은 대체 규칙을 쓰면 가짜 최신 봉이 생기므로 `_parse_candle`이 별도의
    엄격한 파서를 사용한다.
    """
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


def _candle_error(
    symbol: str, row_number: int, field: str, detail: str
) -> BrokerError:
    return BrokerError(f"{symbol} candle {row_number} {field}: {detail}")


def _candle_ts(value: Any, symbol: str, row_number: int) -> datetime:
    if value is None:
        raise _candle_error(symbol, row_number, "timestamp", "필수 값이 없습니다")
    try:
        if isinstance(value, bool):
            raise ValueError("bool은 timestamp가 아닙니다")
        if isinstance(value, (int, float)):
            seconds = value / 1000 if value > 1e11 else value
            parsed = datetime.fromtimestamp(seconds, tz=timezone.utc)
        else:
            text = str(value).strip()
            if not text:
                raise ValueError("빈 문자열입니다")
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            parsed = datetime.fromisoformat(text)
    except (OSError, OverflowError, TypeError, ValueError) as exc:
        raise _candle_error(
            symbol, row_number, "timestamp", f"잘못된 값 {value!r}"
        ) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _candle_decimal(
    row: dict[str, Any],
    aliases: tuple[str, ...],
    symbol: str,
    row_number: int,
    field: str,
) -> Decimal:
    raw = _pick(row, *aliases)
    if raw is None:
        raise _candle_error(symbol, row_number, field, "필수 값이 없습니다")
    try:
        value = Decimal(str(raw))
    except InvalidOperation as exc:
        raise _candle_error(
            symbol, row_number, field, f"숫자가 아닙니다: {raw!r}"
        ) from exc
    if not value.is_finite():
        raise _candle_error(symbol, row_number, field, "유한값이어야 합니다")
    if value <= 0:
        raise _candle_error(symbol, row_number, field, "0보다 커야 합니다")
    return value


def _candle_volume(
    row: dict[str, Any], symbol: str, row_number: int
) -> int:
    raw = _pick(row, "volume", "vol", "v")
    if raw is None:
        raise _candle_error(symbol, row_number, "volume", "필수 값이 없습니다")
    try:
        value = Decimal(str(raw))
    except InvalidOperation as exc:
        raise _candle_error(
            symbol, row_number, "volume", f"숫자가 아닙니다: {raw!r}"
        ) from exc
    if not value.is_finite():
        raise _candle_error(symbol, row_number, "volume", "유한값이어야 합니다")
    if value != value.to_integral_value():
        raise _candle_error(symbol, row_number, "volume", "정수여야 합니다")
    if value < 0:
        raise _candle_error(symbol, row_number, "volume", "음수일 수 없습니다")
    if value > 2**63 - 1:
        raise _candle_error(
            symbol, row_number, "volume", "지원하는 정수 범위를 벗어났습니다"
        )
    return int(value)


def _validate_candle_identifier(
    payload: dict[str, Any], symbol: str, row_number: int | None
) -> None:
    requested = symbol.strip().upper()
    for field in ("symbol", "ticker", "code"):
        if field not in payload or payload[field] is None:
            continue
        received = str(payload[field]).strip().upper()
        if received != requested:
            detail = (
                f"응답 종목 {received!r}이 요청 종목 {requested!r}과 다릅니다"
            )
            if row_number is None:
                raise BrokerError(f"{symbol} candle response {field}: {detail}")
            raise _candle_error(symbol, row_number, field, detail)


def _validate_candle_envelope_identifiers(payload: Any, symbol: str) -> None:
    current = payload
    while isinstance(current, dict):
        _validate_candle_identifier(current, symbol, None)
        for key in ("data", "result", "body", "output"):
            if key in current and isinstance(current[key], (dict, list)):
                current = current[key]
                break
        else:
            return


def _parse_candle(symbol: str, row_number: int, row: Any) -> Candle:
    if not isinstance(row, dict):
        raise _candle_error(symbol, row_number, "row", "객체여야 합니다")
    _validate_candle_identifier(row, symbol, row_number)
    open_ = _candle_decimal(
        row, ("open", "openPrice", "o"), symbol, row_number, "open"
    )
    high = _candle_decimal(
        row, ("high", "highPrice", "h"), symbol, row_number, "high"
    )
    low = _candle_decimal(
        row, ("low", "lowPrice", "l"), symbol, row_number, "low"
    )
    close = _candle_decimal(
        row, ("close", "closePrice", "c"), symbol, row_number, "close"
    )
    if not (low <= open_ <= high and low <= close <= high):
        raise _candle_error(
            symbol,
            row_number,
            "OHLC",
            "low <= open/close <= high 범위가 아닙니다",
        )
    return Candle(
        symbol=symbol,
        ts=_candle_ts(
            _pick(row, "timestamp", "ts", "datetime", "date"),
            symbol,
            row_number,
        ),
        open=open_,
        high=high,
        low=low,
        close=close,
        volume=_candle_volume(row, symbol, row_number),
    )


def _response_dict_chain(payload: Any) -> list[dict[str, Any]]:
    """Return every dictionary reachable through a supported wrapper key.

    ``_unwrap`` chooses one value for normal payload consumption, but response
    validation must not ignore a contradictory sibling wrapper.  Some broker
    rollouts have used more than one of ``data``/``result``/``body``/``output``
    at once.  Treat all explicitly supported wrappers as assertions about the
    same response and validate them before trusting the selected value.
    """
    envelopes: list[dict[str, Any]] = []
    pending: list[Any] = [payload]
    seen: set[int] = set()
    while pending:
        current = pending.pop()
        if not isinstance(current, dict) or id(current) in seen:
            continue
        seen.add(id(current))
        envelopes.append(current)
        children: list[Any] = []
        for key in ("data", "result", "body", "output"):
            value = current.get(key)
            if isinstance(value, dict):
                children.append(value)
            elif isinstance(value, list):
                children.extend(item for item in value if isinstance(item, dict))
        pending.extend(reversed(children))
    return envelopes


def _strict_decimal_alias_chain(
    payload: Any,
    aliases: tuple[str, ...],
    *,
    context: str,
    nonnegative: bool = False,
) -> Decimal:
    """래퍼 각 층의 숫자 alias를 모두 검증하고 하나의 값으로 대사한다."""
    observed: list[tuple[str, Decimal]] = []
    for depth, envelope in enumerate(_response_dict_chain(payload)):
        present = [
            field
            for field in aliases
            if field in envelope and envelope[field] is not None
        ]
        if not present:
            continue
        value = _strict_decimal_alias(
            envelope,
            aliases,
            context=context,
            required=True,
            nonnegative=nonnegative,
        )
        observed.append((f"wrapper[{depth}].{'/'.join(present)}", value))

    label = "/".join(aliases)
    if not observed:
        raise BrokerError(f"{context} {label}: 필수 값이 없습니다")
    first_field, first_value = observed[0]
    for field, value in observed[1:]:
        if value != first_value:
            raise BrokerError(
                f"{context} {label}: 충돌하는 wrapper 값 "
                f"{first_field}={first_value!r}, {field}={value!r}"
            )
    return first_value


def _normalized_symbol(value: Any) -> str:
    return str(value).strip().upper()


def _validate_response_symbol_identifiers(
    payload: dict[str, Any], requested_symbol: str, *, context: str
) -> None:
    requested = _normalized_symbol(requested_symbol)
    for field in ("symbol", "ticker", "code"):
        if field not in payload or payload[field] is None:
            continue
        received = _normalized_symbol(payload[field])
        if received != requested:
            raise BrokerError(
                f"{requested_symbol} {context} {field}: 응답 종목 "
                f"{received!r}이 요청 종목 {requested!r}과 다릅니다"
            )


def _order_response_quantity(value: Any, field: str) -> Decimal:
    if isinstance(value, bool):
        raise BrokerError(f"order response {field}: 정수 수량이 아닙니다: {value!r}")
    try:
        parsed = Decimal(str(value).strip())
    except (InvalidOperation, ValueError) as exc:
        raise BrokerError(
            f"order response {field}: 정수 수량이 아닙니다: {value!r}"
        ) from exc
    if not parsed.is_finite() or parsed != parsed.to_integral_value():
        raise BrokerError(f"order response {field}: 정수 수량이 아닙니다: {value!r}")
    return parsed


def _validate_order_response_identity(
    payload: dict[str, Any], request: OrderRequest
) -> None:
    _validate_response_symbol_identifiers(
        payload, request.symbol, context="order response"
    )

    for field in ("clientOrderId", "client_order_id"):
        if payload.get(field) is None:
            continue
        received_client_order_id = str(payload[field])
        if received_client_order_id != request.client_order_id:
            raise BrokerError(
                f"order response {field}: "
                f"{received_client_order_id!r}이 요청 값 "
                f"{request.client_order_id!r}과 다릅니다"
            )

    if payload.get("side") is not None:
        received_side = str(payload["side"]).strip().upper()
        if received_side != request.side.value:
            raise BrokerError(
                f"order response side: {received_side!r}이 요청 값 "
                f"{request.side.value!r}과 다릅니다"
            )

    for field in ("quantity", "qty"):
        if payload.get(field) is None:
            continue
        received_quantity = _order_response_quantity(payload[field], field)
        if received_quantity != request.quantity:
            raise BrokerError(
                f"order response {field}: {received_quantity!r}이 요청 값 "
                f"{request.quantity!r}과 다릅니다"
            )

    for field in ("orderType", "order_type"):
        if payload.get(field) is None:
            continue
        received_order_type = str(payload[field]).strip().upper()
        if received_order_type != request.order_type.value:
            raise BrokerError(
                f"order response {field}: {received_order_type!r}이 요청 값 "
                f"{request.order_type.value!r}과 다릅니다"
            )

    if request.order_type is OrderType.LIMIT:
        echoed_price = _strict_decimal_alias(
            payload,
            ("price", "limitPrice", "limit_price"),
            context="order response",
            required=False,
            default=request.limit_price,
            positive=True,
        )
        if echoed_price != request.limit_price:
            raise BrokerError(
                "order response price/limitPrice/limit_price: "
                f"{echoed_price!r}이 요청 값 {request.limit_price!r}과 다릅니다"
            )


def _parse_order_status(raw: dict[str, Any]) -> OrderStatus:
    statuses: list[tuple[str, OrderStatus]] = []
    for field in ("status", "orderStatus"):
        if field not in raw or raw[field] is None:
            continue
        value = str(raw[field]).strip().upper()
        try:
            status = OrderStatus(value)
        except ValueError as exc:
            raise BrokerError(
                f"order response status: 알 수 없는 {field} 값 {raw[field]!r}"
            ) from exc
        statuses.append((field, status))

    if not statuses:
        raise BrokerError("order response status: 필수 값이 없습니다")
    first_field, first_status = statuses[0]
    for field, status in statuses[1:]:
        if status is not first_status:
            raise BrokerError(
                "order response status: 충돌하는 상태 값 "
                f"{first_field}={first_status.value!r}, {field}={status.value!r}"
            )
    return first_status


def _parse_order_id(
    raw: dict[str, Any],
    *,
    context: str,
    required: bool,
    fallback: str = "",
    expected: str | None = None,
) -> str:
    identifiers = [
        (field, str(raw[field]).strip())
        for field in ("orderId", "id")
        if field in raw and raw[field] is not None
    ]
    if not identifiers:
        if required and not fallback:
            raise BrokerError(f"{context} orderId/id: 필수 값이 없습니다")
        return fallback
    for field, value in identifiers:
        if not value:
            raise BrokerError(f"{context} {field}: 빈 값일 수 없습니다")
        if expected is not None and value != expected:
            raise BrokerError(
                f"{context} {field}: {value!r}이 요청 값 {expected!r}과 다릅니다"
            )
    first_field, first_value = identifiers[0]
    for field, value in identifiers[1:]:
        if value != first_value:
            raise BrokerError(
                f"{context} orderId/id: 충돌하는 값 "
                f"{first_field}={first_value!r}, {field}={value!r}"
            )
    return first_value


def _parse_cancel_side(raw: dict[str, Any]) -> Side:
    if "side" not in raw or raw["side"] is None:
        raise BrokerError("cancel response side: 필수 값이 없습니다")
    value = str(raw["side"]).strip().upper()
    try:
        return Side(value)
    except ValueError as exc:
        raise BrokerError(
            f"cancel response side: 알 수 없는 값 {raw['side']!r}"
        ) from exc


def _parse_optional_client_order_id(raw: dict[str, Any], *, context: str) -> str:
    identifiers = [
        (field, str(raw[field]))
        for field in ("clientOrderId", "client_order_id")
        if field in raw and raw[field] is not None
    ]
    if not identifiers:
        return ""
    first_field, first_value = identifiers[0]
    for field, value in identifiers[1:]:
        if value != first_value:
            raise BrokerError(
                f"{context} clientOrderId/client_order_id: 충돌하는 값 "
                f"{first_field}={first_value!r}, {field}={value!r}"
            )
    return first_value


def _validate_order_wrapper_consistency(payload: Any, *, context: str) -> None:
    """Reconcile authoritative order state repeated across wrapper envelopes."""
    observations: dict[str, list[tuple[str, Any]]] = {
        "orderId/id": [],
        "status/orderStatus": [],
        "filledQuantity/executedQty": [],
        "averagePrice/avgFillPrice/executedPrice": [],
    }
    for index, envelope in enumerate(_response_dict_chain(payload)):
        location = f"wrapper[{index}]"
        explicit_order_fields = (
            "orderId",
            "clientOrderId",
            "client_order_id",
            "symbol",
            "ticker",
            "code",
            "side",
            "quantity",
            "qty",
            "orderType",
            "order_type",
            "limitPrice",
            "limit_price",
            "filledQuantity",
            "executedQty",
            "averagePrice",
            "avgFillPrice",
            "executedPrice",
        )
        has_explicit_order_field = any(
            envelope.get(field) is not None for field in explicit_order_fields
        )
        has_order_status = any(
            str(envelope[field]).strip().upper()
            in {status.value for status in OrderStatus}
            for field in ("status", "orderStatus")
            if envelope.get(field) is not None
        )
        # A transport wrapper may legitimately use ``status=SUCCESS`` (and a
        # generic trace ``id``).  Only envelopes that assert an order field or
        # a real OrderStatus participate in order-state reconciliation.
        if not has_explicit_order_field and not has_order_status:
            continue
        try:
            if any(
                envelope.get(field) is not None for field in ("orderId", "id")
            ):
                observations["orderId/id"].append(
                    (
                        location,
                        _parse_order_id(
                            envelope,
                            context=context,
                            required=True,
                        ),
                    )
                )
            if any(
                envelope.get(field) is not None
                for field in ("status", "orderStatus")
            ):
                observations["status/orderStatus"].append(
                    (location, _parse_order_status(envelope))
                )
            if any(
                envelope.get(field) is not None
                for field in ("filledQuantity", "executedQty")
            ):
                observations["filledQuantity/executedQty"].append(
                    (
                        location,
                        _strict_integer_alias(
                            envelope,
                            ("filledQuantity", "executedQty"),
                            context=context,
                            required=True,
                            minimum=0,
                        ),
                    )
                )
            if any(
                envelope.get(field) is not None
                for field in ("averagePrice", "avgFillPrice", "executedPrice")
            ):
                observations[
                    "averagePrice/avgFillPrice/executedPrice"
                ].append(
                    (
                        location,
                        _strict_decimal_alias(
                            envelope,
                            ("averagePrice", "avgFillPrice", "executedPrice"),
                            context=context,
                            required=True,
                            nonnegative=True,
                        ),
                    )
                )
        except BrokerError as exc:
            raise BrokerError(
                f"{context} {location}: authoritative wrapper를 확정할 수 "
                f"없습니다 — reconciliation required: {exc}"
            ) from exc

    for label, values in observations.items():
        if len(values) < 2:
            continue
        first_location, first_value = values[0]
        for location, value in values[1:]:
            if value != first_value:
                raise BrokerError(
                    f"{context} {label}: 충돌하는 authoritative wrapper 값 "
                    f"{first_location}={first_value!r}, {location}={value!r} — "
                    "reconciliation required"
                )


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
        method = method.upper()
        read_only = method in {"GET", "HEAD", "OPTIONS"}
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
                if not read_only:
                    raise BrokerError(
                        f"{method} {path} 응답을 받지 못해 결과를 알 수 없습니다. "
                        "중복 주문/취소를 막기 위해 자동 재시도하지 않습니다. "
                        "토스 주문 내역에서 상태를 확인하세요."
                    ) from exc
                last_error = exc
                self._backoff(attempt)
                continue

            if response.status_code == 401 and attempt < MAX_RETRIES - 1:
                # 토큰이 서버 쪽에서 무효화된 경우 한 번 더 발급받아 재시도.
                with self._token_lock:
                    self._token = None
                continue

            if response.status_code in RETRY_STATUS:
                if not read_only:
                    raise BrokerError(
                        f"{method} {path} -> {response.status_code}: 결과를 알 수 없어 "
                        "중복 주문/취소를 막기 위해 자동 재시도하지 않습니다. "
                        "토스 주문 내역에서 상태를 확인하세요."
                    )
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
        payload = self.request(
            "GET",
            ENDPOINTS["quote"].format(symbol=symbol),
            bucket="market",
        )
        for envelope in _response_dict_chain(payload):
            _validate_response_symbol_identifiers(
                envelope, symbol, context="quote response"
            )
        raw = _unwrap(payload)
        if isinstance(raw, list):
            raw = raw[0] if raw else {}
        if not isinstance(raw, dict):
            raise BrokerError(f"{symbol} quote response: 객체가 아닙니다")
        _validate_response_symbol_identifiers(raw, symbol, context="quote response")
        last = _strict_decimal_alias(
            raw,
            ("price", "last", "closePrice", "currentPrice", "trdPrc"),
            context=f"{symbol} quote response",
            required=True,
            positive=True,
        )
        bid = _strict_decimal_alias(
            raw,
            ("bidPrice", "bid", "bestBid"),
            context=f"{symbol} quote response",
            required=False,
            default=last,
            positive=True,
        )
        ask = _strict_decimal_alias(
            raw,
            ("askPrice", "ask", "bestAsk"),
            context=f"{symbol} quote response",
            required=False,
            default=last,
            positive=True,
        )
        if bid > ask:
            raise BrokerError(
                f"{symbol} quote response bid/ask: crossed book "
                f"bid={bid!r} > ask={ask!r}"
            )
        return Quote(
            symbol=symbol,
            last=last,
            bid=bid,
            ask=ask,
            ts=_ts(_pick(raw, "timestamp", "ts", "datetime", "tradeTime")),
        )

    def get_candles(self, symbol: str, interval: str, count: int) -> list[Candle]:
        payload = self.request(
            "GET",
            ENDPOINTS["candles"].format(symbol=symbol),
            bucket="market",
            params={"interval": interval, "count": count},
        )
        _validate_candle_envelope_identifiers(payload, symbol)
        raw = _unwrap(payload)
        if isinstance(raw, list):
            rows = raw
        elif isinstance(raw, dict):
            if "candles" in raw:
                rows = raw["candles"]
            elif "items" in raw:
                rows = raw["items"]
            else:
                raise BrokerError(
                    f"{symbol} candle response: candles/items 필드가 없습니다"
                )
        else:
            raise BrokerError(f"{symbol} candle response: 배열이나 객체가 아닙니다")
        if not isinstance(rows, list):
            raise BrokerError(f"{symbol} candle response: candles/items가 배열이 아닙니다")
        candles: list[Candle] = []
        seen: dict[datetime, int] = {}
        for row_number, row in enumerate(rows, start=1):
            candle = _parse_candle(symbol, row_number, row)
            if candle.ts in seen:
                raise BrokerError(
                    f"{symbol} candle {row_number} duplicate timestamp "
                    f"{candle.ts.isoformat()} (first row {seen[candle.ts]})"
                )
            seen[candle.ts] = row_number
            candles.append(candle)
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
        if isinstance(raw, list):
            rows = raw
        elif isinstance(raw, dict):
            collections = [
                (field, raw[field])
                for field in ("positions", "items")
                if field in raw and raw[field] is not None
            ]
            if not collections:
                raise BrokerError(
                    "position response: positions/items 필드가 없습니다"
                )
            if len(collections) > 1 and collections[0][1] != collections[1][1]:
                raise BrokerError(
                    "position response: 충돌하는 positions/items 값입니다"
                )
            rows = collections[0][1]
        else:
            raise BrokerError("position response: 배열이나 객체가 아닙니다")
        if not isinstance(rows, list):
            raise BrokerError("position response: positions/items가 배열이 아닙니다")
        positions: dict[str, Position] = {}
        for row_number, row in enumerate(rows, start=1):
            context = f"position {row_number}"
            if not isinstance(row, dict):
                raise BrokerError(f"{context} row: 객체여야 합니다")
            symbol = _strict_symbol_alias(row, context=context)
            quantity = _strict_integer_alias(
                row,
                ("quantity", "qty", "balanceQty"),
                context=context,
                required=True,
                minimum=0,
            )
            if quantity == 0:
                continue
            avg_price = _strict_decimal_alias(
                row,
                ("averagePrice", "avgPrice", "avgBuyPrice"),
                context=context,
                required=True,
                nonnegative=True,
            )
            if symbol in positions:
                raise BrokerError(
                    f"{context} duplicate symbol {symbol!r}"
                )
            positions[symbol] = Position(
                symbol=symbol,
                quantity=quantity,
                avg_price=avg_price,
            )
        return positions

    def get_account(self) -> Account:
        payload = self.request(
            "GET", ENDPOINTS["balance"], bucket="account", with_account=True
        )
        raw = _unwrap(payload)
        if not isinstance(raw, dict):
            raise BrokerError("balance response: 객체가 아닙니다")
        # 실제 스키마 확인 전에는 이 이름들을 같은 의미의 후보로만 취급한다.
        # 둘 이상이 동시에 오는데 값이 다르면 어느 값이 주문 가능 현금인지
        # 추측하지 않고 중단한다.
        cash = _strict_decimal_alias_chain(
            payload,
            ("cash", "availableCash", "orderableAmount", "depositAmount"),
            context="balance response",
            nonnegative=True,
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

        payload = self.request(
            "POST", ENDPOINTS["orders"], bucket="order", with_account=True, json=body
        )
        _validate_order_wrapper_consistency(payload, context="order response")
        for envelope in _response_dict_chain(payload):
            _validate_order_response_identity(envelope, request)
        raw = _unwrap(payload)
        return self._parse_order(raw, request)

    def cancel_order(self, order_id: str) -> Order:
        payload = self.request(
            "DELETE",
            ENDPOINTS["order_detail"].format(order_id=order_id),
            bucket="order",
            with_account=True,
        )
        _validate_order_wrapper_consistency(payload, context="cancel response")
        # A wrapper may echo the target even when the inner order object does not.
        # Never accept a contradictory explicit orderId/id from any level.
        for envelope in _response_dict_chain(payload):
            _parse_order_id(
                envelope,
                context="cancel response",
                required=False,
                expected=order_id,
            )
        raw = _unwrap(payload)
        return self._parse_order(raw, None, fallback_id=order_id)

    def _parse_order(
        self,
        raw: dict[str, Any],
        request: OrderRequest | None,
        fallback_id: str = "",
    ) -> Order:
        if not isinstance(raw, dict):
            raise BrokerError("order response: 객체가 아닙니다")
        if request is not None:
            _validate_order_response_identity(raw, request)
        status = _parse_order_status(raw)
        if status is OrderStatus.REJECTED and request is not None:
            try:
                rejected_filled = _strict_integer_alias(
                    raw,
                    ("filledQuantity", "executedQty"),
                    context="order response",
                    required=True,
                    minimum=0,
                )
                rejected_average = _strict_decimal_alias(
                    raw,
                    ("averagePrice", "avgFillPrice", "executedPrice"),
                    context="order response",
                    required=True,
                    nonnegative=True,
                )
            except BrokerError as exc:
                raise BrokerError(
                    "order response REJECTED 체결 상태를 확정할 수 없습니다 — "
                    f"reconciliation required: {exc}"
                ) from exc
            if rejected_filled != 0 or rejected_average != 0:
                raise BrokerError(
                    "order response REJECTED인데 체결 수량/평균가가 "
                    f"{rejected_filled}/{rejected_average}입니다 — "
                    "reconciliation required"
                )
            raise OrderRejected(
                str(_pick(raw, "message", "rejectReason", default="unknown")), request
            )

        context = "order response" if request is not None else "cancel response"
        if request is not None:
            order_id = _parse_order_id(
                raw,
                context=context,
                required=True,
            )
            client_order_id = request.client_order_id
            symbol = request.symbol
            side = request.side
            quantity = request.quantity
        else:
            order_id = _parse_order_id(
                raw,
                context=context,
                required=False,
                fallback=fallback_id,
                expected=fallback_id,
            )
            client_order_id = _parse_optional_client_order_id(raw, context=context)
            symbol = _strict_symbol_alias(raw, context=context)
            side = _parse_cancel_side(raw)
            quantity = _strict_integer_alias(
                raw,
                ("quantity", "qty"),
                context=context,
                required=True,
                minimum=1,
            )

        filled_required = status in {
            OrderStatus.FILLED,
            OrderStatus.PARTIALLY_FILLED,
            OrderStatus.CANCELED,
        } or request is None
        try:
            filled_quantity = _strict_integer_alias(
                raw,
                ("filledQuantity", "executedQty"),
                context=context,
                required=filled_required,
                default=0,
                minimum=0,
            )
            if filled_quantity > quantity:
                raise BrokerError(
                    f"{context} filledQuantity/executedQty: {filled_quantity}이 "
                    f"주문 수량 {quantity}보다 큽니다"
                )
            if status is OrderStatus.FILLED and filled_quantity != quantity:
                raise BrokerError(
                    f"{context} status/filledQuantity: FILLED인데 체결 수량 "
                    f"{filled_quantity}이 주문 수량 {quantity}과 다릅니다"
                )
            if status is OrderStatus.PARTIALLY_FILLED and not (
                0 < filled_quantity < quantity
            ):
                raise BrokerError(
                    f"{context} status/filledQuantity: PARTIALLY_FILLED 수량이 "
                    f"0과 주문 수량 {quantity} 사이가 아닙니다"
                )
            if status is OrderStatus.NEW and filled_quantity != 0:
                raise BrokerError(
                    f"{context} status/filledQuantity: NEW인데 체결 수량이 "
                    f"{filled_quantity}입니다"
                )

            avg_fill_price = _strict_decimal_alias(
                raw,
                ("averagePrice", "avgFillPrice", "executedPrice"),
                context=context,
                required=(
                    filled_quantity > 0 or status is OrderStatus.CANCELED
                ),
                default=Decimal("0"),
                positive=filled_quantity > 0,
                nonnegative=filled_quantity == 0,
            )
            if (
                status is OrderStatus.CANCELED
                and filled_quantity == 0
                and avg_fill_price != 0
            ):
                raise BrokerError(
                    f"{context} CANCELED zero-fill 평균가는 0이어야 합니다: "
                    f"{avg_fill_price}"
                )
        except BrokerError as exc:
            if status is OrderStatus.CANCELED:
                raise BrokerError(
                    f"{context} CANCELED 체결 상태를 확정할 수 없습니다 — "
                    f"reconciliation required: {exc}"
                ) from exc
            raise

        return Order(
            order_id=order_id,
            client_order_id=client_order_id,
            symbol=symbol,
            side=side,
            quantity=quantity,
            filled_quantity=filled_quantity,
            avg_fill_price=avg_fill_price,
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
