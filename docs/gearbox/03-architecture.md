# 03 — System architecture

## 3.1 System context

```mermaid
flowchart TB
    U["User<br/>(VR/AR headset)"]
    UC["Companion user<br/>(desktop / mobile / web)"]
    DEV["Creator / developer"]
    OPS["Operator / admin"]

    GB(("GearBox<br/>Spatial Operating Platform"))

    IDP["Identity provider<br/>(OIDC)"]
    LK["LiveKit<br/>SFU · TURN · signaling"]
    OS["Object storage + CDN"]
    DEVICES["Connected devices<br/>(phase 7)"]
    STORE["Headset app stores"]
    AI["AI providers<br/>(phase 5+)"]

    U -->|spatial session| GB
    UC -->|companion + admin| GB
    DEV -->|publish envs & apps| GB
    OPS -->|operate| GB

    GB <-->|auth| IDP
    GB <-->|voice · video · state datagrams| LK
    GB <-->|assets · snapshots| OS
    GB <-.->|commands · telemetry| DEVICES
    GB -.->|client distribution| STORE
    GB -.->|assistant · generation| AI
```

## 3.2 Container view (MVP)

Everything inside `gearbox-core` is a **module, not a service** ([02](02-stack.md) §2.5).
The room server is separate because it is stateful and has a different lifecycle.

```mermaid
flowchart TB
    subgraph Clients
        XR["XR client<br/>Unity 6 + OpenXR"]
        WEB["Web admin<br/>Next.js"]
        MOB["Mobile companion<br/>Expo (phase 3)"]
    end

    subgraph Edge
        LB["Load balancer / TLS"]
        CDN["CDN"]
    end

    subgraph Control["gearbox-core — modular monolith (TypeScript/Fastify)"]
        IDN["identity"]; USR["user"]; SOC["social"]; PRS["presence"]
        ENV["environment"]; AST["asset"]; SES["session"]; MED["media"]
        NOT["notification"]; AUD["audit"]; SYN["sync"]; DVC["device (ph.7)"]
    end

    subgraph RT["Realtime plane"]
        RS["room-server<br/>Node worker-per-room<br/>20 Hz authoritative"]
        LK["LiveKit SFU"]
    end

    subgraph Data
        PG[("PostgreSQL 16")]
        RD[("Redis")]
        S3[("Object storage")]
    end

    subgraph LocalOpt["Local node (phase 4 — same image, LOCAL profile)"]
        LN["gearbox-core LOCAL<br/>+ embedded room-server<br/>+ mDNS discovery"]
    end

    XR & WEB & MOB --> LB --> Control
    XR --> CDN --> S3
    XR <-->|media + state datagrams| LK
    Control -->|allocate / authorize room| RS
    RS <-->|data channel| LK
    RS --> RD
    RS -->|snapshots + event log| PG
    RS -->|large snapshots| S3
    Control --> PG & RD & S3
    Control -.->|webhooks: participant join/leave, track events| MED
    XR -.->|LAN, no internet| LN
    LN -.->|deferred sync| Control
```

### Why the room server is a separate process

It is the only stateful, latency-critical, hard-to-restart component. Separating it
means: the control plane deploys freely without dropping sessions; room state lives in
one place with one owner; the future Rust port ([02](02-stack.md) §2.4) is a process
swap; and the local node can embed the identical process with a different authority
implementation.

**One room = one `worker_thread`.** Node's main thread handles the LiveKit connection
and supervision only. A misbehaving room cannot stall its neighbours.

## 3.3 The MVP vertical flow (prompt §32) as a sequence

```mermaid
sequenceDiagram
    autonumber
    participant A as User A (XR)
    participant API as gearbox-core
    participant RS as room-server
    participant LK as LiveKit
    participant B as User B (XR)

    A->>API: POST /auth/token (device-bound)
    API-->>A: access (10 min) + refresh
    A->>API: GET /environments/me/home
    API-->>A: environment doc + scene graph + asset manifest
    A->>API: POST /sessions {environmentId}
    API->>RS: allocate(environmentId, version)
    RS->>API: load snapshot + event log tail
    API-->>A: {sessionId, livekitUrl, livekitToken, protocolVersion}
    A->>LK: connect (media + data)
    RS-->>A: SNAPSHOT (full room state)

    A->>RS: SPAWN_APP {appId: dashboard, pose}
    RS->>RS: authorize(A, app.spawn, env) → ok
    RS-->>A: OBJECT_UPSERT (authoritative)
    A->>RS: OBJECT_TRANSFORM (streamed while grabbing, lease held)
    RS->>API: persist layout (debounced 2 s)

    A->>API: POST /invitations {environmentId, inviteeId, role: collaborator}
    API->>B: notification
    B->>API: POST /sessions {invitationToken}
    API-->>B: {sessionId, livekitToken}
    B->>LK: connect
    RS-->>B: SNAPSHOT (late-join: current state, not replay)
    RS-->>A: PARTICIPANT_JOIN

    par Spatial voice
        A->>LK: audio track
        LK->>B: audio track
        B->>B: HRTF spatialize by A's pose
    and Shared object
        B->>RS: OWNERSHIP_REQUEST {objectId}
        RS-->>B: OWNERSHIP_GRANT {lease 5 s}
        B->>RS: OBJECT_TRANSFORM @20 Hz
        RS-->>A: OBJECT_TRANSFORM (interpolated)
    end

    A->>RS: SPAWN_APP {appId: camera-panel}
    A->>LK: publish camera track
    RS-->>B: OBJECT_UPSERT {trackSid}
    B->>LK: subscribe track → render on panel

    Note over A,B: A disconnects (network drop)
    A->>LK: reconnect with resume token (< 30 s)
    RS-->>A: SNAPSHOT (delta since lastSeq if available, else full)
```

Every numbered step maps to a backlog item in [09](09-mvp-backlog-sprints.md) §9.3.

## 3.4 Deployment view (MVP)

```mermaid
flowchart LR
    subgraph Internet
        C1["XR clients"]
    end
    subgraph VM["Single VM (4 vCPU / 16 GB) — Docker Compose"]
        NG["Caddy — TLS, reverse proxy"]
        CORE["gearbox-core"]
        RSV["room-server"]
        LKS["LiveKit (self-hosted)"]
        OTEL["OTel collector + Grafana stack"]
    end
    MPG[("Managed Postgres")]
    MRD[("Managed Redis")]
    MS3[("R2 / S3 + CDN")]

    C1 --> NG --> CORE
    C1 --> LKS
    CORE --> RSV
    RSV --> LKS
    CORE & RSV --> MPG & MRD & MS3
    CORE & RSV --> OTEL
```

Deliberately unglamorous. See [10](10-quality-devops.md) §10.3–10.4 for why this beats
k8s at this stage and what it costs.

## 3.5 Monorepo structure

pnpm workspaces + Turborepo for JS/TS; the Unity project sits in the same repo but
outside the workspace graph (Unity does not participate in pnpm).

```
gearbox/
├── apps/
│   ├── xr-client/                    # Unity 6 project (git-lfs for binary assets)
│   │   ├── Assets/GearBox/
│   │   │   ├── Core/                 # bootstrap, DI, config, logging
│   │   │   ├── Platform/             # IPlatformXR + Meta/OpenXR/visionOS adapters
│   │   │   ├── Spatial/              # anchors, boundaries, room mesh, safety layer
│   │   │   ├── Interaction/          # grab, resize, pin, dock, ray, poke, gaze
│   │   │   ├── Shell/                # home layer, app dock, spatial panels
│   │   │   ├── Net/                  # ITransport, protocol codec, prediction, interp
│   │   │   ├── Avatar/               # rig, IK, LOD, lipsync
│   │   │   ├── Media/                # LiveKit tracks, camera panels, watch-together
│   │   │   ├── Apps/                 # first-party spatial apps (dashboard, camera)
│   │   │   └── Tests/                # EditMode + PlayMode
│   │   └── ProjectSettings/
│   ├── desktop-client/               # Unity flat-screen build config + entry scene
│   ├── mobile-companion/             # Expo (phase 3)
│   └── web-admin/                    # Next.js
├── services/
│   ├── gearbox-core/                 # modular monolith — see 02 §2.5 for module tree
│   └── room-server/                  # authoritative realtime sim
│       ├── src/room/                 # tick loop, component store, interest mgmt
│       ├── src/authority/            # IAuthority: CloudAuthority | LocalAuthority
│       ├── src/protocol/             # codec (shared schema w/ packages/protocol)
│       └── src/persistence/          # snapshot writer, event log
├── packages/
│   ├── protocol/                     # ⭐ single source of truth: realtime message
│   │                                 #    schema + codegen → TS types + C# structs
│   ├── shared-types/                 # domain types, zod schemas, generated from DB
│   ├── api-client/                   # typed REST client, generated from OpenAPI
│   ├── auth-sdk/                     # token handling, device-bound keys, refresh
│   ├── networking-sdk/               # ITransport impls (LiveKit, WebTransport later)
│   ├── spatial-app-sdk/              # app manifest types, host API surface (ph.2)
│   ├── asset-schema/                 # Smart Asset schema + glTF extension + validator
│   ├── environment-schema/           # environment doc + scene graph schema
│   ├── device-schema/                # device capability schema (ph.7)
│   ├── design-system/                # web/admin components + spatial design tokens
│   ├── telemetry/                    # OTel setup, structured logging conventions
│   ├── validation/                   # shared zod validators, error taxonomy
│   └── testing/                      # bot-client harness, fixtures, factories
├── infrastructure/
│   ├── docker/                       # Dockerfiles, compose.dev.yml, compose.prod.yml
│   ├── terraform/                    # (phase 3+)
│   ├── monitoring/                   # Grafana dashboards, alert rules
│   ├── ci/                           # reusable GH Actions workflows
│   └── local-development/            # seed data, one-command bootstrap
├── docs/
│   ├── architecture/  api/  security/  product/  sdk/  runbooks/  adr/
└── tools/
    ├── protocol-codegen/             # schema → TS + C#
    ├── bot-client/                   # headless protocol client (see 01 R3)
    └── perf-harness/                 # on-device frame-budget CI
```

### Three structural rules

1. **`packages/protocol` is the single source of truth for the wire.** TS types and C#
   structs are *generated*, never hand-written on both sides. Schema drift between
   client and server is the highest-frequency bug class in multiplayer, and hand-mirrored
   structs guarantee it.
2. **`packages/*` never imports from `services/*` or `apps/*`.** Enforced by lint.
3. **Unity consumes generated C# via a committed folder**, not a package manager —
   Unity's package tooling fights monorepos. Codegen writes into
   `apps/xr-client/Assets/GearBox/Generated/` and CI fails if it is stale.

## 3.6 Key cross-cutting design points

**`IPlatformXR` port.** All Meta/visionOS/Android XR calls sit behind one interface:
boundaries, room mesh, anchors (create/persist/resolve), passthrough control, input
sources, tracking state. Assumption A2 means only the Meta adapter exists at MVP — but
the port exists from sprint 1, because retrofitting it after 20 direct SDK call sites
is how single-vendor lock-in actually happens.

**Anchors and the coordinate model.** Each environment declares a coordinate frame
rooted at a persistent spatial anchor. Object poses are stored **relative to that
anchor**, never in raw session space. This is what makes "the dashboard is still on
the wall tomorrow" work across tracking-system restarts, and it is why
[08](08-schemas.md) §8.3 makes `anchorId` mandatory on the environment root.

**The safety layer is below the app layer.** A dedicated client subsystem composites
guardian, obstacle proximity, and door/stair warnings *after* environment and app
rendering, with no API for apps or environments to suppress it
([07](07-authz-security.md) §7.6).

**Audit is a module, not a decorator.** Sensitive actions emit an `AuditEvent` in the
same transaction as the state change. Fire-and-forget logging loses exactly the events
you will be asked about.
