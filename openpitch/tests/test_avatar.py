"""Player photos: upload + privacy gating (minors never served without owner)."""

from __future__ import annotations

import base64
import os
import tempfile

os.environ.setdefault("PLAYMETRICS_DB", tempfile.mktemp(suffix=".db"))
os.environ.setdefault("PLAYMETRICS_SECRET", "test-secret")
os.environ.setdefault("PLAYMETRICS_ADMIN_PASSWORD", "adminpass")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from openpitch.api import app  # noqa: E402

# 1x1 PNG
_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _auth(c):
    c.post("/api/auth/register", data={"email": "ph@club.com", "password": "secret1"})
    tok = c.post("/api/auth/login", data={"email": "ph@club.com", "password": "secret1"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def test_avatar_upload_and_minor_privacy(client):
    h = _auth(client)
    tid = client.post("/api/teams", data={"name": "Photo FC"}, headers=h).json()["id"]
    adult = client.post(f"/api/teams/{tid}/players",
                        data={"name": "Adult One", "jersey": "9", "is_minor": "false"},
                        headers=h).json()["id"]
    minor = client.post(f"/api/teams/{tid}/players",
                        data={"name": "Young One", "jersey": "10", "is_minor": "true"},
                        headers=h).json()["id"]

    up = client.post(f"/api/players/{adult}/avatar", headers=h,
                     files={"file": ("a.png", _PNG, "image/png")})
    assert up.status_code == 200
    client.post(f"/api/players/{minor}/avatar", headers=h,
                files={"file": ("a.png", _PNG, "image/png")})

    # Non-image rejected.
    bad = client.post(f"/api/players/{adult}/avatar", headers=h,
                      files={"file": ("a.txt", b"nope", "text/plain")})
    assert bad.status_code == 400

    # Adult photo is public (no media token needed).
    assert client.get(f"/api/players/{adult}/avatar").status_code == 200
    # Minor photo is NOT served without the owner's media token.
    assert client.get(f"/api/players/{minor}/avatar").status_code == 404
    # ...but the owner (valid media token) can see it.
    mt = client.get("/api/auth/media-token", headers=h).json()["media_token"]
    assert client.get(f"/api/players/{minor}/avatar", params={"mt": mt}).status_code == 200


def test_roster_map_empty_without_linked_match(client):
    h = _auth(client)
    jid = client.post("/api/demo", data={"seconds": "2"}, headers=h).json()["job_id"]
    r = client.get(f"/api/jobs/{jid}/roster-map", headers=h).json()
    assert r["team_id"] is None and r["players"] == []
