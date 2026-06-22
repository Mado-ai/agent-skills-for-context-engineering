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

# Speed zones (m/s) for work-rate breakdown.
_SPRINT_MS = 7.0
_RUN_MS = 4.0
_JOG_MS = 2.0


def _zone(speed: float) -> str:
    if speed >= _SPRINT_MS:
        return "sprint"
    if speed >= _RUN_MS:
        return "run"
    if speed >= _JOG_MS:
        return "jog"
    return "walk"


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
    # (track_id, team) of the last in-possession player, for pass/turnover events.
    _last_poss: tuple | None = None

    def _pitch_pos(self, cx: float, cy: float) -> tuple[float, float, float, float]:
        """Return (X_m, Y_m, norm_x, norm_y) for a normalised image point."""
        if self.homography is not None and self.frame_size is not None:
            w, h = self.frame_size
            X, Y = self.homography.to_pitch(cx * w, cy * h)
            nx, ny = self.homography.to_pitch_norm(cx * w, cy * h)
            return X, Y, nx, ny
        # Proxy: treat the image plane as the pitch.
        return cx * PITCH_LENGTH_M, cy * PITCH_WIDTH_M, cx, cy

    def _rec(self, pid: int, team: int) -> dict:
        return self._player_paths.setdefault(pid, {
            "team": team, "last": None, "dist_m": 0.0, "top_speed": 0.0,
            "frames": 0, "in_sprint": False, "sprints": 0, "poss": 0,
            "touches": 0, "passes": 0, "completed": 0, "turnovers": 0,
            "zones": {"walk": 0.0, "jog": 0.0, "run": 0.0, "sprint": 0.0},
            "numbers": {},
        })

    def update(self, state: FrameState) -> tuple[float, float]:
        """Ingest one frame; return cumulative possession (home, away) frames."""
        possessor = None
        if state.ball is not None and state.players:
            bx, by = state.ball
            nearest = min(state.players, key=lambda p: np.hypot(p.cx - bx, p.cy - by))
            if np.hypot(nearest.cx - bx, nearest.cy - by) <= self.config.possession_radius:
                possessor = nearest
                self.possession_frames[nearest.team] += 1
            self.ball_path.append((bx, by))

        for p in state.players:
            X, Y, nx, ny = self._pitch_pos(p.cx, p.cy)
            self._positions[p.team].append((nx, ny))
            rec = self._rec(p.id, p.team)
            rec["frames"] += 1
            if p.number is not None:  # vote jersey numbers across frames
                rec["numbers"][p.number] = rec["numbers"].get(p.number, 0) + 1
            if rec["last"] is not None:
                step = float(np.hypot(X - rec["last"][0], Y - rec["last"][1]))
                speed = step * self.fps  # m/s (one frame elapsed)
                if speed <= MAX_PLAYER_SPEED_MS:
                    rec["dist_m"] += step
                    rec["top_speed"] = max(rec["top_speed"], speed)
                    rec["zones"][_zone(speed)] += step
                    if speed >= _SPRINT_MS and not rec["in_sprint"]:
                        rec["sprints"] += 1
                        rec["in_sprint"] = True
                    elif speed < _SPRINT_MS:
                        rec["in_sprint"] = False
            rec["last"] = (X, Y)

        # Individual possession + pass/turnover events on possession change.
        if possessor is not None:
            self._rec(possessor.id, possessor.team)["poss"] += 1
            cur = (possessor.id, possessor.team)
            if self._last_poss is None or self._last_poss[0] != cur[0]:
                self._player_paths[cur[0]]["touches"] += 1
                if self._last_poss is not None:
                    prev_id, prev_team = self._last_poss
                    prev = self._player_paths.get(prev_id)
                    if prev is not None:
                        prev["passes"] += 1
                        if prev_team == cur[1]:
                            prev["completed"] += 1
                        else:
                            prev["turnovers"] += 1
            self._last_poss = cur

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
        """Per-player stats, re-identified by jersey number where available.

        The greedy tracker fragments a player into several track IDs; the OCR'd
        jersey number is a stable identity, so we merge fragments that share a
        (team, jersey). Fragments with no confident number stay separate.
        """
        groups: dict[tuple, dict] = {}
        for pid, rec in self._player_paths.items():
            numbers = rec.get("numbers") or {}
            jersey = max(numbers, key=numbers.get) if numbers else None
            votes = numbers.get(jersey, 0)
            # Drop barely-seen spurious reads so they don't pollute the roster.
            key = (rec["team"], jersey) if (jersey and votes >= 3) else ("trk", pid)
            g = groups.setdefault(key, {
                "team": rec["team"], "jersey": jersey if key[0] != "trk" else None,
                "dist": 0.0, "top": 0.0, "frames": 0, "sprints": 0, "poss": 0,
                "touches": 0, "passes": 0, "completed": 0, "turnovers": 0,
                "zones": {"walk": 0.0, "jog": 0.0, "run": 0.0, "sprint": 0.0}})
            g["dist"] += rec["dist_m"]
            g["top"] = max(g["top"], rec["top_speed"])
            for k in ("frames", "sprints", "poss", "touches", "passes",
                      "completed", "turnovers"):
                g[k] += rec.get(k, 0)
            for z in g["zones"]:
                g["zones"][z] += rec["zones"][z]

        rows = []
        for (k0, k1), g in groups.items():
            name = self.config.teams[g["team"]].name
            pid = f"{name}#{g['jersey']}" if g["jersey"] is not None else f"trk{k1}"
            secs = g["frames"] / self.fps if g["frames"] else 0
            attempts = g["passes"]
            rows.append({
                "player_id": pid,
                "team": name,
                "jersey": g["jersey"],
                "distance_m": round(g["dist"], 1),
                "top_speed_ms": round(g["top"], 2),
                "avg_speed_ms": round(g["dist"] / secs, 2) if secs else 0,
                "sprints": g["sprints"],
                "touches": g["touches"],
                "passes": attempts,
                "pass_accuracy": round(100 * g["completed"] / attempts, 1) if attempts else None,
                "turnovers": g["turnovers"],
                "possession_s": round(g["poss"] / self.fps, 1),
                "zones_m": {z: round(v, 1) for z, v in g["zones"].items()},
            })
        rows.sort(key=lambda r: r["distance_m"], reverse=True)
        return rows

    def team_stats(self) -> dict:
        """Team-level report metrics derived from the per-player rows."""
        out = {}
        rows = self.player_stats()
        for i, team in enumerate(self.config.teams):
            tr = [r for r in rows if r["team"] == team.name]
            completed = sum(r["passes"] - r["turnovers"] for r in tr)
            attempts = sum(r["passes"] for r in tr)
            out[team.name] = {
                "distance_km": round(sum(r["distance_m"] for r in tr) / 1000, 2),
                "sprints": sum(r["sprints"] for r in tr),
                "passes": attempts,
                "pass_accuracy": round(100 * completed / attempts, 1) if attempts else None,
                "turnovers": sum(r["turnovers"] for r in tr),
                "top_speed_ms": round(max((r["top_speed_ms"] for r in tr), default=0), 2),
            }
        return out

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
            "team_stats": self.team_stats(),
            "possession_timeline": self.possession_timeline(),
            "ball_path_points": len(self.ball_path),
            "calibration": "homography" if self.homography is not None else "proxy",
        }
