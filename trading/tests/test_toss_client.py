"""TossClient 테스트.

실제 응답 스키마를 확정할 수 없는 상태이므로, 여기서는 클라이언트가
"어떤 형태로 와도 무너지지 않는지"(래핑/케이스 변형)와 토큰·재시도·헤더 같은
운영상 중요한 동작을 검증한다. 실제 필드명 확인은 `tossquant verify` 몫이다.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import httpx
import pytest
import respx

from tossquant.broker.base import BrokerError, CredentialsRejected, OrderRejected
from tossquant.broker.toss import TossClient
from tossquant.models import OrderRequest, OrderStatus, OrderType, Side
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


def valid_candle_row(**overrides):
    row = {
        "timestamp": "2026-08-05T00:00:00Z",
        "open": "10",
        "high": "11",
        "low": "9",
        "close": "10.5",
        "volume": "20",
    }
    row.update(overrides)
    return row


def mock_candles(row):
    return respx.get(f"{BASE}/api/v1/market/candles/AAPL").mock(
        return_value=httpx.Response(200, json=[row])
    )


def mock_positions(payload):
    return respx.get(f"{BASE}/api/v1/accounts/positions").mock(
        return_value=httpx.Response(200, json=payload)
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
    with pytest.raises(CredentialsRejected, match="자격증명 거부"):
        client.list_accounts()


@respx.mock
def test_bearer_and_account_headers_are_sent(client, settings):
    mock_token()
    route = respx.get(f"{BASE}/api/v1/accounts/positions").mock(
        return_value=httpx.Response(200, json={"positions": []})
    )

    client.get_positions()

    request = route.calls[0].request
    assert request.headers["Authorization"] == "Bearer tok-abc"
    assert request.headers["X-Tossinvest-Account"] == settings.account_id


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


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("closePrice", None),
        ("closePrice", "garbage"),
        ("closePrice", "NaN"),
        ("closePrice", "Infinity"),
        ("closePrice", 0),
        ("closePrice", -1),
        ("bidPrice", "garbage"),
        ("bidPrice", "NaN"),
        ("bidPrice", 0),
        ("askPrice", "garbage"),
        ("askPrice", "Infinity"),
        ("askPrice", -1),
    ],
)
@respx.mock
def test_quote_rejects_missing_or_nonpositive_nonfinite_numeric_fields(
    client, field, value
):
    mock_token()
    payload = {
        "closePrice": 100,
        "bidPrice": 99,
        "askPrice": 101,
    }
    if value is None:
        payload.pop(field)
    else:
        payload[field] = value
    respx.get(f"{BASE}/api/v1/market/quotes/AAPL").mock(
        return_value=httpx.Response(200, json=payload)
    )

    with pytest.raises(BrokerError, match=rf"AAPL.*quote response.*{field}"):
        client.get_quote("AAPL")


@respx.mock
def test_quote_rejects_crossed_book(client):
    mock_token()
    respx.get(f"{BASE}/api/v1/market/quotes/AAPL").mock(
        return_value=httpx.Response(
            200,
            json={"closePrice": 100, "bidPrice": 99, "askPrice": 1},
        )
    )

    with pytest.raises(BrokerError, match=r"AAPL.*quote response.*bid.*ask"):
        client.get_quote("AAPL")


@pytest.mark.parametrize(
    "payload",
    [
        {"closePrice": 100},
        {"closePrice": 100, "timestamp": "not-a-date"},
    ],
    ids=("missing", "malformed"),
)
@respx.mock
def test_quote_keeps_tolerant_receive_time_fallback(client, payload):
    """현재가 시각은 과거 봉과 달리 수신 시각으로 대체해도 의미가 있다."""
    mock_token()
    respx.get(f"{BASE}/api/v1/market/quotes/AAPL").mock(
        return_value=httpx.Response(200, json=payload)
    )

    before = datetime.now(timezone.utc)
    quote = client.get_quote("AAPL")
    after = datetime.now(timezone.utc)

    assert before <= quote.ts <= after


@pytest.mark.parametrize("identifier", ["symbol", "ticker", "code"])
@respx.mock
def test_quote_rejects_mismatched_response_identifier(client, identifier):
    mock_token()
    respx.get(f"{BASE}/api/v1/market/quotes/AAPL").mock(
        return_value=httpx.Response(
            200,
            json={identifier: "MSFT", "closePrice": 100},
        )
    )

    with pytest.raises(
        BrokerError, match=rf"AAPL.*quote response.*{identifier}.*MSFT"
    ):
        client.get_quote("AAPL")


@respx.mock
def test_quote_rejects_later_contradictory_identifier_alias(client):
    mock_token()
    respx.get(f"{BASE}/api/v1/market/quotes/AAPL").mock(
        return_value=httpx.Response(
            200,
            json={"symbol": "AAPL", "ticker": "MSFT", "closePrice": 100},
        )
    )

    with pytest.raises(BrokerError, match=r"quote response.*ticker.*MSFT"):
        client.get_quote("AAPL")


@respx.mock
def test_quote_rejects_mismatched_identifier_in_list_response(client):
    mock_token()
    respx.get(f"{BASE}/api/v1/market/quotes/AAPL").mock(
        return_value=httpx.Response(
            200,
            json=[{"symbol": "MSFT", "closePrice": 100}],
        )
    )

    with pytest.raises(BrokerError, match=r"quote response.*symbol.*MSFT"):
        client.get_quote("AAPL")


@pytest.mark.parametrize("identifier", ["symbol", "ticker", "code"])
@respx.mock
def test_quote_rejects_mismatched_envelope_identifier(client, identifier):
    mock_token()
    respx.get(f"{BASE}/api/v1/market/quotes/AAPL").mock(
        return_value=httpx.Response(
            200,
            json={identifier: "MSFT", "data": {"closePrice": 100}},
        )
    )

    with pytest.raises(
        BrokerError, match=rf"AAPL.*quote response.*{identifier}.*MSFT"
    ):
        client.get_quote("AAPL")


@pytest.mark.parametrize("identifier", ["symbol", "ticker", "code"])
@respx.mock
def test_quote_accepts_normalized_matching_response_identifier(client, identifier):
    mock_token()
    respx.get(f"{BASE}/api/v1/market/quotes/AAPL").mock(
        return_value=httpx.Response(
            200,
            json={identifier: "  aapl  ", "closePrice": 100},
        )
    )

    quote = client.get_quote("AAPL")

    assert quote.symbol == "AAPL"


@respx.mock
def test_quote_accepts_absent_optional_response_identifier(client):
    mock_token()
    respx.get(f"{BASE}/api/v1/market/quotes/AAPL").mock(
        return_value=httpx.Response(200, json={"closePrice": 100})
    )

    quote = client.get_quote("AAPL")

    assert quote.symbol == "AAPL"


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
            200,
            json={
                "candles": [
                    {"ts": 1785000000000, "o": 10, "h": 10, "l": 10,
                     "c": 10, "v": 5}
                ]
            },
        )
    )

    candles = client.get_candles("AAPL", "1d", 1)

    assert candles[0].close == Decimal("10")
    assert candles[0].ts.year == 2026


@pytest.mark.parametrize("identifier", ["symbol", "ticker", "code"])
@respx.mock
def test_candles_reject_mismatched_response_identifier(client, identifier):
    mock_token()
    mock_candles(valid_candle_row(**{identifier: "MSFT"}))

    with pytest.raises(BrokerError, match=rf"AAPL.*1.*{identifier}.*MSFT"):
        client.get_candles("AAPL", "1d", 1)


@pytest.mark.parametrize("identifier", ["symbol", "ticker", "code"])
@respx.mock
def test_candles_accept_normalized_matching_response_identifier(client, identifier):
    mock_token()
    mock_candles(valid_candle_row(**{identifier: "  aapl  "}))

    candles = client.get_candles("AAPL", "1d", 1)

    assert candles[0].symbol == "AAPL"


@pytest.mark.parametrize(
    ("identifier", "payload"),
    [
        ("symbol", {"symbol": "MSFT", "candles": [{}]}),
        ("ticker", {"ticker": "MSFT", "data": {"candles": [{}]}}),
        ("code", {"data": {"code": "MSFT", "candles": [{}]}}),
    ],
    ids=("direct-symbol", "outer-wrapper-ticker", "inner-wrapper-code"),
)
@respx.mock
def test_candles_reject_mismatched_envelope_identifier_before_rows(
    client, identifier, payload
):
    mock_token()
    respx.get(f"{BASE}/api/v1/market/candles/AAPL").mock(
        return_value=httpx.Response(200, json=payload)
    )

    with pytest.raises(
        BrokerError, match=rf"AAPL.*response.*{identifier}.*MSFT"
    ):
        client.get_candles("AAPL", "1d", 1)


@pytest.mark.parametrize("identifier", ["symbol", "ticker", "code"])
@respx.mock
def test_candles_accept_normalized_matching_envelope_identifier(client, identifier):
    mock_token()
    respx.get(f"{BASE}/api/v1/market/candles/AAPL").mock(
        return_value=httpx.Response(
            200,
            json={identifier: "  aapl  ", "candles": [valid_candle_row()]},
        )
    )

    candles = client.get_candles("AAPL", "1d", 1)

    assert candles[0].symbol == "AAPL"


@pytest.mark.parametrize(
    "timestamp",
    [None, "not-a-date"],
    ids=("missing", "malformed"),
)
@respx.mock
def test_candles_reject_missing_or_malformed_timestamp(client, timestamp):
    mock_token()
    row = valid_candle_row()
    if timestamp is None:
        row.pop("timestamp")
    else:
        row["timestamp"] = timestamp
    mock_candles(row)

    with pytest.raises(BrokerError, match=r"AAPL.*1.*timestamp"):
        client.get_candles("AAPL", "1d", 1)


@pytest.mark.parametrize(
    "volume",
    [None, "garbage", "5.9"],
    ids=("missing", "malformed", "fractional"),
)
@respx.mock
def test_candles_reject_missing_malformed_or_fractional_volume(client, volume):
    mock_token()
    row = valid_candle_row()
    if volume is None:
        row.pop("volume")
    else:
        row["volume"] = volume
    mock_candles(row)

    with pytest.raises(BrokerError, match=r"AAPL.*1.*volume"):
        client.get_candles("AAPL", "1d", 1)


@pytest.mark.parametrize(
    "row",
    [
        pytest.param(
            {key: value for key, value in valid_candle_row().items() if key != "open"},
            id="missing",
        ),
        pytest.param(valid_candle_row(high="garbage"), id="malformed"),
        pytest.param(valid_candle_row(low="0"), id="nonpositive"),
        pytest.param(valid_candle_row(high="9"), id="inconsistent-range"),
    ],
)
@respx.mock
def test_candles_reject_missing_or_invalid_ohlc(client, row):
    mock_token()
    mock_candles(row)

    with pytest.raises(BrokerError, match=r"AAPL.*1.*(open|high|low|OHLC)"):
        client.get_candles("AAPL", "1d", 1)


@pytest.mark.parametrize(
    "second_timestamp",
    ["2026-08-05T00:00:00Z", "2026-08-04T20:00:00-04:00"],
    ids=("same-spelling", "equivalent-offset"),
)
@respx.mock
def test_candles_reject_duplicate_instants(client, second_timestamp):
    mock_token()
    row = valid_candle_row()
    duplicate = dict(row, timestamp=second_timestamp)
    respx.get(f"{BASE}/api/v1/market/candles/AAPL").mock(
        return_value=httpx.Response(200, json=[row, duplicate])
    )

    with pytest.raises(BrokerError, match=r"AAPL.*duplicate.*timestamp"):
        client.get_candles("AAPL", "1d", 2)


@respx.mock
def test_candles_reject_unknown_response_envelope(client):
    mock_token()
    respx.get(f"{BASE}/api/v1/market/candles/AAPL").mock(
        return_value=httpx.Response(200, json={"unexpected": [valid_candle_row()]})
    )

    with pytest.raises(BrokerError, match=r"AAPL.*candles/items"):
        client.get_candles("AAPL", "1d", 1)


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


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("symbol", None),
        ("symbol", ""),
        ("quantity", None),
        ("quantity", "garbage"),
        ("quantity", "NaN"),
        ("quantity", "1.5"),
        ("quantity", True),
        ("quantity", -1),
        ("averagePrice", None),
        ("averagePrice", "garbage"),
        ("averagePrice", "NaN"),
        ("averagePrice", -1),
    ],
)
@respx.mock
def test_positions_reject_malformed_nonzero_rows(client, field, value):
    mock_token()
    row = {"symbol": "AAPL", "quantity": 10, "averagePrice": "200.5"}
    if value is None:
        row.pop(field)
    else:
        row[field] = value
    mock_positions({"data": [row]})

    with pytest.raises(BrokerError, match=rf"position.*1.*{field}"):
        client.get_positions()


@pytest.mark.parametrize(
    "payload",
    [
        {"unexpected": []},
        {"positions": {}},
        "not-an-object",
    ],
    ids=("missing-collection", "collection-not-list", "root-not-object"),
)
@respx.mock
def test_positions_reject_unknown_or_malformed_collection(client, payload):
    mock_token()
    mock_positions(payload)

    with pytest.raises(BrokerError, match=r"position response"):
        client.get_positions()


@respx.mock
def test_positions_reject_duplicate_normalized_symbol(client):
    mock_token()
    mock_positions(
        {
            "data": [
                {"symbol": "AAPL", "quantity": 5, "averagePrice": "100"},
                {"symbol": " aapl ", "quantity": 7, "averagePrice": "200"},
            ]
        }
    )

    with pytest.raises(BrokerError, match=r"position.*2.*duplicate.*AAPL"):
        client.get_positions()


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({}, id="missing"),
        pytest.param({"cash": "garbage"}, id="malformed"),
        pytest.param({"cash": "NaN"}, id="nonfinite"),
        pytest.param({"cash": "Infinity"}, id="infinite"),
        pytest.param({"cash": "-1"}, id="negative"),
        pytest.param(
            {"cash": "10000", "availableCash": "0"},
            id="conflicting-present-aliases",
        ),
        pytest.param(
            {"availableCash": "0", "data": {"cash": "10000"}},
            id="conflicting-wrapper-aliases",
        ),
    ],
)
@respx.mock
def test_account_rejects_missing_malformed_or_conflicting_cash(client, payload):
    mock_token()
    respx.get(f"{BASE}/api/v1/accounts/balance").mock(
        return_value=httpx.Response(200, json=payload)
    )
    mock_positions({"data": []})

    with pytest.raises(BrokerError, match=r"balance response.*(cash|Cash|Amount)"):
        client.get_account()


@respx.mock
def test_account_accepts_consistent_present_cash_aliases(client):
    mock_token()
    respx.get(f"{BASE}/api/v1/accounts/balance").mock(
        return_value=httpx.Response(
            200,
            json={
                "cash": "123.45",
                "availableCash": "123.45",
                "orderableAmount": "123.45",
            },
        )
    )
    mock_positions({"data": []})

    assert client.get_account().cash == Decimal("123.45")


@respx.mock
def test_place_order_body_and_accepts_absent_optional_echo_fields(client):
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
    assert order.client_order_id == request.client_order_id
    assert order.symbol == request.symbol
    assert order.side is request.side
    assert order.quantity == request.quantity
    assert order.status is OrderStatus.FILLED
    assert order.avg_fill_price == Decimal("231.50")


@pytest.mark.parametrize(
    "payload",
    [
        {"status": "NEW"},
        {"orderId": "", "status": "NEW"},
        {"orderId": "ord-9", "id": "ord-other", "status": "NEW"},
    ],
    ids=("missing", "blank", "conflicting-alias"),
)
@respx.mock
def test_place_order_rejects_missing_blank_or_conflicting_order_id(client, payload):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(200, json=payload)
    )

    with pytest.raises(BrokerError, match=r"order response.*(orderId|id)"):
        client.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=3))


@pytest.mark.parametrize(
    "payload",
    [
        {"orderId": "ord-9", "status": "FILLED", "averagePrice": "100"},
        {"orderId": "ord-9", "status": "FILLED", "filledQuantity": 3},
        {
            "orderId": "ord-9",
            "status": "FILLED",
            "filledQuantity": "garbage",
            "averagePrice": "100",
        },
        {
            "orderId": "ord-9",
            "status": "FILLED",
            "filledQuantity": 2,
            "averagePrice": "100",
        },
        {
            "orderId": "ord-9",
            "status": "FILLED",
            "filledQuantity": 3,
            "averagePrice": "NaN",
        },
        {
            "orderId": "ord-9",
            "status": "FILLED",
            "filledQuantity": 3,
            "averagePrice": 0,
        },
    ],
    ids=(
        "missing-filled-quantity",
        "missing-average-price",
        "malformed-filled-quantity",
        "incomplete-filled-quantity",
        "nonfinite-average-price",
        "nonpositive-average-price",
    ),
)
@respx.mock
def test_place_filled_order_requires_coherent_fill_data(client, payload):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(200, json=payload)
    )

    with pytest.raises(BrokerError, match=r"order response.*(filled|average|status)"):
        client.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=3))


@pytest.mark.parametrize(
    ("echo", "expected_field"),
    [
        ({"orderType": "MARKET"}, "orderType"),
        ({"order_type": "MARKET"}, "order_type"),
        ({"orderType": "LIMIT", "order_type": "MARKET"}, "order_type"),
        ({"price": "101"}, "price"),
        ({"limitPrice": "101"}, "limitPrice"),
        ({"limit_price": "garbage"}, "limit_price"),
    ],
)
@respx.mock
def test_limit_order_rejects_mismatched_optional_type_or_price_echo(
    client, echo, expected_field
):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(
            200,
            json={"orderId": "ord-9", "status": "NEW", **echo},
        )
    )
    request = OrderRequest(
        symbol="AAPL",
        side=Side.BUY,
        quantity=3,
        order_type=OrderType.LIMIT,
        limit_price=Decimal("100"),
    )

    with pytest.raises(BrokerError, match=rf"order response.*{expected_field}"):
        client.place_order(request)


@respx.mock
def test_limit_order_accepts_matching_optional_type_and_price_echo(client):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(
            200,
            json={
                "orderId": "ord-9",
                "status": "NEW",
                "orderType": " limit ",
                "order_type": "LIMIT",
                "price": "100.0",
                "limitPrice": 100,
                "limit_price": "100.00",
            },
        )
    )
    request = OrderRequest(
        symbol="AAPL",
        side=Side.BUY,
        quantity=3,
        order_type=OrderType.LIMIT,
        limit_price=Decimal("100"),
    )

    order = client.place_order(request)

    assert order.order_id == "ord-9"
    assert order.status is OrderStatus.NEW


@pytest.mark.parametrize(
    ("field", "response_value"),
    [
        ("symbol", "MSFT"),
        ("ticker", "MSFT"),
        ("code", "MSFT"),
        ("clientOrderId", "other-client"),
        ("side", "SELL"),
        ("quantity", 4),
        ("qty", "4"),
        ("quantity", "3.9"),
        ("quantity", True),
    ],
)
@respx.mock
def test_place_order_rejects_mismatched_response_echo(
    client, field, response_value
):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(
            200,
            json={"orderId": "ord-9", "status": "NEW", field: response_value},
        )
    )
    request = OrderRequest(
        symbol="AAPL",
        side=Side.BUY,
        quantity=3,
        client_order_id="client-1",
    )

    with pytest.raises(BrokerError, match=rf"order response.*{field}"):
        client.place_order(request)


@respx.mock
def test_place_order_rejects_later_contradictory_identifier_alias(client):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(
            200,
            json={
                "orderId": "ord-9",
                "status": "NEW",
                "symbol": "AAPL",
                "ticker": "MSFT",
            },
        )
    )
    request = OrderRequest(symbol="AAPL", side=Side.BUY, quantity=3)

    with pytest.raises(BrokerError, match=r"order response.*ticker.*MSFT"):
        client.place_order(request)


@pytest.mark.parametrize(
    ("field", "response_value"),
    [
        ("symbol", "MSFT"),
        ("ticker", "MSFT"),
        ("code", "MSFT"),
        ("clientOrderId", "other-client"),
        ("side", "SELL"),
        ("quantity", 4),
        ("qty", "4"),
    ],
)
@respx.mock
def test_place_order_rejects_mismatched_envelope_echo(
    client, field, response_value
):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(
            200,
            json={
                field: response_value,
                "data": {"orderId": "ord-9", "status": "NEW"},
            },
        )
    )
    request = OrderRequest(
        symbol="AAPL",
        side=Side.BUY,
        quantity=3,
        client_order_id="client-1",
    )

    with pytest.raises(BrokerError, match=rf"order response.*{field}"):
        client.place_order(request)


@pytest.mark.parametrize(
    "payload",
    [
        {
            "orderId": "outer-new",
            "status": "NEW",
            "data": {
                "orderId": "inner-filled",
                "status": "FILLED",
                "filledQuantity": 3,
                "averagePrice": "100",
            },
        },
        {
            "data": {
                "orderId": "ord-data",
                "status": "FILLED",
                "filledQuantity": 3,
                "averagePrice": "100",
            },
            "result": {
                "orderId": "ord-result",
                "status": "NEW",
                "symbol": "MSFT",
                "side": "SELL",
                "quantity": 99,
            },
        },
    ],
    ids=("ancestor-order-conflict", "sibling-order-conflict"),
)
@respx.mock
def test_place_order_rejects_conflicting_authoritative_wrapper_envelopes(
    client, payload
):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(200, json=payload)
    )

    with pytest.raises(BrokerError, match=r"reconciliation required"):
        client.place_order(
            OrderRequest(symbol="AAPL", side=Side.BUY, quantity=3)
        )


@respx.mock
def test_place_order_accepts_matching_authoritative_wrapper_envelopes(client):
    mock_token()
    order = {
        "orderId": "ord-9",
        "status": "FILLED",
        "symbol": "AAPL",
        "side": "BUY",
        "quantity": 3,
        "filledQuantity": 3,
        "averagePrice": "100",
    }
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(
            200,
            json={**order, "data": dict(order), "result": dict(order)},
        )
    )

    result = client.place_order(
        OrderRequest(symbol="AAPL", side=Side.BUY, quantity=3)
    )

    assert result.order_id == "ord-9"
    assert result.status is OrderStatus.FILLED
    assert result.filled_quantity == 3


@respx.mock
def test_place_order_ignores_non_order_transport_status_wrapper(client):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(
            200,
            json={
                "status": "SUCCESS",
                "data": {
                    "orderId": "ord-9",
                    "status": "NEW",
                },
            },
        )
    )

    result = client.place_order(
        OrderRequest(symbol="AAPL", side=Side.BUY, quantity=3)
    )

    assert result.order_id == "ord-9"
    assert result.status is OrderStatus.NEW


@respx.mock
def test_place_order_accepts_normalized_matching_response_echo(client):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(
            200,
            json={
                "orderId": "ord-9",
                "orderStatus": " new ",
                "symbol": "  aapl  ",
                "ticker": "AAPL",
                "code": "aapl",
                "clientOrderId": "client-1",
                "side": " buy ",
                "quantity": "3.0",
                "qty": 3,
            },
        )
    )
    request = OrderRequest(
        symbol="AAPL",
        side=Side.BUY,
        quantity=3,
        client_order_id="client-1",
    )

    order = client.place_order(request)

    assert order.client_order_id == request.client_order_id
    assert order.symbol == request.symbol
    assert order.side is request.side
    assert order.quantity == request.quantity
    assert order.status is OrderStatus.NEW


@pytest.mark.parametrize(
    "payload",
    [
        {"orderId": "ord-9", "status": "PENDING"},
        {"orderId": "ord-9", "orderStatus": "PENDING"},
        {"orderId": "ord-9", "status": "NEW", "orderStatus": "PENDING"},
        {"orderId": "ord-9"},
    ],
    ids=("status", "order-status", "conflicting-alias", "missing"),
)
@respx.mock
def test_place_order_rejects_unknown_or_missing_status(client, payload):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(200, json=payload)
    )

    with pytest.raises(BrokerError, match=r"order response.*status"):
        client.place_order(
            OrderRequest(symbol="AAPL", side=Side.BUY, quantity=1)
        )


@respx.mock
def test_rejected_order_raises(client):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(
            200,
            json={
                "status": "REJECTED",
                "filledQuantity": 0,
                "averagePrice": 0,
                "message": "장 마감",
            },
        )
    )

    with pytest.raises(OrderRejected, match="장 마감"):
        client.place_order(OrderRequest(symbol="AAPL", side=Side.BUY, quantity=1))


@pytest.mark.parametrize(
    "payload",
    [
        {"status": "REJECTED", "averagePrice": 0},
        {"status": "REJECTED", "filledQuantity": 1, "averagePrice": 100},
        {"status": "REJECTED", "filledQuantity": 0, "averagePrice": 1},
        {
            "status": "REJECTED",
            "filledQuantity": 0,
            "executedQty": 1,
            "averagePrice": 0,
        },
    ],
    ids=("missing-filled", "nonzero-fill", "nonzero-average", "fill-alias-conflict"),
)
@respx.mock
def test_rejected_order_with_unreconciled_fill_is_not_definite_rejection(
    client, payload
):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(200, json=payload)
    )

    with pytest.raises(BrokerError, match="reconciliation required") as raised:
        client.place_order(
            OrderRequest(symbol="AAPL", side=Side.BUY, quantity=10)
        )

    assert not isinstance(raised.value, OrderRejected)


@pytest.mark.parametrize(
    ("payload", "expected_filled", "expected_average"),
    [
        (
            {
                "orderId": "ord-9",
                "status": "CANCELED",
                "filledQuantity": 0,
                "averagePrice": 0,
            },
            0,
            Decimal("0"),
        ),
        (
            {
                "orderId": "ord-9",
                "status": "CANCELED",
                "filledQuantity": 1,
                "averagePrice": 100,
            },
            1,
            Decimal("100"),
        ),
    ],
    ids=("explicit-zero-fill", "explicit-partial-fill"),
)
@respx.mock
def test_place_canceled_order_preserves_explicit_coherent_fill_data(
    client, payload, expected_filled, expected_average
):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(200, json=payload)
    )

    order = client.place_order(
        OrderRequest(symbol="AAPL", side=Side.BUY, quantity=3)
    )

    assert order.status is OrderStatus.CANCELED
    assert order.filled_quantity == expected_filled
    assert order.avg_fill_price == expected_average


@pytest.mark.parametrize(
    "payload",
    [
        {"orderId": "ord-9", "status": "CANCELED", "averagePrice": 0},
        {"orderId": "ord-9", "status": "CANCELED", "filledQuantity": 0},
        {
            "orderId": "ord-9",
            "status": "CANCELED",
            "filledQuantity": 0,
            "executedQty": 1,
            "averagePrice": 0,
        },
        {
            "orderId": "ord-9",
            "status": "CANCELED",
            "filledQuantity": 0,
            "averagePrice": 0,
            "avgFillPrice": 1,
        },
    ],
    ids=("missing-filled", "missing-average", "fill-conflict", "average-conflict"),
)
@respx.mock
def test_place_canceled_order_with_unreconciled_fill_is_ambiguous(client, payload):
    mock_token()
    respx.post(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(200, json=payload)
    )

    with pytest.raises(BrokerError, match="reconciliation required"):
        client.place_order(
            OrderRequest(symbol="AAPL", side=Side.BUY, quantity=3)
        )


def valid_cancel_response(**overrides):
    payload = {
        "orderId": "ord-expected",
        "status": "CANCELED",
        "symbol": "AAPL",
        "side": "SELL",
        "quantity": 3,
        "filledQuantity": 0,
        "averagePrice": 0,
    }
    payload.update(overrides)
    return payload


@pytest.mark.parametrize(
    "payload",
    [
        valid_cancel_response(orderId="ord-other"),
        valid_cancel_response(id="ord-other"),
    ],
    ids=("wrong-order-id", "conflicting-id-alias"),
)
@respx.mock
def test_cancel_order_rejects_mismatched_response_order_id(client, payload):
    mock_token()
    respx.delete(f"{BASE}/api/v1/orders/ord-expected").mock(
        return_value=httpx.Response(200, json=payload)
    )

    with pytest.raises(BrokerError, match=r"cancel response.*(orderId|id).*ord-other"):
        client.cancel_order("ord-expected")


@pytest.mark.parametrize("field", ["orderId", "id"])
@respx.mock
def test_cancel_order_rejects_mismatched_wrapper_id_alias(client, field):
    mock_token()
    inner = valid_cancel_response()
    inner.pop("orderId")
    respx.delete(f"{BASE}/api/v1/orders/ord-expected").mock(
        return_value=httpx.Response(
            200,
            json={field: "ord-other", "data": inner},
        )
    )

    with pytest.raises(BrokerError, match=rf"cancel response.*{field}.*ord-other"):
        client.cancel_order("ord-expected")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("symbol", None),
        ("symbol", ""),
        ("side", None),
        ("side", "HOLD"),
        ("quantity", None),
        ("quantity", "garbage"),
        ("quantity", 0),
        ("filledQuantity", None),
        ("filledQuantity", "garbage"),
        ("filledQuantity", -1),
        ("filledQuantity", 4),
        ("averagePrice", "garbage"),
        ("averagePrice", "NaN"),
    ],
)
@respx.mock
def test_cancel_order_rejects_missing_or_malformed_identity_and_fill_fields(
    client, field, value
):
    mock_token()
    payload = valid_cancel_response()
    if value is None:
        payload.pop(field)
    else:
        payload[field] = value
    respx.delete(f"{BASE}/api/v1/orders/ord-expected").mock(
        return_value=httpx.Response(200, json=payload)
    )

    with pytest.raises(BrokerError, match=rf"cancel response.*{field}"):
        client.cancel_order("ord-expected")


@respx.mock
def test_cancel_order_accepts_absent_id_echo_but_requires_safe_order_fields(client):
    mock_token()
    payload = valid_cancel_response()
    payload.pop("orderId")
    respx.delete(f"{BASE}/api/v1/orders/ord-expected").mock(
        return_value=httpx.Response(200, json=payload)
    )

    order = client.cancel_order("ord-expected")

    assert order.order_id == "ord-expected"
    assert order.symbol == "AAPL"
    assert order.side is Side.SELL
    assert order.quantity == 3
    assert order.filled_quantity == 0


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


@pytest.mark.parametrize("status_code", [429, 503])
@respx.mock
def test_mutating_order_retry_status_is_not_replayed(
    client, monkeypatch, status_code
):
    monkeypatch.setattr("tossquant.broker.toss.time.sleep", lambda _: None)
    mock_token()
    route = respx.post(f"{BASE}/api/v1/orders").mock(
        side_effect=[
            httpx.Response(status_code, text="unknown order outcome"),
            httpx.Response(200, json={"orderId": "duplicate", "status": "NEW"}),
        ]
    )

    with pytest.raises(BrokerError, match="재시도하지.*확인"):
        client.place_order(
            OrderRequest(symbol="AAPL", side=Side.BUY, quantity=1)
        )

    assert route.call_count == 1


@respx.mock
def test_mutating_order_network_error_is_not_replayed(client, monkeypatch):
    monkeypatch.setattr("tossquant.broker.toss.time.sleep", lambda _: None)
    mock_token()
    route = respx.post(f"{BASE}/api/v1/orders").mock(
        side_effect=[
            httpx.ReadTimeout("response lost after possible acceptance"),
            httpx.Response(200, json={"orderId": "duplicate", "status": "NEW"}),
        ]
    )

    with pytest.raises(BrokerError, match="재시도하지.*확인"):
        client.place_order(
            OrderRequest(symbol="AAPL", side=Side.BUY, quantity=1)
        )

    assert route.call_count == 1


@respx.mock
def test_mutating_cancel_retry_status_is_not_replayed(client, monkeypatch):
    monkeypatch.setattr("tossquant.broker.toss.time.sleep", lambda _: None)
    mock_token()
    route = respx.delete(f"{BASE}/api/v1/orders/ord-expected").mock(
        side_effect=[
            httpx.Response(503, text="unknown cancel outcome"),
            httpx.Response(200, json=valid_cancel_response()),
        ]
    )

    with pytest.raises(BrokerError, match="재시도하지.*확인"):
        client.cancel_order("ord-expected")

    assert route.call_count == 1


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
