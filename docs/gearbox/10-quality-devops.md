# 10 — Test strategy, DevOps, deployment, cost

Required outputs #22–#25.

## 10.1 Test strategy

The unusual part of testing this product: **the highest-risk behaviour is distributed,
stateful, and real-time**, which unit tests cannot reach and manual QA cannot reproduce.
The bot harness is therefore not a nice-to-have — it is the primary correctness tool.

### Layers

| Layer | Tool | Covers | Gate |
|---|---|---|---|
| Unit | Vitest (TS), NUnit (C#) | Domain logic, `can()`, protocol codec, pose maths, HLC merge | Every PR; **90% on `domain/` and `can()`**, no global coverage target (they measure nothing useful) |
| Integration | Vitest + testcontainers | Modules against real Postgres/Redis/MinIO. No mocked DB — mocked persistence hides the bugs persistence actually has | Every PR |
| API contract | Generated from OpenAPI + zod | Every endpoint: happy path, authz denial, validation failure, idempotency replay | Every PR |
| **Protocol conformance** | `packages/testing` + bot harness | Encode/decode round-trip, version negotiation, malformed-input rejection, N-1 compatibility | Every PR touching `packages/protocol` |
| **Multi-client scenario** | Bot harness (A7) | Late join, reconnect, ownership contention, permission enforcement, server restart | Every PR touching realtime; nightly soak |
| Load | Bot harness at scale | 50 rooms × 8 bots; p99 tick time, memory growth, event-log write rate | Nightly + pre-release |
| Client unit / play-mode | Unity Test Framework | Interaction toolkit, anchor maths, LOD selection, safety layer invariants | Every PR touching Unity |
| **On-device performance** | `tools/perf-harness` | Frame time, GC allocations, draw calls, memory on a real Quest 3 | Nightly + release gate |
| Manual XR | Scripted checklist | Comfort, legibility, reach, tracking loss, guardian behaviour | Per sprint, on device |
| Security | CodeQL, gitleaks, `pnpm audit`, image scan | See [07](07-authz-security.md) §7.8 | Every PR |

### The three tests that matter most

1. **Ownership contention.** Two bots grab the same object in the same tick, one
   disconnects mid-grab, a third requests it. Assert exactly one holder, correct epoch,
   correct final persisted pose. This is [01](01-assumptions-risks.md) R3 in a test.
2. **Late join under load.** Bot joins a room with 200 objects while two bots are
   actively moving things. Assert its snapshot converges to server state within 2 s and
   no event is applied out of order.
3. **Permission enforcement over the realtime channel.** A viewer-role bot sends
   `OBJECT_TRANSFORM` and `SPAWN_APP`. Assert both are rejected, audited, and rate-limited
   after repetition. REST authz is easy to remember; **realtime authz is the one teams
   forget**, and it is the same `can()` call.

### Client performance budgets (release gate, Quest 3)

| Metric | Budget |
|---|---|
| Frame time | ≤ 11.1 ms (90 fps) with 4 avatars + 2 panels + passthrough |
| GC allocations in steady state | **0 bytes/frame** |
| Draw calls | ≤ 150 |
| Triangles | ≤ 350k |
| App memory | ≤ 1.5 GB |
| Time to interactive from launch | ≤ 8 s (warm) |
| Time to joined-and-rendered from invite accept | ≤ 5 s |

### Server budgets

| Metric | Budget |
|---|---|
| Room tick p99 | ≤ 20 ms (40% of the 50 ms budget) at 8 participants |
| API p95 | ≤ 150 ms (excluding `POST /sessions`, which allocates: ≤ 800 ms) |
| Snapshot write | ≤ 200 ms, off the tick thread |
| Memory per room | ≤ 250 MB including the event ring |

## 10.2 DevOps

**Environments:** `local` (Compose) → `dev` (auto-deploy from `main`) → `staging`
(release candidates, prod-shaped, seeded) → `production` (tagged releases, manual
approval).

**CI (GitHub Actions), on every PR:**

```
lint + typecheck  →  unit  →  integration (testcontainers)  →  contract
  →  protocol conformance  →  codegen-freshness check (fails if generated C# is stale)
  →  build images  →  security scan  →  [main only] deploy dev  →  smoke
Nightly: bot-harness soak · load test · on-device perf · dependency audit
```

**Unity CI is separate and slower** — self-hosted runner (Unity licensing and build
caches make hosted runners impractical), builds APK on PR to `main` and on tag,
uploads to an internal distribution channel. Do not block backend PRs on Unity builds;
the feedback loops have different natural speeds.

**Migrations:** Drizzle, forward-only, **expand-contract in three deploys** for
breaking changes (add nullable → backfill + dual-write → drop old). Never a destructive
migration in the same deploy as the code that stops using the column. Every migration
requires a tested rollback note; migrations run as a separate job before app rollout,
never on app startup.

**Secrets:** never in the repo (gitleaks in CI); `.env.example` committed; runtime
secrets from the platform's secret manager; rotation runbook for JWT signing keys,
database credentials, and LiveKit API keys.

**Runbooks required before production** (`docs/runbooks/`): room-server crash-loop ·
LiveKit outage (graceful degradation to text/state-only) · Postgres failover ·
migration rollback · certificate expiry · abuse report handling · secret rotation ·
"user reports objects moved/disappeared" (the desync triage path).

## 10.3 Deployment

### MVP: one VM, Docker Compose. Deliberately.

```
Caddy (TLS) → gearbox-core (2 replicas) → managed Postgres
            → room-server (1, worker-per-room)  → managed Redis
            → LiveKit (self-hosted, host network for UDP)
            → OTel collector → Grafana Cloud free tier
Object storage: Cloudflare R2 (zero egress fees) + CDN
```

**Why not Kubernetes:** with 3–5 engineers, k8s is a full-time operational commitment
bought to solve scaling problems the MVP does not have. Compose on a well-monitored VM
with managed data services is operationally boring, and boring is the correct target
while the product risk is entirely elsewhere. Graduate to k8s (or Fly/ECS) when you need
multi-region, autoscaling room servers, or zero-downtime rolling deploys with session
drain — realistically phase 3.

**Deploy method:** image tags from CI, `docker compose pull && up -d`, health-gated.
Room servers drain first ([05](05-realtime.md) §5.5) so sessions migrate rather than
drop.

**Backups:** managed Postgres PITR (7 days) + nightly logical dump to R2 with a
**monthly tested restore** — an untested backup is a hope, not a backup. Object storage
versioned with lifecycle rules.

**DR targets (MVP):** RPO 15 min, RTO 4 h. State this publicly to the team so nobody
assumes better.

### Post-MVP scaling shape

- `gearbox-core` → horizontal, stateless behind an LB.
- `room-server` → the interesting one: session-affinity routing via Redis, drain-and-
  migrate on deploy, autoscale on rooms-per-node, regional placement in phase 3.
- LiveKit → its own scaling path; consider LiveKit Cloud once media minutes justify not
  operating it.
- Postgres → read replicas for catalog/social reads long before any sharding
  conversation.

## 10.4 Cost-sensitive prototype plan

Order-of-magnitude, monthly, for MVP development and a small pilot (≤ 100 pilot users,
≤ 20 CCU). Provider list prices; expect real numbers within ~2× of these.

| Item | Choice | ~Monthly |
|---|---|---|
| App VM | 4 vCPU / 16 GB (Hetzner CPX41 class) | $30–50 |
| Managed Postgres | 2 vCPU / 4 GB + PITR | $50–80 |
| Managed Redis | 1 GB | $15–25 |
| Object storage + CDN | R2, ~200 GB, zero egress | $5–15 |
| LiveKit | Self-hosted on the app VM at pilot scale | $0 (in VM cost) |
| Observability | Grafana Cloud free tier | $0 |
| CI | GitHub Actions free minutes + 1 self-hosted Unity runner (existing hardware) | $0–40 |
| Error tracking | Sentry developer tier | $0–26 |
| Domain, TLS, email | Caddy/Let's Encrypt + transactional email | $10–20 |
| **Total** | | **≈ $110–260 / month** |

Plus one-off: 3–4 Quest 3 headsets (~$500 each), Unity Personal ($0 under the revenue
threshold; check current terms before relying on it), Apple/Meta developer accounts
(~$100/yr each).

### The cost decisions that matter

1. **Self-host LiveKit during development, move to LiveKit Cloud when media minutes
   justify it.** Self-hosting is cheap at pilot scale and expensive in attention at
   production scale — the crossover is operational, not financial.
2. **Cloudflare R2 over S3** — zero egress fees, and asset delivery is your egress-
   heaviest path. This single choice can dominate storage cost at scale.
3. **No Kubernetes, no Kafka, no time-series DB, no search engine at MVP.** Each adds
   $50–200/month and, more importantly, ongoing operational attention a small team
   cannot spare ([02](02-stack.md) §2.8).
4. **Turn off dev/staging environments outside working hours** — scheduled shutdown is
   often 40–60% of non-prod spend.
5. **Watch the shape, not the total.** At real scale the driver becomes per-CCU
   compute + media egress; the prior spec's `docs/vr-ar-social-app/06-scale-and-cost.md`
   §6.2–6.5 has that math and it applies to GearBox essentially unchanged. Revisit it
   before any growth commitment.

**Budget alerting from day one** — a cloud bill surprise on a small team is a genuine
project risk, not just an annoyance.
