# OpenPitch ⚽

An **end-to-end AI soccer prototype** that mirrors the two halves of platforms
like [Pixellot](https://www.pixellot.tv) (automated capture & broadcast
production) and [BePro](https://bepro.ai) (computer-vision tracking &
performance analytics) — in one runnable pipeline.

Upload a wide-angle / panoramic match clip and OpenPitch produces:

1. **An auto-produced broadcast** — a *virtual cameraman* crops the panoramic
   feed to follow the action (no operator), with a live scoreboard and
   possession bar burned in.
2. **Performance analytics** — possession %, positional heatmaps, and per-player
   physical metrics (distance, top speed in m/s).
3. **Automatic highlights** — exciting moments (fast ball into an attacking
   third) cut into standalone clips.

It runs **with zero model downloads** using a colour-segmentation detector, and
ships a **synthetic match generator** so you can try the whole thing without any
footage. Swap in YOLO for real video.

```
ingest ─▶ detect ─▶ track ─▶ virtual camera ─▶ overlay ─▶ broadcast.mp4
                       └────────▶ analytics + highlights ─▶ summary.json
```

## Quickstart

```bash
cd openpitch
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1) CLI: generate a synthetic clip and process it end-to-end
python -m openpitch.cli demo --out runs/demo

# 2) Or process your own panoramic video
python -m openpitch.cli process my_match.mp4 --out runs/match1

# 3) Web dashboard (upload / demo / view results)
uvicorn openpitch.api:app --reload   # then open http://localhost:8000
```

Outputs land in `runs/<name>/`: `broadcast.mp4`, `analytics`+`summary.json`,
`heatmap_home.png`, `heatmap_away.png`, and `highlights/*.mp4`.

## Architecture

| Stage | Module | Real-world analogue |
|-------|--------|---------------------|
| Ingest | `ingest.py` | RTSP/SRT termination + stitching of fixed wide cameras |
| Detect | `detect.py` | YOLO/RT-DETR player & ball detection |
| Track | `track.py` | SORT / ByteTrack multi-object tracking + team ID |
| Virtual camera | `virtual_camera.py` | Pixellot "robot cameraman" auto-production |
| Overlay | `overlay.py` | Broadcast graphics layer |
| Analytics | `analytics.py` | BePro tracking data (possession, heatmaps, physical) |
| Highlights | `highlights.py` | Event detection + auto-clipping |
| Pipeline/API | `pipeline.py`, `api.py` | Job orchestration + serving |

### Detector backends

* **`color`** (default) — HSV segmentation. No downloads, deterministic,
  great for the synthetic demo and any colour-distinct footage.
* **`yolo`** — set `--detector yolo` (CLI) or `OPENPITCH_DETECTOR=yolo`.
  Requires `pip install ultralytics`; team identity is assigned by
  jersey-colour clustering.

## Testing

```bash
pytest -q          # generates a sample, runs the full pipeline, checks outputs
```

## What this prototype is — and isn't

It demonstrates the **complete data flow** of a capture-to-analytics product
with explainable, model-free defaults. It is **not** production-grade:

* The colour detector assumes solid, distinct kit colours; real footage needs
  the YOLO backend (and a fine-tuned ball detector — small fast balls are hard).
* The tracker is greedy nearest-neighbour; ID swaps on player crossings are
  gated out of the physical metrics but a real system needs ByteTrack +
  re-identification.
* No camera calibration / homography — analytics use the image plane as a
  proxy pitch. Production needs pitch-line homography to map to true metres.
* Jobs run in-memory on a thread; production needs a queue + object storage +
  GPU workers.

## Roadmap to a real product

1. **Homography & calibration** — detect pitch lines, map to a top-down model.
2. **Real detection/tracking** — fine-tuned YOLO ball model + ByteTrack + ReID.
3. **Capture hardware** — fixed 4K panoramic rig, on-prem encoder, RTMP/SRT push.
4. **Live, low-latency** — stream the virtual-camera output (LL-HLS/WebRTC).
5. **Event model** — learned shot/goal/foul classifier + audio crowd-energy.
6. **Scale** — job queue, GPU autoscaling, per-club tenancy, storage/CDN.
