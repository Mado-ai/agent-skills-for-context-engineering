"""Object-storage abstraction — local filesystem or S3.

The pipeline always writes artifacts to a **local working dir** (OpenCV/ffmpeg
need real files); ``finalize_job`` then persists them (no-op for local, upload
for S3). Reads are served either as a local file or an S3 presigned URL.

Select via ``PLAYMETRICS_STORAGE``:
* ``local`` (default) — files live under ``PLAYMETRICS_DATA``.
* ``s3`` — upload to ``PLAYMETRICS_S3_BUCKET`` (prefix ``PLAYMETRICS_S3_PREFIX``);
  reads return presigned GET URLs. Local working copies are removed after upload.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path


def _safe_rel(rel: str) -> str:
    # Reject path traversal in the relative artifact path.
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise ValueError("invalid path")
    return "/".join(parts)


class Storage:
    root: Path

    def job_dir(self, job_id: str) -> Path:
        raise NotImplementedError

    def finalize_job(self, job_id: str) -> None:
        """Persist a finished job's artifacts (no-op for local)."""

    def local_path(self, job_id: str, rel: str) -> Path | None:
        return None

    def presigned_url(self, job_id: str, rel: str) -> str | None:
        return None

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

    def local_path(self, job_id: str, rel: str) -> Path | None:
        target = (self.root / job_id / _safe_rel(rel)).resolve()
        if not str(target).startswith(str(self.root.resolve())) or not target.is_file():
            return None
        return target

    def delete_job(self, job_id: str) -> None:
        shutil.rmtree(self.root / job_id, ignore_errors=True)


class S3Storage(Storage):
    def __init__(self, bucket: str, prefix: str = "", work_root: str | Path = "/tmp/playmetrics"):
        import boto3  # noqa: PLC0415 (optional dependency)

        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.root = Path(work_root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._s3 = boto3.client("s3")
        self._url_ttl = 6 * 3600

    def _key(self, job_id: str, rel: str = "") -> str:
        parts = [p for p in (self.prefix, job_id, _safe_rel(rel)) if p]
        return "/".join(parts)

    def job_dir(self, job_id: str) -> Path:
        d = self.root / job_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def finalize_job(self, job_id: str) -> None:
        local = self.root / job_id
        if not local.exists():
            return
        for f in local.rglob("*"):
            if f.is_file():
                rel = f.relative_to(local).as_posix()
                self._s3.upload_file(str(f), self.bucket, self._key(job_id, rel))
        shutil.rmtree(local, ignore_errors=True)  # working copy no longer needed

    def presigned_url(self, job_id: str, rel: str) -> str | None:
        return self._s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": self._key(job_id, rel)},
            ExpiresIn=self._url_ttl,
        )

    def delete_job(self, job_id: str) -> None:
        shutil.rmtree(self.root / job_id, ignore_errors=True)
        token = None
        prefix = self._key(job_id) + "/"
        while True:
            kw = {"Bucket": self.bucket, "Prefix": prefix}
            if token:
                kw["ContinuationToken"] = token
            resp = self._s3.list_objects_v2(**kw)
            objs = [{"Key": o["Key"]} for o in resp.get("Contents", [])]
            if objs:
                self._s3.delete_objects(Bucket=self.bucket, Delete={"Objects": objs})
            if not resp.get("IsTruncated"):
                break
            token = resp.get("NextContinuationToken")


def get_storage() -> Storage:
    backend = os.environ.get("PLAYMETRICS_STORAGE", "local").lower()
    if backend == "s3":
        bucket = os.environ.get("PLAYMETRICS_S3_BUCKET")
        if not bucket:
            raise RuntimeError("PLAYMETRICS_S3_BUCKET is required for s3 storage")
        return S3Storage(bucket, os.environ.get("PLAYMETRICS_S3_PREFIX", "jobs"),
                         os.environ.get("PLAYMETRICS_DATA", "/tmp/playmetrics"))
    root = os.environ.get("PLAYMETRICS_DATA", str(Path(__file__).resolve().parent.parent / "runs"))
    return LocalStorage(root)
