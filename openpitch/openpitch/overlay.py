"""Stage 5 — Broadcast graphics overlay.

Burns a live scoreboard onto the auto-produced broadcast frame: team names,
running clock, and a live possession bar. Kept deliberately simple (OpenCV
primitives) — in production this would be an alpha-composited graphics layer.
"""

from __future__ import annotations

import cv2
import numpy as np

from .config import Config


def _put(img, text, org, scale, color, thick=2):
    cv2.putText(img, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), thick + 2,
                cv2.LINE_AA)
    cv2.putText(img, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thick,
                cv2.LINE_AA)


def draw_scoreboard(
    frame: np.ndarray,
    config: Config,
    clock_s: float,
    possession: tuple[float, float],
    score: tuple[int, int] = (0, 0),
) -> np.ndarray:
    h, w = frame.shape[:2]
    home, away = config.teams[0], config.teams[1]

    # Scoreboard pill, top-centre.
    bw, bh = 360, 54
    x0 = (w - bw) // 2
    overlay = frame.copy()
    cv2.rectangle(overlay, (x0, 12), (x0 + bw, 12 + bh), (25, 25, 25), -1)
    cv2.addWeighted(overlay, 0.65, frame, 0.35, 0, frame)
    cv2.rectangle(frame, (x0, 12), (x0 + 12, 12 + bh), home.bgr, -1)
    cv2.rectangle(frame, (x0 + bw - 12, 12), (x0 + bw, 12 + bh), away.bgr, -1)

    mm, ss = divmod(int(clock_s), 60)
    _put(frame, f"{home.name[:3].upper()}", (x0 + 24, 48), 0.7, (240, 240, 240))
    _put(frame, f"{score[0]} - {score[1]}", (x0 + 140, 48), 0.8, (255, 255, 255))
    _put(frame, f"{away.name[:3].upper()}", (x0 + bw - 90, 48), 0.7, (240, 240, 240))
    _put(frame, f"{mm:02d}:{ss:02d}", (x0 + 138, 22), 0.0001, (200, 200, 200), 1)

    # Possession bar, bottom.
    ph, pad = 22, 40
    py = h - 40
    total = max(possession[0] + possession[1], 1e-6)
    home_frac = possession[0] / total
    split = int((w - 2 * pad) * home_frac)
    cv2.rectangle(frame, (pad, py), (pad + split, py + ph), home.bgr, -1)
    cv2.rectangle(frame, (pad + split, py), (w - pad, py + ph), away.bgr, -1)
    _put(frame, f"{home_frac * 100:.0f}%", (pad + 8, py + 17), 0.5, (255, 255, 255), 1)
    _put(frame, f"{(1 - home_frac) * 100:.0f}%", (w - pad - 44, py + 17), 0.5,
         (255, 255, 255), 1)
    _put(frame, "POSSESSION", (w // 2 - 60, py - 6), 0.45, (220, 220, 220), 1)
    return frame
