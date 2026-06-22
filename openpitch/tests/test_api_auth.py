"""API tests: auth, per-user job isolation, token-guarded file serving."""

from __future__ import annotations

import os
import tempfile

# Isolate DB + secret before importing the app (db reads env at import time).
os.environ["PLAYMETRICS_DB"] = tempfile.mktemp(suffix=".db")
os.environ["PLAYMETRICS_SECRET"] = "test-secret"
os.environ["PLAYMETRICS_ADMIN_PASSWORD"] = "adminpass"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from openpitch.api import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:  # context manager triggers startup (DB + seed)
        yield c


def test_register_login_and_me(client):
    r = client.post("/api/auth/register",
                    data={"email": "coach@club.com", "password": "secret1"})
    assert r.status_code == 200
    token = r.json()["token"]

    # duplicate registration rejected
    assert client.post("/api/auth/register",
                       data={"email": "coach@club.com", "password": "secret1"}
                       ).status_code == 409

    # wrong password rejected
    assert client.post("/api/auth/login",
                       data={"email": "coach@club.com", "password": "nope"}
                       ).status_code == 401

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["email"] == "coach@club.com"


def test_seeded_admin_can_login(client):
    r = client.post("/api/auth/login",
                    data={"email": "yazanalshuibe14@gmail.com", "password": "adminpass"})
    assert r.status_code == 200
    assert client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {r.json()['token']}"}
    ).json()["is_admin"] is True


def test_jobs_require_auth(client):
    assert client.get("/api/jobs").status_code == 401
    assert client.post("/api/demo", data={"seconds": "3"}).status_code == 401


def test_demo_job_runs_and_files_are_guarded(client):
    token = client.post("/api/auth/login",
                        data={"email": "yazanalshuibe14@gmail.com",
                              "password": "adminpass"}).json()["token"]
    h = {"Authorization": f"Bearer {token}"}

    jid = client.post("/api/demo", data={"seconds": "3"}, headers=h).json()["job_id"]
    import time
    for _ in range(120):
        job = client.get(f"/api/jobs/{jid}", headers=h).json()
        if job["status"] in ("done", "error"):
            break
        time.sleep(0.5)
    assert job["status"] == "done", job
    assert abs(sum(job["summary"]["possession"].values()) - 100) < 0.5

    # file needs a valid token
    assert client.get(f"/api/files/{jid}/broadcast.mp4").status_code == 401
    assert client.get(f"/api/files/{jid}/broadcast.mp4?token={token}").status_code == 200

    # another user cannot see this job
    other = client.post("/api/auth/register",
                        data={"email": "rival@club.com", "password": "secret1"}
                        ).json()["token"]
    assert client.get(
        f"/api/jobs/{jid}", headers={"Authorization": f"Bearer {other}"}
    ).status_code == 404

    # rename + delete (owner only)
    assert client.patch(f"/api/jobs/{jid}", data={"name": "My Match"}, headers=h).status_code == 200
    assert client.get(f"/api/jobs/{jid}", headers=h).json()["input_name"] == "My Match"
    assert client.delete(
        f"/api/jobs/{jid}", headers={"Authorization": f"Bearer {other}"}
    ).status_code == 404  # not owner
    assert client.delete(f"/api/jobs/{jid}", headers=h).status_code == 200
    assert client.get(f"/api/jobs/{jid}", headers=h).status_code == 404


def test_upload_rejects_non_video(client):
    token = client.post("/api/auth/register",
                        data={"email": "scout@club.com", "password": "secret1"}
                        ).json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    r = client.post(
        "/api/jobs",
        files={"file": ("notes.txt", b"hello", "text/plain")},
        headers=h,
    )
    assert r.status_code == 400


def _make_clip() -> bytes:
    import subprocess
    import sys
    from pathlib import Path

    out = tempfile.mktemp(suffix=".mp4")
    root = Path(__file__).resolve().parent.parent
    subprocess.run(
        [sys.executable, str(root / "scripts" / "generate_sample.py"),
         "--out", out, "--seconds", "3"],
        check=True, capture_output=True,
    )
    return Path(out).read_bytes()


def test_site_device_and_ingest_flow(client):
    import time

    token = client.post("/api/auth/register",
                        data={"email": "academy@club.com", "password": "secret1"}
                        ).json()["token"]
    h = {"Authorization": f"Bearer {token}"}

    # create a site + pair a device
    site = client.post("/api/sites", data={"name": "North Pitch", "package": "pro"},
                       headers=h).json()
    assert client.post("/api/sites", data={"name": "x", "package": "bogus"},
                       headers=h).status_code == 400
    pair = client.post(f"/api/sites/{site['id']}/devices",
                       data={"kind": "gateway", "name": "UDM-Pro"}, headers=h).json()
    key = pair["api_key"]
    assert key.startswith("pmk_")

    # heartbeat: valid + invalid key
    assert client.post("/api/ingest/heartbeat", headers={"X-Device-Key": key}).status_code == 200
    assert client.post("/api/ingest/heartbeat", headers={"X-Device-Key": "nope"}).status_code == 401

    # ingest a match clip
    clip = _make_clip()
    files = {"file": ("match.mp4", clip, "video/mp4")}
    r = client.post("/api/ingest/matches",
                    files=files,
                    data={"idempotency_key": "match-001", "match_label": "U15 vs City"},
                    headers={"X-Device-Key": key})
    assert r.status_code == 200, r.text
    jid = r.json()["job_id"]
    assert r.json()["deduplicated"] is False

    # idempotent retry returns the same job, no reprocessing
    r2 = client.post("/api/ingest/matches",
                     files={"file": ("match.mp4", clip, "video/mp4")},
                     data={"idempotency_key": "match-001"},
                     headers={"X-Device-Key": key})
    assert r2.json()["job_id"] == jid and r2.json()["deduplicated"] is True

    # the ingested job is owned by the site owner and tagged source=ingest
    for _ in range(120):
        job = client.get(f"/api/jobs/{jid}", headers=h).json()
        if job["status"] in ("done", "error"):
            break
        time.sleep(0.5)
    assert job["status"] == "done", job
    assert job["source"] == "ingest" and job["site_id"] == site["id"]
    assert "North Pitch" in job["input_name"]


def test_change_password(client):
    reg = client.post("/api/auth/register",
                      data={"email": "gk@club.com", "password": "secret1"})
    h = {"Authorization": f"Bearer {reg.json()['token']}"}
    # wrong current password rejected
    assert client.post("/api/auth/change-password",
                       data={"current_password": "nope", "new_password": "brandnew1"},
                       headers=h).status_code == 401
    # successful change
    assert client.post("/api/auth/change-password",
                       data={"current_password": "secret1", "new_password": "brandnew1"},
                       headers=h).status_code == 200
    # old password no longer works, new one does
    assert client.post("/api/auth/login",
                       data={"email": "gk@club.com", "password": "secret1"}).status_code == 401
    assert client.post("/api/auth/login",
                       data={"email": "gk@club.com", "password": "brandnew1"}).status_code == 200
