"""Stage 2 — Detection.

Per-frame detection of players (with team identity) and the ball.

Two backends:

* ``ColorDetector`` (default) — HSV colour segmentation + contour analysis.
  Zero downloads, runs on any CPU, and is fully deterministic, which makes
  the rest of the pipeline testable. It assigns team identity directly from
  the colour mask the blob came from.
* ``YoloDetector`` (optional) — wraps an Ultralytics YOLO model for real
  footage. Team identity is assigned by jersey-colour clustering of the
  detected person crops.

Both return a list of :class:`Detection` in **normalised** coordinates
(0..1) so downstream stages are resolution-independent.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .config import BALL_HSV, Config


@dataclass
class Detection:
    cls: str  # "player" | "ball"
    cx: float  # normalised centre x (0..1)
    cy: float  # normalised centre y (0..1)
    w: float  # normalised width
    h: float  # normalised height
    conf: float
    team: int | None = None  # index into Config.teams, players only


class ColorDetector:
    """Detect players/ball via HSV colour masks. Default backend."""

    def __init__(self, config: Config):
        self.cfg = config

    def _blobs(self, mask: np.ndarray, min_area: int, max_area: int):
        mask = cv2.morphologyEx(
            mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1
        )
        # RETR_LIST (not RETR_EXTERNAL): the pitch boundary line encloses the
        # whole field, so the ball would otherwise be a discarded nested contour.
        contours, _ = cv2.findContours(
            mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE
        )
        out = []
        for c in contours:
            area = cv2.contourArea(c)
            if area < min_area or area > max_area:
                continue
            x, y, w, h = cv2.boundingRect(c)
            out.append((x + w / 2, y + h / 2, w, h, area))
        return out

    def detect(self, frame: np.ndarray) -> list[Detection]:
        H, W = frame.shape[:2]
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        dets: list[Detection] = []

        # Players, per team.
        for team_idx, team in enumerate(self.cfg.teams):
            mask = np.zeros((H, W), np.uint8)
            for lo, hi in team.hsv_ranges:
                mask |= cv2.inRange(hsv, np.array(lo), np.array(hi))
            for cx, cy, w, h, _ in self._blobs(
                mask, self.cfg.min_player_area, self.cfg.max_player_area
            ):
                dets.append(
                    Detection(
                        cls="player",
                        cx=cx / W,
                        cy=cy / H,
                        w=w / W,
                        h=h / H,
                        conf=0.9,
                        team=team_idx,
                    )
                )

        # Ball (single best white blob).
        ball_mask = cv2.inRange(hsv, np.array(BALL_HSV[0]), np.array(BALL_HSV[1]))
        balls = self._blobs(
            ball_mask, self.cfg.min_ball_area, self.cfg.max_ball_area
        )
        if balls:
            # Prefer the roundest small blob.
            cx, cy, w, h, _ = min(balls, key=lambda b: abs(b[2] - b[3]) + b[4] * 0.01)
            dets.append(
                Detection("ball", cx / W, cy / H, w / W, h / H, conf=0.8, team=None)
            )
        return dets


class YoloDetector:
    """Optional real-footage backend (lazy import of ultralytics).

    Detects people and the sports ball with a COCO-pretrained YOLO model and
    assigns team identity by jersey-colour hue, ignoring green pitch pixels so
    the grass doesn't dominate the colour estimate.
    """

    # Hue band (OpenCV 0-179) treated as pitch grass and excluded from jerseys.
    _GRASS_HUE = (35, 90)

    def __init__(self, config: Config):
        from ultralytics import YOLO  # noqa: PLC0415 (optional dependency)

        self.cfg = config
        self.model = YOLO(config.yolo_weights)
        # COCO ids: 0 person, 32 sports ball.
        self._classes = {0: "player", 32: "ball"}

    def _team_of(self, crop: np.ndarray) -> int:
        """Nearest team by mean jersey hue, masking out grass/low-saturation."""
        if crop.size == 0:
            return 0
        # Focus on the torso (jersey), not legs/shadow.
        h = crop.shape[0]
        torso = crop[: max(1, h // 2)]
        hsv = cv2.cvtColor(torso, cv2.COLOR_BGR2HSV)
        hue, sat = hsv[:, :, 0], hsv[:, :, 1]
        keep = (sat > 60) & ~((hue >= self._GRASS_HUE[0]) & (hue <= self._GRASS_HUE[1]))
        sample = hue[keep]
        if sample.size == 0:
            return 0
        mean_h = float(np.median(sample))
        best, best_d = 0, 1e9
        for i, team in enumerate(self.cfg.teams):
            ref_h = team.hsv_ranges[0][0][0]
            d = min(abs(mean_h - ref_h), 180 - abs(mean_h - ref_h))
            if d < best_d:
                best, best_d = i, d
        return best

    def detect(self, frame: np.ndarray) -> list[Detection]:
        H, W = frame.shape[:2]
        res = self.model.predict(
            frame,
            verbose=False,
            conf=self.cfg.yolo_conf,
            imgsz=self.cfg.yolo_imgsz,
            device=self.cfg.yolo_device,
        )[0]
        dets: list[Detection] = []
        for box in res.boxes:
            cid = int(box.cls[0])
            cls = self._classes.get(cid)
            if cls is None:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            team = None
            if cls == "player":
                crop = frame[int(y1) : int(y2), int(x1) : int(x2)]
                team = self._team_of(crop)
            dets.append(
                Detection(
                    cls=cls,
                    cx=cx / W,
                    cy=cy / H,
                    w=(x2 - x1) / W,
                    h=(y2 - y1) / H,
                    conf=float(box.conf[0]),
                    team=team,
                )
            )
        return dets


def build_detector(config: Config):
    if config.detector == "yolo":
        return YoloDetector(config)
    return ColorDetector(config)
