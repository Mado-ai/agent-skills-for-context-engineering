"""End-to-end pipeline orchestration.

Reads a panoramic capture video and produces, in a single pass:

* ``broadcast.mp4`` — auto-produced, virtual-camera output with graphics.
* ``analytics.json`` — possession, player physical metrics, ball stats.
* ``heatmap_home.png`` / ``heatmap_away.png`` — positional heatmaps.
* ``highlights/*.mp4`` + entries in ``summary.json``.

Progress can be reported via an optional callback so the API can stream
job status to the frontend.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .analytics import Analytics
from .config import Config
from .detect import build_detector
from .encode import finalize, open_writer
from .highlights import HighlightDetector, export_clips
from .homography import calibrate
from .ingest import VideoSource
from .overlay import draw_scoreboard
from .track import Tracker
from .virtual_camera import VirtualCamera

ProgressCb = Callable[[float, str], None]


@dataclass
class PipelineResult:
    broadcast: str
    analytics: dict
    highlights: list[dict]
    meta: dict


def process_video(
    input_path: str | Path,
    out_dir: str | Path,
    config: Config | None = None,
    progress: ProgressCb | None = None,
) -> PipelineResult:
    cfg = config or Config()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    def report(p: float, msg: str) -> None:
        if progress:
            progress(p, msg)

    src = VideoSource(input_path)
    meta = src.meta
    report(0.02, f"ingest: {meta.width}x{meta.height} @ {meta.fps:.0f}fps")

    detector = build_detector(cfg)
    tracker = Tracker(cfg)
    vcam = VirtualCamera(cfg, meta.width, meta.height)
    analytics = Analytics(cfg, fps=meta.fps, frame_size=(meta.width, meta.height))
    highlighter = HighlightDetector(cfg, fps=meta.fps)

    broadcast_path = out_dir / "broadcast.mp4"
    writer, broadcast_fourcc = open_writer(
        broadcast_path, meta.fps, (cfg.output_width, cfg.output_height)
    )

    total = max(meta.frame_count, 1)
    for idx, frame in src.frames():
        if idx == 0 and cfg.auto_calibrate:
            analytics.homography = calibrate(frame, cfg)
            mode = "homography" if analytics.homography else "image-plane proxy"
            report(0.04, f"calibration: {mode}")
        dets = detector.detect(frame)
        state = tracker.update(idx, dets)

        rect = vcam.update(state)
        broadcast = vcam.render(frame, rect)

        poss = analytics.update(state)
        highlighter.observe(idx, state.ball)

        draw_scoreboard(broadcast, cfg, clock_s=idx / meta.fps, possession=poss)
        writer.write(broadcast)

        if idx % 25 == 0:
            report(0.05 + 0.8 * idx / total, f"processing frame {idx}/{total}")

    writer.release()
    src.close()
    report(0.86, "encoding (H.264)")
    finalize(broadcast_path, broadcast_fourcc)  # browser-friendly playback

    report(0.88, "computing analytics")
    summary = analytics.summary(out_dir)

    report(0.93, "detecting highlights")
    highlights = highlighter.detect()
    highlights = export_clips(broadcast_path, highlights, out_dir / "highlights", cfg)
    summary["highlights"] = [h.__dict__ for h in highlights]

    summary["meta"] = {
        "input": str(input_path),
        "duration_s": round(meta.duration_s, 1),
        "frames": meta.frame_count,
        "fps": meta.fps,
        "detector": cfg.detector,
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    report(1.0, "done")

    return PipelineResult(
        broadcast=str(broadcast_path),
        analytics={
            k: summary[k]
            for k in ("possession", "players", "heatmaps", "possession_timeline")
        },
        highlights=summary["highlights"],
        meta=summary["meta"],
    )
