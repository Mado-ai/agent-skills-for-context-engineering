# Architecture Map — prototype → reference (v4)

How this codebase maps onto the **Athletes Insights Platform** reference
architecture (four layers: Capture → Edge → Cloud → Experience). This is the
bridge between the prototype and the UniFi-grounded production design.

Status: ✅ implemented here · 🟡 stubbed/partial · ⬜ not yet · 🔌 external/hardware.

## Layer 1 — Capture (on-pitch)
| Reference | Here | Status |
|-----------|------|--------|
| UniFi Protect cameras (AI Pro 4K, G5 PTZ/Pro/Bullet) | `scripts/generate_sample.py` synthesises a wide feed for dev | 🔌 / 🟡 |
| Multi-camera angles | single-feed pipeline (one wide view) | 🟡 |
| Wearables / env sensors | — | ⬜ |

## Layer 2 — Edge (on-site rack)
| Reference | Here | Status |
|-----------|------|--------|
| UniFi gateway secure uplink | `POST /api/ingest/*` with per-device API keys | ✅ (cloud side) |
| AI Key first-pass detection | `detect.py` (colour / YOLO) — runs cloud-side for now | 🟡 |
| NVR local recording / sync agent | gateway→cloud sync modelled by the ingest API; on-site agent | 🔌 |
| Device registry / pairing | `sites` + `devices` tables; `POST /api/sites/{id}/devices` | ✅ |
| Heartbeat / health | `POST /api/ingest/heartbeat` (updates `last_seen`) | ✅ |

## Layer 3 — Cloud (ingestion → AI → storage → API)
| Reference stage | Here | Status |
|-----------------|------|--------|
| Ingestion API (auth, validation, dedup) | `POST /api/ingest/matches` — device-key auth, size/type checks, **idempotency keys** | ✅ |
| Job queue (per-match) | background thread per job + SQLite job rows (swap for Celery/RQ) | 🟡 |
| 1 · Detection (player/ball) | `detect.py` + `track.py` | ✅ |
| 2 · Event detection | highlight heuristics in `highlights.py` (passes/shots/tackles = learned models) | 🟡 |
| 3 · Tactical metrics (xG/xT, heatmaps, distance) | possession, heatmaps, distance/speed, possession-timeline in `analytics.py` (xG/xT ⬜) | 🟡 |
| 4 · Individual reports | per-player distance/top-speed; **mapped onto roster players** (`/api/matches/{id}/import-stats`) and surfaced in player profiles | ✅ |
| 5 · Highlight generation | `highlights.py` auto-clips | ✅ |
| 6 · Profile update | **detection stats flow into team/player profiles** via match→roster mapping; reporting reflects matches by 5/7/11 field type, career totals, leaderboards | ✅ |
| Relational DB | SQLite (`db.py`) — Postgres in prod | ✅ / 🟡 |
| Time-series store | folded into job summary JSON (dedicated TSDB ⬜) | 🟡 |
| Object storage | `storage.py` abstraction (LocalStorage now; S3/GCS-ready interface, `PLAYMETRICS_STORAGE`) | 🟡 |
| Application API + authz | `api.py` (JWT, per-user/site ownership) | ✅ |

## Layer 4 — Experience (apps & surfaces)
| Reference | Here | Status |
|-----------|------|--------|
| Coach app (web) | React dashboard (`web/`) | ✅ |
| Parent / Player apps | — (role model ⬜) | ⬜ |
| Solo Mode (phone upload, lighter pipeline) | `POST /api/jobs` upload + `color` detector path | 🟡 |
| Scout marketplace / public profiles | — | ⬜ |
| Federation reporting | — | ⬜ |

## Cross-cutting — child safety & privacy
| Principle | Here | Status |
|-----------|------|--------|
| Private by default | per-user job isolation; token-gated media | ✅ |
| Single authz chokepoint | all access via `api.py`; org access via `authz.py` role checks | ✅ |
| Role-based access (coach/parent/player/scout/federation) | orgs + memberships: owner/admin/coach (staff), parent/player (read-only, linked to one player), scout (public-only); federation ⬜ | ✅ |
| Guardian-gating for minors | players default to `is_minor`; sharing a minor needs guardian consent (`POST /api/players/{id}/consent` by linked parent/owner); revoking consent withdraws public exposure | ✅ |
| Audit trail | `audit_log` table; player views/shares + ingest-imports recorded; `GET /api/players/{id}/audit` (staff) to review | ✅ |
| Hardening | security headers (CSP/HSTS/XFO/nosniff), login rate-limit + lockout, prod requires PLAYMETRICS_SECRET + admin password | ✅ |
| Right to delete (cascade) | `DELETE /api/account` (user data + files) and `DELETE /api/orgs/{id}` cascade through all stores | ✅ |

## Next backend milestones (in priority order)
1. ✅ **Roles & orgs** — organizations + memberships with role-based authz.
2. ✅ **Child-safety hardening** — guardian-consent gate, audit trail, right-to-delete
   cascade, login rate-limit + security headers.
3. **Postgres + Alembic + object storage** — `storage.py` abstraction is in; the
   SQLite→Postgres cutover (SQLAlchemy Core + Alembic, driven by `DATABASE_URL`)
   is the dedicated next step — it needs a live Postgres to validate, so it is
   staged separately rather than rushed. Then S3 storage + a real job queue
   (Celery/RQ) + GPU workers.
4. **Signed media URLs** — replace the `?token=` (session JWT) on `/api/files/*`
   with short-lived, media-scoped signed URLs (small frontend media-token refactor).
5. **Multi-camera + homography per angle**; quality-tier routing (facility vs Solo).
6. **Learned event models** (passes/shots/tackles) feeding xG/xT.
   - Detection→roster mapping is **assisted** today (auto-assign + manual confirm);
     fully automatic mapping needs jersey-number OCR / player re-ID.
7. **On-site sync agent** (the gateway-side counterpart to `/api/ingest/*`).
