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

import os
import shutil
import subprocess
import sys
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import auth, db
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

VALID_PACKAGES = {"starter", "growth", "pro"}


@app.post("/api/sites")
def create_site(
    name: str = Form(...),
    package: str = Form(...),
    user: dict = Depends(current_user),
) -> JSONResponse:
    if package not in VALID_PACKAGES:
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
