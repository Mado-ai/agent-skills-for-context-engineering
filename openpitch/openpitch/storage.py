"""Object-storage abstraction.

Local filesystem today; the interface is S3/GCS-ready so production can swap
in object storage without touching the pipeline or API. Select via
``PLAYMETRICS_STORAGE`` (``local`` default; ``s3`` reserved). Job artifacts
(broadcast, heatmaps, highlights) live under a per-job prefix.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path


class Storage:
    def job_dir(self, job_id: str) -> Path:  # local working dir for a job
        raise NotImplementedError

    def path(self, job_id: str, rel: str) -> Path:
        raise NotImplementedError

    def delete_job(self, job_id: str) -> None:
        raise NotImplementedError


class LocalStorage(Storage):
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def job_dir(self, job_id: str) -> Path:
        d = self.root / job_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def path(self, job_id: str, rel: str) -> Path:
        return (self.root / job_id / rel)

    def delete_job(self, job_id: str) -> None:
        shutil.rmtree(self.root / job_id, ignore_errors=True)


def get_storage() -> Storage:
    backend = os.environ.get("PLAYMETRICS_STORAGE", "local").lower()
    root = os.environ.get("PLAYMETRICS_DATA", str(Path(__file__).resolve().parent.parent / "runs"))
    if backend == "s3":
        # Production: an S3Storage(boto3, bucket=PLAYMETRICS_S3_BUCKET) implements
        # the same interface (upload job_dir on completion, presign on read).
        raise NotImplementedError("s3 backend not yet implemented; use 'local'")
    return LocalStorage(root)
