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

from . import events
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
# High-intensity accel/decel threshold (m/s^2) — BePro-style burst counting.
_ACCEL_MS2 = 2.5


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
    # Possession-spell tracking for passes/turnovers (debounced to ignore the
    # per-frame flicker of "nearest player" in congested play).
    _cand: tuple | None = None
    _cand_n: int = 0
    _confirmed: tuple | None = None
    # Event-model inputs: ball positions in metres and confirmed possession
    # spells (see events.py). Filled during update(), consumed lazily.
    _ball_m: list[tuple[int, float, float]] = field(default_factory=list)
    _spells: list[dict] = field(default_factory=list)
    # Downsampled per-frame player positions in metres, for off-ball metrics
    # (runs in behind): (frame, [(pid, team, X_m), ...]).
    _pos_stream: list[tuple[int, list]] = field(default_factory=list)
    _event_cache: tuple | None = None
    _shots: list = field(default_factory=list)

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
            "frames": 0, "sprint_run": 0, "sprints": 0, "poss": 0,
            "touches": 0, "passes": 0, "completed": 0, "turnovers": 0,
            "zones": {"walk": 0.0, "jog": 0.0, "run": 0.0, "sprint": 0.0},
            "numbers": {}, "sum_x": 0.0, "sum_nx": 0.0, "sum_ny": 0.0,
            "last_speed": None, "acc_run": 0, "dec_run": 0,
            "accels": 0, "decels": 0,
        })

    def update(self, state: FrameState) -> tuple[float, float]:
        """Ingest one frame; return cumulative possession (home, away) frames."""
        possessor = None
        ball_m: tuple[float, float] | None = None
        if state.ball is not None and state.players:
            bx, by = state.ball
            nearest = min(state.players, key=lambda p: np.hypot(p.cx - bx, p.cy - by))
            if np.hypot(nearest.cx - bx, nearest.cy - by) <= self.config.possession_radius:
                possessor = nearest
                self.possession_frames[nearest.team] += 1
            self.ball_path.append((bx, by))
            bX, bY, _, _ = self._pitch_pos(bx, by)
            ball_m = (bX, bY)
            self._ball_m.append((state.frame, bX, bY))

        lineup: list[tuple] = []  # (pid, team, X_m) for every player this frame
        for p in state.players:
            X, Y, nx, ny = self._pitch_pos(p.cx, p.cy)
            self._positions[p.team].append((nx, ny))
            lineup.append((p.id, p.team, X))
            rec = self._rec(p.id, p.team)
            rec["frames"] += 1
            rec["sum_x"] += X  # mean X drives attack-direction inference
            rec["sum_nx"] += nx
            rec["sum_ny"] += ny
            if p.number is not None:  # vote jersey numbers across frames
                rec["numbers"][p.number] = rec["numbers"].get(p.number, 0) + 1
            if rec["last"] is not None:
                step = float(np.hypot(X - rec["last"][0], Y - rec["last"][1]))
                speed = step * self.fps  # m/s (one frame elapsed)
                if speed <= MAX_PLAYER_SPEED_MS:
                    rec["dist_m"] += step
                    rec["top_speed"] = max(rec["top_speed"], speed)
                    rec["zones"][_zone(speed)] += step
                    # Sprint = speed sustained above threshold for >= ~0.5s, so
                    # single-frame jitter doesn't inflate the count.
                    if speed >= _SPRINT_MS:
                        rec["sprint_run"] += 1
                        if rec["sprint_run"] == max(2, round(0.5 * self.fps)):
                            rec["sprints"] += 1
                    else:
                        rec["sprint_run"] = 0
                    # Accelerations / decelerations: a burst counts once the
                    # rate stays past +/- _ACCEL_MS2 for ~0.25 s, so per-frame
                    # tracking jitter doesn't inflate the count (BePro-style).
                    if rec["last_speed"] is not None:
                        a = (speed - rec["last_speed"]) * self.fps
                        need = max(2, round(0.25 * self.fps))
                        if a >= _ACCEL_MS2:
                            rec["acc_run"] += 1
                            rec["dec_run"] = 0
                            if rec["acc_run"] == need:
                                rec["accels"] += 1
                        elif a <= -_ACCEL_MS2:
                            rec["dec_run"] += 1
                            rec["acc_run"] = 0
                            if rec["dec_run"] == need:
                                rec["decels"] += 1
                        else:
                            rec["acc_run"] = rec["dec_run"] = 0
                    rec["last_speed"] = speed
                else:
                    rec["last_speed"] = None  # ID swap — don't fake an accel
                    rec["acc_run"] = rec["dec_run"] = 0
            rec["last"] = (X, Y)

        # Downsampled positional snapshot (~5 Hz) for off-ball metrics.
        if lineup and state.frame % max(1, round(0.2 * self.fps)) == 0:
            self._pos_stream.append((state.frame, lineup))

        # Individual possession + passes. A "spell" is only confirmed once a
        # player has been the nearest within radius for >= ~0.4s, so brief
        # contests don't spawn phantom passes/turnovers. A pass/turnover is the
        # transition between two confirmed spells.
        if possessor is not None:
            pid, team = possessor.id, possessor.team
            self._rec(pid, team)["poss"] += 1
            if self._cand and self._cand[0] == pid:
                self._cand_n += 1
            else:
                self._cand, self._cand_n = (pid, team), 1
            min_hold = max(2, round(0.4 * self.fps))
            if self._cand_n == min_hold and (self._confirmed is None or self._confirmed[0] != pid):
                self._player_paths[pid]["touches"] += 1
                if self._confirmed is not None:
                    ppid, pteam = self._confirmed
                    prev = self._player_paths.get(ppid)
                    if prev is not None:
                        prev["passes"] += 1
                        if pteam == team:
                            prev["completed"] += 1
                        else:
                            prev["turnovers"] += 1
                self._confirmed = (pid, team)
                # Open a new spell for the event model: the ball's metric
                # position when this player gained possession (fall back to the
                # player's own position if the ball wasn't located this frame).
                pos = ball_m or self._pitch_pos(possessor.cx, possessor.cy)[:2]
                self._spells.append({
                    "pid": pid, "team": team, "frame": state.frame, "start": pos,
                    "lineup": lineup,  # all players' X at the moment of the gain
                })

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
            # Real tracking feeds can carry NaN / off-pitch points; skip them.
            if not (0.0 <= cx <= 1.0 and 0.0 <= cy <= 1.0):
                continue
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

    def _events(self) -> tuple[dict, dict]:
        """Per-track and per-team event aggregates (xT, shots, xG). Cached."""
        if self._event_cache is None:
            means: dict[int, dict[int, tuple[float, int]]] = {0: {}, 1: {}}
            for pid, rec in self._player_paths.items():
                f = rec["frames"]
                if f:
                    means[rec["team"]][pid] = (rec["sum_x"] / f, f)
            by_pid, by_team, shots = events.compute(
                self._spells, self._ball_m, means, self.fps, self._pos_stream)
            self._shots = shots
            self._event_cache = (by_pid, by_team)
        return self._event_cache

    def player_stats(self) -> list[dict]:
        """Per-player stats, re-identified by jersey number where available.

        The greedy tracker fragments a player into several track IDs; the OCR'd
        jersey number is a stable identity, so we merge fragments that share a
        (team, jersey). Fragments with no confident number stay separate.
        """
        ev_by_pid, _ = self._events()
        groups: dict[tuple, dict] = {}
        for pid, rec in self._player_paths.items():
            numbers = rec.get("numbers") or {}
            jersey = max(numbers, key=numbers.get) if numbers else None
            votes = numbers.get(jersey, 0)
            total = sum(numbers.values())
            # Accept a jersey only if it's the clear majority of this track's
            # reads (>=3 votes and >50%), so one-off OCR misreads are dropped.
            if not (jersey and votes >= 3 and votes >= 0.5 * total):
                jersey = None
            key = (rec["team"], jersey) if jersey is not None else ("trk", pid)
            g = groups.setdefault(key, {
                "team": rec["team"], "jersey": jersey if key[0] != "trk" else None,
                "dist": 0.0, "top": 0.0, "frames": 0, "sprints": 0, "poss": 0,
                "touches": 0, "passes": 0, "completed": 0, "turnovers": 0,
                "zones": {"walk": 0.0, "jog": 0.0, "run": 0.0, "sprint": 0.0},
                "xt_added": 0.0, "progressive": 0, "final_third": 0,
                "shots": 0, "xg": 0.0, "accels": 0, "decels": 0,
                "xa": 0.0, "line_breaking": 0, "packing": 0, "runs_in_behind": 0})
            g["dist"] += rec["dist_m"]
            g["top"] = max(g["top"], rec["top_speed"])
            for k in ("frames", "sprints", "poss", "touches", "passes",
                      "completed", "turnovers", "accels", "decels"):
                g[k] += rec.get(k, 0)
            for z in g["zones"]:
                g["zones"][z] += rec["zones"][z]
            ev = ev_by_pid.get(pid)
            if ev:
                g["xt_added"] += ev["xt_added"]
                g["xg"] += ev["xg"]
                g["xa"] += ev["xa"]
                for k in ("progressive", "final_third", "shots",
                          "line_breaking", "packing", "runs_in_behind"):
                    g[k] += ev[k]

        have_jersey = any(g["jersey"] is not None for g in groups.values())
        rows = []
        for (k0, k1), g in groups.items():
            # Once any player is identified, drop unidentified tracker fragments
            # (noise/duplicates) from the per-player report.
            if have_jersey and g["jersey"] is None:
                continue
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
                "xt_added": round(g["xt_added"], 3),
                "progressive_passes": g["progressive"],
                "final_third_passes": g["final_third"],
                "shots": g["shots"],
                "xg": round(g["xg"], 3),
                "accelerations": g["accels"],
                "decelerations": g["decels"],
                "hsr_m": round(g["zones"]["run"] + g["zones"]["sprint"], 1),
                "sprint_dist_m": round(g["zones"]["sprint"], 1),
                "xa": round(g["xa"], 3),
                "line_breaking_passes": g["line_breaking"],
                "packing": g["packing"],
                "runs_in_behind": g["runs_in_behind"],
            })
        rows.sort(key=lambda r: r["distance_m"], reverse=True)
        return rows

    def team_stats(self) -> dict:
        """Team-level report metrics derived from the per-player rows."""
        out = {}
        rows = self.player_stats()
        _, by_team = self._events()
        for i, team in enumerate(self.config.teams):
            tr = [r for r in rows if r["team"] == team.name]
            completed = sum(r["passes"] - r["turnovers"] for r in tr)
            attempts = sum(r["passes"] for r in tr)
            te = by_team.get(i)
            out[team.name] = {
                "distance_km": round(sum(r["distance_m"] for r in tr) / 1000, 2),
                "sprints": sum(r["sprints"] for r in tr),
                "passes": attempts,
                "pass_accuracy": round(100 * completed / attempts, 1) if attempts else None,
                "turnovers": sum(r["turnovers"] for r in tr),
                "top_speed_ms": round(max((r["top_speed_ms"] for r in tr), default=0), 2),
                "xt_added": round(sum(r["xt_added"] for r in tr), 2),
                "progressive_passes": sum(r["progressive_passes"] for r in tr),
                "final_third_passes": sum(r["final_third_passes"] for r in tr),
                "shots": sum(r["shots"] for r in tr),
                "xg": round(sum(r["xg"] for r in tr), 2),
                "final_third_entries": te.final_third_entries if te else 0,
                "final_third_time_s": round(te.final_third_time_s, 1) if te else 0.0,
                "final_third_channels": te.channel_dict() if te else {"left": 0, "center": 0, "right": 0},
                "xa": round(sum(r["xa"] for r in tr), 2),
                "line_breaking_passes": sum(r["line_breaking_passes"] for r in tr),
                "packing": sum(r["packing"] for r in tr),
                "runs_in_behind": sum(r["runs_in_behind"] for r in tr),
            }
        return out

    def _identity(self) -> dict:
        """pid -> (team, jersey|None) using the same majority rule as player_stats."""
        ident = {}
        for pid, rec in self._player_paths.items():
            numbers = rec.get("numbers") or {}
            jersey = max(numbers, key=numbers.get) if numbers else None
            votes = numbers.get(jersey, 0)
            total = sum(numbers.values())
            if not (jersey and votes >= 3 and votes >= 0.5 * total):
                jersey = None
            ident[pid] = (rec["team"], jersey)
        return ident

    def pass_network(self) -> dict:
        """Per-team average positions (nodes) + pass links (edges), keyed by jersey."""
        ident = self._identity()
        agg: dict[tuple, dict] = {}
        for pid, rec in self._player_paths.items():
            team, jersey = ident[pid]
            if jersey is None or not rec["frames"]:
                continue
            a = agg.setdefault((team, jersey), {
                "team": team, "jersey": jersey, "fnx": 0.0, "fny": 0.0, "frames": 0, "passes": 0})
            a["fnx"] += rec["sum_nx"]; a["fny"] += rec["sum_ny"]
            a["frames"] += rec["frames"]; a["passes"] += rec.get("passes", 0)
        edges: dict[tuple, int] = {}
        for prev, nxt in zip(self._spells, self._spells[1:]):
            ka, kb = ident.get(prev["pid"]), ident.get(nxt["pid"])
            if not ka or not kb or ka[1] is None or kb[1] is None or ka == kb or ka[0] != kb[0]:
                continue
            pair = tuple(sorted((ka[1], kb[1])))
            edges[(ka[0], pair)] = edges.get((ka[0], pair), 0) + 1
        out = {}
        for i, t in enumerate(self.config.teams):
            out[t.name] = {
                "nodes": [{"jersey": a["jersey"], "x": round(a["fnx"] / a["frames"], 3),
                           "y": round(a["fny"] / a["frames"], 3), "passes": a["passes"]}
                          for a in agg.values() if a["team"] == i],
                "edges": [{"a": pair[0], "b": pair[1], "count": c}
                          for (team, pair), c in edges.items() if team == i],
            }
        return out

    def zones(self) -> dict:
        """Per-team territory as an 18-cell grid (3 width x 6 length), normalised."""
        out = {}
        for i, t in enumerate(self.config.teams):
            grid = [0] * 18
            for nx, ny in self._positions[i]:
                if not (0.0 <= nx <= 1.0 and 0.0 <= ny <= 1.0):
                    continue
                grid[min(2, int(ny * 3)) * 6 + min(5, int(nx * 6))] += 1
            tot = sum(grid) or 1
            out[t.name] = [round(v / tot, 3) for v in grid]
        return out

    def summary(self, out_dir: Path) -> dict:
        out_dir.mkdir(parents=True, exist_ok=True)
        self._heatmap(0, out_dir / "heatmap_home.png")
        self._heatmap(1, out_dir / "heatmap_away.png")
        home_p, away_p = self.possession_pct()
        players = self.player_stats()  # also fills self._shots via _events()
        return {
            "possession": {
                self.config.teams[0].name: round(home_p, 1),
                self.config.teams[1].name: round(away_p, 1),
            },
            "heatmaps": {
                self.config.teams[0].name: "heatmap_home.png",
                self.config.teams[1].name: "heatmap_away.png",
            },
            "players": players,
            "team_stats": self.team_stats(),
            "possession_timeline": self.possession_timeline(),
            "shots": self._shots,
            "pass_network": self.pass_network(),
            "zones": self.zones(),
            "ball_path_points": len(self.ball_path),
            "calibration": "homography" if self.homography is not None else "proxy",
        }
