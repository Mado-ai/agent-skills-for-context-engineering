"""The match-analysis task — the unit of work run by the job queue.

Importable by both the in-process thread backend and an RQ worker (separate
process), so each builds its own storage handle. GPU acceleration is a
deployment concern: run the worker with ``detector=yolo`` on a GPU node.
"""

from __future__ import annotations

from . import db, storage
from .config import Config
from .pipeline import process_video

_STORAGE = storage.get_storage()


def run_job(job_id: str, input_path: str, detector: str) -> None:
    out_dir = _STORAGE.job_dir(job_id)
    try:
        def progress(p: float, msg: str) -> None:
            db.update_job(job_id, progress=p, message=msg, status="running")

        result = process_video(input_path, out_dir, Config(detector=detector), progress)
        _STORAGE.finalize_job(job_id)  # upload artifacts (no-op for local storage)
        db.update_job(
            job_id,
            status="done",
            progress=1.0,
            message="done",
            summary={
                "possession": result.analytics["possession"],
                "possession_timeline": result.analytics["possession_timeline"],
                "players": result.analytics["players"][:28],
                "team_stats": result.analytics["team_stats"],
                "heatmaps": result.analytics["heatmaps"],
                "shots": result.analytics.get("shots", []),
                "pass_network": result.analytics.get("pass_network", {}),
                "zones": result.analytics.get("zones", {}),
                "highlights": result.highlights,
                "meta": result.meta,
            },
        )
    except Exception as exc:  # surface failures to the client
        db.update_job(job_id, status="error", message=str(exc))
