"""Stage 3 — Tracking.

Greedy nearest-neighbour tracker that assigns persistent IDs to players
across frames (a lightweight stand-in for SORT/ByteTrack). The ball is
tracked separately as a single smoothed point, tolerating short dropouts.

Coordinates are normalised throughout.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .config import Config
from .detect import Detection


@dataclass
class PlayerTrack:
    id: int
    team: int
    cx: float
    cy: float
    disappeared: int = 0
    path: list[tuple[int, float, float]] = field(default_factory=list)  # frame,x,y


@dataclass
class FrameState:
    frame: int
    players: list[PlayerTrack]
    ball: tuple[float, float] | None


class Tracker:
    def __init__(self, config: Config):
        self.cfg = config
        self._tracks: dict[int, PlayerTrack] = {}
        self._next_id = 0
        self._ball: tuple[float, float] | None = None
        self._ball_miss = 0

    def _new_track(self, det: Detection) -> PlayerTrack:
        t = PlayerTrack(id=self._next_id, team=det.team or 0, cx=det.cx, cy=det.cy)
        self._next_id += 1
        self._tracks[t.id] = t
        return t

    def update(self, frame_idx: int, detections: list[Detection]) -> FrameState:
        players = [d for d in detections if d.cls == "player"]
        balls = [d for d in detections if d.cls == "ball"]

        # --- match players to existing tracks (per team, greedy) ---
        unmatched = set(self._tracks)
        for det in players:
            candidates = [
                tid
                for tid in unmatched
                if self._tracks[tid].team == (det.team or 0)
            ]
            best_id, best_d = None, self.cfg.max_track_distance
            for tid in candidates:
                t = self._tracks[tid]
                d = float(np.hypot(t.cx - det.cx, t.cy - det.cy))
                if d < best_d:
                    best_id, best_d = tid, d
            if best_id is None:
                self._new_track(det)
            else:
                t = self._tracks[best_id]
                t.cx, t.cy, t.disappeared = det.cx, det.cy, 0
                unmatched.discard(best_id)

        # Age / retire unmatched tracks.
        for tid in list(unmatched):
            t = self._tracks[tid]
            t.disappeared += 1
            if t.disappeared > self.cfg.max_disappeared:
                del self._tracks[tid]

        # --- ball: nearest to previous position, with dropout tolerance ---
        if balls:
            if self._ball is None:
                pick = balls[0]
            else:
                pick = min(
                    balls,
                    key=lambda b: np.hypot(b.cx - self._ball[0], b.cy - self._ball[1]),
                )
            self._ball = (pick.cx, pick.cy)
            self._ball_miss = 0
        else:
            self._ball_miss += 1
            if self._ball_miss > self.cfg.max_disappeared:
                self._ball = None

        active = [t for t in self._tracks.values() if t.disappeared == 0]
        for t in active:
            t.path.append((frame_idx, t.cx, t.cy))

        return FrameState(frame=frame_idx, players=active, ball=self._ball)
