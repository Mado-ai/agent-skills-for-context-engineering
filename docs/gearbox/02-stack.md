# 02 — Recommended technology stack

Each choice states the alternative considered, the reason, and **the reversal cost** —
what it would take to change your mind later. Reversal cost is the number that should
drive the decision, not the feature comparison.

## 2.1 Summary

| Layer | Choice | Reversal cost |
|---|---|---|
| XR client | **Unity 6 LTS + OpenXR + XR Interaction Toolkit** | Very high — total client rewrite |
| XR platform adapters | Meta XR SDK (Scene, passthrough, anchors) behind an internal `IPlatformXR` port | Low — that is the point of the port |
| Realtime media | **LiveKit** (self-hosted; LiveKit Cloud for dev) | Medium — hidden behind `ITransport` |
| Realtime state transport | **LiveKit data channels** (lossy + reliable) at MVP | Low — protocol is transport-agnostic |
| Room server | **TypeScript (Node 22) authoritative room process** | Medium — port to Go/Rust at a known threshold |
| Control plane | **TypeScript modular monolith** (Fastify), module-per-future-service | Low — split is a deployment change |
| DB | **PostgreSQL 16** + **Drizzle ORM** | Low for ORM, high for DB (don't) |
| Cache / ephemeral | **Redis 7** (Valkey acceptable) | Low |
| Object storage | **S3-compatible** (MinIO locally, R2/S3 in cloud) + CDN | Low |
| Web / admin | **Next.js + React + TypeScript + Tailwind** | Low |
| Mobile companion | **Expo / React Native** (native modules when scanning lands) | Medium |
| Desktop client | **Unity build of the same client**, flat-screen mode | Low |
| Local node | **Same monolith image, `LOCAL` profile** + embedded Postgres + mDNS | Low if seams from [01](01-assumptions-risks.md) R5 are kept |
| IaC / CI | Docker Compose (dev+MVP prod) → Terraform + k8s (post-MVP) · GitHub Actions | Low |
| Observability | OpenTelemetry → Grafana stack (Loki/Tempo/Prometheus) | Low |

## 2.2 XR client: Unity, and why this reverses the WebXR call

The earlier `docs/vr-ar-social-app` spec recommended a **WebXR-first** client, and
that recommendation was right *for that product*. GearBox has different constraints,
and they point the other way. The honest comparison:

| Constraint | UGC social platform (prior spec) | GearBox |
|---|---|---|
| Primary risk | Distributing **untrusted content** at runtime | Deep **device and OS integration** |
| Content model | Every world is third-party, arriving at runtime | MVP apps are first-party, shipped with the client |
| Needs scene understanding (room mesh, plane/obstacle semantics) | No | **Yes — core to the product** |
| Needs persistent spatial anchors across sessions | No | **Yes — "persistent room" depends on it** |
| Needs passthrough / MR compositing control | No | **Yes** |
| Needs BLE / USB / LAN device access | No | **Yes (GearBox Link)** |
| Needs background sensors, foreground service behavior | No | **Yes (4D, telemetry)** |
| Sharing model | A world is a URL — install-free virality is the growth engine | An installed spatial OS; a room link opens an installed app |

Three of those rows are decisive. **Scene understanding, persistent anchors, and
passthrough control are native-only or poorly/inconsistently exposed via WebXR**, and
all three are load-bearing for "the room is the operating system." Device access over
BLE/USB from a browser is worse still. The web's advantage — runtime-downloaded
untrusted content — is exactly the thing GearBox does *not* need at MVP (assumption
A5).

**Unity over Unreal**, specifically: better standalone-Android XR performance and build
size, mature OpenXR + XR Interaction Toolkit (grab/resize/pin/ray/poke largely
solved), visionOS via PolySpatial, C# iteration speed, and the far deeper hiring pool
for *XR* specifically. Unreal wins on photorealism, which [01](01-assumptions-risks.md)
does not treat as a differentiator on mobile-class GPUs.

**Keep the web door open anyway:** a WebXR/WebGL *viewer* (join a room, see avatars,
hear voice, view panels — no editing, no devices) is a phase-4 growth feature worth
having. Keep the protocol and schemas engine-neutral so it stays cheap. That is the
practical hedge against having made the wrong call here.

**Reversal trigger:** if scene-understanding APIs converge in WebXR across Quest,
Android XR, and visionOS, re-evaluate for the *viewer-plus* tier — not for the main
client, which by then owns device integration.

## 2.3 Media and state on one connection: LiveKit

The non-obvious recommendation, and the biggest schedule lever in the plan.

LiveKit provides SFU, signaling, TURN, adaptive bitrate, simulcast, a Unity SDK, and
**reliable + lossy data channels**. For an MVP at ≤ 8 users per room, those lossy data
packets are a perfectly good carrier for 20 Hz pose data.

Using it for both media and state buys:
- **One connection, one auth token, one NAT-traversal problem.** Not three.
- Room lifecycle, participant join/leave, and reconnection semantics for free —
  precisely the surface where [01](01-assumptions-risks.md) R3 says the bugs live.
- ~2–3 months of specialist WebRTC work avoided.

The cost is coupling, mitigated by `ITransport` ([05](05-realtime.md) §5.2).

**When to graduate:** move state to a dedicated WebTransport room server when any of —
sustained > 16 users/room, state bandwidth > ~200 kbps/client, or needing per-packet
priority the data channel cannot express. The protocol does not change; the driver does.

## 2.4 Room server: TypeScript now, with a stated threshold

A 20 Hz authoritative loop for 8 participants in Node is comfortable — roughly 2–4 ms
per tick with a typed-array component store and zero per-tick allocation. Choosing
Rust or Go at MVP costs a small team velocity and a shared type system for a
performance problem it does not yet have.

**Discipline required** (or Node will bite you): pre-allocated typed arrays, object
pools, no per-tick allocation, no JSON on the hot path, `worker_threads` per room, and
a p99 tick-time metric in CI from day one.

**Graduation threshold — write it down and hold to it:** port to Rust (Tokio + a
Wasmtime host for phase-2 sandboxed app logic) when p99 tick time exceeds 60% of the
tick budget at target occupancy, or when rooms/node economics require > ~200
concurrent rooms per node. Prior-spec §6.2 gives the density math that the port would
be chasing.

## 2.5 Control plane: modular monolith

The prompt's §22 lists 16 services. Build them as 16 **modules in one deployable**,
with import boundaries enforced by lint rule (`eslint-plugin-boundaries`) and a
`ports/` interface per module. Cross-module calls go through the port, never a deep
import.

```
services/gearbox-core/src/modules/
  identity/  user/  social/  presence/  environment/  asset/
  session/   device/  media/  notification/  audit/  sync/
    ├── domain/          — entities, invariants, pure logic. Zero I/O.
    ├── application/     — use cases, transactions
    ├── infrastructure/  — Drizzle repos, external clients
    ├── http/            — routes, request/response DTOs
    └── ports/           — the module's public interface. The ONLY import surface.
```

A module becomes a service when it has a genuinely different scaling or availability
profile. Realistic first candidates: `asset` (CPU-heavy ingest), `presence` (high
write rate), `media` (LiveKit webhooks). Everything else can stay monolithic for years.

**Why not microservices now:** with 3–5 engineers, distributed transactions,
per-service CI, and 16 dashboards cost more than the coupling they remove. This is the
prompt's own instruction (§22, "do not create unnecessary microservices") and it is
correct.

## 2.6 Data layer

- **Postgres 16.** With `pgvector` available for later AI/semantic search, and JSONB
  for the genuinely schemaless parts (scene graphs, manifests, capability documents).
  No second database at MVP.
- **Drizzle over Prisma.** SQL-first, generates real migrations you can review,
  no query-engine binary, better fit for the recursive/spatial queries the scene graph
  will need. Prisma's DX advantage is real but shrinks exactly where this schema gets
  interesting.
- **Redis** for presence, session routing, rate limits, and short-lived locks.
  Ephemeral by construction: losing Redis must degrade routing, never lose durable
  state.
- **Object storage** for assets, avatars, environment bundles, and snapshots.
  Content-addressed keys (SHA-256 of bundle) → immutable, cacheable forever, free
  rollback, dedupe across environments.
- **Telemetry time-series: not at MVP.** Postgres with partitioned tables handles
  device telemetry until volume justifies TimescaleDB or ClickHouse. Adding it early is
  a second operational burden for a load you do not have.

## 2.7 Identity

Two paths, and the choice depends on open question 2 in [01](01-assumptions-risks.md) §1.3:

- **If local-first is deferred (A4):** use a managed OIDC provider for user auth and
  keep tokens short-lived. Fastest, least code, good security defaults.
- **If local-first is a launch requirement:** you must own identity, because a LAN room
  with no internet still has to authenticate. That means a self-hosted OIDC issuer,
  device-bound keypairs, and pre-issued offline room capability tokens
  ([07](07-authz-security.md) §7.4).

**Recommendation: own it from the start.** Local-first appears in the product
principles (§2.5 of the master prompt) as a *core* principle, not a nice-to-have, and
migrating identity later is one of the most disruptive migrations there is. The extra
MVP cost is roughly one sprint.

## 2.8 What is deliberately *not* in the stack

| Not chosen | Why |
|---|---|
| Kubernetes at MVP | Docker Compose on one VM + managed Postgres covers the MVP. k8s is a full-time job you cannot staff. [10](10-quality-devops.md) §10.3. |
| Message broker (Kafka/NATS/Rabbit) | Postgres `LISTEN/NOTIFY` + a `jobs` table covers MVP async work. Add NATS when you have real fan-out. |
| GraphQL | REST + OpenAPI + generated typed client is simpler for a small team; the flexibility GraphQL buys is a phase-3 problem when third-party clients exist. [06](06-api.md) §6.1. |
| Separate search engine | Postgres full-text is sufficient until the marketplace exists. |
| ECS framework in Unity (DOTS) | Real perf ceiling, real complexity tax. Revisit if [01](01-assumptions-risks.md) R2 materializes. |
| Custom SFU / TURN | See §2.3. |
| Blockchain anything | Solves no problem this product has. |
