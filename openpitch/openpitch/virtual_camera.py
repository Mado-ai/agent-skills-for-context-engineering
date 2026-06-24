"""Stage 4 — Virtual camera (the Pixellot-style auto-production core).

Given the full panoramic frame and the current tracking state, compute a
smoothly-moving crop window that follows the action, then render it to the
broadcast output resolution. This is the "robot cameraman": no operator,
the system decides where to point and how far to zoom.

Design:
* Action point = weighted blend of the ball position and the player
  centroid (ball dominates when present).
* Zoom adapts to how spread-out the players are (tight when bunched,
  wide on a counter-attack).
* The crop centre and width are exponentially smoothed and the per-frame
  pan is clamped, eliminating the jitter that makes naive object-follow
  cameras unwatchable.
"""

from __future__ import annotations

import cv2
import numpy as np

from .config import Config
from .track import FrameState


class VirtualCamera:
    def __init__(self, config: Config, src_w: int, src_h: int):
        self.cfg = config
        self.src_w = src_w
        self.src_h = src_h
        self.cx = 0.5 * src_w
        self.cy = 0.5 * src_h
        self.crop_w = config.base_zoom * src_w

    def _action_point(self, state: FrameState) -> tuple[float, float, float]:
        """Return target centre (px) and player spread (normalised)."""
        players = state.players
        if players:
            px = float(np.mean([p.cx for p in players]))
            py = float(np.mean([p.cy for p in players]))
            spread = float(
                np.std([p.cx for p in players]) + np.std([p.cy for p in players])
            )
        else:
            px, py, spread = 0.5, 0.5, 0.2

        if state.ball is not None:
            bx, by = state.ball
            w = self.cfg.ball_weight
            tx, ty = w * bx + (1 - w) * px, w * by + (1 - w) * py
        else:
            tx, ty = px, py
        return tx * self.src_w, ty * self.src_h, spread

    def update(self, state: FrameState) -> tuple[int, int, int, int]:
        tx, ty, spread = self._action_point(state)

        # Target zoom from spread, clamped.
        target_w = np.clip(
            (self.cfg.base_zoom + spread * 1.4) * self.src_w,
            self.cfg.min_zoom * self.src_w,
            self.cfg.max_zoom * self.src_w,
        )
        self.crop_w += (target_w - self.crop_w) * self.cfg.zoom_smoothing
        crop_h = self.crop_w / self.cfg.output_aspect

        # Smooth + clamp the pan.
        ncx = self.cx + (tx - self.cx) * self.cfg.pan_smoothing
        ncy = self.cy + (ty - self.cy) * self.cfg.pan_smoothing
        ncx = self.cx + np.clip(ncx - self.cx, -self.cfg.max_pan_px, self.cfg.max_pan_px)
        ncy = self.cy + np.clip(ncy - self.cy, -self.cfg.max_pan_px, self.cfg.max_pan_px)

        # Keep the window inside the frame.
        half_w, half_h = self.crop_w / 2, crop_h / 2
        self.cx = float(np.clip(ncx, half_w, self.src_w - half_w))
        self.cy = float(np.clip(ncy, half_h, self.src_h - half_h))

        x1 = int(self.cx - half_w)
        y1 = int(self.cy - half_h)
        return x1, y1, int(self.crop_w), int(crop_h)

    def render(self, frame: np.ndarray, rect: tuple[int, int, int, int]) -> np.ndarray:
        x1, y1, w, h = rect
        x1 = max(0, min(x1, self.src_w - 1))
        y1 = max(0, min(y1, self.src_h - 1))
        x2 = min(self.src_w, x1 + w)
        y2 = min(self.src_h, y1 + h)
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            crop = frame
        return cv2.resize(
            crop, (self.cfg.output_width, self.cfg.output_height),
            interpolation=cv2.INTER_LINEAR,
        )
