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

# Recommended: install ffmpeg so outputs are encoded as H.264 and play in the
# browser dashboard (macOS: brew install ffmpeg · Debian/Ubuntu: apt install ffmpeg).
# Without it, videos still render but may need VLC to view.

# 1) CLI: generate a synthetic clip and process it end-to-end
python -m openpitch.cli demo --out runs/demo

# 2) Or process your own panoramic video
python -m openpitch.cli process my_match.mp4 --out runs/match1

# 3) Web app — accounts + dashboard (upload / demo / view results)
uvicorn openpitch.api:app --reload   # then open http://localhost:8000
```

Outputs land in `runs/<name>/`: `broadcast.mp4`, `analytics`+`summary.json`,
`heatmap_home.png`, `heatmap_away.png`, and `highlights/*.mp4`.

## Web app & accounts

The frontend is a **Vite + React + TypeScript** SPA (in `web/`, styled with
Tailwind) talking to the FastAPI backend (`openpitch/api.py`):

* **Landing + auth** (`/`) — sign in or create an account.
* **Dashboard** (`/dashboard`) — every pipeline tool in one place: upload a
  match, pick the detector, run the synthetic demo, browse your job history, and
  view the auto-produced broadcast, possession, heatmaps, player metrics and
  highlights.

### Frontend dev / build

```bash
cd web
npm install
npm run dev        # Vite dev server on :5173, proxies /api -> :8000
npm run build      # emits web/dist, which the backend serves at /
npm run lint
```

In production the backend serves the built SPA from `web/dist` (with SPA
deep-link fallback). If `web/dist` is absent, it falls back to the no-build
`frontend/` directory, so the app still runs without Node. The `Dockerfile`
builds the SPA in a Node stage automatically.

Auth is stdlib-only (PBKDF2 password hashing + HMAC-signed tokens); accounts and
job history persist in SQLite. Jobs are isolated per user, and result files are
served only with a valid token.

On first launch an **admin account is seeded**. Configure via environment:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PLAYMETRICS_ADMIN_EMAIL` | `yazanalshuibe14@gmail.com` | Seeded admin login |
| `PLAYMETRICS_ADMIN_PASSWORD` | `playmetrics-dev` | Seeded admin password — **change in production** |
| `PLAYMETRICS_SECRET` | random per process | Token signing key — **set a fixed value in production** |
| `DATABASE_URL` | `sqlite:///<PLAYMETRICS_DB>` | DB connection; set `postgresql+psycopg://…` for Postgres |
| `PLAYMETRICS_DB` | `playmetrics.db` | SQLite file path (used when `DATABASE_URL` is unset) |
| `PLAYMETRICS_DATA` | `runs/` | Job output directory (mount a volume in prod) |
| `PLAYMETRICS_ENV` | (unset) | Set to `production` to **require** `PLAYMETRICS_SECRET` + admin password (fails fast otherwise) |
| `PLAYMETRICS_STORAGE` | `local` | Object storage: `local` or `s3` (`PLAYMETRICS_S3_BUCKET`, `PLAYMETRICS_S3_PREFIX`) |
| `PLAYMETRICS_QUEUE` | `thread` | Job queue: `thread` (in-process) or `rq` (needs `REDIS_URL`) |

### Security posture

- **Auth:** PBKDF2-HMAC-SHA256 passwords; HMAC-signed tokens; device API keys stored hashed.
- **Authorization:** role-based (orgs/memberships) enforced at a single API chokepoint; private-by-default sharing; parent/player restricted to a linked player.
- **Hardening:** security headers (CSP, HSTS, X-Frame-Options, nosniff) on every response; login **rate-limiting + lockout**; production refuses to boot on insecure defaults.
- **Audit trail:** access to player data (views/shares) and stat imports are logged to `audit_log`; staff can review per player via `GET /api/players/{id}/audit`.
- **Known gaps (see ARCHITECTURE.md):** signed media URLs, S3 object storage, and a real job queue for production scale.

### Database & migrations

The data layer (`db.py`) runs on **SQLAlchemy Core** and works on both SQLite
(dev default) and **Postgres** — just set `DATABASE_URL`:

```bash
export DATABASE_URL="postgresql+psycopg://user:pass@host:5432/playmetrics"
pip install "psycopg[binary]"
alembic upgrade head        # apply migrations (run on every deploy)
```

Schema changes: edit the `Table` definitions in `db.py`, then
`alembic revision --autogenerate -m "describe change"` and commit the new file
under `migrations/versions/`. In dev, `init_db()` create-alls the schema so no
migration step is needed to get started.

### Scaling: storage & workers

- **S3 object storage:** `PLAYMETRICS_STORAGE=s3` + `PLAYMETRICS_S3_BUCKET=…`
  (`pip install boto3`). Job artifacts upload on completion; media is served via
  presigned URLs.
- **Distributed job queue:** `PLAYMETRICS_QUEUE=rq` + `REDIS_URL=…`
  (`pip install rq redis`), then run workers — on GPU nodes with `detector=yolo`
  for accelerated analysis:

  ```bash
  rq worker -u $REDIS_URL playmetrics
  ```

### Deploying

See **[DEPLOY.md](DEPLOY.md)** for production deployment — a `Dockerfile`,
`docker-compose.yml`, `fly.toml` (recommended) and `render.yaml` are included.
Play Metrics is a stateful, compute-heavy service, so it needs a container host
with a persistent volume (not a static/serverless host).

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
* **`yolo`** — set `--detector yolo` (CLI) for **real footage**. Requires
  `pip install ultralytics` (weights auto-download on first run). Uses a
  COCO-pretrained model for `person` + `sports ball`; team identity is
  assigned by jersey-hue (grass pixels masked out). Tunable via
  `Config.yolo_weights / yolo_conf / yolo_imgsz / yolo_device` — raise
  `yolo_imgsz` to catch small, fast balls. Note: the synthetic demo uses
  coloured dots, not people, so YOLO only finds the ball there — point it at
  real match video.

### Pitch homography (calibration)

To produce *true* metres (distance/speed) and a correct top-down heatmap,
`homography.py` maps image pixels to a canonical 105×68 m pitch model:

* **Automatic** — `detect_pitch_corners` finds the field boundary and maps its
  four corners to the model. Works when the whole pitch is visible and roughly
  rectangular (synthetic sample, elevated centre-line cameras).
* **Manual** — set `Config.homography_corners` to four image points
  (TL, TR, BR, BL) for trapezoidal real-camera views.

When calibration fails, the pipeline falls back to an image-plane proxy and
reports `"calibration": "proxy"` in `summary.json` (vs `"homography"`).

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
* Homography auto-detection assumes a near-rectangular full-pitch view; angled
  broadcast cameras need the manual-corner override (or learned pitch-keypoint
  detection) and ideally per-frame re-estimation.
* Jobs run in-memory on a thread; production needs a queue + object storage +
  GPU workers.

## Roadmap to a real product

1. ✅ **Homography & calibration** — auto + manual pitch-corner mapping to a
   top-down model (this prototype). Next: learned pitch-keypoint detection.
2. ✅ **YOLO detection backend** (this prototype). Next: fine-tuned ball model +
   ByteTrack + ReID for stable IDs through crossings.
3. **Capture hardware** — fixed 4K panoramic rig, on-prem encoder, RTMP/SRT push.
4. **Live, low-latency** — stream the virtual-camera output (LL-HLS/WebRTC).
5. **Event model** — learned shot/goal/foul classifier + audio crowd-energy.
6. **Scale** — job queue, GPU autoscaling, per-club tenancy, storage/CDN.
