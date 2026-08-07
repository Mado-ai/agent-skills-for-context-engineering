# @gearbox/xr-viewer — Room View

A WebXR design prototype of the **bridge**: game → collected item → your persistent
room (`docs/gearbox/11-geospatial-mvp.md` §11.4, step D→E).

This is a _view_, not the client. No networking, no auth, no anchors, no Unity. It
exists to make the payoff tangible enough to judge before sprint 6 builds it — and
because "room return rate" is the metric that decides whether GearBox is a platform or
a game (§11.13), it is worth being able to look at that room early.

## Run it

```bash
pnpm --filter @gearbox/xr-viewer dev     # http://localhost:5173
pnpm --filter @gearbox/xr-viewer build   # dist/index.html + dist/artifact.html
pnpm --filter @gearbox/xr-viewer smoke   # headless render check + screenshot
```

`build` emits two files:

- `dist/index.html` — a standalone page. Everything is inlined, so it can be opened
  from disk, served from anywhere, or sideloaded onto a headset.
- `dist/artifact.html` — the same content as a fragment, for hosts that supply their
  own document shell.

## On a headset

Open the page in the headset browser over HTTPS and press **Enter VR**.

| Control | Does |
|---|---|
| Left thumbstick | Move (head-relative) |
| Right thumbstick | Snap turn, 30° per flick |
| Trigger | Inspect — brings up the provenance card |
| Grip | **Pick the item up** and hold it |
| Physically walking | Works too; the rig is clamped to the room |

Grabbing is the point. Pick a collected thing up, bring it to your face, and the
provenance card follows it to your hand — that moment is the emotional argument for
having a room at all, and it is not something a screenshot can settle.

Comfort choices, matching the invariants in `docs/gearbox/07-authz-security.md` §7.6:
**snap turn by default** (smooth turn is the biggest single cause of sickness) and a
movement vignette that fades in while the stick is held.

On desktop: drag to look, `WASD` to walk, click to inspect. The button reads
`VR NOT SUPPORTED` on a machine with no XR device — expected, not a failure. The
on-screen control hints switch to the VR set only when a headset is actually detected.

## What's in the room, and why

| Element                         | Why it's here                                                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Five collected items on plinths | Each carries a real provenance record — place, coordinates, H3 cell, date, who you were with. That record is the emotional payload of the bridge, not decoration. |
| The provenance card             | The thesis made legible: a field-log entry, grotesk heading over monospace data.                                                                                  |
| Wall dashboard                  | A first-party spatial app, rendered as an object in the room rather than as HUD chrome.                                                                           |
| Guardian boundary on the floor  | The safety layer is an architectural invariant (`docs/gearbox/07-authz-security.md` §7.6). A room view that quietly omitted it would misrepresent the product.    |
| A remote participant            | Presence is half the product; an empty room would undersell it.                                                                                                   |
| Portal back to the map          | Closes the loop: the room is where you keep things, the map is where you go.                                                                                      |

**Lighting is the one deliberate idea:** the room is lit almost entirely by the
collected items themselves. Your collection is what makes the place yours.

Place data is real Copenhagen geography, matching the launch-city assumption in
`docs/gearbox/01-assumptions-risks.md` A18. © OpenStreetMap contributors.

## Notes

- Type is drawn to canvas textures rather than through a text-mesh library: smaller
  bundle, crisper at VR reading distance, and it lets the card use a real field-log
  layout.
- Single visual theme by choice — this is a room at dusk, and a light mode would be a
  different room.
- **The VR paths are unverified on real hardware.** The smoke check runs every frame
  of the interaction layer in a headless browser, so the code is exercised and
  error-free, but locomotion, grab, haptics and comfort have not been felt on a
  headset. Treat controller feel — grab offsets, move speed, snap angle — as the first
  thing to tune once someone straps one on.
- `scripts/smoke.mjs` is the seed of the on-device perf harness in
  `docs/gearbox/10-quality-devops.md` §10.1: same shape, real hardware later. It fails
  the build if the canvas has no GL context or if selection stops working, because a
  WebGL scene can compile perfectly and render nothing.
