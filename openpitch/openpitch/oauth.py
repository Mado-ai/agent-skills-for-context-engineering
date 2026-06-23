"""Social login (OAuth 2.0 Authorization Code flow) — Google + GitHub.

Stdlib-only and dependency-free, matching the rest of the auth layer. A provider
is *enabled* only when its client id + secret are configured via env, so the UI
can hide buttons that wouldn't work. The CSRF ``state`` is an HMAC-signed,
expiring token (no server-side session needed).

Config (per provider you want to enable):
    GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
    GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET

Register the redirect URI ``<your-origin>/api/auth/oauth/<provider>/callback``
in each provider's console.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.parse
import urllib.request

from .auth import SECRET

_STATE_TTL_S = 600

PROVIDERS: dict[str, dict] = {
    "google": {
        "label": "Google",
        "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "userinfo": "https://openidconnect.googleapis.com/v1/userinfo",
        "scope": "openid email profile",
        "id_env": "GOOGLE_OAUTH_CLIENT_ID",
        "secret_env": "GOOGLE_OAUTH_CLIENT_SECRET",
        "extra_authorize": {"access_type": "online", "prompt": "select_account"},
    },
    "github": {
        "label": "GitHub",
        "authorize": "https://github.com/login/oauth/authorize",
        "token": "https://github.com/login/oauth/access_token",
        "userinfo": "https://api.github.com/user",
        "emails": "https://api.github.com/user/emails",
        "scope": "read:user user:email",
        "id_env": "GITHUB_OAUTH_CLIENT_ID",
        "secret_env": "GITHUB_OAUTH_CLIENT_SECRET",
    },
}


def _creds(provider: str) -> tuple[str, str] | None:
    p = PROVIDERS.get(provider)
    if not p:
        return None
    cid = os.environ.get(p["id_env"])
    secret = os.environ.get(p["secret_env"])
    return (cid, secret) if cid and secret else None


def enabled() -> list[dict]:
    """Configured providers, as ``[{id, label}]`` for the UI."""
    return [{"id": pid, "label": p["label"]}
            for pid, p in PROVIDERS.items() if _creds(pid)]


# --- CSRF state (signed, stateless) -----------------------------------------

def _sign(msg: str) -> str:
    sig = hmac.new(SECRET.encode(), msg.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(sig).rstrip(b"=").decode()


def make_state(provider: str) -> str:
    msg = f"{provider}.{int(time.time()) + _STATE_TTL_S}.{secrets.token_urlsafe(8)}"
    return f"{msg}.{_sign(msg)}"


def verify_state(state: str) -> str | None:
    """Return the provider id if the state is authentic and unexpired."""
    try:
        provider, exp, nonce, sig = state.split(".")
    except (ValueError, AttributeError):
        return None
    if not hmac.compare_digest(_sign(f"{provider}.{exp}.{nonce}"), sig):
        return None
    if int(exp) < time.time():
        return None
    return provider


# --- flow -------------------------------------------------------------------

def authorize_url(provider: str, redirect_uri: str) -> str | None:
    creds = _creds(provider)
    if not creds:
        return None
    cid, _ = creds
    p = PROVIDERS[provider]
    params = {
        "client_id": cid,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": p["scope"],
        "state": make_state(provider),
        **p.get("extra_authorize", {}),
    }
    return f"{p['authorize']}?{urllib.parse.urlencode(params)}"


def _post_form(url: str, data: dict, headers: dict | None = None) -> dict:
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(
        url, data=body,
        headers={"Accept": "application/json", "User-Agent": "PlayMetrics",
                 **(headers or {})})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def _get_json(url: str, token: str):
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json",
                      "User-Agent": "PlayMetrics"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def exchange_code(provider: str, code: str, redirect_uri: str) -> tuple[str, str | None]:
    """Exchange an auth code for the user's (email, name). Raises on failure."""
    creds = _creds(provider)
    if not creds:
        raise RuntimeError(f"{provider} OAuth is not configured")
    cid, secret = creds
    p = PROVIDERS[provider]
    tok = _post_form(p["token"], {
        "client_id": cid, "client_secret": secret, "code": code,
        "redirect_uri": redirect_uri, "grant_type": "authorization_code",
    })
    access = tok.get("access_token")
    if not access:
        raise RuntimeError(f"{provider} token exchange failed: {tok.get('error', 'no token')}")

    info = _get_json(p["userinfo"], access)
    email = (info.get("email") or "").lower()
    name = info.get("name") or info.get("login")
    if not email and provider == "github":
        for e in _get_json(p["emails"], access):
            if e.get("primary") and e.get("verified"):
                email = (e.get("email") or "").lower()
                break
    if not email:
        raise RuntimeError(f"{provider} did not return a verified email")
    return email, name
