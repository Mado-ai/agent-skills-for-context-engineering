"""Central configuration for the OpenPitch pipeline.

Everything tunable lives here so the rest of the code stays declarative.
Real pitch dimensions are used to convert normalised tracking coordinates
into metres for the physical-performance metrics (distance, speed).
"""

from __future__ import annotations

from dataclasses import dataclass, field


# FIFA-recommended pitch size, used to scale normalised coords -> metres.
PITCH_LENGTH_M = 105.0
PITCH_WIDTH_M = 68.0


@dataclass
class TeamColors:
    """HSV-friendly colour identity for a team (BGR for drawing)."""

    name: str
    bgr: tuple[int, int, int]
    # Inclusive HSV ranges (OpenCV: H 0-179, S/V 0-255). A list supports
    # hues that wrap around 0 (e.g. red).
    hsv_ranges: list[tuple[tuple[int, int, int], tuple[int, int, int]]]


# Defaults match the synthetic sample generator (scripts/generate_sample.py).
HOME_TEAM = TeamColors(
    name="Home",
    bgr=(60, 60, 220),  # red
    hsv_ranges=[((0, 120, 90), (10, 255, 255)), ((170, 120, 90), (179, 255, 255))],
)
AWAY_TEAM = TeamColors(
    name="Away",
    bgr=(220, 90, 60),  # blue
    hsv_ranges=[((100, 120, 90), (130, 255, 255))],
)
# White ball: low saturation, high value.
BALL_HSV = ((0, 0, 200), (179, 60, 255))


@dataclass
class Config:
    # --- detection ---
    detector: str = "color"  # "color" | "yolo"
    min_player_area: int = 60
    max_player_area: int = 6000
    min_ball_area: int = 6
    max_ball_area: int = 400

    # --- tracking ---
    max_track_distance: float = 0.08  # normalised, ~max travel between frames
    max_disappeared: int = 12  # frames a track survives without a match

    # --- virtual camera (auto-production) ---
    output_width: int = 1280
    output_height: int = 720
    base_zoom: float = 0.42  # fraction of source width the crop spans
    min_zoom: float = 0.30
    max_zoom: float = 0.85
    pan_smoothing: float = 0.12  # EMA factor for the crop centre (0..1)
    zoom_smoothing: float = 0.06
    max_pan_px: float = 26.0  # cap on crop-centre travel per frame
    ball_weight: float = 0.6  # action point = ball*w + players*(1-w)

    # --- analytics ---
    heatmap_bins: int = 32
    possession_radius: float = 0.06  # normalised distance ball<->player

    # --- highlights ---
    highlight_speed_pctl: float = 92.0  # ball-speed percentile = "exciting"
    highlight_pad_s: float = 2.0
    highlight_max_s: float = 12.0
    attacking_thirds: tuple[float, float] = (0.34, 0.66)

    teams: list[TeamColors] = field(default_factory=lambda: [HOME_TEAM, AWAY_TEAM])

    @property
    def output_aspect(self) -> float:
        return self.output_width / self.output_height
