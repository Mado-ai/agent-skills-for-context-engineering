# 06 — Scale & unit economics

All figures are **engineering estimates to be falsified by a load spike**, not
measurements. Each carries a "verify by" note. The point of this document is not the
numbers — it is the *shape* of the cost curve and which decisions bend it.

## 6.1 The cost structure

Per concurrent user (CCU), you pay for:

| Component | Scales with | Rough share |
|---|---|---|
| Instance server CPU/RAM | CCU, worst-case script cost | ~45% |
| Voice SFU (CPU + egress) | CCU × subscribed streams | ~30% |
| State bandwidth egress | CCU × interest-managed delta rate | ~10% |
| Asset CDN egress | *New* users per world (cached after) | ~10% |
| Platform plane + storage + ingest | DAU, upload volume | ~5% |

Two structural consequences:

1. **Voice is roughly a third of your cost and is nearly incompressible.** It is also
   the highest-value feature. Do not try to save money here; save it elsewhere.
2. **Instance CPU is the only component where a *creator* can spend your money.** A
   pathological world script inflates cost per CCU without bound. That is precisely
   why authoritative script fuel is metered and why cosmetic logic is pushed to
   clients ([03](03-ugc-pipeline.md) §3.5). Without that split, your unit economics
   are set by your worst creator.

## 6.2 Instance density math

Assume a 16-vCPU / 32 GB node.

```
Per instance @ 30 CCU:
  sim tick (20 Hz):        ~1.5 ms/tick  → ~3% of one core
  script VMs (10 Hz):      ~2.0 ms/tick  → ~2% of one core (fuel-capped)
  serialization + interest: ~2.5 ms/tick → ~5% of one core
  ────────────────────────────────────────────────────────
  ≈ 0.10 core per instance, ≈ 250 MB RAM (incl. replay buffer)

Per node: CPU-bound at ~110 instances; RAM-bound at ~120.
Run at 60% headroom → ~65 instances → ~2,000 CCU per node.
```

**Verify by:** a synthetic load test with 30 bot clients per instance running a
representative UGC world (not an empty scene — empty scenes lie by ~4×). Do this in
phase 1. If real density lands below ~1,000 CCU/node, the cost model in §6.4 roughly
doubles and monetization has to move up the roadmap.

**Voice**, separately: an SFU node handles order-of ~1,500–3,000 forwarded streams
depending on subscription fan-out. With interest-managed subscription capped at ~12
streams per listener, budget one SFU node per ~1,500–2,500 CCU. **Verify by:** SFU
vendor benchmarks against your actual fan-out, early.

## 6.3 Bandwidth

Per CCU, sustained:

| Stream | Down | Up |
|---|---|---|
| State (30 nearby avatars, interest-managed) | ~120 kbps | ~50 kbps |
| Voice (12 subscribed streams @ 24 kbps) | ~290 kbps | ~24 kbps |
| **Total sustained** | **~410 kbps** | **~75 kbps** |

≈ **185 MB/hour egress per CCU**, plus a one-time ~60–120 MB asset fetch per new
world per user (CDN-cached, so it amortizes hard across a popular world).

At commodity cloud egress pricing this is the term that punishes you at scale;
committed-use CDN/egress contracts and edge-terminated SFU placement are the levers.
**Verify by:** measuring real delta sizes on a populated instance — interest
management performance is highly content-dependent.

## 6.4 Unit economics sketch

Order-of-magnitude, commodity cloud, no committed-use discounts:

```
Per CCU-hour:
  compute (instance)      ~$0.006     ← 2,000 CCU/node, ~$12/node-hr blended
  voice SFU               ~$0.004
  egress (state + voice)  ~$0.005
  CDN (amortized assets)  ~$0.002
  platform + storage      ~$0.001
  ─────────────────────────────────
  ≈ $0.018 per CCU-hour
```

Sanity-check against engagement: at ~8 hours/month of average session time per MAU
and a 3–5% CCU/MAU ratio, that is roughly **$0.14–0.15 per MAU per month** in
variable infrastructure cost — before people, before ingest CPU, before moderation
staffing.

**Moderation is the cost line that surprises people.** Human review does not scale
sublinearly with users the way infra does; at meaningful scale it can rival or exceed
infrastructure spend. Budget it as a first-class line item from phase 2 and invest in
triage automation early ([05](05-trust-safety.md) §5.3) — that investment is a
cost-structure decision, not a nice-to-have.

**Where the money comes from** (not designed in detail here, but the architecture must
not preclude it): avatar/wardrobe sales, creator revenue share on world-level
purchases, subscription for durable persistence and higher budgets. The
capability/budget system in [03](03-ugc-pipeline.md) is deliberately the same
mechanism that would meter a paid tier — do not build a second one.

## 6.5 What bends the curve

| Lever | Effect | Cost |
|---|---|---|
| Push cosmetic logic client-side | Caps the creator-controlled portion of server CPU | Already in the design |
| Interest management quality | Directly scales state egress; a 2× improvement is achievable and worth chasing | Engineering time, ongoing |
| Voice subscription cap (12 → 8) | ~30% off the largest single cost line | Slight loss of ambient crowd feel; A/B it |
| Audience mode for large events | Turns an O(N²) gathering into O(N) | Build only when events matter |
| Regional instance placement | Cuts latency *and* cross-region egress | Ops complexity; do it by phase 3 |
| Committed egress / CDN contracts | Frequently 40–70% off list at volume | Requires volume predictability |
| Raising instance cap 40 → 60 | Lower per-CCU compute | Worse social experience — this is a bad lever, listed so nobody proposes it twice |

## 6.6 Failure modes at scale

- **Hot world.** One world goes viral: instances multiply faster than the autoscaler
  provisions. Mitigation: pre-warmed capacity pool, per-world instance ceiling with a
  queue, and audience mode.
- **Ingest queue collapse** after a creator-event drop. Mitigation: separate priority
  lanes (small edits vs. full bundles) and visible queue position.
- **Replay buffer memory pressure** in very long-lived instances. Mitigation: fixed
  ring size in bytes, not seconds.
- **Durable persistence abuse** — one creator writes every tick. Mitigation: hard
  per-world write quotas, enforced in the host API rather than by review.
- **Redis loss** takes down routing. Mitigation: routing degrades to "any healthy
  instance" instead of failing closed. Never put durable state there
  ([01](01-architecture.md) §1.2).
