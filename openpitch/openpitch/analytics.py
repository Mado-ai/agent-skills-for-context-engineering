"""Stage 6 — Performance analytics (the BePro-style core).

Consumes the per-frame tracking stream and produces:

* Possession % per team (which team holds the ball, frame by frame).
* Team heatmaps (where each side spent its time) as PNG images.
* Physical metrics: distance covered and top/avg speed per player,
  derived in metres using real pitch dimensions.
* Ball trajectory.

All distances use normalised coords scaled by PITCH_LENGTH_M / PITCH_WIDTH_M.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from .config import PITCH_LENGTH_M, PITCH_WIDTH_M, Config
from .track import FrameState

# A sprinting footballer tops out around 10-11 m/s. Larger per-frame steps are
# tracker ID-swaps (two players crossing), not real motion, so we ignore them
# for distance/speed to keep physical metrics credible.
MAX_PLAYER_SPEED_MS = 12.0


@dataclass
class Analytics:
    config: Config
    fps: float
    # (width, height) of the source frame, required for homography mapping.
    frame_size: tuple[int, int] | None = None
    # Image->metres homography; when None, an image-plane proxy is used.
    homography: "object | None" = None
    possession_frames: list[int] = field(default_factory=lambda: [0, 0])
    _positions: list[list[tuple[float, float]]] = field(
        default_factory=lambda: [[], []]
    )
    _player_paths: dict[int, dict] = field(default_factory=dict)
    ball_path: list[tuple[float, float]] = field(default_factory=list)
    # (frame, cumulative home frames, cumulative away frames) per processed frame.
    _timeline: list[tuple[int, int, int]] = field(default_factory=list)

    def _pitch_pos(self, cx: float, cy: float) -> tuple[float, float, float, float]:
        """Return (X_m, Y_m, norm_x, norm_y) for a normalised image point."""
        if self.homography is not None and self.frame_size is not None:
            w, h = self.frame_size
            X, Y = self.homography.to_pitch(cx * w, cy * h)
            nx, ny = self.homography.to_pitch_norm(cx * w, cy * h)
            return X, Y, nx, ny
        # Proxy: treat the image plane as the pitch.
        return cx * PITCH_LENGTH_M, cy * PITCH_WIDTH_M, cx, cy

    def update(self, state: FrameState) -> tuple[float, float]:
        """Ingest one frame; return cumulative possession (home, away) frames."""
        # Possession: team of player nearest the ball within radius (image space).
        if state.ball is not None and state.players:
            bx, by = state.ball
            nearest = min(
                state.players, key=lambda p: np.hypot(p.cx - bx, p.cy - by)
            )
            d = np.hypot(nearest.cx - bx, nearest.cy - by)
            if d <= self.config.possession_radius:
                self.possession_frames[nearest.team] += 1
            self.ball_path.append((bx, by))

        for p in state.players:
            X, Y, nx, ny = self._pitch_pos(p.cx, p.cy)
            self._positions[p.team].append((nx, ny))
            rec = self._player_paths.setdefault(
                p.id, {"team": p.team, "last": None, "dist_m": 0.0, "top_speed": 0.0}
            )
            if rec["last"] is not None:
                step = float(np.hypot(X - rec["last"][0], Y - rec["last"][1]))
                speed = step * self.fps  # m/s (one frame elapsed)
                if speed <= MAX_PLAYER_SPEED_MS:
                    rec["dist_m"] += step
                    rec["top_speed"] = max(rec["top_speed"], speed)
            rec["last"] = (X, Y)

        self._timeline.append(
            (state.frame, self.possession_frames[0], self.possession_frames[1])
        )
        return tuple(self.possession_frames)  # type: ignore[return-value]

    def possession_timeline(self, points: int = 60) -> list[dict]:
        """Downsampled cumulative possession % over time, for charting."""
        if not self._timeline:
            return []
        n = len(self._timeline)
        step = max(1, n // points)
        out = []
        for i in range(0, n, step):
            frame, home, away = self._timeline[i]
            total = home + away or 1
            out.append(
                {
                    "t": round(frame / self.fps, 1),
                    "home": round(100 * home / total, 1),
                    "away": round(100 * away / total, 1),
                }
            )
        return out

    # --- outputs ---

    def possession_pct(self) -> tuple[float, float]:
        total = sum(self.possession_frames) or 1
        return (
            100 * self.possession_frames[0] / total,
            100 * self.possession_frames[1] / total,
        )

    def _heatmap(self, team: int, out_path: Path) -> None:
        bins = self.config.heatmap_bins
        pts = self._positions[team]
        hist = np.zeros((bins, bins), np.float32)
        for cx, cy in pts:
            ix = min(bins - 1, int(cx * bins))
            iy = min(bins - 1, int(cy * bins))
            hist[iy, ix] += 1
        if hist.max() > 0:
            hist = cv2.GaussianBlur(hist, (0, 0), sigmaX=1.2)
            hist = (255 * hist / hist.max()).astype(np.uint8)
        img = cv2.applyColorMap(hist, cv2.COLORMAP_JET)
        img = cv2.resize(img, (525, 340), interpolation=cv2.INTER_CUBIC)
        # Pitch outline.
        cv2.rectangle(img, (5, 5), (520, 335), (255, 255, 255), 2)
        cv2.line(img, (262, 5), (262, 335), (255, 255, 255), 1)
        cv2.circle(img, (262, 170), 40, (255, 255, 255), 1)
        cv2.imwrite(str(out_path), img)

    def player_stats(self) -> list[dict]:
        rows = []
        for pid, rec in self._player_paths.items():
            rows.append(
                {
                    "player_id": pid,
                    "team": self.config.teams[rec["team"]].name,
                    "distance_m": round(rec["dist_m"], 1),
                    "top_speed_ms": round(rec["top_speed"], 2),
                }
            )
        rows.sort(key=lambda r: r["distance_m"], reverse=True)
        return rows

    def summary(self, out_dir: Path) -> dict:
        out_dir.mkdir(parents=True, exist_ok=True)
        self._heatmap(0, out_dir / "heatmap_home.png")
        self._heatmap(1, out_dir / "heatmap_away.png")
        home_p, away_p = self.possession_pct()
        return {
            "possession": {
                self.config.teams[0].name: round(home_p, 1),
                self.config.teams[1].name: round(away_p, 1),
            },
            "heatmaps": {
                self.config.teams[0].name: "heatmap_home.png",
                self.config.teams[1].name: "heatmap_away.png",
            },
            "players": self.player_stats(),
            "possession_timeline": self.possession_timeline(),
            "ball_path_points": len(self.ball_path),
            "calibration": "homography" if self.homography is not None else "proxy",
        }
