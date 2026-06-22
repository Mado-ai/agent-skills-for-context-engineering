# Deploying Play Metrics

Play Metrics is a **stateful, compute-heavy Python service** (OpenCV video
processing, background jobs, SQLite, file outputs). It needs a **container host
with a persistent volume** — not a static/serverless host (those have no
persistent filesystem and short request timeouts that kill video jobs).

This repo ships ready-to-use configs for three paths. **Fly.io is recommended.**

## Before you deploy — set these secrets everywhere

| Variable | Required | Notes |
|----------|----------|-------|
| `PLAYMETRICS_SECRET` | **yes** | Token signing key. `openssl rand -hex 32`. Without a fixed value, logins drop on every restart. |
| `PLAYMETRICS_ADMIN_PASSWORD` | **yes** | Replaces the dev default. Use something strong. |
| `PLAYMETRICS_ADMIN_EMAIL` | no | Defaults to `yazanalshuibe14@gmail.com`. |
| `PLAYMETRICS_DATA` | preset | Job outputs dir (on the volume). |
| `PLAYMETRICS_DB` | preset | SQLite path (on the volume). |

---

## Option 1 — Fly.io (recommended)

```bash
cd openpitch
fly launch --no-deploy --copy-config            # creates the app from fly.toml
fly volumes create playmetrics_data --size 3    # persistent disk
fly secrets set PLAYMETRICS_SECRET=$(openssl rand -hex 32) \
                PLAYMETRICS_ADMIN_PASSWORD='<strong-password>'
fly deploy
```
Your URL: `https://play-metrics.fly.dev` (or whatever name `fly launch` assigns).

## Option 2 — Render.com (Git-driven blueprint)

1. Push this repo to GitHub (already done on the feature branch).
2. Render → **New → Blueprint** → pick the repo. It reads `render.yaml`.
3. Set `PLAYMETRICS_ADMIN_PASSWORD` in the dashboard (it's `sync:false`).
4. Deploy. Render gives you `https://play-metrics.onrender.com`.

> `render.yaml` lives at the repo root paths (`./openpitch/...`); if you deploy
> from inside `openpitch/`, move it up or adjust `dockerfilePath`/`dockerContext`.

## Option 3 — Any VPS / your own box (Docker Compose)

```bash
cd openpitch
export PLAYMETRICS_SECRET=$(openssl rand -hex 32)
export PLAYMETRICS_ADMIN_PASSWORD='<strong-password>'
docker compose up -d --build
```
Serves on port 8000. Put nginx/Caddy in front for TLS + a domain.

---

## Scaling notes (read before going big)

This prototype runs the CV pipeline **in-process on a background thread**, and
writes outputs to the **local volume**. That means:

* **Run a single instance.** Multiple replicas won't share job output files, and
  a CPU-bound job will compete with the web worker for the GIL.
* To scale out, move to the production architecture: a **job queue** (Celery/RQ)
  with **GPU workers**, **object storage** (S3/GCS) for media, and **Postgres**
  instead of SQLite. The code is structured so `pipeline.process_video` drops
  straight into a worker task.

## First login

Open the deployed URL → sign in with `PLAYMETRICS_ADMIN_EMAIL` /
`PLAYMETRICS_ADMIN_PASSWORD`, or create a new account from the landing page.
