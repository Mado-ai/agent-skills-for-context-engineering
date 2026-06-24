"""The on-site sync agent's upload payload is accepted by the Ingestion API."""

from __future__ import annotations

import importlib.util
import os
import tempfile
from pathlib import Path

os.environ.setdefault("PLAYMETRICS_DB", tempfile.mktemp(suffix=".db"))
os.environ.setdefault("PLAYMETRICS_SECRET", "test-secret")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from openpitch.api import app  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("sync_agent", ROOT / "scripts" / "sync_agent.py")
sync_agent = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sync_agent)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_agent_multipart_is_accepted_by_ingest(client):
    token = client.post("/api/auth/register",
                        data={"email": "rack@club.com", "password": "secret1"}
                        ).json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    site = client.post("/api/sites", data={"name": "Edge Pitch", "package": "pro"},
                       headers=h).json()
    key = client.post(f"/api/sites/{site['id']}/devices",
                      data={"kind": "gateway", "name": "UDM"}, headers=h).json()["api_key"]

    # build the exact wire format the agent sends, then feed it to the API
    body, boundary = sync_agent._multipart(
        {"match_label": "Sync Test", "idempotency_key": "agent-1", "detector": "color"},
        "file", "match.mp4", b"\x00" * 256)
    r = client.post(
        "/api/ingest/matches", content=body,
        headers={"X-Device-Key": key,
                 "Content-Type": f"multipart/form-data; boundary={boundary}"})
    assert r.status_code == 200, r.text
    assert "job_id" in r.json()

    # heartbeat path the agent uses
    assert client.post("/api/ingest/heartbeat", headers={"X-Device-Key": key}).status_code == 200
    assert client.post("/api/ingest/heartbeat", headers={"X-Device-Key": "bad"}).status_code == 401
