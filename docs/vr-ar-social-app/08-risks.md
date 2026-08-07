# 08 — Risks & open questions

The honest section. Each item states what would change the decision, so the spec can
be updated by evidence rather than by argument.

## 8.1 Decisions I hold with high confidence

| Decision | Confidence | Why it is safe |
|---|---|---|
| Server-authoritative for script-mutable state | Very high | Every UGC platform that started client-authoritative rebuilt it. There is no counter-example. |
| Untrusted scripts in a fuel-metered Wasm isolate | Very high | The threat model in [03](03-ugc-pipeline.md) §3.4 has no alternative solution at acceptable cost. |
| Safety primitives below the script layer | Very high | Retrofitting this is impossible without breaking published worlds. |
| Evidence buffer designed into the netcode | High | Cheap now, unaffordable later. |
| glTF/VRM canonical, platform-owned optimization | High | The only way rung 3–4 creators do not need to be technical artists. |
| Per-world opaque user IDs | High | A permanent API constraint; must be decided before the first world ships. |

## 8.2 Genuinely uncertain

### R1 — WebXR performance ceiling *(highest risk in the project)*

The whole architecture leans on a browser runtime holding 72 fps with 40 avatars and
real UGC content on standalone hardware. I believe it is achievable with the LOD
ladder, imposters, and aggressive instancing. I would not bet the company on it
without measuring.

*Changes the decision:* phase-0 perf spike misses 72 fps at 40 avatars after a genuine
optimization pass → move to a native runtime with a Wasm script layer, keeping the
service architecture, the pipeline, and the sandbox intact (all of which are
engine-independent). **Everything in docs 02, 03, 05, and 06 survives an engine
change; only doc 01 §1.1 dies.** That is deliberate — the spec is structured so this
risk is survivable.

### R2 — Rung-2 authoring is the make-or-break and is under-specified here

A visual trigger→action system that compiles to the same bytecode as the TypeScript
SDK is stated as a requirement but not designed. It is a hard design problem (every
node-graph system is either too limited or becomes programming with extra steps), and
whether the long tail forms depends more on this than on any infrastructure choice.

*Needs:* a dedicated design phase in phase 2 with real creators in the loop, and a
prototype validated against "can a non-programmer build a working escape room in two
hours?"

### R3 — Cold-start / empty-room problem

Routing policy ([02](02-netcode.md) §2.5) helps, but no architecture solves "there is
nothing to do here on day one." This is a product and community problem — seeded
worlds, scheduled events, a hand-picked founding creator cohort. Untreated, good
technology dies here. It is the most common cause of death in this category and it is
outside what this spec can fix.

### R4 — Moderation cost curve

§6.4 flags that human review may rival infrastructure cost at scale. I do not have a
defensible number for it, and it is highly sensitive to your content policy and user
mix. *Needs:* a bottoms-up model from phase-2 report-rate telemetry before committing
to a growth plan.

### R5 — Age assurance regime

The regulatory landscape for minors on social/immersive platforms is moving fast and
differs by jurisdiction. The spec commits to a trust/age-band signal wired into
discovery, voice, and DM from phase 2 — which is the architecturally load-bearing part
— but the *assurance method* (self-declared → document/estimation-based) is a policy
and legal decision that should be re-checked against current requirements in each
launch market before phase 3, not inherited from this document.

### R6 — Voice cost vs. quality

The 12-stream subscription cap is a guess balancing crowd feel against ~30% of a major
cost line. *Needs:* A/B testing on perceived presence, early, because it is easier to
loosen a cap than to tighten one users have gotten used to.

### R7 — Durable persistence conflict semantics

[02](02-netcode.md) §2.7 specifies durable state exists and is quota'd, but not how
conflicting writes across simultaneous instances resolve. Last-write-wins is probably
acceptable for v1 (player homes, saved builds) and definitely not for anything
economy-like. *Needs:* explicit design before the durable tier ships; do not let it be
decided implicitly by the first implementation.

## 8.3 Questions for the product owner

These change the architecture materially and are not mine to assume:

1. **Who is the creator?** A hobbyist kitbashing on a headset, or a Blender-fluent 3D
   artist? The ladder in [03](03-ugc-pipeline.md) §3.1 spans both, but which rung gets
   the best team determines whether you build a toy or a tool.
2. **Is this social-first or creation-first?** Phase 1 as written bets on social
   presence first. If the bet is creation-first, phases 1 and 2 partially invert and
   the pipeline gets built before the crowd does.
3. **VR-first or AR-first?** This spec is VR-first with AR as a phase-2/3 mode. An
   AR-first product (phone-primary, colocated) is a genuinely different architecture —
   anchors and colocation move to phase 1, and the perf/LOD story changes completely.
4. **Moderation posture.** A curated platform (small creator cohort, review before
   `live`) and an open one (anyone publishes, react to reports) differ by roughly a
   phase of work and an order of magnitude in ops cost. The spec assumes open with
   trust tiers.
5. **What is the money?** Wardrobe economy, creator revenue share, and subscription
   all reuse the capability/budget metering — but which one is primary shapes what
   phase 3 actually builds.
