"""Role-based access control: organizations, memberships, permissions."""

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


def _register(c, email):
    return {"Authorization": f"Bearer {c.post('/api/auth/register', data={'email': email, 'password': 'secret1'}).json()['token']}"}


def test_rbac_org_roles(client):
    owner = _register(client, "owner@academy.com")
    coach = _register(client, "coach@academy.com")
    parent = _register(client, "parent@academy.com")
    outsider = _register(client, "outsider@academy.com")

    # owner creates an org + a team + two players
    org = client.post("/api/orgs", data={"name": "Springfield Academy"}, headers=owner).json()
    oid = org["id"]
    assert client.get("/api/orgs", headers=owner).json()["orgs"][0]["role"] == "owner"

    tid = client.post(f"/api/orgs/{oid}/teams", data={"name": "U15"}, headers=owner).json()["id"]
    p1 = client.post(f"/api/teams/{tid}/players", data={"name": "Kid One"}, headers=owner).json()["id"]
    p2 = client.post(f"/api/teams/{tid}/players", data={"name": "Kid Two"}, headers=owner).json()["id"]

    # add a coach (staff) and a parent linked to p1
    assert client.post(f"/api/orgs/{oid}/members",
                       data={"email": "coach@academy.com", "role": "coach"},
                       headers=owner).status_code == 200
    # parent without a linked player is rejected
    assert client.post(f"/api/orgs/{oid}/members",
                       data={"email": "parent@academy.com", "role": "parent"},
                       headers=owner).status_code == 400
    assert client.post(f"/api/orgs/{oid}/members",
                       data={"email": "parent@academy.com", "role": "parent", "player_id": p1},
                       headers=owner).status_code == 200

    # coach (staff) can read + manage the team
    assert client.get(f"/api/teams/{tid}", headers=coach).status_code == 200
    assert client.post(f"/api/teams/{tid}/players", data={"name": "Kid Three"},
                       headers=coach).status_code == 200

    # parent: can read ONLY their linked player; cannot read the team or other players
    assert client.get(f"/api/players/{p1}", headers=parent).status_code == 200
    assert client.get(f"/api/players/{p2}", headers=parent).status_code == 403
    assert client.get(f"/api/teams/{tid}", headers=parent).status_code == 404
    # parent cannot manage
    assert client.post(f"/api/teams/{tid}/players", data={"name": "X"},
                       headers=parent).status_code in (403, 404)

    # a coach (non-admin) cannot add members
    assert client.post(f"/api/orgs/{oid}/members",
                       data={"email": "outsider@academy.com", "role": "coach"},
                       headers=coach).status_code == 403

    # an outsider sees nothing
    assert client.get(f"/api/teams/{tid}", headers=outsider).status_code == 404
    assert client.get(f"/api/orgs/{oid}/members", headers=outsider).status_code == 404
    assert client.get(f"/api/players/{p1}", headers=outsider).status_code == 404


def test_personal_teams_still_work(client):
    """Teams created without an org remain owner-only (backward compatible)."""
    h = _register(client, "solo@coach.com")
    tid = client.post("/api/teams", data={"name": "My Team"}, headers=h).json()["id"]
    assert client.get(f"/api/teams/{tid}", headers=h).status_code == 200
    other = _register(client, "nosy@coach.com")
    assert client.get(f"/api/teams/{tid}", headers=other).status_code == 404
