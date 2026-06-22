#!/usr/bin/env python3
"""On-site sync agent — the gateway-side counterpart to /api/ingest/*.

Runs on the UniFi edge rack: authenticates with the site's device API key,
sends a heartbeat, then uploads a finished match clip to the cloud Ingestion
API. Idempotent (a retried upload returns the original job). Stdlib only.

    python sync_agent.py --server https://app.example.com \
        --device-key pmk_xxx --video match.mp4 --label "U15 vs City" --field-type 11
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.request
import uuid
from pathlib import Path


def _multipart(fields: dict[str, str], file_field: str, filename: str,
               file_bytes: bytes) -> tuple[bytes, str]:
    boundary = "----pmsync" + uuid.uuid4().hex
    out = bytearray()
    for name, value in fields.items():
        out += f"--{boundary}\r\n".encode()
        out += f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        out += f"{value}\r\n".encode()
    out += f"--{boundary}\r\n".encode()
    out += (f'Content-Disposition: form-data; name="{file_field}"; '
            f'filename="{filename}"\r\n').encode()
    out += b"Content-Type: video/mp4\r\n\r\n" + file_bytes + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), boundary


def _post(url: str, key: str, data: bytes = b"", content_type: str | None = None) -> dict:
    headers = {"X-Device-Key": key}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read() or b"{}")


def main() -> int:
    ap = argparse.ArgumentParser(prog="sync_agent")
    ap.add_argument("--server", required=True, help="cloud base URL")
    ap.add_argument("--device-key", required=True)
    ap.add_argument("--video", required=True)
    ap.add_argument("--label", default="Match")
    ap.add_argument("--field-type", type=int, default=11, choices=[5, 7, 11])
    ap.add_argument("--detector", default="color", choices=["color", "yolo"])
    args = ap.parse_args()

    base = args.server.rstrip("/")
    video = Path(args.video)
    if not video.exists():
        print(f"video not found: {video}", file=sys.stderr)
        return 1

    print("· heartbeat…")
    hb = _post(f"{base}/api/ingest/heartbeat", args.device_key)
    print(f"  device {hb.get('device_id')} @ site {hb.get('site_id')}")

    data = video.read_bytes()
    idem = hashlib.sha256(data).hexdigest()[:24]  # stable per file -> idempotent
    body, boundary = _multipart(
        {"match_label": args.label, "idempotency_key": idem, "detector": args.detector},
        "file", video.name, data)
    print(f"· uploading {video.name} ({len(data) // 1024} KB)…")
    res = _post(f"{base}/api/ingest/matches", args.device_key, body,
                f"multipart/form-data; boundary={boundary}")
    print(f"  job {res.get('job_id')} (deduplicated={res.get('deduplicated')})")
    print("done — analysis runs in the cloud; results appear in the dashboard.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
