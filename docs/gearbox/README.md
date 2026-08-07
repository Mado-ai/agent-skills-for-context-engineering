# GearBox Spatial Operating Platform — MVP architecture & implementation plan

**Status: plan only. No production code has been written. Approval requested before scaffolding.**

This document set is the response to the GearBox Master Technical Prompt §32 (First
Task) and delivers all 25 required outputs from §30.

---

## 1. Executive technical summary

GearBox is a persistent spatial operating platform: the room is the shell, spatial
apps are the software, and the same account carries identity, layout, assets,
devices, and permissions across VR, AR, desktop, and mobile — online, on a local
network, or hybrid.

The MVP proves exactly one claim:

> **A persistent spatial room can hold multiple users, run spatial apps, synchronize
> shared state and voice, and survive a restart — over the internet today and over a
> LAN by architecture.**

The plan below builds that as a single vertical slice (§32's twelve steps), on a
deliberately small stack:

- **Unity 6 + OpenXR** for the XR client (reversing the WebXR recommendation made in
  the earlier `docs/vr-ar-social-app` spec — see [02](02-stack.md) §2.2 for why the
  constraints differ).
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

### The one thing I want to flag before you read further

**§27's 30-item MVP is not an MVP.** Items 1–22 are roughly the vertical slice and are
achievable; items 23–30 (desktop companion, mobile companion, local-node prototype,
developer SDK, manifest, audit, network adaptation, dual auth) each carry a
platform's worth of work. Delivered as written, the list is a 12–18 month build for a
small team, and it front-loads the parts that prove nothing.

The §32 vertical flow, by contrast, is a genuinely good MVP and is what
[09](09-mvp-backlog-sprints.md) plans against: **16 weeks, 8 sprints, 3–5 engineers.**
Where §27 items are deferred, [09](09-mvp-backlog-sprints.md) §9.5 says exactly which,
why, and what architectural seam keeps them cheap to add later. **The scope call is
yours** — say the word and I will plan the full 30.

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
| 20 | MVP backlog | [09 — Backlog & sprints](09-mvp-backlog-sprints.md) §9.1–9.3 |
| 21 | Sprint plan | [09](09-mvp-backlog-sprints.md) §9.4 |
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

## 4. Approval requested

Per §30, I am stopping here. To proceed I need a decision on:

1. **Scope** — vertical slice (16 weeks, recommended) or the full §27 30-item list?
2. **Stack** — confirm Unity 6 + OpenXR, TypeScript monolith, LiveKit. Any of these
   can be swapped; §2 in [02](02-stack.md) states the reversal cost for each.
3. **Headset** — Quest 3 as the single phase-1 target device? Multi-device from day
   one roughly doubles client QA.
4. **The five open questions** in [01](01-assumptions-risks.md) §1.3, which change the
   data model if answered differently.

On approval I will scaffold in the order set out in [09](09-mvp-backlog-sprints.md)
§9.6 — repo + CI + schema + auth first, one vertical feature at a time, each with the
nine-part output required by §31.
