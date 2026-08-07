# 06 — API design

## 6.1 REST + OpenAPI, not GraphQL

For a small team with one first-party client family, REST with a generated typed client
beats GraphQL: simpler caching, simpler authorization (per-endpoint, not per-field
resolver), simpler rate limiting, no N+1 surprises, and no server-side query cost
analysis. GraphQL's flexibility pays off when many third-party clients shape their own
queries — a phase-8/9 problem. Revisit when the public SDK lands.

**Conventions**

- Base: `https://api.gearbox.dev/v1` · versioned in the path; breaking changes → `/v2`.
- OpenAPI 3.1 is **generated from zod schemas** in `packages/validation` — the schema is
  the source of truth, the spec is an artifact, and `packages/api-client` is generated
  from the spec. One definition, no drift.
- Auth: `Authorization: Bearer <access_token>` (JWT, 10 min).
- `Idempotency-Key` header required on all non-GET mutations. Sessions, invitations,
  and (later) device commands and payments are all replay-sensitive.
- Cursor pagination: `?cursor=&limit=` → `{data, nextCursor}`. No offset pagination.
- Errors are RFC 9457 Problem Details with a stable machine-readable `type`:

```json
{ "type": "https://gearbox.dev/errors/permission-denied",
  "title": "Permission denied",
  "status": 403,
  "detail": "Role 'viewer' cannot perform 'object.move' in environment 018f...",
  "instance": "/v1/environments/018f.../objects/018f...",
  "requiredRole": "collaborator" }
```

## 6.2 Endpoints (MVP)

### Identity & session

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/register` | email + password or OIDC exchange; age band captured |
| `POST` | `/auth/token` | password / OIDC / **device-assertion** grant |
| `POST` | `/auth/refresh` | rotating refresh token; reuse detection revokes the family |
| `POST` | `/auth/devices` | register device-bound Ed25519 public key |
| `GET` | `/auth/devices` · `DELETE /auth/devices/{id}` | list / revoke |
| `POST` | `/auth/offline-grants` | mint cached grant for local mode ([07](07-authz-security.md) §7.4) |
| `POST` | `/auth/logout` | revoke refresh family |

### Users & social

```
GET    /me                                  → user + profile + settings
PATCH  /me/profile
GET    /me/avatar          PUT /me/avatar
GET    /users/{handle}                      → public profile (privacy-filtered)
GET    /me/friends?status=accepted|pending
POST   /me/friends          {handle}        → request
POST   /me/friends/{id}/accept | /decline
DELETE /me/friends/{id}
POST   /me/blocks {userId}  DELETE /me/blocks/{userId}
GET    /me/notifications?unread=true
POST   /me/notifications/{id}/read
```

### Environments

```
GET    /environments?filter=owned|member|public
POST   /environments                        {name, kind, visibility, networkMode}
GET    /environments/{id}                   → env + currentVersion + members + anchors
PATCH  /environments/{id}                   {name, visibility, safetyConfig}
DELETE /environments/{id}                   → soft delete
GET    /environments/me/home                → personal home; created on first call

GET    /environments/{id}/versions
POST   /environments/{id}/versions          → new draft from current live
POST   /environments/{id}/versions/{vid}/publish  {channel}   → pointer move
POST   /environments/{id}/rollback          {versionId}       → pointer move

GET    /environments/{id}/objects           → live placements (not authored scene)
POST   /environments/{id}/objects           {kind, assetId|appInstanceId, anchorId, pose}
PATCH  /environments/{id}/objects/{oid}     {pose, pinned, parentId}   -- out-of-session
DELETE /environments/{id}/objects/{oid}

GET    /environments/{id}/anchors
POST   /environments/{id}/anchors           {label, pose, platformRefs, semanticType}
PATCH  /environments/{id}/anchors/{aid}     -- re-localization updates platformRefs

GET    /environments/{id}/members
PUT    /environments/{id}/members/{userId}  {role}
DELETE /environments/{id}/members/{userId}
```

**Note on `PATCH .../objects/{oid}`:** in-session moves go over the realtime
`EVENT`/`TRANSFORM` channels, never REST. The REST endpoint exists for out-of-session
editing (web admin, companion app). Both paths funnel through the same authorization
check and the same domain service — two entry points, one rule set.

### Sessions & realtime

```
POST   /sessions            {environmentId, networkMode?, invitationToken?}
                            → {sessionId, roomServer, livekitUrl, livekitToken,
                               protocolVersion, resumeToken, iceServers}
GET    /sessions/{id}       → status, participants, media tracks
POST   /sessions/{id}/leave
POST   /sessions/{id}/resume    {resumeToken, lastAppliedSeq}
                                → new livekitToken + snapshot mode (full|delta)
GET    /sessions/{id}/participants
PATCH  /sessions/{id}/participants/{userId}  {role, presenceMode}  -- owner/admin only
POST   /sessions/{id}/kick  {userId, reason}
```

`POST /sessions` is the busiest authorization decision in the product: it resolves
membership → role → capability set, allocates or joins a room-server, mints a
LiveKit token scoped to exactly that room with exactly the permitted publish rights,
and writes an audit event. It is the endpoint to write tests against first.

### Invitations

```
POST   /invitations         {environmentId, inviteeId?|null, role, expiresIn, maxUses}
                            → {invitationId, token}   -- token returned ONCE, hash stored
GET    /invitations?environmentId=
POST   /invitations/{id}/revoke
POST   /invitations/redeem  {token}   → membership + join hint
```

### Applications

```
GET    /applications?scope=available|installed
GET    /applications/{appKey}/versions
POST   /environments/{id}/apps            {appKey, semver, grantedCapabilities}
DELETE /environments/{id}/apps/{installationId}
POST   /environments/{id}/app-instances   {installationId, pose}  → spawn + object
PATCH  /app-instances/{id}/state          {state}   -- quota-enforced, out-of-session
```

### Assets

```
POST   /assets                    {name, kind, license}    → {assetId, uploadUrls}
PUT    <presigned upload url>                              -- direct to object storage
POST   /assets/{id}/finalize                               → enqueue ingest
GET    /assets/{id}                                        → status, files, budgetReport
GET    /assets?owner=me&kind=model
DELETE /assets/{id}
```

Uploads go **direct to object storage via presigned URL**, never through the API
process. Streaming 100 MB glTF bundles through Node is an availability incident waiting
for its moment.

### Media

```
POST   /sessions/{id}/tracks     {kind, objectId?, consent:{acknowledgedBy[]}}
                                 → {trackSid, publishToken}
DELETE /sessions/{id}/tracks/{trackSid}
GET    /sessions/{id}/tracks
POST   /webhooks/livekit         -- LiveKit → core: track published/ended, participant events
```

### Admin & audit

```
GET    /admin/audit?actorId=&resourceId=&from=&to=
GET    /admin/sessions?status=active
GET    /health   /health/ready   /metrics
```

## 6.3 Realtime vs. REST — the boundary rule

| Goes over REST | Goes over the realtime protocol |
|---|---|
| Anything durable and infrequent | Anything at tick rate |
| Anything requiring a transaction across modules | Anything scoped to one live room |
| Permissions, invitations, membership | Pose, transforms, pointers |
| Asset upload/ingest | Object spawn/move/delete **while in session** |
| Out-of-session editing | Ownership leases |

**One rule keeps this from rotting: no realtime message may be the *only* way to
achieve a durable state change.** Every durable mutation the room server performs has a
REST equivalent and shares the same domain service. That is what makes the web admin,
the companion app, and the bot-client harness possible — and it is what stops
authorization logic from forking into two half-correct copies.

## 6.4 Rate limiting

| Surface | Limit |
|---|---|
| `/auth/*` | 10/min per IP, 5/min per account, exponential backoff on failure |
| Mutations (general) | 60/min per user |
| `POST /sessions` | 20/min per user |
| `POST /invitations` | 30/hour per user |
| Asset finalize | 20/hour per user |
| Realtime reliable events | 100/s per participant, then throttle-and-warn, then disconnect |
| Realtime datagrams | Rate-shaped at the transport; excess dropped silently |

Enforced in Redis with a sliding window; limits are configuration, not constants.

## 6.5 Versioning & compatibility

- REST: additive changes only within `v1`. Field removal or semantic change → `v2`,
  with both served during a deprecation window.
- **Realtime protocol has its own integer version**, negotiated at `POST /sessions`. A
  client with a mismatched major version is refused with an actionable upgrade error —
  never allowed to connect and desync silently.
- **Support N-1 client versions minimum.** Headset app updates are not instantaneous
  and users skip them; a server that only speaks the newest protocol will lock out a
  meaningful fraction of your users on every deploy.
