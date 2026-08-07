# Loom — a 3D VR/AR social platform for user-generated worlds

**Technical architecture spec. Design only — no implementation.**

"Loom" is a placeholder codename. This document set is the answer to: *if you were
going to build a VR/AR social app whose core loop is **users building and publishing
their own worlds**, what would you actually build, in what order, and what would kill
you if you got it wrong?*

---

## The thesis in one page

**The product is not a world. The product is the pipeline that lets strangers ship
worlds to each other safely.** Every platform in this category that died, died from
one of three things — not from bad graphics:

1. **Empty-room problem.** Users arrive, nobody is there, they leave. Solved by
   routing, not by content volume.
2. **Creator cliff.** The gap between "place a cube" and "ship something people
   return to" is too wide, so the long tail never forms.
3. **Trust collapse.** Untrusted 3D content plus untrusted scripting plus voice
   equals harassment, crashes, and IP violations — at which point nobody ships and
   nobody stays.

Architecture follows from that. The hard parts of this system are the **content
ingest pipeline**, the **untrusted script sandbox**, and the **moderation
substrate** — not the renderer. The renderer is a solved problem you should buy.

## Ten decisions this spec commits to

| # | Decision | Why | Doc |
|---|---|---|---|
| 1 | **WebXR-first client**, native shell later | UGC means downloading untrusted content at runtime. Browsers are engineered for exactly that; app stores forbid it. This is the single highest-leverage decision. | [01](01-architecture.md) |
| 2 | **Server-authoritative instance sim**, client-predicted avatars | Anything a world script can change must be server-owned, or UGC becomes an exploit surface. | [02](02-netcode.md) |
| 3 | **WebTransport (QUIC datagrams)**, WebRTC DataChannel fallback | Unreliable-unordered transport is required for 20–30 Hz state; WebSockets head-of-line block. | [02](02-netcode.md) |
| 4 | **glTF 2.0 canonical**, Meshopt + KTX2, LODs generated at ingest | One format in the runtime. Optimization is the platform's job, not the creator's. | [03](03-ugc-pipeline.md) |
| 5 | **Untrusted scripts in a Wasm isolate with fuel metering** (QuickJS-on-Wasm), TypeScript authoring | A world script must not be able to hang the sim, read another world's state, or reach the network. Fuel metering makes "budget" enforceable rather than aspirational. | [03](03-ugc-pipeline.md) |
| 6 | **Split logic: authoritative script on server, presentation script on client** | Cosmetic logic scales for free; state-changing logic must be cheat-proof. Most UGC is cosmetic. | [03](03-ugc-pipeline.md) |
| 7 | **VRM 1.0 avatars**, platform-owned LOD/imposter ladder | Cross-world avatar identity is the retention hook. Perf is the platform's problem. | [04](04-avatars-identity.md) |
| 8 | **Safety primitives live in the client, below the script layer** | Personal bubble, mute, block, and hide must be unoverridable by world code. Not a policy — an architecture boundary. | [05](05-trust-safety.md) |
| 9 | **Rolling replay buffer per instance** (state deltas + audio ring) | Reports without evidence are unactionable. This must be designed in at the netcode layer or it is unaffordable to retrofit. | [05](05-trust-safety.md) |
| 10 | **AR is a client mode, not a second product** | Same world graph, different presentation and anchor semantics. Shared-anchor colocation ships in phase 3, not phase 1. | [01](01-architecture.md) |

## Document map

| Doc | Covers |
|---|---|
| [01 — System architecture](01-architecture.md) | Client runtime, service topology, world graph model, AR mode, rejected alternatives |
| [02 — Netcode & realtime](02-netcode.md) | Authority model, transport, tick budget, interest management, voice, instance lifecycle |
| [03 — UGC pipeline](03-ugc-pipeline.md) | Creation surfaces, asset ingest, budgets, the script sandbox, publishing & versioning |
| [04 — Avatars & identity](04-avatars-identity.md) | Avatar format, LOD ladder, tracking, identity and account model |
| [05 — Trust & safety](05-trust-safety.md) | Threat model, safety primitives, moderation loop, evidence, creator IP |
| [06 — Scale & cost](06-scale-and-cost.md) | Instance density, capacity math, unit economics, the numbers that decide viability |
| [07 — Roadmap](07-roadmap.md) | Four phases with kill-gates, team shape, what to *not* build |
| [08 — Risks & open questions](08-risks.md) | What is genuinely unresolved, and what evidence would change each decision |

## How to read this

Docs 01–03 are the load-bearing ones; if you only read three, read those. Doc 06 is
the one that tells you whether the business closes. Doc 08 is where the honest
uncertainty lives — it is not a formality.

Numbers throughout (tick rates, poly budgets, cost per CCU-hour) are engineering
estimates meant to be **falsified by a spike**, not treated as measurements. Each is
tagged with how to verify it.
