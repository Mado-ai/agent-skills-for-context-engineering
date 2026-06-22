"""HTTP API + static website host for Play Metrics.

A FastAPI backend that turns the OpenPitch pipeline into a multi-user web
app: account login, persistent per-user job history (SQLite), and every
pipeline capability (upload, detector choice, pitch calibration, broadcast,
analytics, heatmaps, highlights) exposed to an authenticated dashboard.

    uvicorn openpitch.api:app --reload      # http://localhost:8000

On first start an admin account is seeded from PLAYMETRICS_ADMIN_EMAIL /
PLAYMETRICS_ADMIN_PASSWORD (sensible dev defaults if unset).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, Depends, FastAPI, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import auth, authz, db, hardware, profiles
from .config import Config
from .pipeline import process_video

ROOT = Path(__file__).resolve().parent.parent
# Output/job directory — point at a mounted volume in production via env.
RUNS = Path(os.environ.get("PLAYMETRICS_DATA", str(ROOT / "runs")))
# Prefer the built Vite SPA (web/dist); fall back to the no-build frontend.
WEB_DIST = ROOT / "web" / "dist"
SPA_DIR = WEB_DIST if (WEB_DIST / "index.html").exists() else ROOT / "frontend"
RUNS.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    email = os.environ.get("PLAYMETRICS_ADMIN_EMAIL", "yazanalshuibe14@gmail.com")
    password = os.environ.get("PLAYMETRICS_ADMIN_PASSWORD", "playmetrics-dev")
    if db.get_user_by_email(email) is None:
        db.create_user(email, auth.hash_password(password), is_admin=True)
        print(f"[seed] admin account created: {email}")
    yield


app = FastAPI(title="Play Metrics", version="0.2.0", lifespan=lifespan)
_bearer = HTTPBearer(auto_error=False)


# --- auth helpers -----------------------------------------------------------

def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if creds is None:
        raise HTTPException(401, "missing token")
    data = auth.decode_token(creds.credentials)
    if not data:
        raise HTTPException(401, "invalid or expired token")
    user = db.get_user_by_id(data["sub"])
    if not user:
        raise HTTPException(401, "unknown user")
    return dict(user)


def _user_from_token_str(token: str) -> dict | None:
    data = auth.decode_token(token)
    if not data:
        return None
    user = db.get_user_by_id(data["sub"])
    return dict(user) if user else None


# --- auth endpoints ---------------------------------------------------------

@app.post("/api/auth/register")
def register(email: str = Form(...), password: str = Form(...)) -> JSONResponse:
    if len(password) < 6:
        raise HTTPException(400, "password must be at least 6 characters")
    if db.get_user_by_email(email):
        raise HTTPException(409, "email already registered")
    user = db.create_user(email, auth.hash_password(password))
    token = auth.create_token(user["id"], user["email"])
    return JSONResponse({"token": token, "email": user["email"]})


@app.post("/api/auth/login")
def login(email: str = Form(...), password: str = Form(...)) -> JSONResponse:
    user = db.get_user_by_email(email)
    if not user or not auth.verify_password(password, user["password_hash"]):
        raise HTTPException(401, "invalid credentials")
    token = auth.create_token(user["id"], user["email"])
    return JSONResponse({"token": token, "email": user["email"]})


@app.get("/api/health")
def health() -> JSONResponse:
    return JSONResponse({"status": "ok", "version": app.version})


@app.get("/api/auth/me")
def me(user: dict = Depends(current_user)) -> JSONResponse:
    return JSONResponse(
        {"email": user["email"], "is_admin": bool(user["is_admin"])}
    )


@app.post("/api/auth/change-password")
def change_password(
    current_password: str = Form(...),
    new_password: str = Form(...),
    user: dict = Depends(current_user),
) -> JSONResponse:
    if not auth.verify_password(current_password, user["password_hash"]):
        raise HTTPException(401, "current password is incorrect")
    if len(new_password) < 6:
        raise HTTPException(400, "new password must be at least 6 characters")
    db.set_password(user["id"], auth.hash_password(new_password))
    return JSONResponse({"status": "ok"})


# --- job execution ----------------------------------------------------------

def _run_job(job_id: str, input_path: Path, detector: str) -> None:
    out_dir = RUNS / job_id
    try:
        def progress(p: float, msg: str) -> None:
            db.update_job(job_id, progress=p, message=msg, status="running")

        result = process_video(input_path, out_dir, Config(detector=detector), progress)
        db.update_job(
            job_id,
            status="done",
            progress=1.0,
            message="done",
            summary={
                "possession": result.analytics["possession"],
                "possession_timeline": result.analytics["possession_timeline"],
                "players": result.analytics["players"][:14],
                "heatmaps": result.analytics["heatmaps"],
                "highlights": result.highlights,
                "meta": result.meta,
            },
        )
    except Exception as exc:  # surface failures to the client
        db.update_job(job_id, status="error", message=str(exc))


def _start(job_id: str, user_id: int, input_path: Path, detector: str,
           input_name: str, source: str = "upload", site_id: str | None = None) -> None:
    db.create_job(job_id, user_id, input_name, detector, source=source, site_id=site_id)
    threading.Thread(
        target=_run_job, args=(job_id, input_path, detector), daemon=True
    ).start()


# --- job endpoints ----------------------------------------------------------

MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB


@app.post("/api/jobs")
async def create_job(
    file: UploadFile,
    detector: str = Form("color"),
    user: dict = Depends(current_user),
) -> JSONResponse:
    if detector not in ("color", "yolo"):
        raise HTTPException(400, "detector must be 'color' or 'yolo'")
    if file.content_type and not file.content_type.startswith("video/"):
        raise HTTPException(400, "please upload a video file")
    data = await file.read()
    if not data:
        raise HTTPException(400, "uploaded file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file too large (max 500 MB)")
    job_id = uuid.uuid4().hex[:12]
    out_dir = RUNS / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "input.mp4").write_bytes(data)
    _start(job_id, user["id"], out_dir / "input.mp4", detector, file.filename or "upload.mp4")
    return JSONResponse({"job_id": job_id})


@app.post("/api/demo")
def create_demo(
    seconds: int = Form(10),
    detector: str = Form("color"),
    user: dict = Depends(current_user),
) -> JSONResponse:
    job_id = uuid.uuid4().hex[:12]
    out_dir = RUNS / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    sample = out_dir / "input.mp4"
    subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "generate_sample.py"),
         "--out", str(sample), "--seconds", str(min(max(seconds, 3), 30))],
        check=True,
    )
    _start(job_id, user["id"], sample, detector, "synthetic-demo.mp4")
    return JSONResponse({"job_id": job_id})


@app.get("/api/jobs")
def list_jobs(user: dict = Depends(current_user)) -> JSONResponse:
    return JSONResponse({"jobs": db.list_jobs_for_user(user["id"])})


def _owned_job(job_id: str, user: dict) -> dict:
    job = db.get_job(job_id)
    if not job or job["user_id"] != user["id"]:
        raise HTTPException(404, "job not found")
    return job


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    return JSONResponse(_owned_job(job_id, user))


@app.patch("/api/jobs/{job_id}")
def rename_job(
    job_id: str, name: str = Form(...), user: dict = Depends(current_user)
) -> JSONResponse:
    _owned_job(job_id, user)
    name = name.strip()[:120]
    if not name:
        raise HTTPException(400, "name cannot be empty")
    db.rename_job(job_id, name)
    return JSONResponse({"status": "ok", "name": name})


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    _owned_job(job_id, user)
    db.delete_job(job_id)
    shutil.rmtree(RUNS / job_id, ignore_errors=True)
    return JSONResponse({"status": "ok"})


@app.get("/api/files/{job_id}/{path:path}")
def serve_file(job_id: str, path: str, token: str = ""):
    # Media tags can't send Authorization headers, so accept ?token=.
    user = _user_from_token_str(token)
    if not user:
        raise HTTPException(401, "invalid token")
    job = db.get_job(job_id)
    if not job or job["user_id"] != user["id"]:
        raise HTTPException(404, "not found")
    target = (RUNS / job_id / path).resolve()
    if not str(target).startswith(str(RUNS.resolve())) or not target.exists():
        raise HTTPException(404, "not found")
    return FileResponse(target)


# --- capture-site registry (Layer 1/2 onboarding) ---------------------------

@app.get("/api/packages")
def packages() -> JSONResponse:
    """Public hardware infrastructure manifest (UniFi 3-package model)."""
    return JSONResponse(hardware.manifest())


@app.post("/api/sites")
def create_site(
    name: str = Form(...),
    package: str = Form(...),
    user: dict = Depends(current_user),
) -> JSONResponse:
    if package not in hardware.PACKAGES:
        raise HTTPException(400, "package must be starter, growth or pro")
    site_id = "site_" + uuid.uuid4().hex[:10]
    site = db.create_site(site_id, user["id"], name.strip()[:120], package)
    return JSONResponse(site)


@app.get("/api/sites")
def list_sites(user: dict = Depends(current_user)) -> JSONResponse:
    return JSONResponse({"sites": db.list_sites(user["id"])})


def _owned_site(site_id: str, user: dict):
    site = db.get_site(site_id)
    if not site or site["user_id"] != user["id"]:
        raise HTTPException(404, "site not found")
    return site


@app.get("/api/sites/{site_id}")
def site_detail(site_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    site = _owned_site(site_id, user)
    return JSONResponse({**dict(site), "devices": db.list_devices(site_id)})


@app.get("/api/sites/{site_id}/matches")
def site_matches(site_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    _owned_site(site_id, user)
    return JSONResponse({"jobs": db.list_jobs_for_site(site_id)})


@app.post("/api/sites/{site_id}/devices")
def pair_device(
    site_id: str,
    kind: str = Form(...),
    name: str = Form(...),
    user: dict = Depends(current_user),
) -> JSONResponse:
    _owned_site(site_id, user)
    device_id = "dev_" + uuid.uuid4().hex[:10]
    api_key = auth.new_api_key()
    db.create_device(device_id, site_id, kind.strip()[:40], name.strip()[:80],
                     auth.hash_token(api_key))
    # The plaintext key is returned exactly once — the gateway stores it.
    return JSONResponse({"device_id": device_id, "api_key": api_key})


# --- cloud ingestion (Layer 2 edge gateway -> Layer 3 cloud) ----------------

def _device_from_key(x_device_key: str | None):
    if not x_device_key:
        raise HTTPException(401, "missing X-Device-Key")
    device = db.get_device_by_key_hash(auth.hash_token(x_device_key))
    if not device:
        raise HTTPException(401, "unknown device key")
    db.touch_device(device["id"])
    return device


@app.post("/api/ingest/heartbeat")
def ingest_heartbeat(x_device_key: str | None = Header(None)) -> JSONResponse:
    device = _device_from_key(x_device_key)
    return JSONResponse({"status": "ok", "device_id": device["id"], "site_id": device["site_id"]})


@app.post("/api/ingest/matches")
async def ingest_match(
    file: UploadFile,
    match_label: str = Form("Match"),
    idempotency_key: str = Form(...),
    detector: str = Form("color"),
    x_device_key: str | None = Header(None),
) -> JSONResponse:
    """Edge gateway syncs a processed match clip + metadata for analysis."""
    device = _device_from_key(x_device_key)
    if detector not in ("color", "yolo"):
        raise HTTPException(400, "detector must be 'color' or 'yolo'")

    # Idempotent: a retried sync returns the original job, never double-processes.
    existing = db.get_ingest_job(idempotency_key)
    if existing:
        return JSONResponse({"job_id": existing, "deduplicated": True})

    data = await file.read()
    if not data:
        raise HTTPException(400, "empty clip")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "clip too large (max 500 MB)")

    site = db.get_site(device["site_id"])
    job_id = uuid.uuid4().hex[:12]
    out_dir = RUNS / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "input.mp4").write_bytes(data)
    label = f"{site['name']} · {match_label.strip()[:80]}"
    _start(job_id, site["user_id"], out_dir / "input.mp4", detector, label,
           source="ingest", site_id=site["id"])
    db.record_ingest_job(idempotency_key, job_id)
    return JSONResponse({"job_id": job_id, "deduplicated": False})


# --- organizations & memberships (RBAC) -------------------------------------

@app.post("/api/orgs")
def create_org(name: str = Form(...), user: dict = Depends(current_user)) -> JSONResponse:
    org_id = "org_" + uuid.uuid4().hex[:10]
    org = db.create_org(org_id, name.strip()[:120])
    db.add_membership("mem_" + uuid.uuid4().hex[:10], org_id, user["id"], authz.OWNER)
    return JSONResponse(org)


@app.get("/api/orgs")
def list_orgs(user: dict = Depends(current_user)) -> JSONResponse:
    return JSONResponse({"orgs": db.list_orgs_for_user(user["id"])})


def _require_org_role(org_id: str, user: dict, allowed: set[str]):
    if not db.get_org(org_id):
        raise HTTPException(404, "org not found")
    role = _org_role(org_id, user)
    if role is None:
        raise HTTPException(404, "org not found")
    if role not in allowed:
        raise HTTPException(403, "not permitted")
    return role


@app.get("/api/orgs/{org_id}/members")
def org_members(org_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    _require_org_role(org_id, user, authz.ALL_ROLES)
    return JSONResponse({"members": db.list_members(org_id)})


@app.post("/api/orgs/{org_id}/members")
def add_member(
    org_id: str,
    email: str = Form(...),
    role: str = Form(...),
    player_id: str = Form(""),
    user: dict = Depends(current_user),
) -> JSONResponse:
    _require_org_role(org_id, user, authz.ADMIN_ROLES)
    if role not in authz.ALL_ROLES:
        raise HTTPException(400, f"role must be one of {sorted(authz.ALL_ROLES)}")
    target = db.get_user_by_email(email)
    if not target:
        raise HTTPException(404, "no registered user with that email")
    if role in authz.LINKED_ROLES and not player_id:
        raise HTTPException(400, "parent/player members must be linked to a player_id")
    db.add_membership("mem_" + uuid.uuid4().hex[:10], org_id, target["id"], role,
                      player_id or None)
    return JSONResponse({"status": "ok"})


@app.post("/api/orgs/{org_id}/teams")
def create_org_team(org_id: str, name: str = Form(...),
                    user: dict = Depends(current_user)) -> JSONResponse:
    _require_org_role(org_id, user, authz.STAFF_ROLES)
    team_id = "team_" + uuid.uuid4().hex[:10]
    return JSONResponse(db.create_team(team_id, user["id"], name.strip()[:120], org_id))


@app.get("/api/orgs/{org_id}/teams")
def org_teams(org_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    _require_org_role(org_id, user, authz.ALL_ROLES)
    return JSONResponse({"teams": db.list_org_teams(org_id)})


# --- teams ------------------------------------------------------------------

def _org_role(org_id: str, user: dict) -> str | None:
    m = db.get_membership(org_id, user["id"])
    return m["role"] if m else None


def _owned_team(team_id: str, user: dict):
    """Team access for staff (org coach+) or the owner of a personal team."""
    team = db.get_team(team_id)
    if not team:
        raise HTTPException(404, "team not found")
    if team["org_id"]:
        if _org_role(team["org_id"], user) not in authz.STAFF_ROLES:
            raise HTTPException(404, "team not found")
    elif team["user_id"] != user["id"]:
        raise HTTPException(404, "team not found")
    return team


def _readable_player(player_id: str, user: dict):
    """Read access: staff see any; parent/player see only their linked player."""
    player = db.get_player(player_id)
    if not player:
        raise HTTPException(404, "player not found")
    team = db.get_team(player["team_id"])
    if team and team["org_id"]:
        m = db.get_membership(team["org_id"], user["id"])
        if not m:
            raise HTTPException(404, "player not found")
        if m["role"] in authz.STAFF_ROLES:
            return player
        if m["role"] in authz.LINKED_ROLES and m["player_id"] == player_id:
            return player
        raise HTTPException(403, "not permitted")
    if not team or team["user_id"] != user["id"]:
        raise HTTPException(404, "player not found")
    return player


def _owned_player(player_id: str, user: dict):
    """Manage access (staff / personal owner only)."""
    player = db.get_player(player_id)
    if not player:
        raise HTTPException(404, "player not found")
    _owned_team(player["team_id"], user)  # raises unless staff/owner
    return player


def _owned_match(match_id: str, user: dict):
    match = db.get_match(match_id)
    if not match:
        raise HTTPException(404, "match not found")
    _owned_team(match["team_id"], user)  # access governed by the match's team
    return match


@app.post("/api/teams")
def create_team(name: str = Form(...), user: dict = Depends(current_user)) -> JSONResponse:
    team_id = "team_" + uuid.uuid4().hex[:10]
    return JSONResponse(db.create_team(team_id, user["id"], name.strip()[:120]))


@app.get("/api/teams")
def list_teams(user: dict = Depends(current_user)) -> JSONResponse:
    return JSONResponse({"teams": db.list_teams(user["id"])})


@app.get("/api/teams/{team_id}")
def team_detail(team_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    _owned_team(team_id, user)
    return JSONResponse(profiles.team_profile(team_id))


@app.patch("/api/teams/{team_id}")
def update_team(team_id: str, name: str = Form(...), user: dict = Depends(current_user)) -> JSONResponse:
    _owned_team(team_id, user)
    db.update_team(team_id, name.strip()[:120])
    return JSONResponse({"status": "ok"})


@app.delete("/api/teams/{team_id}")
def remove_team(team_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    _owned_team(team_id, user)
    db.delete_team(team_id)
    return JSONResponse({"status": "ok"})


@app.post("/api/teams/{team_id}/share")
def share_team(team_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    team = _owned_team(team_id, user)
    token = None if team["public_token"] else uuid.uuid4().hex[:12]
    db.set_team_public(team_id, token)
    return JSONResponse({"public": token is not None, "public_token": token})


@app.get("/api/teams/{team_id}/export")
def export_team(team_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    _owned_team(team_id, user)
    return JSONResponse(profiles.export_team(team_id))


@app.post("/api/teams/import")
def import_team(bundle: dict = Body(...), user: dict = Depends(current_user)) -> JSONResponse:
    if not isinstance(bundle.get("team"), dict):
        raise HTTPException(400, "invalid bundle")
    return JSONResponse(profiles.import_team(user["id"], bundle))


# --- players ----------------------------------------------------------------

@app.post("/api/teams/{team_id}/players")
def create_player(
    team_id: str,
    name: str = Form(...),
    position: str = Form(""),
    jersey: int | None = Form(None),
    user: dict = Depends(current_user),
) -> JSONResponse:
    _owned_team(team_id, user)
    player_id = "ply_" + uuid.uuid4().hex[:10]
    return JSONResponse(
        db.create_player(player_id, team_id, name.strip()[:80], position.strip()[:40] or None, jersey)
    )


@app.get("/api/players/{player_id}")
def player_detail(player_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    _readable_player(player_id, user)
    profile = profiles.player_profile(player_id)
    player = db.get_player(player_id)
    profile["public_token"] = player["public_token"]
    return JSONResponse(profile)


@app.patch("/api/players/{player_id}")
def update_player(
    player_id: str,
    name: str = Form(...),
    position: str = Form(""),
    jersey: int | None = Form(None),
    user: dict = Depends(current_user),
) -> JSONResponse:
    _owned_player(player_id, user)
    db.update_player(player_id, name.strip()[:80], position.strip()[:40] or None, jersey)
    return JSONResponse({"status": "ok"})


@app.delete("/api/players/{player_id}")
def remove_player(player_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    _owned_player(player_id, user)
    db.delete_player(player_id)
    return JSONResponse({"status": "ok"})


@app.post("/api/players/{player_id}/share")
def share_player(player_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    player = _owned_player(player_id, user)
    token = None if player["public_token"] else uuid.uuid4().hex[:12]
    db.set_player_public(player_id, token)
    return JSONResponse({"public": token is not None, "public_token": token})


# --- matches & stats --------------------------------------------------------

@app.post("/api/teams/{team_id}/matches")
def create_match(
    team_id: str,
    field_type: int = Form(...),
    opponent: str = Form(""),
    played_on: str = Form(""),
    job_id: str = Form(""),
    home_score: int | None = Form(None),
    away_score: int | None = Form(None),
    user: dict = Depends(current_user),
) -> JSONResponse:
    _owned_team(team_id, user)
    if field_type not in (5, 7, 11):
        raise HTTPException(400, "field_type must be 5, 7 or 11")
    # Snapshot team metrics from a linked, completed analysis job.
    summary = None
    linked_job = None
    if job_id:
        job = db.get_job(job_id)
        if job and job["user_id"] == user["id"] and job.get("summary"):
            linked_job = job_id
            summary = json.dumps({"possession": job["summary"].get("possession")})
    match_id = "match_" + uuid.uuid4().hex[:10]
    db.create_match(match_id, user["id"], team_id, field_type,
                    opponent.strip()[:80] or None, played_on.strip()[:20] or None,
                    linked_job, home_score, away_score, summary)
    return JSONResponse({"id": match_id})


@app.get("/api/matches/{match_id}")
def match_detail(match_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    match = _owned_match(match_id, user)
    match["stats"] = db.stats_for_match(match_id)
    return JSONResponse(match)


@app.delete("/api/matches/{match_id}")
def remove_match(match_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    _owned_match(match_id, user)
    db.delete_match(match_id)
    return JSONResponse({"status": "ok"})


@app.get("/api/matches/{match_id}/detected")
def match_detected(match_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    """Detected players from the linked analysis job + the team roster, for mapping."""
    match = _owned_match(match_id, user)
    roster = db.list_players(match["team_id"])
    detected: list[dict] = []
    if match.get("job_id"):
        job = db.get_job(match["job_id"])
        if job and job.get("summary"):
            detected = job["summary"].get("players", [])
    return JSONResponse({"detected": detected, "roster": [dict(p) for p in roster]})


@app.post("/api/matches/{match_id}/import-stats")
def import_match_stats(
    match_id: str,
    mapping: list[dict] = Body(..., embed=True),
    minutes: int = Body(0, embed=True),
    user: dict = Depends(current_user),
) -> JSONResponse:
    """Map detected track IDs -> roster players and write their stats to the match.

    `mapping` = [{"detected_id": <job player_id>, "player_id": <roster id>}].
    Re-importing replaces the match's prior auto-imported stats (idempotent).
    """
    match = _owned_match(match_id, user)
    if not match.get("job_id"):
        raise HTTPException(400, "match has no linked analysis job")
    job = db.get_job(match["job_id"])
    detected = {str(p["player_id"]): p for p in (job["summary"].get("players", []) if job and job.get("summary") else [])}
    roster_ids = {p["id"] for p in db.list_players(match["team_id"])}

    db.clear_match_stats(match_id)
    written = 0
    for m in mapping:
        det = detected.get(str(m.get("detected_id")))
        if not det or m.get("player_id") not in roster_ids:
            continue
        db.add_player_stat("st_" + uuid.uuid4().hex[:10], match_id, m["player_id"],
                           int(minutes), float(det.get("distance_m") or 0),
                           float(det.get("top_speed_ms") or 0), 0, 0)
        written += 1
    return JSONResponse({"status": "ok", "imported": written})


@app.post("/api/matches/{match_id}/stats")
def add_stat(
    match_id: str,
    player_id: str = Form(...),
    minutes: int = Form(0),
    distance_m: float = Form(0),
    top_speed_ms: float = Form(0),
    goals: int = Form(0),
    assists: int = Form(0),
    user: dict = Depends(current_user),
) -> JSONResponse:
    _owned_match(match_id, user)
    player = _owned_player(player_id, user)  # noqa: F841 (validates ownership)
    db.add_player_stat("st_" + uuid.uuid4().hex[:10], match_id, player_id,
                       minutes, distance_m, top_speed_ms, goals, assists)
    return JSONResponse({"status": "ok"})


# --- public (no auth) read-only profiles ------------------------------------

@app.get("/api/public/teams/{token}")
def public_team(token: str) -> JSONResponse:
    team = db.get_team_by_token(token)
    if not team:
        raise HTTPException(404, "not found")
    profile = profiles.team_profile(team["id"])
    profile["team"].pop("public_token", None)
    return JSONResponse(profile)


@app.get("/api/public/players/{token}")
def public_player(token: str) -> JSONResponse:
    player = db.get_player_by_token(token)
    if not player:
        raise HTTPException(404, "not found")
    return JSONResponse(profiles.player_profile(player["id"]))


@app.get("/{full_path:path}")
def serve_spa(full_path: str):
    """Serve built static assets; fall back to index.html for SPA routes.

    Registered last, so all /api/* routes take precedence.
    """
    candidate = (SPA_DIR / full_path).resolve()
    if (
        full_path
        and str(candidate).startswith(str(SPA_DIR.resolve()))
        and candidate.is_file()
    ):
        return FileResponse(candidate)
    index = SPA_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    raise HTTPException(404, "frontend not built — run `npm run build` in web/")
