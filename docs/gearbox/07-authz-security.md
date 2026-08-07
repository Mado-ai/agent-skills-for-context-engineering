# 07 — Authorization, security, safety, privacy

Covers required outputs #14 (authorization model) and #19 (threat model), plus the
physical-safety and privacy invariants the product depends on.

## 7.1 Authorization model: RBAC + capabilities, one decision function

Three layers, evaluated in order. All three run **server-side**; the client's copy of
the permission set is a UI hint and is never trusted.

```
1. Scope membership   — is the actor in the owning scope (user / org)?
2. Role               — what role does the actor hold on this resource?
3. Capability grant   — has this app/device/agent been granted this specific capability?
```

```ts
// One function. Every call site — REST, realtime, AI agent, device — goes through it.
function can(actor: Actor, action: Action, resource: ResourceRef): Decision;

type Actor =
  | { type: 'user';   userId: UUID; sessionId?: UUID }
  | { type: 'app';    appInstanceId: UUID; onBehalfOf: UUID }   // never more than the user
  | { type: 'device'; deviceId: UUID }
  | { type: 'agent';  agentId: UUID; onBehalfOf: UUID }
  | { type: 'system'; reason: string };
```

**Delegation rule, and it is absolute: a delegated actor can never exceed the
permissions of the principal it acts for.** An app acting on behalf of a viewer cannot
move an object. An AI agent cannot grant itself a capability. The intersection is
computed in `can()`, not at the call site — call sites forget.

## 7.2 Role matrix

| Action | Owner | Admin | Operator | Collaborator | Viewer | Guest |
|---|---|---|---|---|---|---|
| Enter environment | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Voice | ✓ | ✓ | ✓ | ✓ | ✓ | ✓* |
| Move / pin unlocked object | ✓ | ✓ | ✓ | ✓ | — | — |
| Spawn / delete object | ✓ | ✓ | ✓ | ✓ | — | — |
| Install / remove app | ✓ | ✓ | — | — | — | — |
| Publish environment version | ✓ | ✓ | — | — | — | — |
| Manage members & roles | ✓ | ✓ | — | — | — | — |
| Create invitations | ✓ | ✓ | — | ✓† | — | — |
| Publish camera / screen | ✓ | ✓ | ✓ | ✓ | —‡ | — |
| Start recording | ✓ | ✓ | — | — | — | — |
| Operate connected device (ph.7) | ✓ | ✓ | ✓ | — | — | — |
| Kick participant | ✓ | ✓ | — | — | — | — |
| Delete environment | ✓ | — | — | — | — | — |
| Transfer ownership | ✓ | — | — | — | — | — |

\* Guest voice defaults on in private environments, off in public ones.
† Collaborator invites are viewer-role only and require owner approval — the standard
fix for invite-chain privilege escalation.
‡ Viewer camera publish is owner-grantable per session.

**Least privilege defaults:** new environments are `private`; invitation links default
to `viewer`, single-use, 24 h expiry; new app installations receive **zero** capabilities
until explicitly granted.

**Org seam:** when organizations land (phase 3), org roles resolve *into* this same
matrix rather than adding a parallel system. `can()` gains a scope-resolution step; the
matrix does not change. This is why `owner_scope_id` exists in
[04](04-data-model.md) §4.4.

## 7.3 Tokens

| Token | Lifetime | Binding | Notes |
|---|---|---|---|
| Access (JWT) | 10 min | `aud`, `sub`, `device_id` | Contains role claims only for the current session; never a full permission dump |
| Refresh | 30 days, rotating | Device-bound (Ed25519) | Reuse detection revokes the entire family |
| LiveKit token | Session duration | Room + participant + publish grants | Minted per session with exactly the permitted rights — this is where a mis-scoped token becomes a camera-publish exploit |
| Resume token | 30 s | Session + participant | Reconnect only; single use |
| Invitation token | Configurable, default 24 h | — | **Hash stored, raw returned once**, single-use by default |
| Offline grant | ≤ 7 days | Device + environment | §7.4 |

**Device-bound credentials:** the client generates an Ed25519 keypair in platform secure
storage; the public key registers to the account. Refresh and offline grants require a
signed challenge. A stolen refresh token alone is useless without the device key.

## 7.4 Offline / local-mode authentication

The hard part of local mode. A LAN room with no internet still has to answer "who are
you and what may you do?"

```
While online (pre-issued):
  Cloud mints an OfflineGrant per (device, environment):
    { userId, deviceId, environmentId, role, capabilities,
      notBefore, notAfter (≤7d), nonce, sig(cloud_private_key) }
  Client caches it. Local node caches the cloud's public key + a user roster snapshot.

Offline (join):
  1. Client → node: OfflineGrant + fresh signature over a node-supplied nonce
  2. Node verifies: cloud signature · not expired · not in cached revocation list
                    · device key matches grant · nonce fresh (replay defense)
  3. Node issues a short-lived local session token
  4. Node logs the grant use to its local audit store

On reconnect:
  – Node uploads offline audit events
  – Cloud checks for revocations issued during the partition and flags any violation
```

**Accepted residual risk, stated plainly:** a credential revoked during a network
partition remains valid on an offline node until the grant expires or the node
reconnects. Mitigations — short grant lifetimes (default 24 h, max 7 d), an
owner-triggerable local kick, and a **revocation bloom filter** gossiped between nodes
on the LAN. This risk is inherent to offline authorization and cannot be fully removed;
it can only be bounded. Shorten grant lifetime for high-sensitivity deployments.

## 7.5 Threat model

STRIDE over the MVP surface. `Sev` = severity if exploited.

| # | Threat | Category | Sev | Mitigation |
|---|---|---|---|---|
| T1 | Account takeover via credential stuffing | Spoofing | High | Rate limits, breach-password check, MFA (phase 2), device-bound refresh |
| T2 | Stolen refresh token replay | Spoofing | High | Rotation + reuse detection + device binding |
| T3 | Room invasion via leaked invite link | Spoofing | Med-High | Single-use tokens, short expiry, hashed storage, revocation, owner join-notification |
| T4 | Avatar/display-name impersonation | Spoofing | Med | Immutable handle shown alongside display name; name moderation |
| T5 | Client claims an ownership lease it doesn't hold | Tampering | High | Server-authoritative leases + epoch check ([05](05-realtime.md) §5.1) |
| T6 | Client sends impossible poses (speed hack, wallclip) | Tampering | Med | Server clamps velocity/teleport distance; violations rate-limited then disconnected |
| T7 | Malicious asset (zip bomb, malformed glTF, huge textures) | DoS / Tampering | High | Ingest parses in a **sandboxed worker with hard CPU/memory caps**, structural validation, budget rejection, malware scan |
| T8 | Malicious app/script (phase 2) | Elevation | High | Wasm isolate + fuel metering + no ambient authority (prior spec, `03-ugc-pipeline.md` §3.4) |
| T9 | Over-scoped LiveKit token → publish/subscribe to another room | Elevation | High | Tokens minted server-side per session, room-scoped, publish grants explicit; **never mint client-side** |
| T10 | Realtime message flood | DoS | Med | Per-participant reliable-event budget, datagram shaping, disconnect on sustained abuse |
| T11 | LAN node spoofing (evil twin on mDNS) | Spoofing | High | TOFU cert pinning + **two-device verification code** ([05](05-realtime.md) §5.8) |
| T12 | Offline grant replay after revocation | Elevation | Med | Short lifetimes, nonce challenge, revocation gossip, reconnect audit (§7.4) |
| T13 | Camera/mic activated without user awareness | Info disclosure | **Severe** | OS-level indicator + in-app persistent indicator + consent record + active-capture list; publish requires explicit user action, never programmatic |
| T14 | Location inference from environment/presence metadata | Info disclosure | Med | Exact location off by default; coarse-only to non-friends; no room-name geocoding |
| T15 | Cross-tenant data leak via IDOR | Info disclosure | High | Every query scoped by `owner_scope_id`; `can()` on every read path; contract tests assert 404-not-403 for non-members |
| T16 | Audit log tampering | Repudiation | Med | Append-only, no app-level `UPDATE`/`DELETE` grants, partitioned, offsite backup |
| T17 | Room-server compromise → full environment control | Elevation | High | Room server holds **no long-lived secrets**; per-session credentials; DB access via least-privilege role limited to its tables |
| T18 | Unsafe AI action (agent moves objects, invites users, sends commands) | Elevation | Med-High | Agents are `Actor{type:'agent', onBehalfOf}` and cannot exceed the principal; destructive/physical actions require explicit user confirmation |
| T19 | Unauthorized physical device command (phase 7) | Tampering | **Severe** | Operator role + per-command authorization + confirmation for sensitive commands + timeout + idempotency + audit + emergency stop |
| T20 | Supply-chain compromise (npm, Unity packages, LiveKit) | Tampering | High | Lockfiles, `pnpm audit` in CI, Dependabot, pinned Unity packages, SBOM per release |

**Not yet modelled (phase-gated):** marketplace fraud and chargebacks (phase 8),
content moderation at scale (phase 5+), GPU/driver exploits via untrusted shaders
(phase 5), physical-hardware attestation (phase 7).

## 7.6 Physical safety invariants

Non-negotiable client-layer rules. Not policy — architecture. The safety subsystem
composites **after** environment and app rendering and exposes **no** suppression API.

| Invariant | Enforcement |
|---|---|
| Guardian/boundary is always available and always composited | Safety layer renders above all content; no app or environment can disable it |
| A classified obstacle may be **re-skinned but never fully hidden** | Prompt §7's re-skinning works because the *collision and safety proxy persists* underneath the virtual appearance. A desk can look like a console; it cannot look like open floor. |
| Doors, stairs, and drop-offs get elevated treatment | Semantic classification (`spatial_anchors.semantic_type`) drives always-on proximity indicators |
| Proximity warning escalates with speed toward the obstacle | Distance + closing velocity, not distance alone |
| Passthrough is reachable in one reserved gesture | Reserved input, never capturable by an app |
| Degradation never removes safety | [05](05-realtime.md) §5.11 |
| Environments declare a required play area; smaller rooms get a compatibility warning **before** entry | `environments.safety_config` |

**The rule to hold when someone asks for an exception:** any feature request phrased as
"let the environment hide the boundary" is refused. The creative capability survives via
re-skinning; the safety guarantee does not survive an exception.

## 7.7 Privacy

- **Capture consent.** Publishing camera or screen requires explicit user action plus a
  consent record; recording requires **all-party** consent, an unmistakable in-room
  indicator, and an audit entry. Consent is per-session and does not persist.
- **Indicators are non-suppressible** — a persistent marker on the publishing avatar and
  an always-available "who is capturing right now" list.
- **Location** ([master prompt §13]): virtual and real-world location are separate
  settings. Exact GPS is **off by default**, requires an explicit audience and duration,
  shows a persistent active-sharing indicator, lists exactly who can currently see it,
  and can be stopped in one action.
- **Body motion is biometric-adjacent.** Head and hand traces are identifying with high
  accuracy in published research. Treat pose telemetry as sensitive: minimize retention,
  never sell it, keep it out of third-party analytics, and aggregate before storing.
- **Room geometry is sensitive personal data** — it is a map of someone's home. Scans
  stay in the owner's scope, are never used for advertising, and are never shared with
  an environment or app without an explicit grant.
- **Data subject rights:** export (`GET /me/export` → async job → signed URL) and
  deletion ([04](04-data-model.md) §4.6) built in phase 2, not when the first request
  arrives.
- **Children:** age band captured at signup; under-13 blocked at MVP (assumption A15).
  When minors are supported, the age band gates discovery, voice, DMs, **and telemetry
  collection** — not just content.

## 7.8 Secure development practices

Baked into CI from sprint 1, because retrofitting security tooling is how it never
happens:

- Secrets via environment/secret manager; **`.env.example` committed, `.env` never**;
  gitleaks in CI.
- Dependency audit + SBOM per release.
- SAST (CodeQL) on every PR; container image scanning.
- All external input validated at the boundary with zod — including realtime payloads,
  which are the input surface teams most often forget.
- Parameterized queries only (Drizzle enforces this); no string-built SQL.
- Security review required for changes touching `auth`, `can()`, token minting, or the
  safety layer — enforced by CODEOWNERS.
- Threat-model review at each phase gate, not once at the start.
