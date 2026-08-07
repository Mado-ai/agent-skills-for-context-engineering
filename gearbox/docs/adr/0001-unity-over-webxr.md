# ADR 0001 — Unity 6 for the client, not WebXR

- Status: accepted
- Date: 2026-08
- Deciders: user (decision 2)

## Context

An earlier spec in this repository (`docs/vr-ar-social-app`) recommended a WebXR-first
client for a UGC social platform. GearBox reverses that.

## Decision

Unity 6 with AR Foundation (ARKit + ARCore) for phones and OpenXR for headsets.

## Rationale

The products have different defining constraints. The UGC platform's hardest problem is
distributing _untrusted content at runtime_, which browsers handle natively. GearBox's
hardest problems are scene understanding, persistent spatial anchors, passthrough
control and BLE/USB device access — all native-only or inconsistently exposed via
WebXR — and, after decision 4, phone AR on both iOS and Android from one codebase.

Full comparison: `docs/gearbox/02-stack.md` §2.2.

## Consequences

- One codebase covers phones and headsets; the `IPlatformXR` port keeps vendor SDK
  calls behind a single interface.
- App-store review is on the critical path for client fixes. Accepted.
- A WebGL/WebXR _viewer_ tier remains cheap to add later because the wire protocol and
  schemas are engine-neutral.

## Reversal trigger

If WebXR scene-understanding APIs converge across Quest, Android XR and visionOS,
re-evaluate for the viewer tier only — not for the main client, which by then owns
device integration.
