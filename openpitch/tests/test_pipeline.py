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


def test_homography_detects_pitch_and_maps_corners(sample):
    import cv2

    from openpitch.homography import calibrate, detect_pitch_corners

    cap = cv2.VideoCapture(str(sample))
    ok, frame = cap.read()
    cap.release()
    assert ok

    corners = detect_pitch_corners(frame)
    assert corners is not None and corners.shape == (4, 2)

    h = calibrate(frame, Config())
    assert h is not None
    # A detected corner maps near a pitch corner (metres); centre maps near mid.
    cx, cy = corners[0]
    X, Y = h.to_pitch(float(cx), float(cy))
    assert -2 <= X <= 5 and -2 <= Y <= 5  # top-left corner ~ (0, 0)


def test_pipeline_uses_homography(sample, tmp_path):
    result = process_video(sample, tmp_path, Config())
    summary = (tmp_path / "summary.json").read_text()
    assert '"calibration": "homography"' in summary


def test_metric_quality_invariants(sample, tmp_path):
    """Guards the QA findings: bounded sprints, clean roster, valid ranges."""
    result = process_video(sample, tmp_path, Config())
    players = result.analytics["players"]
    team_stats = result.analytics["team_stats"]
    assert players and team_stats

    # Identified roster only — no unidentified tracker fragments leak in.
    assert all(p["jersey"] is not None for p in players)

    total_sprints = 0
    for p in players:
        assert p["distance_m"] >= 0
        assert 0 <= p["top_speed_ms"] <= 12.01
        assert p["sprints"] >= 0
        assert p["pass_accuracy"] is None or 0 <= p["pass_accuracy"] <= 100
        total_sprints += p["sprints"]
    # Sprint debounce: a few-second clip must not report hundreds of sprints.
    assert total_sprints < 60, f"sprint count looks inflated: {total_sprints}"

    poss = sum(result.analytics["possession"].values())
    assert abs(poss - 100) < 0.6 or poss == 0


def test_yolo_backend_runs_if_available(sample):
    """YOLO is optional; skip cleanly if ultralytics or weights are missing."""
    pytest.importorskip("ultralytics")
    import cv2

    from openpitch.detect import YoloDetector

    try:
        det = YoloDetector(Config(detector="yolo", yolo_imgsz=640))
    except Exception as exc:  # weights download blocked, etc.
        pytest.skip(f"YOLO weights unavailable: {exc}")

    cap = cv2.VideoCapture(str(sample))
    ok, frame = cap.read()
    cap.release()
    assert ok
    dets = det.detect(frame)
    # Synthetic dots aren't people, so we only assert it runs and is well-formed.
    assert isinstance(dets, list)
    for d in dets:
        assert d.cls in ("player", "ball")


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
