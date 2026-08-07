"""인증 실패 진단과 키 만료 감지 테스트.

이 두 가지는 자격증명이 멀쩡한데도 봇이 멈추게 만드는 원인이다. 원인을
잘못 짚으면 멀쩡한 키를 재발급하며 시간을 버리므로, 오진하지 않는 게
'진단이 있다'는 것보다 중요하다.
"""

from __future__ import annotations

from datetime import date

import httpx
import pytest
import respx

from tossquant.broker.base import BrokerError, CredentialsRejected, IPNotAllowed
from tossquant.broker.toss import (
    IP_HINT_PATTERN,
    TossClient,
    classify_auth_failure,
    public_ip,
)
from tossquant.config import Settings

BASE = "https://openapi.tossinvest.com"


@pytest.fixture(autouse=True)
def no_ip_lookup(monkeypatch):
    """진단이 외부 IP 서비스를 때리지 않게 한다 (테스트가 네트워크에 의존하면 안 된다)."""
    monkeypatch.setattr("tossquant.broker.toss.public_ip", lambda *a, **k: "1.2.3.4")


# --- IP 차단 판정 ------------------------------------------------------------


def test_403_is_treated_as_ip_block():
    error = classify_auth_failure(403, "forbidden")
    assert isinstance(error, IPNotAllowed)
    assert "허용 IP" in str(error)


def test_ip_block_message_shows_current_ip():
    assert "1.2.3.4" in str(classify_auth_failure(403, "forbidden"))


@pytest.mark.parametrize(
    "body",
    [
        '{"message":"IP not allowed"}',
        '{"message":"허용 IP가 아닙니다"}',
        '{"error":"not in allowlist"}',
        '{"error":"not in allow-list"}',
        '{"error":"white_list violation"}',
        '{"message":"화이트리스트에 없습니다"}',
        '{"detail":"unknown ip address"}',
    ],
)
def test_body_hints_detect_ip_block(body):
    assert IP_HINT_PATTERN.search(body)
    assert isinstance(classify_auth_failure(401, body), IPNotAllowed)


@pytest.mark.parametrize(
    "body",
    [
        '{"error":"invalid_client","error_description":"bad secret"}',
        '{"message":"Recipient unknown"}',
        '{"detail":"multiple descriptions"}',
        '{"error":"unauthorized"}',
        '{"message":"participant not found"}',
    ],
)
def test_ordinary_errors_are_not_mistaken_for_ip_blocks(body):
    """'description' 처럼 흔한 단어에 걸리면 멀쩡한 키를 재발급하게 된다."""
    assert not IP_HINT_PATTERN.search(body)
    assert isinstance(classify_auth_failure(401, body), CredentialsRejected)


# --- 자격증명 거부 -----------------------------------------------------------


@pytest.mark.parametrize("status", [400, 401])
def test_4xx_without_ip_hints_is_credentials(status):
    error = classify_auth_failure(status, "invalid_client")
    assert isinstance(error, CredentialsRejected)
    assert "만료" in str(error)


def test_5xx_stays_generic():
    error = classify_auth_failure(500, "boom")
    assert type(error) is BrokerError


def test_body_is_truncated_in_message():
    assert len(str(classify_auth_failure(500, "x" * 5000))) < 1000


# --- 클라이언트 연동 ---------------------------------------------------------


@pytest.fixture
def client(settings):
    settings.base_url = BASE
    from tossquant.ratelimit import RateLimiter, TokenBucket

    return TossClient(
        settings,
        limiter=RateLimiter(buckets={}, default=TokenBucket(10_000, capacity=10_000)),
    )


@respx.mock
def test_token_endpoint_403_raises_ip_error(client):
    respx.post(f"{BASE}/oauth2/token").mock(
        return_value=httpx.Response(403, text="forbidden")
    )
    with pytest.raises(IPNotAllowed):
        client.list_accounts()


@respx.mock
def test_data_endpoint_403_also_raises_ip_error(client):
    """토큰이 캐시된 뒤 IP가 바뀌면 데이터 호출에서 막힌다."""
    respx.post(f"{BASE}/oauth2/token").mock(
        return_value=httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
    )
    respx.get(f"{BASE}/api/v1/accounts").mock(
        return_value=httpx.Response(403, text="forbidden")
    )

    with pytest.raises(IPNotAllowed):
        client.list_accounts()


@respx.mock
def test_403_is_not_retried(client):
    """IP 차단은 재시도해도 절대 풀리지 않는다 — 한도만 낭비한다."""
    respx.post(f"{BASE}/oauth2/token").mock(
        return_value=httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
    )
    route = respx.get(f"{BASE}/api/v1/accounts").mock(
        return_value=httpx.Response(403, text="forbidden")
    )

    with pytest.raises(IPNotAllowed):
        client.list_accounts()
    assert route.call_count == 1


# --- public_ip ---------------------------------------------------------------


@respx.mock
def test_public_ip_returns_first_success(monkeypatch):
    monkeypatch.undo()  # autouse 픽스처의 스텁을 걷어낸다
    respx.get("https://api.ipify.org").mock(
        return_value=httpx.Response(200, text="203.0.113.9\n")
    )
    assert public_ip() == "203.0.113.9"


@respx.mock
def test_public_ip_falls_back_to_second_service(monkeypatch):
    monkeypatch.undo()
    respx.get("https://api.ipify.org").mock(side_effect=httpx.ConnectError("down"))
    respx.get("https://ifconfig.me/ip").mock(
        return_value=httpx.Response(200, text="198.51.100.7")
    )
    assert public_ip() == "198.51.100.7"


@respx.mock
def test_public_ip_returns_none_when_all_fail(monkeypatch):
    """조회 실패가 예외로 새어나가면 정작 원래 에러 메시지가 묻힌다."""
    monkeypatch.undo()
    respx.get("https://api.ipify.org").mock(side_effect=httpx.ConnectError("down"))
    respx.get("https://ifconfig.me/ip").mock(side_effect=httpx.ConnectError("down"))
    assert public_ip() is None


@respx.mock
def test_public_ip_rejects_garbage_response(monkeypatch):
    monkeypatch.undo()
    respx.get("https://api.ipify.org").mock(
        return_value=httpx.Response(200, text="<html>" + "x" * 500 + "</html>")
    )
    respx.get("https://ifconfig.me/ip").mock(side_effect=httpx.ConnectError("down"))
    assert public_ip() is None


# --- 키 만료 -----------------------------------------------------------------


def expiring(day: date) -> Settings:
    return Settings(
        _env_file=None, client_id="x", client_secret="y", key_expires_at=day
    )


def test_no_expiry_configured_means_no_warning():
    settings = Settings(_env_file=None, client_id="x", client_secret="y")
    assert settings.days_until_key_expiry() is None
    assert settings.key_expiry_warning() is None


def test_far_future_expiry_is_silent():
    settings = expiring(date(2027, 8, 4))
    assert settings.key_expiry_warning(date(2026, 8, 6)) is None


def test_warns_inside_the_window():
    settings = expiring(date(2027, 8, 4))
    warning = settings.key_expiry_warning(date(2027, 7, 20))
    assert warning is not None
    assert "15일 뒤" in warning


def test_warns_on_the_expiry_day():
    warning = expiring(date(2027, 8, 4)).key_expiry_warning(date(2027, 8, 4))
    assert "오늘 만료" in warning


def test_reports_already_expired():
    warning = expiring(date(2027, 8, 4)).key_expiry_warning(date(2027, 8, 10))
    assert "6일 전에 만료" in warning
    assert "재발급" in warning


def test_warn_window_is_configurable():
    settings = Settings(
        _env_file=None,
        client_id="x",
        client_secret="y",
        key_expires_at=date(2027, 8, 4),
        key_expiry_warn_days=90,
    )
    assert settings.key_expiry_warning(date(2027, 6, 1)) is not None


def test_days_until_expiry_counts_down():
    settings = expiring(date(2027, 8, 4))
    assert settings.days_until_key_expiry(date(2027, 8, 1)) == 3
    assert settings.days_until_key_expiry(date(2027, 8, 5)) == -1
