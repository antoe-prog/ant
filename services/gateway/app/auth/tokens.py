"""Minimal HMAC-SHA256 signed token (JWT-compatible structure)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def sign_token(payload: dict[str, Any], secret: str, ttl_seconds: int = 60 * 60 * 24 * 7) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    body = dict(payload)
    now = int(time.time())
    body.setdefault("iat", now)
    body.setdefault("exp", now + ttl_seconds)

    header_b = _b64url_encode(json.dumps(header, separators=(",", ":"), sort_keys=True).encode())
    body_b = _b64url_encode(json.dumps(body, separators=(",", ":"), sort_keys=True).encode())
    signing_input = f"{header_b}.{body_b}".encode("ascii")
    sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    sig_b = _b64url_encode(sig)
    return f"{header_b}.{body_b}.{sig_b}"


def verify_token(token: str, secret: str) -> dict[str, Any] | None:
    try:
        header_b, body_b, sig_b = token.split(".")
    except ValueError:
        return None
    signing_input = f"{header_b}.{body_b}".encode("ascii")
    expected_sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    try:
        actual_sig = _b64url_decode(sig_b)
    except Exception:
        return None
    if not hmac.compare_digest(expected_sig, actual_sig):
        return None
    try:
        body = json.loads(_b64url_decode(body_b))
    except Exception:
        return None
    if not isinstance(body, dict):
        return None
    exp = body.get("exp")
    if isinstance(exp, (int, float)) and time.time() > exp:
        return None
    return body
