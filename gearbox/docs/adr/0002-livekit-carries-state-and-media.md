# ADR 0002 — LiveKit carries realtime state as well as media

- Status: accepted
- Date: 2026-08

## Context

The realtime plane needs unreliable datagrams for 20 Hz pose, reliable ordered
messaging for events, and WebRTC for voice and camera. Building signaling, an SFU and
TURN is roughly 2–3 months of specialist work.

## Decision

Use LiveKit for media _and_ for the state channel via its lossy/reliable data packets,
behind an `ITransport` interface.

## Rationale

At the MVP's ≤ 8 participants per session, lossy data packets are an adequate carrier
for pose. Using one connection means one auth token, one NAT-traversal problem, and
free room lifecycle and reconnection semantics — exactly the surface where multiplayer
bugs concentrate (`docs/gearbox/01-assumptions-risks.md` R3).

## Consequences

- A real dependency on LiveKit, mitigated by `ITransport`: swapping to WebTransport is
  a driver rewrite, not a protocol rewrite.
- The protocol in `packages/protocol` is transport-agnostic by construction.

## Graduation threshold

Move state to a dedicated WebTransport room server when any of: sustained > 16 users
per session, state bandwidth > ~200 kbps per client, or a need for per-packet priority
the data channel cannot express.
