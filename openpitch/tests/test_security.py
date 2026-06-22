"""Security hardening: headers, login rate-limit, audit trail."""

from __future__ import annotations

import os
import tempfile

os.environ.setdefault("PLAYMETRICS_DB", tempfile.mktemp(suffix=".db"))
os.environ.setdefault("PLAYMETRICS_SECRET", "test-secret")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from openpitch.api import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_security_headers_present(client):
    r = client.get("/api/health")
    assert r.headers.get("X-Content-Type-Options") == "nosniff"
    assert r.headers.get("X-Frame-Options") == "DENY"
    assert "default-src 'self'" in r.headers.get("Content-Security-Policy", "")


def test_login_rate_limit(client):
    client.post("/api/auth/register", data={"email": "rl@club.com", "password": "secret1"})
    # exhaust the failure budget
    codes = [
        client.post("/api/auth/login", data={"email": "rl@club.com", "password": "wrong"}).status_code
        for _ in range(5)
    ]
    assert all(c == 401 for c in codes)
    # next attempt is locked out (even with the right password)
    assert client.post("/api/auth/login",
                       data={"email": "rl@club.com", "password": "secret1"}).status_code == 429


def test_audit_trail_records_player_access(client):
    token = client.post("/api/auth/register",
                        data={"email": "auditor@club.com", "password": "secret1"}
                        ).json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    tid = client.post("/api/teams", data={"name": "Audit FC"}, headers=h).json()["id"]
    pid = client.post(f"/api/teams/{tid}/players",
                      data={"name": "Senior Watcher", "is_minor": "false"}, headers=h).json()["id"]

    # view + share generate audit entries
    client.get(f"/api/players/{pid}", headers=h)
    client.post(f"/api/players/{pid}/share", headers=h)

    audit = client.get(f"/api/players/{pid}/audit", headers=h).json()["audit"]
    actions = {e["action"] for e in audit}
    assert "player.view" in actions and "player.share" in actions
    assert all(e["actor"] == "auditor@club.com" for e in audit)
