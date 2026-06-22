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
