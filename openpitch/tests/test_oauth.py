"""OAuth social-login: provider gating, signed state, and the callback flow."""

from __future__ import annotations

import os
import tempfile

os.environ.setdefault("PLAYMETRICS_DB", tempfile.mktemp(suffix=".db"))
os.environ.setdefault("PLAYMETRICS_SECRET", "test-secret")
os.environ.setdefault("PLAYMETRICS_ADMIN_PASSWORD", "adminpass")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from openpitch import auth, db, oauth  # noqa: E402
from openpitch.api import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_providers_hidden_until_configured(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRET", raising=False)
    assert client.get("/api/auth/providers").json()["providers"] == []

    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "secret")
    ids = [p["id"] for p in client.get("/api/auth/providers").json()["providers"]]
    assert "google" in ids


def test_state_sign_and_verify():
    state = oauth.make_state("google")
    assert oauth.verify_state(state) == "google"
    assert oauth.verify_state(state + "tamper") is None
    assert oauth.verify_state("garbage") is None


def test_authorize_url_includes_state_and_client(monkeypatch):
    monkeypatch.setenv("GITHUB_OAUTH_CLIENT_ID", "ghid")
    monkeypatch.setenv("GITHUB_OAUTH_CLIENT_SECRET", "ghsecret")
    url = oauth.authorize_url("github", "https://app.example/api/auth/oauth/github/callback")
    assert url and "client_id=ghid" in url and "state=" in url
    assert "redirect_uri=https%3A%2F%2Fapp.example" in url


def test_start_404_when_unconfigured(client, monkeypatch):
    monkeypatch.delenv("GITHUB_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("GITHUB_OAUTH_CLIENT_SECRET", raising=False)
    assert client.get("/api/auth/oauth/github/start", follow_redirects=False).status_code == 404


def test_callback_creates_user_and_sets_cookie(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "secret")
    monkeypatch.setattr(oauth, "exchange_code",
                        lambda provider, code, redirect_uri: ("oauthuser@club.com", "OAuth User"))

    state = oauth.make_state("google")
    r = client.get(f"/api/auth/oauth/google/callback?code=abc&state={state}",
                   follow_redirects=False)
    assert r.status_code in (302, 307)
    assert r.headers["location"] == "/dashboard"
    # Session is handed back as an HttpOnly cookie, never in the URL.
    set_cookie = r.headers.get("set-cookie", "")
    assert "pm_session=" in set_cookie and "HttpOnly" in set_cookie
    token = set_cookie.split("pm_session=", 1)[1].split(";", 1)[0]
    assert auth.decode_token(token)["email"] == "oauthuser@club.com"
    assert db.get_user_by_email("oauthuser@club.com") is not None


def test_cookie_session_authorizes_without_bearer(client):
    """A login sets the session cookie; subsequent requests authorize via it."""
    fresh = TestClient(app)  # isolated cookie jar
    r = fresh.post("/api/auth/login",
                   data={"email": "yazanalshuibe14@gmail.com", "password": "adminpass"})
    assert r.status_code == 200
    assert "pm_session=" in r.headers.get("set-cookie", "")
    # No Authorization header — the cookie carries the session.
    me = fresh.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["email"] == "yazanalshuibe14@gmail.com"
    # Logout clears it.
    fresh.post("/api/auth/logout")
    fresh.cookies.clear()
    assert fresh.get("/api/auth/me").status_code == 401


def test_callback_rejects_bad_state(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "secret")
    # A state signed for a different provider must not be accepted.
    state = oauth.make_state("github")
    r = client.get(f"/api/auth/oauth/google/callback?code=abc&state={state}",
                   follow_redirects=False)
    assert r.status_code in (302, 307)
    assert "oauth_error=state" in r.headers["location"]
