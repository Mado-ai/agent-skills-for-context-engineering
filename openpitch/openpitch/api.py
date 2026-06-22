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
import subprocess
import sys
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Form, HTTPException, UploadFile
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
                "players": result.analytics["players"][:14],
                "heatmaps": result.analytics["heatmaps"],
                "highlights": result.highlights,
                "meta": result.meta,
            },
        )
    except Exception as exc:  # surface failures to the client
        db.update_job(job_id, status="error", message=str(exc))


def _start(job_id: str, user_id: int, input_path: Path, detector: str,
           input_name: str) -> None:
    db.create_job(job_id, user_id, input_name, detector)
    threading.Thread(
        target=_run_job, args=(job_id, input_path, detector), daemon=True
    ).start()


# --- job endpoints ----------------------------------------------------------

@app.post("/api/jobs")
async def create_job(
    file: UploadFile,
    detector: str = Form("color"),
    user: dict = Depends(current_user),
) -> JSONResponse:
    if detector not in ("color", "yolo"):
        raise HTTPException(400, "detector must be 'color' or 'yolo'")
    job_id = uuid.uuid4().hex[:12]
    out_dir = RUNS / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    input_path = out_dir / "input.mp4"
    input_path.write_bytes(await file.read())
    _start(job_id, user["id"], input_path, detector, file.filename or "upload.mp4")
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
