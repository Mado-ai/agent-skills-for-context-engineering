"""HTTP API + static frontend host.

A thin FastAPI layer over the pipeline so the browser dashboard can upload a
clip, poll progress, and view the auto-produced broadcast, analytics and
highlights. Jobs run on a background thread with an in-memory registry
(swap for Celery/RQ + object storage in production).

    uvicorn openpitch.api:app --reload
"""

from __future__ import annotations

import threading
import uuid
from pathlib import Path

from fastapi import FastAPI, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import Config
from .pipeline import process_video

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / "runs"
FRONTEND = ROOT / "frontend"
RUNS.mkdir(exist_ok=True)

app = FastAPI(title="OpenPitch", version="0.1.0")

# job_id -> {status, progress, message, summary?}
JOBS: dict[str, dict] = {}


def _run_job(job_id: str, input_path: Path, detector: str) -> None:
    out_dir = RUNS / job_id
    try:
        def progress(p: float, msg: str) -> None:
            JOBS[job_id].update(progress=p, message=msg, status="running")

        result = process_video(input_path, out_dir, Config(detector=detector), progress)
        JOBS[job_id].update(
            status="done",
            progress=1.0,
            message="done",
            summary={
                "possession": result.analytics["possession"],
                "players": result.analytics["players"][:12],
                "heatmaps": result.analytics["heatmaps"],
                "highlights": result.highlights,
                "meta": result.meta,
            },
        )
    except Exception as exc:  # surface failures to the client
        JOBS[job_id].update(status="error", message=str(exc))


def _start(job_id: str, input_path: Path, detector: str) -> None:
    JOBS[job_id] = {"status": "queued", "progress": 0.0, "message": "queued"}
    threading.Thread(
        target=_run_job, args=(job_id, input_path, detector), daemon=True
    ).start()


@app.post("/api/jobs")
async def create_job(file: UploadFile, detector: str = "color") -> JSONResponse:
    job_id = uuid.uuid4().hex[:12]
    out_dir = RUNS / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    input_path = out_dir / "input.mp4"
    input_path.write_bytes(await file.read())
    _start(job_id, input_path, detector)
    return JSONResponse({"job_id": job_id})


@app.post("/api/demo")
def create_demo(seconds: int = 10) -> JSONResponse:
    import subprocess
    import sys

    job_id = uuid.uuid4().hex[:12]
    out_dir = RUNS / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    sample = out_dir / "input.mp4"
    subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "generate_sample.py"),
         "--out", str(sample), "--seconds", str(seconds)],
        check=True,
    )
    _start(job_id, sample, "color")
    return JSONResponse({"job_id": job_id})


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> JSONResponse:
    job = JOBS.get(job_id)
    if not job:
        return JSONResponse({"error": "not found"}, status_code=404)
    return JSONResponse(job)


@app.get("/api/files/{job_id}/{path:path}")
def serve_file(job_id: str, path: str):
    target = (RUNS / job_id / path).resolve()
    if not str(target).startswith(str(RUNS.resolve())) or not target.exists():
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(target)


if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
