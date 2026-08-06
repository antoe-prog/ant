"""TossClient 테스트.

실제 응답 스키마를 확정할 수 없는 상태이므로, 여기서는 클라이언트가
"어떤 형태로 와도 무너지지 않는지"(래핑/케이스 변형)와 토큰·재시도·헤더 같은
운영상 중요한 동작을 검증한다. 실제 필드명 확인은 `tossquant verify` 몫이다.
"""

from __future__ import annotations

from decimal import Decimal

import httpx
import pytest
import respx

from tossquant.broker.base import BrokerError
from tossquant.broker.toss import TossClient
from tossquant.models import OrderRequest, OrderStatus, Side
from tossquant.ratelimit import RateLimiter, TokenBucket

BASE = "https://openapi.tossinvest.com"


def fast_limiter() -> RateLimiter:
    """테스트가 레이트리밋 때문에 느려지지 않게 한다."""
    return RateLimiter(buckets={}, default=TokenBucket(10_000, capacity=10_000))


@pytest.fixture
def client(settings):
    settings.base_url = BASE
    return TossClient(settings, limiter=fast_limiter())


def mock_token(expires_in: int = 3600):
    return respx.post(f"{BASE}/oauth2/token").mock(
        return_value=httpx.Response(
            200, json={"access_token": "tok-abc", "expires_in": expires_in}
        )
    )


def test_missing_credentials_raise(settings):
    settings.client_id = ""
    with pytest.raises(RuntimeError, match="TOSSQUANT_CLIENT_ID"):
        TossClient(settings)


@respx.mock
def test_token_is_fetched_once_and_reused(client):
    route = mock_token()
    respx.get(f"{BASE}/api/v1/accounts").mock(
        return_value=httpx.Response(200, json={"data": [{"id": "acct-1"}]})
    )

    client.list_accounts()
    client.list_accounts()

    assert route.call_count == 1


@respx.mock
def test_token_failure_surfaces(client):
    respx.post(f"{BASE}/oauth2/token").mock(
        return_value=httpx.Response(401, text="bad client")
    )
    with pytest.raises(BrokerError, match="토큰 발급 실패"):
        client.list_accounts()


@respx.mock
def test_bearer_and_account_headers_are_sent(client):
    mock_token()
    route = respx.get(f"{BASE}/api/v1/accounts/positions").mock(
        return_value=httpx.Response(200, json={"positions": []})
    )

    client.get_positions()

    request = route.calls[0].request
    assert request.headers["Authorization"] == "Bearer tok-abc"
    assert request.headers["X-Tossinvest-Account"] == "test-account"


@respx.mock
def test_account_header_missing_is_a_clear_error(settings):
    settings.base_url = BASE
    settings.account_id = ""
    client = TossClient(settings, limiter=fast_limiter())
    mock_token()

    with pytest.raises(BrokerError, match="TOSSQUANT_ACCOUNT_ID"):
        client.get_positions()


@respx.mock
def test_quote_parses_camel_case(client):
    mock_token()
    respx.get(f"{BASE}/api/v1/market/quotes/AAPL").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "price": "231.45",
                    "bidPrice": "231.40",
                    "askPrice": "231.50",
                    "timestamp": "2026-08-06T14:30:00Z",
                }
            },
        )
    )

    quote = client.get_quote("AAPL")

    assert quote.last == Decimal("231.45")
    assert quote.bid == Decimal("231.40")
    assert quote.ask == Decimal("231.50")
    assert quote.mid == Decimal("231.45")


@respx.mock
def test_quote_falls_back_to_last_when_no_book(client):
    mock_token()
    respx.get(f"{BASE}/api/v1/market/quotes/AAPL").mock(
        return_value=httpx.Response(200, json={"closePrice": 100})
    )

    quote = client.get_quote("AAPL")

    assert quote.last == Decimal("100")
    assert quote.bid == quote.ask == Decimal("100")


@respx.mock
def test_candles_are_sorted_oldest_first(client):
    mock_token()
    respx.get(f"{BASE}/api/v1/market/candles/AAPL").mock(
        return_value=httpx.Response(
            200,
            json=[
                {"timestamp": "2026-08-05T00:00:00Z", "open": 2, "high": 2, "low": 2, "close": 2, "volume": 20},
                {"timestamp": "2026-08-03T00:00:00Z", "open": 1, "high": 1, "low": 1, "close": 1, "volume": 10},
            ],
        )
    )

    candles = client.get_candles("AAPL", "1d", 2)

    assert [c.close for c in candles] == [Decimal("1"), Decimal("2")]


@respx.mock
def test_candles_accept_epoch_millis(client):
    mock_token()
    respx.get(f"{BASE}/api/v1/market/candles/AAPL").mock(
        return_value=httpx.Response(
            200, json={"candles": [{"ts": 1785000000000, "c": 10, "v": 5}]}
        )
    )

    candles = client.get_candles("AAPL", "1d", 1)

    assert candles[0].close == Decimal("10")
    assert candles[0].ts.year == 2026


@respx.mock
def test_positions_skip_zero_quantity(client):
    mock_token()
    respx.get(f"{BASE}/api/v1/accounts/positions").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {"symbol": "aapl", "quantity": 10, "averagePrice": "200.5"},
                    {"symbol": "MSFT", "quantity": 0, "averagePrice": "0"},
                ]
            },
        )
    )

    positions = client.get_positions()

    assert set(positions) == {"AAPL"}
    assert positions["AAPL"].avg_price == Decimal("200.5")


@respx.mock
def test_place_order_body_and_parsing(client):
    mock_token()
    route = respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(
            200,
            json={
                "orderId": "ord-9",
                "status": "FILLED",
                "filledQuantity": 3,
                "averagePrice": "231.50",
            },
        )
    )

    request = OrderRequest(symbol="AAPL", side=Side.BUY, quantity=3)
    order = client.place_order(request)

    body = route.calls[0].request.content.decode()
    assert '"symbol":"AAPL"' in body.replace(" ", "")
    assert '"side":"BUY"' in body.replace(" ", "")
    assert order.order_id == "ord-9"
    assert order.status is OrderStatus.FILLED
    assert order.avg_fill_price == Decimal("231.50")


@respx.mock
def test_rejected_order_raises(client):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(
            200, json={"status": "REJECTED", "message": "장 마감"}
        )
    )

    with pytest.raises(Exception, match="장 마감"):
        client.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=1))


@respx.mock
def test_429_is_retried(client, monkeypatch):
    monkeypatch.setattr("tossquant.broker.toss.time.sleep", lambda _: None)
    mock_token()
    route = respx.get(f"{BASE}/api/v1/accounts").mock(
        side_effect=[
            httpx.Response(429, text="slow down"),
            httpx.Response(200, json={"accounts": [{"id": "acct-1"}]}),
        ]
    )

    accounts = client.list_accounts()

    assert route.call_count == 2
    assert accounts == [{"id": "acct-1"}]


@respx.mock
def test_401_triggers_token_refresh(client, monkeypatch):
    monkeypatch.setattr("tossquant.broker.toss.time.sleep", lambda _: None)
    token_route = mock_token()
    respx.get(f"{BASE}/api/v1/accounts").mock(
        side_effect=[
            httpx.Response(401, text="expired"),
            httpx.Response(200, json={"accounts": []}),
        ]
    )

    client.list_accounts()

    assert token_route.call_count == 2


@respx.mock
def test_4xx_other_than_401_raises_immediately(client):
    mock_token()
    route = respx.get(f"{BASE}/api/v1/accounts").mock(
        return_value=httpx.Response(404, text="not found")
    )

    with pytest.raises(BrokerError, match="404"):
        client.list_accounts()
    assert route.call_count == 1


@respx.mock
def test_gives_up_after_max_retries(client, monkeypatch):
    monkeypatch.setattr("tossquant.broker.toss.time.sleep", lambda _: None)
    mock_token()
    respx.get(f"{BASE}/api/v1/accounts").mock(
        return_value=httpx.Response(503, text="down")
    )

    with pytest.raises(BrokerError, match="재시도"):
        client.list_accounts()


def test_toss_client_is_live(client):
    assert client.is_live is True
