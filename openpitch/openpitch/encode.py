"""Video encoding helpers for browser-friendly output.

The dashboard plays results in HTML5 ``<video>`` tags, which require **H.264**
(``avc1``). OpenCV's bundled FFmpeg can't always write H.264 (it often only
offers ``mp4v`` / MPEG-4 Part 2, which browsers won't decode). So we:

1. Try to open the writer as ``avc1`` directly (works on many local builds).
2. Otherwise fall back to ``mp4v`` and, if the ``ffmpeg`` CLI is available,
   transcode the finished file to H.264 + ``faststart`` for web streaming.

If neither path yields H.264 (no avc1 support and no ffmpeg), the file stays
``mp4v`` — still valid, just not playable in most browsers (use VLC / install
ffmpeg). This keeps the pipeline runnable everywhere.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import cv2

_PREFERRED_FOURCC = ["avc1", "mp4v"]


def open_writer(path, fps: float, size: tuple[int, int]):
    """Return (VideoWriter, fourcc_used), preferring browser-friendly H.264."""
    for cc in _PREFERRED_FOURCC:
        writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*cc), fps, size)
        if writer.isOpened():
            return writer, cc
    raise RuntimeError(f"no usable video codec for {path}")


def has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def ensure_h264(path) -> bool:
    """Transcode a file to H.264 in place via ffmpeg. Returns True on success."""
    path = Path(path)
    if not has_ffmpeg() or not path.exists():
        return False
    tmp = path.with_suffix(".h264.mp4")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(path),
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
             str(tmp)],
            check=True,
        )
        tmp.replace(path)
        return True
    except Exception:
        if tmp.exists():
            tmp.unlink()
        return False


def finalize(path, fourcc_used: str) -> None:
    """Make a just-written file browser-friendly if it isn't already H.264."""
    if fourcc_used != "avc1":
        ensure_h264(path)
