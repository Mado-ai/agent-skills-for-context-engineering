# GearBox Spatial Operating Platform — MVP architecture & implementation plan

**Status: plan only. No production code has been written. Scope and stack decisions are
locked (see below); scaffolding awaits a go.**

This document set is the response to the GearBox Master Technical Prompt §32 (First
Task) and delivers all 25 required outputs from §30.

> ### ⚠️ Read [11 — Revised MVP: location-based AR entry product](11-geospatial-mvp.md) first
>
> The first user is now defined as **location-based AR game players** (Pokémon Go–style)
> funnelling into the ecosystem. That makes **phone AR the lead client**, not the
> companion, and adds geospatial data, GPS anti-cheat, and outdoor safety.
> **Doc 11 supersedes the MVP definition and sprint plan in [09](09-mvp-backlog-sprints.md).**
> Docs 02–08 remain valid; doc 11 collects the deltas they need.

## 0. Locked decisions

| # | Question | Answer | Consequence |
|---|---|---|---|
| 1 | Scope | **Vertical slice**, 16 weeks | [11](11-geospatial-mvp.md) §11.14–11.15 |
| 2 | Engine | **Unity 6** | Confirmed — and *more* right after decision 4, since AR Foundation and OpenXR share one codebase |
| 3 | Devices | **No restriction** | Architecture covers all; QA is staged by test burden — phones lead, Quest second ([11](11-geospatial-mvp.md) §11.3) |
| 4 | First user | **Location-based AR game players → ecosystem** | The pivot. [11](11-geospatial-mvp.md) §11.2 |
| 5 | Slice shape | **Game loop + bridge into a persistent room** | The bridge is the thesis ([11](11-geospatial-mvp.md) §11.4) |
| 6 | Place data | **OpenStreetMap + own curation** | Free and hazard-aware; ODbL obligation handled by table separation ([11](11-geospatial-mvp.md) §11.5) |

---

## 1. Executive technical summary

GearBox is a persistent spatial operating platform: the room is the shell, spatial
apps are the software, and the same account carries identity, layout, assets,
devices, and permissions across VR, AR, desktop, and mobile — online, on a local
network, or hybrid.

The MVP proves exactly one claim:

> **A player acquired by a real-world AR game will follow a collected thing into a
> persistent spatial room — and stay for the room.**

That is the acquisition-to-ecosystem bridge, and it is the only claim that decides
whether GearBox is a platform or a game. The full acceptance test is in
[11](11-geospatial-mvp.md) §11.4.

The plan builds it as a single vertical slice on a deliberately small stack:

- **Unity 6** — AR Foundation (ARKit + ARCore) for phones, OpenXR for headsets, one
  codebase. This reverses the WebXR recommendation in the earlier
  `docs/vr-ar-social-app` spec; see [02](02-stack.md) §2.2 for why the constraints
  differ.
- **One TypeScript modular monolith** (`gearbox-core`) for the entire control plane,
  with internal module boundaries drawn where services will later split.
- **One TypeScript room-server process** for authoritative realtime state at 20 Hz.
- **LiveKit** (self-hosted or cloud) for WebRTC voice, camera, and — critically — the
  **data channel that also carries state**, so the MVP ships one connection, one auth
  path, one NAT-traversal story.
- **Postgres + Redis + S3-compatible storage.** Nothing else.

Everything that looks like a microservice in the prompt's §22 tree exists as a module
directory inside the monolith with an enforced import boundary. Splitting is a
deployment decision deferred until a specific module's scaling profile diverges.

### The three things that will decide this

1. **The bridge, not the game.** Room return rate — players re-entering their room on a
   later day *without* collecting first — is the single metric that separates a platform
   from a game ([11](11-geospatial-mvp.md) §11.13). Build no flat inventory screen; the
   room is the only place a collection lives, or nobody will visit it.
2. **Anti-cheat ships in the MVP, not phase 2.** Once a spoofing tool exists for your
   game it is permanent, and it destroys exactly the local-play fairness you acquired
   users for ([11](11-geospatial-mvp.md) §11.6).
3. **Outdoor safety is an architecture invariant, not a policy.** Hazard exclusion at
   place-ingest, speed lock, map-only default, takedown flow at launch
   ([11](11-geospatial-mvp.md) §11.7). §27's 30-item list is superseded by the slice;
   every deferral and its seam is listed in [09](09-mvp-backlog-sprints.md) §9.5 and
   [11](11-geospatial-mvp.md) §11.16.

## 2. Coverage of the 25 required outputs (§30)

| # | Required output | Where |
|---|---|---|
| 1 | Executive technical summary | This document, §1 |
| 2 | Assumptions | [01 — Assumptions & risks](01-assumptions-risks.md) §1.1 |
| 3 | Risks | [01](01-assumptions-risks.md) §1.2 |
| 4 | Recommended stack | [02 — Stack](02-stack.md) |
| 5 | Mermaid architecture diagram | [03 — Architecture](03-architecture.md) §3.1–3.3 |
| 6 | Monorepo structure | [03](03-architecture.md) §3.5 |
| 7 | Domain model | [04 — Data model](04-data-model.md) §4.1 |
| 8 | PostgreSQL schema proposal | [04](04-data-model.md) §4.3 |
| 9 | Realtime protocol | [05 — Realtime](05-realtime.md) §5.1–5.6 |
| 10 | REST / GraphQL API | [06 — API](06-api.md) |
| 11 | WebRTC media architecture | [05](05-realtime.md) §5.7 |
| 12 | Local-network discovery | [05](05-realtime.md) §5.8 |
| 13 | Offline sync strategy | [05](05-realtime.md) §5.9 |
| 14 | Authorization model | [07 — AuthZ & security](07-authz-security.md) §7.1–7.4 |
| 15 | App manifest schema | [08 — Schemas](08-schemas.md) §8.1 |
| 16 | Smart Asset schema | [08](08-schemas.md) §8.2 |
| 17 | Environment schema | [08](08-schemas.md) §8.3 |
| 18 | Device capability schema | [08](08-schemas.md) §8.4 |
| 19 | Threat model | [07](07-authz-security.md) §7.5 |
| 20 | MVP backlog | **[11](11-geospatial-mvp.md) §11.14** (supersedes [09](09-mvp-backlog-sprints.md) §9.3) |
| 21 | Sprint plan | **[11](11-geospatial-mvp.md) §11.15** (supersedes [09](09-mvp-backlog-sprints.md) §9.4) |
| 22 | Test strategy | [10 — Quality & DevOps](10-quality-devops.md) §10.1 |
| 23 | DevOps plan | [10](10-quality-devops.md) §10.2 |
| 24 | Deployment strategy | [10](10-quality-devops.md) §10.3 |
| 25 | Cost-sensitive prototype plan | [10](10-quality-devops.md) §10.4 |

## 3. Relationship to the existing `docs/vr-ar-social-app` spec

That spec covers a UGC-worlds social platform and shares real surface with GearBox.
What carries over unchanged, what is adapted, and what reverses:

| Topic | Carries over? |
|---|---|
| Server-authoritative state, ownership leases, interest management | **Unchanged.** [05](05-realtime.md) restates it in GearBox terms. |
| Untrusted app code in a fuel-metered Wasm sandbox | **Unchanged in principle**, deferred past MVP. The manifest in [08](08-schemas.md) §8.1 is designed so first-party MVP apps and later sandboxed third-party apps declare capabilities identically. |
| Asset ingest → validate → optimize → LOD → budget | **Adapted.** Same pipeline shape; Smart Asset metadata ([08](08-schemas.md) §8.2) rides as a glTF extension. |
| Safety primitives below the app layer | **Unchanged and extended** — GearBox adds *physical* safety (boundaries, obstacles) to the social safety set. [07](07-authz-security.md) §7.6. |
| Evidence/replay buffer in the netcode | **Deferred**, but the event log in [05](05-realtime.md) §5.6 is the same substrate. |
| **WebXR-first client** | **Reversed.** GearBox needs native scene understanding, persistent anchors, passthrough, BLE/USB device access, and background sensor work — all native-only or badly exposed on the web. [02](02-stack.md) §2.2 makes the full argument. |

## 4. Status and what happens next

Scope, engine, device policy, first user, slice shape, and place-data source are
**locked** (§0). The plan is complete and internally consistent.

**Still open, and not blocking the first sprints:**

- **Business model** — determines whether devices (phase 7) or marketplace (phase 8)
  comes first. Does not affect the slice.
- **Organizations at MVP?** Assumed no. The `owner_scope_id` seam
  ([04](04-data-model.md) §4.4) keeps this cheap either way.
- **ODbL legal review** — needed before launch, not before sprint 1
  ([11](11-geospatial-mvp.md) §11.5).
- **Launch city** — pick it in sprint 0, and run the OSM filter over it before sprint 1
  starts. What the filter actually produces in a specific place is the thing most likely
  to surprise you.

**On a go, scaffolding proceeds in the order in [09](09-mvp-backlog-sprints.md) §9.6** —
repo, CI, Compose, migrations, protocol codegen, then a complete auth vertical before
anything else starts — followed by the sprint plan in [11](11-geospatial-mvp.md) §11.15.
Each feature ships with the nine-part output required by §31.
