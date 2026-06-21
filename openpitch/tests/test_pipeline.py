"""End-to-end smoke tests for the OpenPitch pipeline."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from openpitch.config import Config
from openpitch.detect import ColorDetector
from openpitch.pipeline import process_video
from openpitch.virtual_camera import VirtualCamera

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def sample(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("sample") / "sample.mp4"
    subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "generate_sample.py"),
         "--out", str(out), "--seconds", "5"],
        check=True,
    )
    assert out.exists()
    return out


def test_detector_finds_players_and_ball(sample):
    import cv2

    cap = cv2.VideoCapture(str(sample))
    ok, frame = cap.read()
    cap.release()
    assert ok
    dets = ColorDetector(Config()).detect(frame)
    assert any(d.cls == "player" for d in dets)
    assert sum(d.cls == "player" for d in dets) >= 6
    # Both teams represented.
    assert {d.team for d in dets if d.cls == "player"} == {0, 1}


def test_pipeline_produces_outputs(sample, tmp_path):
    result = process_video(sample, tmp_path, Config())
    assert Path(result.broadcast).exists()
    assert (tmp_path / "summary.json").exists()
    assert (tmp_path / "heatmap_home.png").exists()
    assert (tmp_path / "heatmap_away.png").exists()

    # Possession sums to ~100%.
    poss = result.analytics["possession"]
    assert abs(sum(poss.values()) - 100.0) < 0.5

    # Physical metrics stay in a plausible human range.
    for p in result.analytics["players"]:
        assert 0 <= p["top_speed_ms"] <= 12.0


def test_virtual_camera_stays_in_bounds():
    from openpitch.track import FrameState, PlayerTrack

    cfg = Config()
    vcam = VirtualCamera(cfg, 1280, 540)
    state = FrameState(
        frame=0,
        players=[PlayerTrack(id=0, team=0, cx=0.95, cy=0.95)],
        ball=(0.98, 0.98),
    )
    for _ in range(30):
        x, y, w, h = vcam.update(state)
        assert x >= 0 and y >= 0
        assert x + w <= 1280 + 1
        assert y + h <= 540 + 1
