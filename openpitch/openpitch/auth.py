"""Authentication — stdlib-only password hashing + signed tokens.

Deliberately dependency-free (no passlib / pyjwt): PBKDF2-HMAC-SHA256 for
passwords and a compact HS256 JWT signed with HMAC. Good enough for a
self-hosted prototype; swap for a managed identity provider in production.

The signing secret comes from ``PLAYMETRICS_SECRET`` (a random per-process
secret is used if unset, which invalidates tokens on restart — set it in
any real deployment).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time

_PBKDF2_ITERATIONS = 240_000
_TOKEN_TTL_S = 7 * 24 * 3600

SECRET = os.environ.get("PLAYMETRICS_SECRET") or secrets.token_hex(32)


# --- password hashing -------------------------------------------------------

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(iters)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk.hex(), hash_hex)


# --- tokens (compact HS256 JWT) ---------------------------------------------

def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64u_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def create_token(user_id: int, email: str) -> str:
    header = _b64u(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64u(
        json.dumps(
            {"sub": user_id, "email": email, "exp": int(time.time()) + _TOKEN_TTL_S}
        ).encode()
    )
    signing_input = f"{header}.{payload}".encode()
    sig = hmac.new(SECRET.encode(), signing_input, hashlib.sha256).digest()
    return f"{header}.{payload}.{_b64u(sig)}"


def new_api_key() -> str:
    """A device/gateway API key (shown to the operator once at pairing)."""
    return "pmk_" + secrets.token_urlsafe(24)


def hash_token(token: str) -> str:
    """Fast hash for high-entropy API keys (not user passwords)."""
    return hashlib.sha256(token.encode()).hexdigest()


def decode_token(token: str) -> dict | None:
    try:
        header, payload, sig = token.split(".")
    except ValueError:
        return None
    expected = hmac.new(
        SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256
    ).digest()
    if not hmac.compare_digest(_b64u(expected), sig):
        return None
    data = json.loads(_b64u_decode(payload))
    if data.get("exp", 0) < time.time():
        return None
    return data
