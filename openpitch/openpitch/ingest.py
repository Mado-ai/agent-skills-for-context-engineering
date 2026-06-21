"""Stage 1 — Ingest.

Represents the panoramic capture feed. In a production Pixellot-style system
this is where you'd terminate RTSP/SRT streams from fixed wide-angle cameras
and stitch them; here we read a single wide-angle video file frame by frame.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import cv2
import numpy as np


@dataclass
class VideoMeta:
    width: int
    height: int
    fps: float
    frame_count: int

    @property
    def duration_s(self) -> float:
        return self.frame_count / self.fps if self.fps else 0.0


class VideoSource:
    """Thin iterator over a video file with metadata."""

    def __init__(self, path: str | Path):
        self.path = str(path)
        if not Path(self.path).exists():
            raise FileNotFoundError(self.path)
        self._cap = cv2.VideoCapture(self.path)
        if not self._cap.isOpened():
            raise RuntimeError(f"could not open video: {self.path}")
        self.meta = VideoMeta(
            width=int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            height=int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            fps=self._cap.get(cv2.CAP_PROP_FPS) or 25.0,
            frame_count=int(self._cap.get(cv2.CAP_PROP_FRAME_COUNT)),
        )

    def frames(self) -> Iterator[tuple[int, np.ndarray]]:
        idx = 0
        while True:
            ok, frame = self._cap.read()
            if not ok:
                break
            yield idx, frame
            idx += 1
        self._cap.release()

    def close(self) -> None:
        if self._cap.isOpened():
            self._cap.release()
