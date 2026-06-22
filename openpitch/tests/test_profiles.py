"""Tests for teams, players, matches, profiles, sharing and import/export."""

from __future__ import annotations

import os
import tempfile

os.environ.setdefault("PLAYMETRICS_DB", tempfile.mktemp(suffix=".db"))
os.environ.setdefault("PLAYMETRICS_SECRET", "test-secret")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from openpitch.api import app  # noqa: E402


@pytest.fixture(scope="module")
def auth():
    with TestClient(app) as c:
        token = c.post("/api/auth/register",
                       data={"email": "profiles@club.com", "password": "secret1"}
                       ).json()["token"]
        yield c, {"Authorization": f"Bearer {token}"}


def test_team_player_match_profile_flow(auth):
    c, h = auth

    team = c.post("/api/teams", data={"name": "Riverside FC"}, headers=h).json()
    tid = team["id"]

    p1 = c.post(f"/api/teams/{tid}/players",
                data={"name": "Sam Carter", "position": "FW", "jersey": 9}, headers=h).json()
    p2 = c.post(f"/api/teams/{tid}/players",
                data={"name": "Alex Lee", "position": "MF", "jersey": 8}, headers=h).json()

    # matches across field types
    m5 = c.post(f"/api/teams/{tid}/matches",
                data={"field_type": 5, "opponent": "Dragons", "home_score": 3, "away_score": 2},
                headers=h).json()["id"]
    m11 = c.post(f"/api/teams/{tid}/matches",
                 data={"field_type": 11, "opponent": "City", "home_score": 1, "away_score": 1},
                 headers=h).json()["id"]
    c.post(f"/api/teams/{tid}/matches", data={"field_type": 11, "opponent": "United",
           "home_score": 0, "away_score": 2}, headers=h)

    # per-player stats
    c.post(f"/api/matches/{m5}/stats",
           data={"player_id": p1["id"], "minutes": 40, "distance_m": 4200,
                 "top_speed_ms": 7.5, "goals": 2}, headers=h)
    c.post(f"/api/matches/{m11}/stats",
           data={"player_id": p1["id"], "minutes": 90, "distance_m": 10500,
                 "top_speed_ms": 8.1, "goals": 1}, headers=h)
    c.post(f"/api/matches/{m11}/stats",
           data={"player_id": p2["id"], "minutes": 90, "distance_m": 11000,
                 "top_speed_ms": 7.9}, headers=h)

    # team profile
    tp = c.get(f"/api/teams/{tid}", headers=h).json()
    assert tp["matches_by_field"] == {"5": 1, "7": 0, "11": 2}
    assert tp["record"] == {"played": 3, "wins": 1, "draws": 1, "losses": 1,
                            "goals_for": 4, "goals_against": 5}
    assert tp["player_count"] == 2
    assert tp["leaderboard"][0]["name"] in ("Sam Carter", "Alex Lee")

    # player profile: matches played by field type + totals
    pp = c.get(f"/api/players/{p1['id']}", headers=h).json()
    assert pp["matches_by_field"] == {"5": 1, "7": 0, "11": 1}
    assert pp["totals"]["matches"] == 2
    assert pp["totals"]["goals"] == 3
    assert pp["totals"]["distance_m"] == 14700.0


def test_sharing_and_public_access(auth):
    c, h = auth
    tid = c.post("/api/teams", data={"name": "Shared United"}, headers=h).json()["id"]
    c.post(f"/api/teams/{tid}/players", data={"name": "Pat Kim"}, headers=h)

    # not public yet
    share = c.post(f"/api/teams/{tid}/share", headers=h).json()
    assert share["public"] is True
    token = share["public_token"]

    # public endpoint needs no auth and hides the token
    pub = c.get(f"/api/public/teams/{token}")
    assert pub.status_code == 200
    assert "public_token" not in pub.json()["team"]

    # toggling off makes it private again
    assert c.post(f"/api/teams/{tid}/share", headers=h).json()["public"] is False
    assert c.get(f"/api/public/teams/{token}").status_code == 404


def test_export_import_roundtrip(auth):
    c, h = auth
    tid = c.post("/api/teams", data={"name": "Export FC"}, headers=h).json()["id"]
    p = c.post(f"/api/teams/{tid}/players", data={"name": "Jo Park", "jersey": 7}, headers=h).json()
    m = c.post(f"/api/teams/{tid}/matches", data={"field_type": 7, "opponent": "Town"}, headers=h).json()["id"]
    c.post(f"/api/matches/{m}/stats", data={"player_id": p["id"], "distance_m": 5000, "goals": 1}, headers=h)

    bundle = c.get(f"/api/teams/{tid}/export", headers=h).json()
    assert bundle["team"]["name"] == "Export FC"
    assert len(bundle["players"]) == 1 and len(bundle["matches"]) == 1

    imported = c.post("/api/teams/import", json=bundle, headers=h).json()
    new_tid = imported["team_id"]
    assert new_tid != tid

    prof = c.get(f"/api/teams/{new_tid}", headers=h).json()
    assert prof["matches_by_field"] == {"5": 0, "7": 1, "11": 0}
    assert prof["player_count"] == 1
    assert prof["leaderboard"][0]["goals"] == 1


def test_ownership_isolation(auth):
    c, h = auth
    tid = c.post("/api/teams", data={"name": "Private FC"}, headers=h).json()["id"]
    other = c.post("/api/auth/register",
                   data={"email": "intruder@club.com", "password": "secret1"}
                   ).json()["token"]
    oh = {"Authorization": f"Bearer {other}"}
    assert c.get(f"/api/teams/{tid}", headers=oh).status_code == 404
    assert c.delete(f"/api/teams/{tid}", headers=oh).status_code == 404
