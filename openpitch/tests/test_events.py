"""Unit + integration tests for the event model (xT, progression, shots → xG)."""

from __future__ import annotations

from pathlib import Path

import pytest

from openpitch import events
from openpitch.analytics import Analytics
from openpitch.config import PITCH_LENGTH_M, PITCH_WIDTH_M, Config
from openpitch.track import FrameState, PlayerTrack


def test_threat_rises_toward_goal_and_centre():
    mid_w = 0.5
    # Monotone in progress to goal.
    assert events.threat(0.1, mid_w) < events.threat(0.6, mid_w) < events.threat(0.95, mid_w)
    # Central is more threatening than the touchline at the same depth.
    assert events.threat(0.9, 0.5) > events.threat(0.9, 0.02)
    # Bounded and non-negative.
    assert 0.0 <= events.threat(1.0, 0.5) <= 0.4


def test_xg_closer_and_more_central_is_higher():
    cy = PITCH_WIDTH_M / 2.0
    goal = PITCH_LENGTH_M
    close = events.xg(PITCH_LENGTH_M - 6, cy, goal)
    far = events.xg(PITCH_LENGTH_M - 25, cy, goal)
    wide = events.xg(PITCH_LENGTH_M - 6, cy + 18, goal)
    assert 0.0 < far < close < 1.0
    assert wide < close  # tight angle from the byline is worth less
    # Sanity: a central 6 m chance is a big one; a 25 m one is small.
    assert close > 0.3 and far < 0.1


def test_attack_direction_inferred_from_keeper():
    # Team 0's deepest player sits near x=0 → they attack the far goal (x=L).
    means = {0: {1: (2.0, 100), 2: (40.0, 100)}, 1: {3: (100.0, 100), 4: (60.0, 100)}}
    assert events._attack_goal_x(0, means[0]) == PITCH_LENGTH_M
    assert events._attack_goal_x(1, means[1]) == 0.0


def test_progressive_pass_and_xt_credited():
    # A team attacking +x makes one big forward pass between two possession gains.
    spells = [
        {"pid": 1, "team": 0, "frame": 0, "start": (20.0, 34.0)},
        {"pid": 2, "team": 0, "frame": 25, "start": (70.0, 34.0)},
    ]
    means = {0: {1: (5.0, 50)}, 1: {3: (100.0, 50)}}  # keeper low → attack +x
    by_pid, by_team, _shots = events.compute(spells, [], means, fps=25)
    assert by_team[0].completed == 1
    assert by_team[0].progressive == 1
    assert by_pid[1]["xt_added"] > 0  # threat increased
    assert by_pid[1]["progressive"] == 1


def test_pipeline_summary_has_event_fields(tmp_path):
    from openpitch.pipeline import process_video
    import subprocess
    import sys

    root = Path(__file__).resolve().parent.parent
    sample = tmp_path / "sample.mp4"
    subprocess.run(
        [sys.executable, str(root / "scripts" / "generate_sample.py"),
         "--out", str(sample), "--seconds", "5"],
        check=True,
    )
    result = process_video(sample, tmp_path, Config())
    players = result.analytics["players"]
    team_stats = result.analytics["team_stats"]
    assert players and team_stats

    for p in players:
        for k in ("xt_added", "progressive_passes", "final_third_passes", "shots", "xg"):
            assert k in p
        assert p["progressive_passes"] >= 0 and p["shots"] >= 0
        assert p["xg"] >= 0.0
    for t in team_stats.values():
        for k in ("xt_added", "progressive_passes", "final_third_passes", "shots", "xg"):
            assert k in t
        assert t["xg"] >= 0.0
