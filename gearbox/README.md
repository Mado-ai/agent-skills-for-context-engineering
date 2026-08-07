# GearBox — monorepo

Implementation of the plan in [`../docs/gearbox/`](../docs/gearbox/). Start with
[`docs/gearbox/README.md`](../docs/gearbox/README.md) for the architecture and
[`docs/gearbox/11-geospatial-mvp.md`](../docs/gearbox/11-geospatial-mvp.md) for the
current MVP definition and sprint plan.

**Status: sprint 1 foundations.** The auth vertical runs end to end; the game loop,
places, realtime rooms and the Unity client are not built yet. See
[What exists / what doesn't](#what-exists--what-doesnt).

## Quick start

```bash
pnpm install
cp .env.example .env          # then set JWT_SECRET: openssl rand -base64 48
pnpm dev:infra                # Postgres+PostGIS, Redis, MinIO, LiveKit
pnpm db:migrate
pnpm db:seed                  # optional: two dev accounts
pnpm dev                      # http://localhost:3000/health
```

Without Docker you can still run everything except the database-backed tests:

```bash
pnpm build && pnpm test       # 74 tests, no infrastructure needed
```

## Commands

| Command                        | What it does                                       |
| ------------------------------ | -------------------------------------------------- |
| `pnpm build`                   | Build all packages and services                    |
| `pnpm test`                    | Unit + API tests (no infrastructure required)      |
| `pnpm test:integration`        | Repository contract tests against real Postgres    |
| `pnpm lint`                    | ESLint, including the architectural boundary rules |
| `pnpm format` / `format:check` | Prettier                                           |
| `pnpm codegen`                 | Regenerate C# from the wire schema                 |
| `pnpm codegen:check`           | Fail if the committed C# is stale (CI)             |
| `pnpm db:generate`             | Generate a SQL migration from the Drizzle schema   |
| `pnpm db:migrate` / `db:seed`  | Apply migrations / seed dev data                   |
| `pnpm dev:infra:reset`         | Tear down infrastructure **and its volumes**       |

## Layout

```
packages/protocol      ⭐ wire schema — single source of truth, generates TS + C#
packages/validation       zod schemas + error taxonomy (Problem Details)
services/gearbox-core     modular monolith; one module per future service
apps/xr-client            Unity project (generated protocol + wire primitives)
infrastructure/docker     local dev stack
docs/adr                  architecture decision records
```

## The three rules that keep this honest

1. **`packages/protocol` is the only definition of the wire.** TS types and C# structs
   are generated from `src/schema.ts`; `pnpm codegen:check` fails CI if the committed
   C# is stale. Hand-mirrored structs on two sides are the highest-frequency bug class
   in multiplayer code.
2. **Modules talk through `ports/` only.** A deep import from one module into another's
   `domain/`, `application/`, `infrastructure/` or `http/` is a lint error. The rule was
   verified against a deliberate violation, not just written down.
3. **`packages/*` never imports `services/*` or `apps/*`.** Also lint-enforced.

## Adapters and testability

Every port has two implementations: in-memory and Drizzle. They are not
"real vs. fake" — the same contract test
(`repositoryContract.integration.test.ts`) runs against both, so the in-memory version
cannot quietly be more forgiving than Postgres. That is what lets the whole auth
vertical, including a real Fastify app, be tested without infrastructure; it is also
the foundation the `LOCAL` deployment profile will build on.

The contract test **warns loudly and skips** the Drizzle half when `DATABASE_URL` is
unset. A silently skipped test is worse than no test.

## What exists / what doesn't

**Exists and verified:**

- Wire protocol: schema, binary codec, quantization, C# codegen + freshness check
- Auth vertical: register, password grant, refresh rotation with reuse detection,
  Ed25519 device registration and assertion, audit events
- Postgres schema + generated migration; Drizzle and in-memory adapters
- Fastify app with RFC 9457 Problem Details error handling
- **Realtime multiplayer core**: `packages/room-core` (authoritative room — ownership
  leases with epochs, snapshots/late-join, server-stamped identity, pose plausibility,
  realtime authz), `services/room-server` (dev WebSocket host; run with
  `pnpm --filter @gearbox/room-server dev`), `packages/networking-sdk` (client link +
  interpolation buffer), all bot-tested over real sockets
- **Multi-user room view** (`apps/xr-viewer`): remote avatars, shared-object grabbing
  through leases, VR + AR passthrough modes. `?server=ws://host:7777/rooms/demo`
  joins a live server; without it the real room runs in-page with two simulated peers
- Local dev stack, CI pipeline, boundary lint rules, 5 ADRs

**Not built yet** (next in `docs/gearbox/11-geospatial-mvp.md` §11.15):

- The Unity client (the web viewer is the demo surface; Unity remains the plan of
  record for phones + headsets)
- Voice (LiveKit SFU integration), the LiveKit ITransport implementation, and
  session minting via `POST /sessions` — the room-server currently accepts
  handle+role on the query string, dev-only by declared design
- Place pipeline (OSM ingest, H3, curation), location service, anti-cheat
- The game loop and the room bridge persistence

**Verified how:** `pnpm build`, `pnpm lint`, `pnpm format:check`, `pnpm test` (74
passing) and `pnpm codegen:check` were all run green. `pnpm test:integration` has
**not** been run — it needs Docker, which was unavailable in the environment where
this was scaffolded. It is wired into CI and should be run on the first machine that
has a database.
