"""Stage 7 — Automatic highlights.

Heuristic event detector: moments where the ball moves fast **and** is in
an attacking third are flagged as exciting (shots, counter-attacks, balls
into the box). Flagged frames are merged into padded windows and exported
as standalone clips cut from the auto-produced broadcast video.

This is intentionally model-free and explainable; a production system would
add audio-energy peaks (crowd noise) and a learned event classifier.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .config import Config
from .encode import finalize, open_writer


@dataclass
class Highlight:
    start_s: float
    end_s: float
    peak_speed: float
    clip: str | None = None


class HighlightDetector:
    def __init__(self, config: Config, fps: float):
        self.cfg = config
        self.fps = fps
        # (frame_idx, ball_x or None, ball_y or None)
        self._ball: list[tuple[int, float | None, float | None]] = []

    def observe(self, frame_idx: int, ball: tuple[float, float] | None) -> None:
        if ball is None:
            self._ball.append((frame_idx, None, None))
        else:
            self._ball.append((frame_idx, ball[0], ball[1]))

    def _speed_series(self) -> list[tuple[int, float, float]]:
        """Return (frame, speed, x) for frames with a known ball position."""
        series = []
        prev = None
        for fi, x, y in self._ball:
            if x is None:
                prev = None
                continue
            if prev is not None:
                spd = float(np.hypot(x - prev[0], y - prev[1]))
                series.append((fi, spd, x))
            prev = (x, y)
        return series

    def detect(self) -> list[Highlight]:
        series = self._speed_series()
        if len(series) < 5:
            return []
        speeds = np.array([s for _, s, _ in series])
        thresh = float(np.percentile(speeds, self.cfg.highlight_speed_pctl))
        lo, hi = self.cfg.attacking_thirds

        flagged = [
            (fi, spd)
            for fi, spd, x in series
            if spd >= thresh and (x <= lo or x >= hi)
        ]
        if not flagged:
            return []

        # Merge consecutive flags (gap < pad) into windows.
        pad_f = self.cfg.highlight_pad_s * self.fps
        max_f = self.cfg.highlight_max_s * self.fps
        windows: list[Highlight] = []
        cur_start = cur_end = flagged[0][0]
        cur_peak = flagged[0][1]
        for fi, spd in flagged[1:]:
            if fi - cur_end <= pad_f:
                cur_end = fi
                cur_peak = max(cur_peak, spd)
            else:
                windows.append(self._window(cur_start, cur_end, cur_peak, pad_f, max_f))
                cur_start = cur_end = fi
                cur_peak = spd
        windows.append(self._window(cur_start, cur_end, cur_peak, pad_f, max_f))
        windows.sort(key=lambda h: h.peak_speed, reverse=True)
        return windows

    def _window(self, start_f, end_f, peak, pad_f, max_f) -> Highlight:
        s = max(0.0, (start_f - pad_f) / self.fps)
        e = (end_f + pad_f) / self.fps
        if e - s > max_f / self.fps:
            e = s + max_f / self.fps
        return Highlight(start_s=round(s, 2), end_s=round(e, 2), peak_speed=round(peak, 4))


def export_clips(
    broadcast_path: Path, highlights: list[Highlight], out_dir: Path, config: Config
) -> list[Highlight]:
    """Cut each highlight window out of the broadcast video."""
    out_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(broadcast_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    for i, h in enumerate(highlights):
        name = f"highlight_{i + 1:02d}.mp4"
        clip_path = out_dir / name
        writer, fourcc_used = open_writer(
            clip_path, fps, (config.output_width, config.output_height)
        )
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(h.start_s * fps))
        end_frame = int(h.end_s * fps)
        while cap.get(cv2.CAP_PROP_POS_FRAMES) <= end_frame:
            ok, frame = cap.read()
            if not ok:
                break
            writer.write(frame)
        writer.release()
        finalize(clip_path, fourcc_used)  # browser-friendly playback
        h.clip = name
    cap.release()
    return highlights
