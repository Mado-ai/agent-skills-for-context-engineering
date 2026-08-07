# 04 — Avatars & identity

## 4.1 Why avatars are a retention system

In a UGC platform the avatar is the one thing that persists across every world. It is
the user's identity, their sunk cost, and — if you build the economy — your best
monetization surface. It is also the largest per-frame rendering cost in a crowded
instance. These two facts are in permanent tension and the architecture has to resolve
it in the platform's favor, not the creator's.

## 4.2 Format

**VRM 1.0 as the canonical avatar format**, ingested through the same pipeline as
world assets ([03](03-ugc-pipeline.md) §3.2).

VRM is glTF with an avatar-specific extension: a standardized humanoid bone map,
first-person rendering flags, blendshape/expression presets, look-at config, and
spring-bone physics. That standard bone map is what makes cross-world avatars
tractable — every world can animate every avatar without knowing anything about it.

**Two avatar sources, one runtime representation:**

1. **Platform avatar system** — parametric base meshes + a wardrobe of items. Cheap,
   perf-guaranteed, monetizable, and what ~90% of users will use. Ships phase 1.
2. **Imported VRM** — creator-authored, budget-enforced, review-gated for public
   instances. Ships phase 2.

Both compile to the same runtime avatar bundle. The renderer does not know or care
which path an avatar came from.

## 4.3 The LOD ladder

Enforced by the platform, never by the world. Distance bands are shared with the
network layer ([02](02-netcode.md) §2.4) so visual and network fidelity step together.

| Band | Distance | Geometry | Skinning | Face | Network |
|---|---|---|---|---|---|
| L0 | < 4 m | ≤ 30k tri, ≤ 4 materials | Full, incl. fingers | Blendshapes + viseme lipsync | Full joints, 20 Hz |
| L1 | 4–8 m | ≤ 12k tri, 2 materials | Body only, hands as blobs | Jaw open only | No fingers, 20 Hz |
| L2 | 8–20 m | ≤ 4k tri, 1 material | Coarse skeleton | None | Head + root, 10 Hz |
| L3 | > 20 m | Billboard imposter, GPU-instanced | None | None | Position only, 2–5 Hz |

**Imposters are generated at ingest**, not at runtime: an octahedral impostor atlas
baked from the avatar mesh. This is what makes a 60-person instance renderable at all
— an L3 crowd costs a handful of draw calls total.

**Budget per avatar** (hard limits at ingest): ≤ 30k tri, ≤ 4 materials, ≤ 8 MB
texture after KTX2, ≤ 120 bones, ≤ 24 spring bones, ≤ 3 MB bundle. Over budget →
rejected with a per-item report, with an auto-decimate offer.

**Spring-bone physics is the hidden CPU bomb** in social VR. Cap the count, disable
entirely below L1, and give users a global "disable others' avatar physics" toggle.
It will be one of the most-used settings you ship.

## 4.4 Tracking and expression

Ship in this order — each rung meaningfully raises social presence per unit of cost:

1. **Head + two controllers** (phase 1). Three-point IK to a plausible full body.
   Getting the IK to *not* look uncanny is worth a dedicated engineer for a month; a
   bad three-point solve is worse than no body.
2. **Hand tracking + finger pose** (phase 1). Pointing, waving, thumbs-up carry an
   enormous share of social signal. Fall back gracefully when tracking drops — freeze
   the last valid pose, never snap to T-pose.
3. **Viseme lipsync from the voice stream** (phase 1). Computed client-side from the
   received audio, not transmitted. Free, and the single highest presence-per-byte
   feature in the entire system.
4. **Eye + face tracking** where the device exposes it (phase 2). Transmit as a small
   blendshape weight vector, not a mesh.
5. **Full-body / IMU trackers** (phase 3, if telemetry justifies it). A vocal minority
   want it; it is a long tail of calibration support burden.

**Emotes and gestures** need a platform-standard set that works on every avatar via
the VRM bone map, plus a per-world extension slot. A creator should never have to
re-author the wave.

**Safety interacts with expression:** proximity-based gesture suppression, and no
world-script control over another user's avatar pose, ever ([05](05-trust-safety.md) §5.2).

## 4.5 Identity and account model

```
Account (auth: email / OAuth / device)
  ├── Profile          — display name, handle, pronouns, bio (moderatable)
  ├── AvatarSlots[]    — owned + equipped avatars
  ├── Inventory        — wardrobe items, entitlements
  ├── SocialGraph      — friends (mutual), follows (asymmetric), blocks, parties
  ├── TrustTier        — see 05 §5.4
  └── PerWorldIdentity[] — opaque, per-world-scoped IDs handed to scripts
```

**Design commitments:**

- **Guest-first entry.** A world link must be enterable without an account: guests get
  a temp avatar, can hear and be heard, cannot persist, and are visibly marked. The
  install-and-signup wall in front of a shared link is the number one killer of the
  viral loop. Guest → account conversion should carry the session's state forward.
- **Per-world IDs are unlinkable.** World scripts never receive a platform ID. A world
  cannot determine that a visitor is the same person who visited another world. This
  is a hard privacy boundary and it constrains the scripting API permanently — decide
  it now, because it cannot be added later without breaking every world.
- **Display names are not identity.** Impersonation is a top report category; back
  names with an immutable handle and show both wherever moderation-relevant.
- **Age assurance is a phase-2 requirement, not a phase-4 one.** Under-13 and 13–17
  cohorts arrive whether you plan for them or not, and the regulatory posture
  (COPPA, GDPR-K, UK/EU online-safety regimes, app-store age-rating rules) is
  materially different per cohort. Architect for a `TrustTier`/age-band signal that
  gates world discovery, voice, and DM from day one; you can start with self-declared
  and tighten the assurance method later. Retrofitting an age dimension into
  discovery, matchmaking, and voice routing is a quarter of work you cannot schedule
  when a regulator asks.
