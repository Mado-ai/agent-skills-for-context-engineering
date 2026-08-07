# 07 — Roadmap

Structured as phases with **kill-gates**: a measurable condition that, if unmet, means
you stop and re-plan rather than proceed on hope. The gates are the point.

## Phase 0 — Prove the thesis (4–6 weeks, 2–3 engineers)

Not a product. Three spikes that de-risk the decisions everything else rests on.

| Spike | Question | Pass condition |
|---|---|---|
| **Perf spike** | Can a WebXR client hold 72 fps on Quest 3 with 40 avatars and a representative UGC world? | ≥ 72 fps sustained at 40 avatars with the L0–L3 ladder ([04](04-avatars-identity.md) §4.3) and a 350k-tri scene |
| **Sandbox spike** | Does QuickJS-on-Wasm with fuel metering hold under adversarial scripts at acceptable cost? | Infinite loop, alloc bomb, and 10k-entity spawn storm all contained with < 0.05 core/instance overhead |
| **Transport spike** | Does WebTransport work well enough across the target browsers, with a viable WebRTC fallback? | 30 clients @ 20 Hz, p95 RTT-added latency < 40 ms, clean fallback path |

**Kill-gate:** if the perf spike fails after optimization effort, revisit the
WebXR-first decision ([01](01-architecture.md) §1.1) *before* writing product code.
This is the cheapest moment in the project's life to change engines and the most
expensive decision to defer.

## Phase 1 — One world, real presence (3–4 months)

**Goal: 30 strangers in a room, and it feels good.** No UGC yet. If the base
experience is not good, UGC on top of it is worthless.

Ship: WebXR client · instance server with the ownership-lease authority model ·
WebTransport + fallback · voice SFU with client spatialization · platform avatar
system with the LOD ladder · three-point IK + hand tracking + viseme lipsync ·
**the full §5.2 safety primitive set including panic action** · in-world reporting +
evidence buffer · friends, parties, and friend-first routing · rung 0–1 creation
(place/assemble/publish from a platform kit) · instance drain & migrate.

Notably **not** in phase 1: custom asset import, scripting, AR, monetization,
discovery beyond a flat list.

**Kill-gate:** in a closed test, do users voluntarily return within 7 days at a rate
you would bet a company on? Social presence either works or it does not, and no
amount of UGC rescues it. Also: does §6.2's density math survive contact with a real
load test?

## Phase 2 — Creation becomes the loop (4–6 months)

**Goal: worlds users did not make appear in the catalog, and other users go to them.**

Ship: full asset ingest pipeline (validate → scan → optimize → LOD → budget) ·
custom glTF and VRM import · **rung 2 visual trigger→action logic** · TypeScript SDK
with `loom dev` hot-reload and `loom check` · the split authoritative/presentation
script runtime · capability manifest with pre-entry disclosure · publish channels and
rollback · remix/fork with attribution · discovery v1 (new / trending / friends-are-here)
· creator analytics · age bands + trust tiers wired into discovery and voice ·
moderation tooling and staffing · DMCA pipeline · passthrough/mixed AR mode.

**Kill-gate:** what fraction of worlds visited in a week were made by someone the
visitor does not know? If the answer is near zero, you have a toolset, not a platform,
and the problem is discovery or the rung-2 gap — not features.

## Phase 3 — Distribution and durability (4–6 months)

**Goal: the platform survives its own growth.**

Ship: native shell for store presence, push, and iOS ARKit · shared-space AR via
marker alignment · durable persistence tier · monetization (wardrobe economy, creator
revenue share, payouts + tax/KYC) · regional instance placement · audience mode for
large events · automated moderation triage · public status/incident process.

**Kill-gate:** are creator payouts non-trivial for a real cohort? A UGC economy where
nobody earns has a hard ceiling on creator retention, and creator retention is the
only durable moat this product has.

## Phase 4 — Depth (ongoing)

Cloud anchors if colocated AR proves out · full-body tracking if telemetry justifies
it · advanced scripting (Rust/AssemblyScript direct-to-Wasm) · cross-world persistent
inventory · events/ticketing · marketplace for assets, not just worlds.

## Team shape (steady state, phase 2)

| Function | Heads | Notes |
|---|---|---|
| Client / rendering / XR | 4 | The perf ceiling is set here |
| Realtime / netcode / instance server | 3 | Rust; owns authority, sandbox, evidence |
| Pipeline / ingest / SDK | 3 | Consistently under-resourced; do not |
| Platform backend | 2 | Catalog, social, identity |
| Trust & safety engineering | 2 | Separate from ops moderation staffing |
| Moderation ops | scales with DAU | Budget as a first-class cost line |
| Design (product + world design) | 3 | World design informs which primitives to build |
| Creator relations | 2 from phase 2 | Your first 50 creators are a relationship, not a funnel |

## What to deliberately not build

- **A general-purpose in-VR IDE.** In-world for layout; browser for code.
- **Your own SFU.** Buy it.
- **Photorealistic rendering.** Unwinnable on standalone; stylized ages better and
  costs creators less.
- **A second engine path.** One runtime, wrapped for distribution.
- **Sixty scene components in year one.** Fifteen good ones and a scripting API.
- **Anything blockchain-adjacent.** [01](01-architecture.md) §1.5.
- **Custom physics.** Embed a proven deterministic engine on the server; keep client
  physics cosmetic.
- **AI-generated world content, in phase 1–2.** Tempting and it will be asked for. It
  multiplies every ingest, moderation, and IP problem you have before you have solved
  any of them at hand-authored scale. Revisit in phase 4 as a *creation assist* inside
  the editor (retexture, LOD hints, layout suggestions) — where the output still goes
  through the same ingest gate — not as a runtime world generator.
