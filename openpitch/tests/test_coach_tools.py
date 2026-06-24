"""Coach video-workflow tools: clip tagging, telestration, playbooks, scouting."""

from __future__ import annotations

import os
import tempfile
import time

os.environ.setdefault("PLAYMETRICS_DB", tempfile.mktemp(suffix=".db"))
os.environ.setdefault("PLAYMETRICS_SECRET", "test-secret")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from openpitch.api import app  # noqa: E402


@pytest.fixture(scope="module")
def auth():
    with TestClient(app) as c:
        tok = c.post("/api/auth/register",
                     data={"email": "coach@club.com", "password": "secret1"}
                     ).json()["token"]
        yield c, {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def job_id(auth):
    """A finished analysis job to attach tags / telestrations to."""
    c, h = auth
    jid = c.post("/api/demo", data={"seconds": "4"}, headers=h).json()["job_id"]
    for _ in range(120):
        if c.get(f"/api/jobs/{jid}", headers=h).json()["status"] in ("done", "error"):
            break
        time.sleep(0.5)
    return jid


def test_clip_tags_crud(auth, job_id):
    c, h = auth
    # create two tags
    t1 = c.post(f"/api/jobs/{job_id}/tags", headers=h,
                json={"t": 12.5, "label": "press", "note": "high block"}).json()
    c.post(f"/api/jobs/{job_id}/tags", headers=h, json={"t": 3.0, "label": "turnover"})
    assert t1["label"] == "press"

    # listed in time order
    tags = c.get(f"/api/jobs/{job_id}/tags", headers=h).json()["tags"]
    assert [t["label"] for t in tags] == ["turnover", "press"]

    # label is required
    assert c.post(f"/api/jobs/{job_id}/tags", headers=h, json={"t": 1}).status_code == 400

    # delete one
    assert c.delete(f"/api/tags/{t1['id']}", headers=h).status_code == 200
    assert len(c.get(f"/api/jobs/{job_id}/tags", headers=h).json()["tags"]) == 1


def test_telestration_crud(auth, job_id):
    c, h = auth
    shapes = [{"kind": "arrow", "x1": 0.1, "y1": 0.2, "x2": 0.5, "y2": 0.6, "color": "#ff0"}]
    row = c.post(f"/api/jobs/{job_id}/telestrations", headers=h,
                 json={"name": "Build-up", "t": 30.0, "shapes": shapes}).json()
    assert row["name"] == "Build-up" and row["shapes"] == shapes

    got = c.get(f"/api/jobs/{job_id}/telestrations", headers=h).json()["telestrations"]
    assert len(got) == 1 and got[0]["shapes"][0]["kind"] == "arrow"

    # shapes must be a list
    assert c.post(f"/api/jobs/{job_id}/telestrations", headers=h,
                  json={"name": "x", "shapes": "nope"}).status_code == 400

    assert c.delete(f"/api/telestrations/{row['id']}", headers=h).status_code == 200
    assert c.get(f"/api/jobs/{job_id}/telestrations", headers=h).json()["telestrations"] == []


def test_playbook_crud(auth):
    c, h = auth
    tid = c.post("/api/teams", data={"name": "Tactics FC"}, headers=h).json()["id"]
    data = {"tokens": [{"id": "a", "x": 0.5, "y": 0.5, "label": "9", "team": "home"}],
            "arrows": [{"x1": 0.5, "y1": 0.5, "x2": 0.8, "y2": 0.3}]}
    pb = c.post(f"/api/teams/{tid}/playbooks", headers=h,
                json={"name": "Corner routine", "field_type": 11, "data": data}).json()
    assert pb["name"] == "Corner routine"

    # fetch + edit
    full = c.get(f"/api/playbooks/{pb['id']}", headers=h).json()
    assert full["data"]["tokens"][0]["label"] == "9"
    assert c.put(f"/api/playbooks/{pb['id']}", headers=h,
                 json={"name": "Corner v2", "data": data}).status_code == 200
    assert c.get(f"/api/playbooks/{pb['id']}", headers=h).json()["name"] == "Corner v2"

    # listed under the team
    lst = c.get(f"/api/teams/{tid}/playbooks", headers=h).json()["playbooks"]
    assert len(lst) == 1

    # ownership isolation
    other = c.post("/api/auth/register",
                   data={"email": "rival@club.com", "password": "secret1"}).json()["token"]
    oh = {"Authorization": f"Bearer {other}"}
    assert c.get(f"/api/playbooks/{pb['id']}", headers=oh).status_code == 404

    assert c.delete(f"/api/playbooks/{pb['id']}", headers=h).status_code == 200
    assert c.get(f"/api/teams/{tid}/playbooks", headers=h).json()["playbooks"] == []


def test_scouting_report(auth):
    c, h = auth
    tid = c.post("/api/teams", data={"name": "Scout FC"}, headers=h).json()["id"]
    p1 = c.post(f"/api/teams/{tid}/players",
                data={"name": "Striker One", "jersey": 9}, headers=h).json()["id"]
    p2 = c.post(f"/api/teams/{tid}/players",
                data={"name": "Winger Two", "jersey": 7}, headers=h).json()["id"]
    m = c.post(f"/api/teams/{tid}/matches",
               data={"field_type": 11, "opponent": "Rivals", "home_score": 3, "away_score": 1},
               headers=h).json()["id"]
    c.post(f"/api/matches/{m}/stats", headers=h,
           data={"player_id": p1, "goals": 2, "shots": 5, "shots_on_target": 3})
    c.post(f"/api/matches/{m}/stats", headers=h,
           data={"player_id": p2, "goals": 1, "assists": 2, "shots": 2})

    sc = c.get(f"/api/teams/{tid}/scouting", headers=h).json()
    assert sc["team"]["name"] == "Scout FC"
    assert sc["matches"] == 1
    # danger men ranked by goal threat — the two-goal striker leads
    assert sc["danger_men"][0]["name"] == "Striker One"
    assert sc["totals"]["goals"] == 3 and sc["totals"]["shots"] == 7
    assert set(sc["attacking"]["channels"]) == {"left", "center", "right"}


def test_tools_require_auth(auth, job_id):
    c, _ = auth
    c.cookies.clear()
    assert c.get(f"/api/jobs/{job_id}/tags").status_code == 401
    assert c.post(f"/api/jobs/{job_id}/telestrations", json={"shapes": []}).status_code == 401
