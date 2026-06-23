"""BePro-style additions: computed physical metrics + event-taxonomy round-trip."""

from __future__ import annotations

import os
import tempfile

os.environ.setdefault("PLAYMETRICS_DB", tempfile.mktemp(suffix=".db"))
os.environ.setdefault("PLAYMETRICS_SECRET", "test-secret")
os.environ.setdefault("PLAYMETRICS_ADMIN_PASSWORD", "adminpass")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from openpitch.analytics import Analytics  # noqa: E402
from openpitch.api import app  # noqa: E402
from openpitch.config import Config  # noqa: E402
from openpitch.track import FrameState, PlayerTrack  # noqa: E402


def test_player_stats_expose_computed_physical_metrics():
    a = Analytics(Config(), fps=25)
    # A player accelerating then cruising, with the ball nearby.
    for i in range(60):
        x = min(0.9, 0.05 + 0.014 * i)  # steady advance across the pitch
        a.update(FrameState(frame=i,
                            players=[PlayerTrack(id=1, team=0, cx=x, cy=0.5, number=7)],
                            ball=(x, 0.5)))
    rows = a.player_stats()
    assert rows, "expected a player row"
    p = rows[0]
    for k in ("accelerations", "decelerations", "hsr_m", "sprint_dist_m"):
        assert k in p and p[k] >= 0


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_event_taxonomy_round_trips_to_profile(client):
    client.post("/api/auth/register", data={"email": "sd@club.com", "password": "secret1"})
    tok = client.post("/api/auth/login", data={"email": "sd@club.com", "password": "secret1"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}

    tid = client.post("/api/teams", data={"name": "SD FC"}, headers=h).json()["id"]
    pid = client.post(f"/api/teams/{tid}/players",
                      data={"name": "Box Crasher", "jersey": "6", "is_minor": "false"},
                      headers=h).json()["id"]
    mid = client.post(f"/api/teams/{tid}/matches",
                      data={"field_type": "11", "opponent": "Rivals"}, headers=h).json()["id"]

    # Manually record standard-data events.
    r = client.post(f"/api/matches/{mid}/stats", headers=h, data={
        "player_id": pid, "tackles": "4", "interceptions": "3", "key_passes": "2",
        "saves": "0", "minutes": "90"})
    assert r.status_code == 200

    totals = client.get(f"/api/players/{pid}", headers=h).json()["totals"]
    assert totals["tackles"] == 4
    assert totals["interceptions"] == 3
    assert totals["key_passes"] == 2

    # A second edit merges (doesn't wipe) prior fields.
    client.post(f"/api/matches/{mid}/stats", headers=h, data={"player_id": pid, "clearances": "5"})
    totals = client.get(f"/api/players/{pid}", headers=h).json()["totals"]
    assert totals["clearances"] == 5 and totals["tackles"] == 4
