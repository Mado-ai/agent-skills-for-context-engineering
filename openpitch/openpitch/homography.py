"""Pitch homography — map image pixels to real-world pitch metres.

A fixed wide-angle camera sees the pitch as a trapezoid. To produce *true*
physical metrics (distance, speed) and a correct top-down heatmap, we need a
homography H that maps image points to a canonical top-down pitch model in
metres.

Two ways to obtain H:

* **Manual** — supply four image points (the pitch corners, or any four known
  landmarks) via ``Config.homography_corners``. Robust for any real footage.
* **Automatic** — :func:`detect_pitch_corners` finds the outer boundary of the
  field (largest white-line quad) and maps its four corners to the model.
  Works when the whole pitch is visible and roughly rectangular (e.g. the
  synthetic sample, elevated centre-line cameras); falls back to ``None``
  otherwise, in which case the pipeline uses an image-plane proxy.

Coordinates returned by :meth:`PitchHomography.to_pitch` are in metres with
the origin at the top-left corner of the pitch.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .config import PITCH_LENGTH_M, PITCH_WIDTH_M, BALL_HSV, Config


@dataclass
class PitchModel:
    length_m: float = PITCH_LENGTH_M
    width_m: float = PITCH_WIDTH_M

    def corners(self) -> np.ndarray:
        """Model corners in metres, ordered TL, TR, BR, BL."""
        return np.array(
            [[0, 0], [self.length_m, 0], [self.length_m, self.width_m], [0, self.width_m]],
            dtype=np.float32,
        )


class PitchHomography:
    """Wraps a 3x3 homography from image pixels to pitch metres."""

    def __init__(self, matrix: np.ndarray, model: PitchModel | None = None):
        self.matrix = matrix
        self.model = model or PitchModel()

    @classmethod
    def from_correspondences(
        cls, image_pts, model: PitchModel | None = None
    ) -> "PitchHomography | None":
        model = model or PitchModel()
        image_pts = np.asarray(image_pts, dtype=np.float32)
        if image_pts.shape[0] < 4:
            return None
        matrix, _ = cv2.findHomography(image_pts, model.corners()[: len(image_pts)])
        if matrix is None:
            return None
        return cls(matrix, model)

    def to_pitch(self, x: float, y: float) -> tuple[float, float]:
        """Image pixel -> (X, Y) in metres on the pitch."""
        pt = np.array([[[x, y]]], dtype=np.float32)
        out = cv2.perspectiveTransform(pt, self.matrix)[0, 0]
        return float(out[0]), float(out[1])

    def to_pitch_norm(self, x: float, y: float) -> tuple[float, float]:
        """Image pixel -> normalised pitch coords (0..1), clamped."""
        X, Y = self.to_pitch(x, y)
        return (
            float(np.clip(X / self.model.length_m, 0.0, 1.0)),
            float(np.clip(Y / self.model.width_m, 0.0, 1.0)),
        )


def _order_corners(pts: np.ndarray) -> np.ndarray:
    """Order four points as TL, TR, BR, BL."""
    pts = pts.reshape(-1, 2).astype(np.float32)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array(
        [
            pts[np.argmin(s)],  # TL: smallest x+y
            pts[np.argmin(d)],  # TR: smallest y-x
            pts[np.argmax(s)],  # BR: largest x+y
            pts[np.argmax(d)],  # BL: largest y-x
        ],
        dtype=np.float32,
    )


def detect_pitch_corners(frame: np.ndarray) -> np.ndarray | None:
    """Find the four outer corners of the pitch from white field lines."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, np.array(BALL_HSV[0]), np.array(BALL_HSV[1]))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    biggest = max(contours, key=cv2.contourArea)
    # The field boundary should dominate the frame.
    if cv2.contourArea(biggest) < 0.2 * frame.shape[0] * frame.shape[1]:
        return None
    peri = cv2.arcLength(biggest, True)
    approx = cv2.approxPolyDP(biggest, 0.02 * peri, True)
    if len(approx) != 4:
        return None
    return _order_corners(approx)


def calibrate(frame: np.ndarray, config: Config) -> PitchHomography | None:
    """Build a homography from manual config corners or auto-detection."""
    if config.homography_corners:
        return PitchHomography.from_correspondences(config.homography_corners)
    corners = detect_pitch_corners(frame)
    if corners is None:
        return None
    return PitchHomography.from_correspondences(corners)
