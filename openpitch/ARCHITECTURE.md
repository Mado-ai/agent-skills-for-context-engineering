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
| Object storage | local volume `runs/` (S3/GCS in prod) | 🟡 |
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
| Guardian-gating for minors | — | ⬜ |
| Audit trail | — (request logging ⬜) | ⬜ |
| Right to delete (cascade) | job delete removes row + files; full cascade ⬜ | 🟡 |

## Next backend milestones (in priority order)
1. ✅ **Roles & orgs** — organizations + memberships with role-based authz at the
   Application API chokepoint (owner/admin/coach/parent/player/scout). Next:
   guardian-consent flow + audit logging; federation aggregate role.
2. **Real job queue + object storage** — Celery/RQ + S3/GCS; GPU workers for detection.
3. **Multi-camera + homography per angle**; quality-tier routing (facility vs Solo).
4. **Learned event models** (passes/shots/tackles) feeding xG/xT.
   - Detection→roster mapping is **assisted** today (auto-assign + manual confirm);
     fully automatic mapping needs jersey-number OCR / player re-ID.
5. **Audit logging + guardian consent** for any minor data exposure.
6. **On-site sync agent** (the gateway-side counterpart to `/api/ingest/*`).
