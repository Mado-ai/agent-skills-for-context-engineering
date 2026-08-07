# 01 — Assumptions, risks, open questions

> **Partly superseded.** Decisions 1–6 in [README](README.md) §0 have now been made.
> A2 and A4 below are **replaced** (see §1.5), and the open questions in §1.3 are
> **answered** (see §1.6). Everything else stands. New risks R11–R16 live in
> [11](11-geospatial-mvp.md) §11.12.

## 1.1 Assumptions

Stated explicitly because each one, if wrong, changes the plan. Grouped by how
expensive they are to be wrong about.

### Expensive if wrong

| # | Assumption | If wrong |
|---|---|---|
| A1 | Team is **3–5 engineers** (1–2 Unity/XR, 2 backend, 1 full-stack), not 15 | Sprint plan in [09](09-mvp-backlog-sprints.md) is invalid; a larger team should parallelize the companion clients and local node into the MVP |
| A2 | **Quest 3 / Quest 3S is the single phase-1 device.** visionOS and Android XR are phase 3+ | Multi-device from day one roughly doubles client QA and forces the OpenXR abstraction to be real, not aspirational, in sprint 1 |
| A3 | MVP rooms hold **≤ 8 users** (§27 says 4) | Above ~16 the TypeScript room server needs to become Go/Rust sooner ([02](02-stack.md) §2.4) |
| A4 | MVP is **online-first**; local-network mode is an *architecturally reserved seam*, not shipped code | If local mode must actually run in the MVP, add ~4 sprints — offline auth ([07](07-authz-security.md) §7.4) is the hard part, not discovery |
| A5 | MVP spatial apps are **first-party and trusted**. The Wasm sandbox is phase 2 | Third-party apps in the MVP add ~6 sprints and make the manifest's capability enforcement load-bearing immediately |
| A6 | **LiveKit is acceptable as a dependency** (self-hosted or cloud) for WebRTC media *and* the state data channel | Building signaling + SFU + TURN yourself is ~2–3 months of specialist work; if rejected, plan a separate WebTransport room server and a bought SFU |

### Moderate

| # | Assumption | If wrong |
|---|---|---|
| A7 | "Persistent room" means **server-persisted layout**, not per-device local anchors as source of truth | Anchor-authoritative persistence is a different sync model; see [05](05-realtime.md) §5.5 |
| A8 | Physical boundary awareness in the MVP = **Quest Scene API room mesh + guardian**, not custom scanning | Custom scanning moves phase 6 work into phase 1 |
| A9 | Accounts are **individual**; organizations, families, and managed devices are phase 3 | Org hierarchy is invasive in the authz model — cheaper to add now than later if you know it's coming ([07](07-authz-security.md) §7.2 keeps the seam) |
| A10 | Voice is **spatialized client-side** from discrete LiveKit tracks | Server-side spatial mixing is O(N²) CPU and forfeits head-relative HRTF quality |
| A11 | No compliance regime beyond GDPR/CCPA at MVP (no HIPAA, no ITAR, no PCI — payments are phase 8 via a processor) | Any of those changes hosting, logging, and data residency fundamentally |
| A12 | Cloud is **one region** at MVP | Multi-region adds session affinity and data residency work |
| A13 | "4D" is an **event/time-driven state model**, not a physics-time simulation | If it means something else, §30 of the master prompt needs restating before phase 10 |

### Cheap to correct

A14 English-only UI at MVP · A15 No under-13 users at MVP (age gate at signup) ·
A16 Desktop/web admin is an internal tool at MVP, not a user-facing product ·
A17 Asset storage is S3-compatible and CDN-fronted from day one (cheap now, painful later).

## 1.2 Risks

Ranked by expected damage. Each has a named mitigation and a **detection signal** —
the thing that tells you the risk is materializing while there is still time.

### R1 — Scope. *Probability: near-certain. Impact: fatal.*

The prompt describes ~10 products. Every one is independently a company. The MVP list
in §27 already contains four of them (companion apps, local node, SDK, manifest).

- **Mitigation:** ship the §32 vertical slice only; hold everything else behind
  documented seams. [09](09-mvp-backlog-sprints.md) §9.5 lists each deferral and its
  seam.
- **Detection signal:** any sprint where "just add" work exceeds 20% of committed
  points. That is scope creep with a friendly face.

### R2 — Unity XR performance under real content. *Probability: medium. Impact: high.*

72–90 fps on Quest 3 with four avatars, spatial voice, a live camera panel, a media
panel, and passthrough is achievable but not free. Camera panels in particular
(WebRTC decode → texture upload → render) are a common frame-time killer.

- **Mitigation:** frame-budget CI from sprint 2 — an automated on-device perf scene
  that fails the build on regression. Hard budgets in [10](10-quality-devops.md) §10.1.
- **Detection signal:** frame time > 11 ms on the perf scene, or any GC allocation in
  the per-frame path.

### R3 — Realtime correctness (ownership, late join, reconnection). *Probability: high. Impact: high.*

This is the single largest source of "works on my machine" bugs in multiplayer, and
it is untestable by hand at four users.

- **Mitigation:** build the **headless bot client harness in sprint 3, before the
  features it tests.** Bots speak the protocol, not the engine. Non-negotiable — it is
  also how you load-test and how you reproduce every future desync report.
- **Detection signal:** any desync bug that cannot be reproduced deterministically.

### R4 — LiveKit dependency risk. *Probability: low. Impact: medium-high.*

Using LiveKit data channels for state as well as media is a real efficiency win and a
real coupling.

- **Mitigation:** the transport sits behind `ITransport` in `networking-sdk`
  ([05](05-realtime.md) §5.2). The protocol is transport-agnostic by construction, so
  swapping to WebTransport is a driver rewrite, not a protocol rewrite.
- **Detection signal:** needing LiveKit-specific semantics to leak above `ITransport`.

### R5 — Local/hybrid mode is architecturally invasive. *Probability: high. Impact: high if deferred badly.*

Offline-capable auth, split-brain persistence, and local↔cloud promotion touch
identity, storage, and realtime simultaneously. Bolting it on later is a rewrite.

- **Mitigation:** three cheap decisions in the MVP that keep it a port, not a
  rewrite — (a) all IDs are UUIDv7, client-generatable; (b) every mutation carries a
  hybrid logical clock; (c) room-server authority is an interface with a `Cloud`
  implementation now and a `LocalNode` implementation later. Details in
  [05](05-realtime.md) §5.9.
- **Detection signal:** any MVP code that assumes a reachable cloud inside the room
  session loop.

### R6 — Spatial UX is genuinely hard and is not an architecture problem. *Probability: high. Impact: high.*

Grab/move/resize/pin that *feels good* is weeks of iteration, not a ticket. Bad
spatial UI reads as "the whole product is bad" no matter how good the backend is.

- **Mitigation:** build the interaction toolkit layer in sprint 1 with a throwaway
  grey-box scene, and put it in front of real users in sprint 2 — before any backend
  integration.
- **Detection signal:** engineers demoing to each other instead of to users.

### R7 — Physical safety in mixed reality. *Probability: medium. Impact: severe (injury, liability).*

§7 of the prompt asks to visually replace real objects. Doing that wrong hurts people.

- **Mitigation:** safety is a client-layer invariant that no app or environment can
  override ([07](07-authz-security.md) §7.6): guardian always composited, obstacle
  proximity always shown, no full-occlusion of a classified obstacle.
- **Detection signal:** any feature request phrased as "let the environment hide the
  boundary."

### R8 — Device integration (GearBox Link) is an unbounded surface. *Probability: high. Impact: medium.*

Every protocol (BLE, Matter, Modbus, ONVIF, vendor clouds) is its own integration with
its own failure modes and its own security posture.

- **Mitigation:** phase 7, and then only via a driver-plugin model against the
  capability schema in [08](08-schemas.md) §8.4 — never bespoke per-device code in core.
- **Detection signal:** device-specific branching appearing in `device-service`.

### R9 — Camera and location features are a privacy/legal minefield. *Probability: medium. Impact: high.*

Room-scanning, live camera panels, and location sharing in a product used at home,
plus GDPR/CCPA, plus recording consent laws that vary by jurisdiction.

- **Mitigation:** hardware-level indicators, consent per session, default-off exact
  location, all-party consent for recording, short retention. [07](07-authz-security.md) §7.7.
- **Detection signal:** any feature that captures without a persistent visible indicator.

### R10 — Small team, ten specialisms. *Probability: certain. Impact: medium.*

Unity XR, realtime netcode, WebRTC, backend, DevOps, security, and spatial design are
different people. A 3–5 person team cannot be expert in all of them.

- **Mitigation:** buy the specialist pieces (LiveKit for media, managed Postgres, a
  managed identity provider *if* local-first is deferred), and hire the Unity XR skill
  first — it is the hardest to substitute.

## 1.3 Open questions that change the plan

These are not rhetorical. Each has a different architecture behind it.

1. **Who is the first user?** An enterprise operations customer (digital twins,
   devices, few users, high value) or a consumer social/creative user (many users, low
   ARPU, network effects)? The prompt describes both. They imply different MVPs — the
   enterprise path makes local mode and devices phase 1 and drops social entirely; the
   consumer path is what [09](09-mvp-backlog-sprints.md) currently plans. **This is the
   single most consequential unanswered question in the document set.**
2. **Is local-network mode a launch requirement or a roadmap item?** A4 assumes
   roadmap. If it is a launch requirement (e.g. for a factory or a school with no
   guest Wi-Fi), the identity architecture changes in sprint 1, not sprint 20.
3. **Does the physical GearBox device exist in any form?** If hardware is in flight,
   the local node should be designed against its real constraints (CPU, RAM, thermals)
   rather than against a generic container.
4. **Organizations at MVP or not?** (A9.) Multi-tenancy is dramatically cheaper to
   design in at the schema level than to retrofit — every table either gets an
   `org_id` now or gets a painful migration later.
5. **What is the business model?** Marketplace take rate, per-seat enterprise,
   hardware, or creator economy. It determines whether phase 8 (marketplace) or phase 7
   (devices) comes first, and whether the payment abstraction needs to exist earlier.

## 1.4 What I would refuse to build as specified

Stated plainly, since the prompt asks for a lead architect's judgment:

- **Visually replacing a real obstacle with no safety representation** (prompt §7's
  hardest reading). The compromise in [07](07-authz-security.md) §7.6 keeps the
  creative capability and the safety guarantee; a mode that discards the guarantee is
  not something I would ship.
- **Material "identification" presented as measurement.** The prompt already says this
  ([§10 of the master prompt]) — agreed, and it needs to be enforced in the UI layer,
  as a confidence-bounded estimate with manual correction, not a policy note.
- **Retransmitting DRM-protected media in Watch Together.** Approved integrations
  only. This constrains the feature substantially and should be planned for as a
  limitation, not discovered late.

## 1.5 Replaced assumptions

| Was | Now |
|---|---|
| **A2** — Quest 3 is the single phase-1 device | **iOS + Android phones are the lead tier** (release-gated); Quest 3 is the second tier for the room half only; others best-effort or reserved. [11](11-geospatial-mvp.md) §11.3 |
| **A4** — MVP is online-first, local mode is a reserved seam | Unchanged in effect but now obvious: an outdoor location game is inherently online. Local mode moves firmly to phase 4. |
| **A8** — Boundary awareness via Quest Scene API | Applies to the **room** half only. The outdoor half uses GPS + H3 + OSM geometry ([11](11-geospatial-mvp.md) §11.5). |
| **A15** — No under-13 users | Still holds, but the **teen band (13–17) is now in scope from day one** and gets tightened safety and location defaults ([11](11-geospatial-mvp.md) §11.7–11.8). Outdoor play by minors is not a hypothetical. |

New assumption **A18**: the slice launches in **one city**, not one country. Density
beats coverage in this genre ([11](11-geospatial-mvp.md) §11.12 R14).

## 1.6 Open questions — answered

| Q | Answer | Where it landed |
|---|---|---|
| 1. Who is the first user? | **Location-based AR game players**, funnelling into the ecosystem | [11](11-geospatial-mvp.md) — this answer was the pivot |
| 2. Local mode: launch or roadmap? | **Roadmap** (phase 4) | §1.5 |
| 3. Physical GearBox device? | Not in the slice; unchanged | [09](09-mvp-backlog-sprints.md) §9.5 |
| 4. Organizations at MVP? | **No** — `owner_scope_id` seam retained | [04](04-data-model.md) §4.4 |
| 5. Business model? | **Still open.** Does not block the slice; decides whether devices or marketplace comes next | [README](README.md) §4 |
