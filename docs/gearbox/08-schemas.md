# 08 — Core schemas

Required outputs #15–#18. All four are defined as zod schemas in `packages/*-schema`,
exported as JSON Schema for tooling, and code-generated to C# for the Unity client.
Every document carries `schemaVersion`; validators must accept N-1.

## 8.1 Spatial Application Manifest

```jsonc
{
  "schemaVersion": 1,
  "appKey": "com.gearbox.dashboard",          // reverse-DNS, globally unique, immutable
  "name": "Operations Dashboard",
  "version": "1.2.0",                          // semver
  "developer": { "id": "018f...", "name": "GearBox", "verified": true },

  "entry": {
    "kind": "builtin",                         // builtin | wasm | remote-panel
    "builtinId": "gearbox.dashboard",          // first-party (MVP)
    "wasmModule": null,                        // phase 2: content-addressed bundle key
    "presentationModule": null                 // phase 2: client-side cosmetic logic
  },

  "platforms": ["quest", "visionos", "androidxr", "desktop", "web"],
  "minProtocolVersion": 1,

  "presentation": {
    "renderAs": "panel",                       // panel|object|tool|room|portal|character|dashboard|environment
    "defaultSize": { "width": 1.2, "height": 0.8 },   // metres
    "resizable": { "min": [0.4, 0.3], "max": [3.0, 2.0], "aspectLocked": false },
    "placement": ["wall", "free", "desk"],
    "pinnable": true,
    "multiInstance": true,
    "maxInstancesPerEnvironment": 4
  },

  // Deny-by-default. Anything absent is denied; escalation on update re-prompts.
  "capabilities": {
    "network":   { "outbound": ["https://api.example.com"], "websocket": false },
    "storage":   { "instanceStateBytes": 65536, "userScopedBytes": 0 },
    "media":     { "publishCamera": false, "publishScreen": false, "playAudio": true,
                   "maxGainDb": 0 },
    "spatial":   { "readAnchors": "semantic",  // none | semantic | full
                   "readRoomMesh": false,
                   "spawnObjects": 8 },
    "presence":  { "readParticipants": "roster",  // none | count | roster
                   "readPose": false },
    "devices":   { "read": [], "command": [] },       // phase 7; review-gated
    "ai":        { "invokeAssistant": false },
    "identity":  { "scope": "per-environment" }       // ALWAYS per-environment. Never platform ID.
  },

  "multiplayer": {
    "mode": "shared",                          // solo | shared | shared-authoritative
    "statePersistence": "environment",         // none | session | environment
    "conflictPolicy": "lww"                    // lww | authoritative | crdt-orset
  },

  "offline": { "supported": true, "degradedFeatures": ["live-data-refresh"] },

  "lifecycle": { "backgroundBehavior": "suspend",   // suspend | tick-slow | terminate
                 "resumeState": true },

  "budgets": { "scriptFuelPerTick": 200000, "tickHz": 10,
               "maxTriangles": 20000, "maxDrawCalls": 12, "maxTextureBytes": 8388608 },

  "marketplace": { "listed": false, "priceModel": "free",
                   "categories": ["productivity"], "contentRating": "everyone" },

  "update": { "source": "gearbox-registry", "channel": "stable", "autoUpdate": true }
}
```

**Design notes.**

- **`identity.scope` is permanently `per-environment`.** An app receives an opaque
  per-environment user ID and can never correlate a user across environments. This is a
  hard privacy boundary that must be set before the first third-party app ships,
  because it cannot be tightened afterwards without breaking every app.
- **Capabilities are the same mechanism at every trust level.** First-party MVP apps
  declare them and the host enforces them, so the enforcement path is exercised from day
  one rather than switched on later when third-party apps arrive and the code has never
  actually run in deny mode.
- **`budgets` are declared and measured.** The host enforces at runtime; the ingest
  pipeline records measured values at publish so a manifest cannot understate.
- **Capability diffs on update re-prompt.** Silent escalation across an auto-update is
  the classic app-store failure mode.

## 8.2 Smart Asset

Transport is **glTF 2.0 / GLB with a `GEARBOX_smart_asset` extension** — the metadata
travels with the geometry, and standard glTF tooling still opens the file.

```jsonc
{
  "schemaVersion": 1,
  "assetId": "018f...",
  "name": "Espresso Machine EM-2",
  "kind": "model",                             // model | avatar | material | environment_kit
  "creator": { "userId": "018f...", "displayName": "..." },
  "owner":   { "scopeType": "user", "scopeId": "018f..." },

  "license": { "type": "all-rights-reserved",  // all-rights-reserved | remix-attribution | cc0 | commercial
               "attributionRequired": true, "commercialUse": false,
               "sourceAttestation": "self-authored" },   // required at publish (IP posture)

  "physical": {
    "dimensions": { "x": 0.35, "y": 0.42, "z": 0.48, "unit": "m" },
    "weightKg": 12.5,
    "pivot": "base-center",
    "realScaleConfidence": 0.94                // provenance-aware; see capture notes
  },

  "geometry": {
    "files": { "lod0": "sha256:...", "lod1": "sha256:...", "lod2": "sha256:...",
               "imposter": "sha256:...", "collision": "sha256:..." },
    "budgetReport": { "triangles": 18400, "drawCalls": 6,
                      "textureBytes": 6291456, "materials": 3, "measuredAt": "2026-.." }
  },

  "materials": [
    { "slot": "body", "materialId": "018f...", "editable": true,
      "variants": ["stainless", "matte-black", "cream"] }
  ],

  "interaction": {
    "grabbable": true,
    "points": [
      { "id": "power-button", "type": "button", "pose": {"p":[0.1,0.3,0.2]},
        "affordance": "press", "binding": "state.power" },
      { "id": "handle", "type": "grip", "pose": {"p":[0,0.25,0.24]}, "affordance": "grab" }
    ],
    "snapTargets": [{ "id": "counter", "surface": "horizontal", "clearanceM": 0.5 }]
  },

  "states": {
    "power":       { "type": "enum", "values": ["off","heating","ready","brewing","error"],
                     "default": "off" },
    "waterLevel":  { "type": "number", "unit": "percent", "min": 0, "max": 100 },
    "temperature": { "type": "number", "unit": "celsius" }
  },
  "behaviors": [
    { "on": "state.power=brewing", "play": "anim:brew", "emit": "audio:grind" }
  ],

  "connections": {
    "device": { "capabilityProfile": "coffee-machine.v1", "optional": true },  // → §8.4
    "dataSources": [{ "id": "telemetry", "kind": "device-telemetry", "fields": ["temperature","waterLevel"] }]
  },

  "product": {                                  // marketplace / commerce seam (phase 8)
    "manufacturer": "…", "modelNumber": "EM-2", "sku": "…",
    "purchaseUrl": null, "documentationUrl": null
  },
  "maintenance": { "schedule": [{ "task": "descale", "everyDays": 90 }],
                   "accessPoints": ["rear-panel"] },

  "ai": {
    "description": "A domestic espresso machine, stainless body, single group head.",
    "tags": ["kitchen","appliance","coffee"],
    "affordanceSummary": "Can be switched on, brews when ready, requires water refill."
  },

  "provenance": { "source": "scan",             // authored | scan | imported | generated
                  "captureMethod": "photogrammetry-phone",
                  "confidence": { "scale": 0.94, "geometry": 0.88, "material": 0.61 } },

  "permissions": { "visibility": "private", "remixable": false }
}
```

**Design notes.**

- **`provenance.confidence` is mandatory for scanned and generated assets** and must
  surface in the UI. The master prompt's §10 rule — never present an estimate as
  laboratory certainty — is enforced by making the confidence field non-optional in the
  schema rather than by asking the UI layer to remember.
- **`states` + `behaviors` + `connections.device` are what make an asset "smart"**, and
  they are the same fields a digital twin uses in phase 7. Defining them now costs
  nothing and avoids a schema migration on every existing asset later.
- **`license.sourceAttestation` is required at publish.** It is what makes the DMCA
  safe-harbor posture defensible when ripped models inevitably appear.
- **`budgetReport` is written by the ingest pipeline, never by the creator.**

## 8.3 Environment

```jsonc
{
  "schemaVersion": 1,
  "environmentId": "018f...",
  "version": 7,
  "name": "Home Office",
  "kind": "mixed_reality",
  "owner": { "scopeType": "user", "scopeId": "018f..." },
  "visibility": "invite",
  "networkMode": "online",

  "coordinateSystem": {
    "unit": "m", "handedness": "right", "up": "+Y",
    "rootAnchorId": "018f...",                 // REQUIRED — everything is posed relative to this
    "bounds": { "min": [-8,-1,-8], "max": [8,4,8] }   // also drives pose quantization (05 §5.4)
  },

  "physical": {                                 // present for mixed_reality / scanned
    "roomMeshRef": "sha256:...",
    "playArea": { "shape": "rect", "size": [3.2, 2.4] },
    "anchors": [
      { "id": "018f...", "label": "desk", "semanticType": "table",
        "pose": {"p":[1.2,0,0.4],"r":[0,0,0,1]},
        "extents": [1.4,0.75,0.7],
        "safety": { "isObstacle": true, "collisionRequired": true },
        "realityLayer": {                        // prompt §7 — re-skin, never hide
          "virtualAssetId": "018f...",           // desk → control console
          "occlusionMode": "reskin",             // reskin | augment  (NEVER "hide")
          "preservePhysicalExtents": true        // enforced true for isObstacle anchors
        }
      },
      { "id": "018f...", "label": "door", "semanticType": "door",
        "safety": { "isObstacle": true, "alwaysIndicate": true } }
    ]
  },

  "sceneGraph": {                               // authored content, versioned & immutable
    "nodes": [
      { "id": "n1", "kind": "group", "name": "Wall panels", "pose": {"p":[0,0,0]} ,
        "children": [
          { "id": "n2", "kind": "asset", "assetId": "018f...", "pose": {"p":[-2,1.4,-3]} }
        ]
      }
    ]
  },

  "theme": { "id": "command-center", "lighting": { "preset": "cool-indirect",
             "realtimeLights": 2 }, "skybox": null, "audioAmbience": "sha256:..." },

  "apps": [{ "installationId": "018f...", "appKey": "com.gearbox.dashboard",
             "version": "1.2.0", "grantedCapabilities": { "...": "..." } }],

  "safetyConfig": {
    "requiredPlayArea": [2.0, 2.0],
    "boundaryStyle": "adaptive",
    "obstacleProximityWarningM": 0.5,
    "allowFullOcclusionOfObstacles": false      // schema-pinned false; see 07 §7.6
  },

  "networking": { "maxParticipants": 8, "voiceMode": "spatial",
                  "defaultRole": "viewer", "interestZones": [] },

  "persistence": { "tier": "durable",           // ephemeral | session | durable
                   "snapshotIntervalSec": 60, "maxDurableBytes": 5242880 },

  "assetManifest": [{ "assetId": "018f...", "contentHash": "sha256:...", "required": true }],
  "contentHash": "sha256:...",
  "history": { "createdBy": "018f...", "publishedAt": "2026-...", "parentVersion": 6 }
}
```

**Design notes.**

- **`rootAnchorId` is required and every pose is relative to it.** This is the single
  mechanism that makes "the dashboard is still on the wall tomorrow" survive tracking
  restarts and re-localization ([03](03-architecture.md) §3.6).
- **`realityLayer.occlusionMode` has no `"hide"` value, by construction.** The schema —
  not a code review — is what prevents someone shipping an environment that visually
  erases a real obstacle. `preservePhysicalExtents` is forced true whenever
  `safety.isObstacle` is true.
- **Authored `sceneGraph` (immutable, versioned) is distinct from live
  `spatial_objects` (mutable placements).** Conflating them is why "the world changed
  under my feet" bugs happen. See [04](04-data-model.md) §4.3.
- **Multiple themes over one physical room** (master prompt §7) = multiple environments
  sharing a `physical.anchors` set. Anchors are the stable substrate; themes are
  swappable.

## 8.4 Device capability (phase 7, defined now)

```jsonc
{
  "schemaVersion": 1,
  "profileId": "coffee-machine.v1",
  "deviceId": "018f...",
  "owner": { "scopeType": "user", "scopeId": "018f..." },
  "identity": { "manufacturer": "…", "model": "EM-2",
                "serial": "…", "firmwareVersion": "2.3.1" },

  "connection": {
    "methods": [
      { "kind": "wifi-local", "protocol": "http", "endpoint": "http://192.168.1.44",
        "priority": 1 },
      { "kind": "ble", "serviceUuid": "0000…", "priority": 2 },
      { "kind": "cloud", "protocol": "vendor-api", "priority": 3 }
    ],
    "pairing": { "method": "code-confirm", "requiresPhysicalAccess": true },
    "availability": "local-or-remote"
  },

  "telemetry": [
    { "key": "temperature", "type": "number", "unit": "celsius",
      "sampleHz": 0.2, "retentionDays": 30 },
    { "key": "waterLevel",  "type": "number", "unit": "percent", "sampleHz": 0.1 },
    { "key": "state", "type": "enum", "values": ["off","heating","ready","brewing","error"] }
  ],

  "commands": [
    { "id": "power",  "params": { "on": "boolean" },
      "sensitivity": "low",  "requiresRole": "operator",
      "idempotent": true,  "timeoutMs": 5000 },
    { "id": "brew",   "params": { "size": "enum:single|double" },
      "sensitivity": "medium", "requiresRole": "operator",
      "requiresConfirmation": false, "idempotent": false,
      "timeoutMs": 30000, "rateLimit": "6/hour" },
    { "id": "descale", "params": {},
      "sensitivity": "high", "requiresRole": "admin",
      "requiresConfirmation": true, "requiresPresence": "local",
      "idempotent": false, "timeoutMs": 1800000 }
  ],

  "safety": {
    "emergencyStop": { "supported": true, "commandId": "power", "params": {"on": false} },
    "physicalRiskClass": "low",                // low | moderate | high
    "requiresLineOfSight": false,              // true ⇒ commands only from inside the room
    "failSafeState": "off"
  },

  "twin": { "spatialObjectId": "018f...", "assetId": "018f...",
            "stateMapping": { "state": "asset.states.power",
                              "temperature": "asset.states.temperature" } },

  "permissions": { "readTelemetry": ["owner","admin","operator","collaborator"],
                   "sendCommands": ["owner","admin","operator"],
                   "remoteAccess": false }
}
```

**Design notes.**

- **`sensitivity` + `requiresConfirmation` + `requiresPresence` are the safety
  gradient.** A high-sensitivity command on a `physicalRiskClass: high` device should
  require an operator physically present in the room, not a remote user or an AI agent.
- **`emergencyStop` is a first-class field**, not a convention. Anything with a moving
  part or a heating element needs a defined fail-safe state that the platform can
  command without vendor cooperation.
- **`requiresLineOfSight`** exists because "turn on the oven from another country" is a
  capability worth being able to switch off at the schema level.
- **Every command is audited**, including denials — `AuditEvent` with the resolved actor,
  role, device, parameters, and outcome ([07](07-authz-security.md) §7.5 T19).
- **AI agents are `Actor{type:'agent'}`** and inherit their principal's device
  permissions at most; any `sensitivity: high` command from an agent requires explicit
  human confirmation regardless of the principal's role.
