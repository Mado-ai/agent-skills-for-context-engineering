# 09 — MVP backlog & sprint plan

Required outputs #20 and #21.

> **§9.1, §9.3 and §9.4 are superseded by [11 — Revised MVP](11-geospatial-mvp.md)
> §11.14–11.15**, following the decision that the first users are location-based AR game
> players. **§9.2 (definition of done), §9.5 (deferrals and their seams), and §9.6
> (scaffolding order) still apply unchanged** and are referenced by doc 11. The epics
> below are retained because doc 11's backlog carries several of them forward verbatim.

## 9.1 MVP scope statement

> A signed-in user enters their persistent spatial room, opens and pins a dashboard,
> invites up to three others, sees them as avatars, talks in spatial voice, manipulates
> a shared object, places a live camera panel, and finds everything where they left it
> next session — over the internet, with local hosting reachable by architecture.

That is prompt §32's twelve steps, and it is the whole MVP.
[README](README.md) §1 explains why this replaces §27's 30-item list; §9.5 below lists
each deferral and its seam.

## 9.2 Definition of done (every story)

Per master prompt §31 — a story is not done without all nine:

1. User story · 2. Technical design note · 3. Files created/modified ·
4. Code · 5. Tests (unit + integration; protocol changes also need bot-harness
coverage) · 6. Manual verification steps **on device** where XR is involved ·
7. Security considerations · 8. Performance considerations (frame budget for client
work, p99 tick time for server work) · 9. Future extension points.

Plus, always: passes CI, no new lint-boundary violations, telemetry emitted for new
failure modes, docs updated, ADR written for any decision that closes off an option.

## 9.3 Backlog

`S` = story points (Fibonacci, 1 pt ≈ half a day for one engineer).
`§32` maps to the vertical-flow step the item serves.

### Epic A — Foundations (no user-visible value; everything depends on it)

| ID | Story | S | Notes |
|---|---|---|---|
| A1 | Monorepo, pnpm/Turborepo, lint boundaries, CI skeleton | 5 | [03](03-architecture.md) §3.5 |
| A2 | Docker Compose dev env: Postgres, Redis, MinIO, LiveKit, one-command bootstrap | 5 | Must be genuinely one command or it rots |
| A3 | `packages/protocol` schema + codegen → TS + C# | 8 | The anti-drift mechanism; do it before any netcode |
| A4 | DB migrations for the [04](04-data-model.md) MVP schema + seed data | 5 | |
| A5 | OTel wiring, structured logs, `/health`, `/metrics` | 3 | Cheap now, invaluable in sprint 6 |
| A6 | Unity project skeleton, OpenXR, `IPlatformXR` port + Meta adapter | 8 | |
| A7 | **Bot-client harness** (headless protocol client, scriptable scenarios) | 8 | [01](01-assumptions-risks.md) R3 — before the features it tests |
| A8 | On-device perf harness in CI (frame-budget regression gate) | 5 | [01](01-assumptions-risks.md) R2 |

### Epic B — Identity & accounts (§32.1)

| ID | Story | S |
|---|---|---|
| B1 | Register / login, password hashing, email verification | 5 |
| B2 | JWT access + rotating refresh with reuse detection | 5 |
| B3 | Device-bound Ed25519 registration + assertion grant | 5 |
| B4 | Profile CRUD, handle uniqueness, `GET /me` | 3 |
| B5 | XR client sign-in flow (device code — typing a password in VR is miserable) | 5 |
| B6 | `can()` authorization core + role matrix + contract tests | 8 |
| B7 | Audit module: transactional `AuditEvent` writes | 3 |

### Epic C — Spatial shell & persistence (§32.2, §32.3, §32.10)

| ID | Story | S |
|---|---|---|
| C1 | Boundary + room-mesh ingestion via `IPlatformXR`; safety layer compositing | 8 |
| C2 | Root anchor create/persist/resolve; anchor-relative pose maths | 8 |
| C3 | Personal home environment: create on first launch, load, render | 5 |
| C4 | Interaction toolkit: ray, poke, grab, move, resize, pin, dock | 13 |
| C5 | Spatial panel primitive (world-space UI, curved, legible at 1–3 m) | 8 |
| C6 | App dock / home layer | 8 |
| C7 | Persist placements; restore on next launch (the §32.10 acceptance test) | 5 |
| C8 | Dashboard app v1 (first-party, manifest-declared, capability-enforced) | 8 |

### Epic D — Realtime rooms (§32.5, §32.7, §32.11, §32.12)

| ID | Story | S |
|---|---|---|
| D1 | `room-server` process, worker-per-room, 20 Hz tick, component store | 8 |
| D2 | `ITransport` + `LiveKitTransport` (TS and C#) | 8 |
| D3 | `POST /sessions` — allocate, authorize, mint scoped LiveKit token | 5 |
| D4 | Pose channel: encode, send, interpolate, avatar drive | 8 |
| D5 | Basic avatars: three-point IK, LOD bands, nameplate | 13 |
| D6 | Ownership leases + epoch; grab/release of a shared object | 8 |
| D7 | Object spawn/delete/pin events, server-authoritative + permission-checked | 5 |
| D8 | Snapshot: full + late-join | 5 |
| D9 | Reconnect with resume token; `RESYNC_REQUEST` path | 8 |
| D10 | Snapshot/event-log persistence, debounced writes | 5 |
| D11 | `IAuthority` interface + `CloudAuthority` (the local-mode seam) | 3 |
| D12 | Network-quality adaptation ladder + telemetry | 5 |

### Epic E — Social & invitations (§32.4, §32.9)

| ID | Story | S |
|---|---|---|
| E1 | Friends: request, accept, list, block | 5 |
| E2 | Invitations: create, hash-store, redeem, revoke, expiry | 5 |
| E3 | Environment members + role assignment UI | 5 |
| E4 | In-XR invite flow + notification + join | 8 |
| E5 | Owner permission controls in-session (role change, kick) | 5 |
| E6 | Presence (Redis): online, in-environment, activity | 3 |

### Epic F — Media (§32.6, §32.8)

| ID | Story | S |
|---|---|---|
| F1 | LiveKit audio publish/subscribe in Unity | 5 |
| F2 | Client-side HRTF spatialization driven by speaker pose | 8 |
| F3 | Mute/block enforced below the app layer + non-suppressible indicators | 5 |
| F4 | Camera panel: publish track, bind to spatial object, consent record | 8 |
| F5 | Adaptive subscription by on-screen panel size (simulcast layers) | 5 |
| F6 | Shared-media panel with synchronized playback clock + host control | 8 |

### Epic G — Companion & admin (thin)

| ID | Story | S |
|---|---|---|
| G1 | Web admin: users, environments, sessions, audit viewer | 8 |
| G2 | Desktop client build of the Unity project (flat-screen join) | 5 |
| G3 | Mobile companion: sign-in, friends, invitations, notifications | 8 |

**Total ≈ 295 points.**

## 9.4 Sprint plan — 8 × 2-week sprints, 4 engineers

Assumes ~35–40 points per sprint at 4 engineers (deliberately conservative; XR work
estimates badly).

| Sprint | Theme | Items | Demo at end of sprint |
|---|---|---|---|
| **1** | Skeleton | A1 A2 A3 A4 A5 A6 | `docker compose up` runs everything; Unity app launches on Quest and shows a grey-box room; codegen produces C# structs |
| **2** | Identity + interaction feel | B1 B2 B3 B4 B5 B6 C4 | Sign in on device; grab, move, resize, pin a cube. **Put C4 in front of real users this sprint** ([01](01-assumptions-risks.md) R6) |
| **3** | Space + harness | A7 A8 C1 C2 C3 C5 | Room boundary and safety layer visible; anchored panel persists across app restarts; bot harness drives a fake session |
| **4** | Rooms come alive | D1 D2 D3 D4 D11 B7 | Two headsets in one room, avatars moving. First real multiplayer demo |
| **5** | Sync correctness | D5 D6 D7 D8 D9 D10 | Shared object passes between users; late join correct; kill the server and reconnect cleanly |
| **6** | Voice + social | F1 F2 F3 E1 E2 E6 | Invite a friend, hear them positioned in space, mute them |
| **7** | Apps + camera | C6 C7 C8 E3 E4 E5 F4 | Full §32 flow end to end: dock → dashboard → pin → invite → camera panel → permissions |
| **8** | Hardening | D12 F5 F6 G1 G2 + buffer | Acceptance criteria pass; adaptation under simulated packet loss; admin console |

**Sprint 0 (1 week, before sprint 1):** finalize open questions
([01](01-assumptions-risks.md) §1.3), procure devices and accounts, ADRs for the
decisions in [02](02-stack.md), and a spike on Quest Scene API + persistent anchors —
C2 is the item most likely to surprise, so surprise early.

### Milestones

| Milestone | End of | Gate |
|---|---|---|
| **M1 — Walking skeleton** | Sprint 3 | One user, persistent anchored panel, safety layer. *Gate: if C2 (anchor persistence) is not solid, the entire "persistent room" premise is at risk — stop and re-plan.* |
| **M2 — Multiplayer** | Sprint 5 | 4 users, avatars, shared object, reconnect, late join. *Gate: bot-harness soak of 4 bots × 30 min with zero desync.* |
| **M3 — Feature complete** | Sprint 7 | Full §32 vertical flow |
| **M4 — MVP accepted** | Sprint 8 | Every §28 acceptance criterion in scope passes, on device, twice |

## 9.5 Deferred from §27, with the seam that keeps it cheap

| §27 item | Deferred to | Seam already in the MVP |
|---|---|---|
| 11 Local-network room · 13 Hybrid architecture | Phase 4 | `IAuthority` (D11), UUIDv7 IDs, HLC columns, transport abstraction ([05](05-realtime.md) §5.10) |
| 24 Mobile companion (G3) | Phase 3 | REST API is client-agnostic; nothing to change |
| 25 Local-node prototype | Phase 4 | Same monolith image, `LOCAL` profile ([02](02-stack.md) §2.1) |
| 27 Developer SDK | Phase 9 | Manifest + capability enforcement already exercised by first-party apps ([08](08-schemas.md) §8.1) |
| Third-party app sandbox | Phase 2 | `entry.kind: "wasm"` reserved in the manifest |
| Room/object scanning | Phase 6 | Provenance + confidence fields in the Smart Asset schema |
| Marketplace, devices, AI, Studio | Phases 5–8 | JSONB seams noted in [04](04-data-model.md) §4.1 |

Each deferral is a **seam, not a stub** — nothing shipped in the MVP has to be
rewritten to add these; the interfaces exist and have exactly one implementation.

## 9.6 Scaffolding order (on approval)

Strictly sequential — each step is verifiable before the next begins:

1. `A1` repo + CI + lint boundaries → green pipeline on an empty repo.
2. `A2` Docker Compose + `make dev` → all infra healthy locally.
3. `A4` schema + migrations + seed → `psql` shows the tables.
4. `A3` protocol schema + codegen → TS and C# structs round-trip in a test.
5. `B1–B4` auth vertical → integration tests green, admin can create a user.
6. `A6` Unity skeleton + `IPlatformXR` → grey-box scene on device.
7. Then feature-by-feature per the sprint plan, each with the §31 nine-part output.

**Nothing else starts until step 5 is green.** A working auth vertical through the
whole stack — migration, service, API, typed client, test — is the proof that the
architecture is real rather than a diagram.
