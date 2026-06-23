"""Stage 6b — Event model: passes → expected threat, shots → expected goals.

The base analytics layer answers "who ran how far / who held the ball". This
layer answers "did that action *create danger*". It turns the debounced
possession spells (see ``analytics.py``) plus the ball trajectory into discrete
events and values them:

* **Expected threat (xT)** — every completed pass/carry is scored by how much
  it raised the team's chance of scoring soon, using a positional threat
  surface. We progress the ball through the surface and credit the delta.
* **Progressive passes / final-third entries** — geometric, ground-truthable
  straight from tracking.
* **Shots → expected goals (xG)** — goal-mouth arrivals of the ball are treated
  as shots and valued by a distance/angle logistic.

What is and isn't "learned": the *segmentation* (spells, transitions, goal-mouth
arrivals) is rule-based on ball kinematics — robust from tracking data. The xG
coefficients and the threat surface are **literature-derived priors**, not fit
on our own labelled corpus (we have none). They are documented constants so the
numbers are interpretable and reproducible, and can later be swapped for a model
trained on event-labelled footage. Shot detection deliberately favours precision
(a tight goal-mouth zone) — better to under-count shots than fabricate xG.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .config import PITCH_LENGTH_M, PITCH_WIDTH_M

GOAL_HALF_M = 3.66  # half of a 7.32 m goal mouth

# xG logistic on the angle subtended by the posts (rad) and distance (m).
# Calibrated to open-play anchors (≈0.40 @ 6 m central, ≈0.13 @ 11 m, ≈0.05 @
# 18 m). Literature prior, not trained here — see module docstring.
_XG_A, _XG_ANGLE, _XG_DIST = -3.0, 2.68, 0.057

# Progression thresholds.
_PROGRESSIVE_M = 10.0  # ball moved this much closer to goal = progressive pass
_FINAL_THIRD = 2.0 / 3.0


def threat(xn: float, yn: float) -> float:
    """xT-style positional value in [0, ~0.3].

    ``xn`` is progress toward the attacking goal (0 = own goal line, 1 = scoring
    end); ``yn`` is normalised width (0.5 = central). Rises steeply near goal and
    is weighted toward the centre. This is an xT-*style* surface (monotone to
    goal, central peak), not a fitted grid — see module docstring.
    """
    xn = min(1.0, max(0.0, xn))
    central = max(0.0, 1.0 - 2.0 * abs(yn - 0.5))
    base = 0.05 * xn + 0.25 * xn**4
    return base * (0.6 + 0.4 * central)


def xg(x_m: float, y_m: float, goal_x: float) -> float:
    """Expected-goals value of a shot taken from (x_m, y_m) at the goal on
    ``goal_x`` (0 or PITCH_LENGTH_M). Uses the post-angle/distance logistic."""
    dx = abs(goal_x - x_m)
    cy = PITCH_WIDTH_M / 2.0
    dist = math.hypot(dx, y_m - cy)
    # Angle subtended by the two posts as seen from the shot location.
    a1 = math.atan2((cy + GOAL_HALF_M) - y_m, dx + 1e-6)
    a2 = math.atan2((cy - GOAL_HALF_M) - y_m, dx + 1e-6)
    angle = abs(a1 - a2)
    logit = _XG_A + _XG_ANGLE * angle - _XG_DIST * dist
    return 1.0 / (1.0 + math.exp(-logit))


@dataclass
class TeamEvents:
    passes: int = 0
    completed: int = 0
    xt_added: float = 0.0
    progressive: int = 0
    final_third: int = 0
    shots: int = 0
    xg: float = 0.0
    # Broadcast-style final-third entries (image: "FINAL THIRD ENTRIES").
    final_third_entries: int = 0
    final_third_time_s: float = 0.0
    channels: dict | None = None  # {"left":int,"center":int,"right":int}
    # BePro-style advanced metrics.
    xa: float = 0.0
    line_breaking: int = 0
    packing: int = 0
    runs_in_behind: int = 0

    def channel_dict(self) -> dict:
        return self.channels or {"left": 0, "center": 0, "right": 0}


def _attack_goal_x(team: int, player_mean_x: dict[int, tuple[float, int]]) -> float:
    """Infer the goal a team attacks (returns its X coord, 0 or pitch length).

    The keeper sits deepest by their own goal, so a team's most positionally
    extreme player marks the *defending* end; they attack the opposite goal.
    Falls back to team 0 → +X, team 1 → -X when data is too thin to tell.
    """
    mids = PITCH_LENGTH_M / 2.0
    deepest = None  # (|mean - mid|, mean_x)
    for _pid, (mean_x, frames) in player_mean_x.items():
        if frames < 5:
            continue
        score = abs(mean_x - mids)
        if deepest is None or score > deepest[0]:
            deepest = (score, mean_x)
    if deepest is None:
        return PITCH_LENGTH_M if team == 0 else 0.0
    own_goal_x = 0.0 if deepest[1] < mids else PITCH_LENGTH_M
    return PITCH_LENGTH_M - own_goal_x


def compute(
    spells: list[dict],
    ball_m: list[tuple[int, float, float]],
    player_mean_x: dict[int, dict[int, tuple[float, int]]],
    fps: float,
    pos_stream: list[tuple[int, list]] | None = None,
) -> tuple[dict[int, dict], dict[int, TeamEvents]]:
    """Derive per-player and per-team event metrics.

    ``spells``: ordered confirmed possession spells, each
      ``{"pid", "team", "start": (X,Y), "end": (X,Y), "frame", "end_frame"}``.
    ``ball_m``: ``(frame, X, Y)`` ball positions in metres.
    ``player_mean_x``: ``{team: {pid: (mean_x, frames)}}`` for attack inference.

    Returns ``(by_pid, by_team)``.
    """
    attack: dict[int, float] = {
        t: _attack_goal_x(t, player_mean_x.get(t, {})) for t in (0, 1)
    }
    by_pid: dict[int, dict] = {}
    by_team: dict[int, TeamEvents] = {0: TeamEvents(), 1: TeamEvents()}

    def rec(pid: int) -> dict:
        return by_pid.setdefault(pid, {
            "xt_added": 0.0, "progressive": 0, "final_third": 0,
            "shots": 0, "xg": 0.0, "xa": 0.0, "line_breaking": 0,
            "packing": 0, "runs_in_behind": 0})

    def toward(team: int, x: float) -> float:
        """Distance gained toward the attacking goal for a coordinate."""
        return x if attack[team] == PITCH_LENGTH_M else (PITCH_LENGTH_M - x)

    def xn_of(team: int, x: float) -> float:
        return toward(team, x) / PITCH_LENGTH_M

    # --- passes between consecutive confirmed spells ---
    # Value a pass by the net ball displacement between two possession *gains*
    # (start → start). Updating an "end" each frame would fold the ball's travel
    # to the receiver into the passer's own spell and zero out the delta, since
    # confirmation lags possession by ~0.4 s (by which point the ball has
    # already arrived). Start-to-start captures the real progression.
    for prev, nxt in zip(spells, spells[1:]):
        team = prev["team"]
        ox, oy = prev["start"]
        dx, dy = nxt["start"]
        by_team[team].passes += 1
        if nxt["team"] != team:
            continue
        by_team[team].completed += 1
        r = rec(prev["pid"])
        delta = threat(xn_of(team, dx), dy / PITCH_WIDTH_M) - threat(
            xn_of(team, ox), oy / PITCH_WIDTH_M)
        r["xt_added"] += delta
        by_team[team].xt_added += delta
        if toward(team, dx) - toward(team, ox) >= _PROGRESSIVE_M:
            r["progressive"] += 1
            by_team[team].progressive += 1
        if xn_of(team, dx) >= _FINAL_THIRD > xn_of(team, ox):
            r["final_third"] += 1
            by_team[team].final_third += 1
        # Packing / line-breaking: opponents bypassed by a forward pass (their
        # toward-goal position falls between the pass origin and destination),
        # using the lineup snapshot at the moment the receiver gained the ball.
        o_tw, d_tw = toward(team, ox), toward(team, dx)
        if d_tw > o_tw:
            lineup = nxt.get("lineup") or prev.get("lineup") or []
            bypassed = sum(1 for (_pid, t2, x2) in lineup
                           if t2 != team and o_tw < toward(team, x2) <= d_tw)
            if bypassed:
                r["packing"] += bypassed
                r["line_breaking"] += 1
                by_team[team].packing += bypassed
                by_team[team].line_breaking += 1

    # --- shots: ball arrivals inside a tight goal-mouth zone ---
    # The strike location is the ball ~0.7 s before it reached the goal (it
    # travels near-straight during a shot), and the shooter is the attacking
    # team's last confirmed possessor. Attribute xG there.
    if spells and ball_m:
        cy = PITCH_WIDTH_M / 2.0
        lookback = max(1, round(0.7 * fps))
        si = 0
        in_zone = False
        for i, (frame, bx, by) in enumerate(ball_m):
            near_goal = (
                (bx <= 3.0 or bx >= PITCH_LENGTH_M - 3.0)
                and abs(by - cy) <= GOAL_HALF_M + 1.5
            )
            if near_goal and not in_zone:
                goal_x = 0.0 if bx <= 3.0 else PITCH_LENGTH_M
                shooter_team = 0 if attack[0] == goal_x else 1
                while si + 1 < len(spells) and spells[si + 1]["frame"] <= frame:
                    si += 1
                sp = spells[si]
                if sp["team"] == shooter_team:
                    j = i
                    while j > 0 and frame - ball_m[j][0] < lookback:
                        j -= 1
                    sx, sy = ball_m[j][1], ball_m[j][2]
                    val = xg(sx, sy, goal_x)
                    r = rec(sp["pid"])
                    r["shots"] += 1
                    r["xg"] += val
                    by_team[shooter_team].shots += 1
                    by_team[shooter_team].xg += val
                    # Expected assist: credit the shot's xG to the team-mate
                    # whose pass set up the shooter (the previous confirmed
                    # spell, if it was a completed pass to them).
                    if si >= 1 and spells[si - 1]["team"] == shooter_team \
                            and spells[si - 1]["pid"] != sp["pid"]:
                        a = rec(spells[si - 1]["pid"])
                        a["xa"] += val
                        by_team[shooter_team].xa += val
            in_zone = near_goal

    # --- final-third entries (per possessing team) ---
    # Walk the ball; the team in possession "enters" its attacking final third
    # when the ball crosses xn = 2/3 with them on it. Count entries (debounced
    # by leaving the zone / losing the ball), time spent there, and the channel
    # (left/center/right of the attacking width) the entry came through.
    if spells and ball_m:
        for t in (0, 1):
            by_team[t].channels = {"left": 0, "center": 0, "right": 0}
        si = 0
        prev_team: int | None = None
        in_third = False
        for frame, bx, by in ball_m:
            while si + 1 < len(spells) and spells[si + 1]["frame"] <= frame:
                si += 1
            team = spells[si]["team"]
            inside = xn_of(team, bx) >= _FINAL_THIRD
            if inside:
                by_team[team].final_third_time_s += 1.0 / fps
                if not in_third or team != prev_team:
                    by_team[team].final_third_entries += 1
                    # Channel from the attacking team's perspective.
                    yn = by / PITCH_WIDTH_M
                    if attack[team] == 0.0:
                        yn = 1.0 - yn
                    side = "left" if yn < 1 / 3 else "center" if yn < 2 / 3 else "right"
                    by_team[team].channels[side] += 1
            in_third = inside
            prev_team = team

    # --- runs in behind (off-ball) ---
    # While a team is in possession, count rising-edge moments where one of its
    # players breaks beyond the opponent's last defensive line (past the
    # second-deepest opponent, i.e. excluding the keeper) into the final third.
    if pos_stream and spells:
        was_behind: dict[int, bool] = {}
        si = 0
        for frame, lineup in pos_stream:
            while si + 1 < len(spells) and spells[si + 1]["frame"] <= frame:
                si += 1
            team = spells[si]["team"]
            opp_tw = sorted((toward(team, x) for (_pid, t2, x) in lineup if t2 != team),
                            reverse=True)
            if len(opp_tw) < 2:
                continue
            last_line = opp_tw[1]  # deepest is the keeper; next is the back line
            for pid, t2, x in lineup:
                if t2 != team:
                    continue
                tw = toward(team, x)
                behind = tw > last_line and tw >= _FINAL_THIRD * PITCH_LENGTH_M
                if behind and not was_behind.get(pid, False):
                    rec(pid)["runs_in_behind"] += 1
                    by_team[team].runs_in_behind += 1
                was_behind[pid] = behind

    return by_pid, by_team
