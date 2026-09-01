# AI Workforce OS v0.4 — Security

**This build is not production-ready and must not be deployed.** Section 5
lists the blockers. The rest of this document describes what v0.4 does enforce,
and how each claim is tested.

---

## 1. Threat model

The adversary this design takes seriously is not an external attacker — v0.4
has no exposed surface to attack. It is **an agent that acquires more authority
than it was granted**, whether through a bad contract, a delegation bug, a
replayed approval, or a model that has been talked into something.

Trusted: the Owner, the runtime code itself, the database file.
Untrusted: **every agent, including the Chief**, and every model output.

That framing drives the design. The Chief has system-wide *visibility* and no
special *authority*: its actions run through the same gateway on the same
contract as any other agent, and a test asserts it cannot bypass an Owner gate.

---

## 2. Enforced properties

Each row is a claim, where it is enforced, and the test that fails if it
regresses. `tests/security.test.ts` is one test per claim, named after it.

| Property | Enforced in | Test |
|---|---|---|
| Default deny | `policy/engine.ts` | `default deny: an unregistered tool is refused`; `an agent with an empty allowlist can do nothing` |
| Project isolation | `policy/engine.ts`, `memory/service.ts` | `project isolation: an agent cannot reach another project`; `a master cannot delegate into another master's project` |
| A parent cannot delegate authority it lacks | `delegation/service.ts`, `registry/validation.ts` | `a parent cannot delegate authority it does not hold`; `a child contract claiming more than its parent fails validation` |
| Inactive/retired agents cannot execute | `policy/engine.ts` | `an inactive agent cannot execute`; `a draft agent cannot execute even with a perfect contract` |
| Expired tokens cannot execute | `approvals/service.ts` | `refuses an expired token` |
| Tokens cannot be replayed | `approvals/service.ts`, `gateway.ts` | `executes exactly once with a valid token`; `refuses a token replayed against different arguments`; `…against a different tool`; `…by a different agent` |
| Unlisted tools are blocked | `policy/engine.ts` | `denies a tool that is not in the allowlist` |
| Authoritative memory needs permission | `memory/service.ts` | `authoritative memory requires both the grant and human-backed provenance` |
| An agent cannot alter its own permissions | `registry/registry.ts`, `gateway/handlers.ts` | `an agent cannot alter its own contract permissions`; `refuses to let an agent change its own permissions through policy.update` |
| Audit is append-only | `telemetry/audit.ts`, migration 002 | `audit events cannot be updated or deleted through any interface`; `a settled tool call cannot be rewritten` |
| No agent holds Owner level | `registry/validation.ts` | `no agent holds Owner access level` |
| Owner-gated tools always need approval | `policy/engine.ts` | `every owner-gated tool needs an approval, for every agent that holds it` |
| Denials are recorded before the caller sees them | `gateway.ts` | `every denial is recorded before the error reaches the caller` |
| Handlers cannot reach a project the policy engine did not check | `gateway/handlers.ts` | `task.create cannot create a task in another project`; `report.compose cannot write an artifact into another project's task`; `quality.evaluate cannot evaluate another project's task` |
| Authoritative provenance cannot be forged | `gateway/handlers.ts`, `memory/service.ts` | `memory.write_authoritative cannot forge human provenance` |

---

## 3. How each control works

### Default deny

`authorizeToolCall` runs an ordered list of checks and allows only if all pass.
Every check — passed or failed — is recorded on the decision, so a denial names
the rule that fired rather than returning a bare "no". Denial codes are typed
(`ErrorCode`), and the UI keys its "blocked" and "approval required"
affordances off the code rather than off message text.

The strongest form of this test is the one with an empty allowlist: an active,
validated agent granted no tools is denied **every** tool in the catalogue,
enumerated.

### Scope derivation

`policy/scopes.ts` is the only place access levels map onto capabilities.
Nothing is implicit. Two categories never come from an access level alone:

- **Explicit-grant scopes** (`memory:authoritative`, `net:egress`) need a
  contract grant as well, so a broadly-privileged agent cannot reach them by
  accident.
- **Owner-only scopes** (`policy:write`, `secrets:grant`, `finance:commit`,
  `legal:bind`, `data:destructive`, `publish:external`) are reachable *only*
  through an approval token. No agent holds them at rest.

### Authority bounds

Checked twice, at different times, on purpose:

- **At validation** (`registry/validation.ts`): role rank, access level, tools,
  project scope, derived scopes, memory layers and child templates must all be
  within the parent. A contract that escalates cannot become active.
- **At delegation** (`delegation/service.ts`): the receiver must be a
  descendant of the sender; packet tools must be within both contracts; packet
  budget must be within the sender's ceiling.

An instantiated specialist is clamped to the parent's envelope *before*
validation sees it — project scope is overwritten with the single target
project, and the tool list is intersected with the parent's — and then
validated anyway.

### Approval tokens

The binding is `sha256(canonical_json({action, tool_name, args,
actor_agent_id, project_id}))`. Canonical JSON sorts keys at every depth, so
key order does not change the fingerprint and any value change does.

Properties, each separately tested:

- **Single-use.** Enforced by `UPDATE … WHERE consumed_at IS NULL`, so
  concurrent consumers race and exactly one wins; a trigger refuses a second
  consume even by direct SQL.
- **Short-lived.** Default 300s, maximum 3600s.
- **Hash-only storage.** The plaintext is returned once and never persisted; a
  test dumps the whole table and asserts the plaintext appears nowhere.
- **Immutable binding.** A trigger refuses any UPDATE to the action
  fingerprint, actor, approval, hash or expiry — including an attempt to extend
  a token's life.
- **Constant-time comparison** on the fingerprint.
- **Revocable.** Revoking the approval invalidates its outstanding tokens.

### Handler-resolved entities

The gateway authorizes against the project on the **request**. A handler that
then reads `args.project_id`, or resolves a task or artifact and acts on
whatever project *that* belongs to, is acting on something the policy engine
never saw. Three handlers did exactly that before an audit caught it
(`task.create`, `quality.evaluate`, `report.compose`); all now route through a
`requireProjectScope` guard, and each crossing has its own test.

This is worth stating as a rule rather than a fix: **a handler that resolves an
entity from its arguments must re-check scope for whatever that entity belongs
to.** Any new handler that does so and skips the guard reintroduces the class.

### Memory integrity

Authoritative writes need the contract grant *and* provenance that is either
human-sourced or references a **granted** approval. The tool handler does not
assert human provenance on the caller's behalf — it records the write as the
agent write it is, so an agent reaching this tool must produce an Owner
approval reference. (The handler previously hard-coded `origin: 'human'`; see
`V04_TEST_REPORT.md` §4.) A lower layer may not
supersede a higher one. Reads are scope-filtered in the repository, and a
cross-project read is a denial rather than an empty result.

### Audit integrity

The audit interface has exactly two methods: `append` and `list`. A test
asserts `Object.keys(runtime.audit)` equals `['append', 'list']`, so adding a
mutation path breaks the build. Migration 002 adds triggers refusing UPDATE and
DELETE on `events`, `quality_evaluations` and `usage_records`; refusing DELETE
on `tool_calls` and any UPDATE after settlement; and refusing edits to contract
versions and token bindings.

Denials are written to `tool_calls` *and* raised as a `security`-severity event
**before** the error is thrown, so a caller that swallows the exception still
leaves the attempt on record.

### Secrets

No table holds a secret value. `secret_refs` records only where a credential
lives — provider and environment variable name — and `secret.grant` records the
grant of a *reference*, returning `{granted: true, secret_key}` and never a
value. A test walks every column in the schema and fails on a column named for
a secret value.

---

## 4. Known-weak areas

Real, and not mitigated in v0.4:

1. **The acting identity is asserted, not proven.** `x-workforce-actor-id` is a
   header. Anyone who can reach the API is the Owner.
2. **Owner-gated effects are simulated.** The handlers return
   `simulated: true`. The governance is real; the effect is not.
3. **Contract-validation warnings do not block.** `BUDGET_ABOVE_PARENT` is a
   warning; a child can carry a higher cost ceiling than its parent as long as
   runtime budgets bound it.
4. **The model evaluator trusts its own provider.** A compromised provider
   could pass artifacts that deterministic checks would fail. Mitigation: the
   default gate uses no model evaluator at all.
5. **No rate limiting.** Budgets bound total consumption, not request rate.
6. **The database file is unencrypted** and readable by anything with
   filesystem access.
7. **`concurrency_limit × 10` children per parent** is a heuristic, not a
   reasoned capacity model.
8. **Job claiming is single-process.** The conditional UPDATE is correct for
   concurrent workers on one SQLite file; it has not been exercised across
   processes.

---

## 5. Production blockers

Ordered. Nothing below "must" should be deployed without.

### Must fix before any deployment

1. **Owner authentication and session management.** Today the Owner is a
   header. Needs real authentication, MFA on approval decisions, and signed
   sessions. Until then the loopback bind is the only thing standing between an
   attacker and unlimited approval authority.
2. **Authorization on the API surface.** Every endpoint currently trusts the
   caller. Needs per-endpoint authorization tied to an authenticated principal,
   and an approval flow that cannot be driven by the same credential that
   requests approvals.
3. **Real owner-gated effects, or explicit removal.** Either wire
   `finance.commit_payment`, `contract.finalize`, `publish.external`,
   `data.destructive_action` and `secret.grant` to real systems with their own
   idempotency and reconciliation, or remove them so nothing can mistake the
   simulation for the real thing.
4. **Secret resolution and rotation.** `secret_refs` names environment
   variables. Needs a real secret manager, per-agent scoping at resolution
   time, rotation, and audit of every resolution.
5. **Transport security.** No TLS. The bearer token, if set, is sent in clear.

### Must fix before multi-tenant or networked use

6. **PostgreSQL migration.** SQLite is single-writer. See `V04_DATA_MODEL.md`
   for the path; the schema is portable but the migration has not been run.
7. **A durable external queue.** The local `jobs` table has no cross-process
   guarantees, no dead-letter queue and a linear retry that is not a real
   policy.
8. **Rate limiting and quota enforcement** at the API edge, distinct from
   budgets.
9. **Audit log shipping.** An append-only table in the same database as the
   data it audits is not tamper-evident against anyone with file access. Needs
   append-only external storage and integrity chaining.
10. **Backup, restore and retention**, exercised.

### Should fix before relying on it operationally

11. **Cron scheduling.** `schedule_expr` is milliseconds.
12. **Contract-change approval.** Revising a contract is Owner-gated by
    `policy.update` when an agent does it, but the API path lets the Owner
    revise directly with no second signature.
13. **Model provider hardening**: retries, circuit breaking, per-provider cost
    reconciliation against real invoices. `estimated_cost` is an estimate.
14. **Prompt-injection defence.** Nothing today treats model output as hostile
    beyond schema validation and quality gates. An agent whose input contains
    instructions is bounded by its contract, which is the main defence — but
    the packet payloads it reads are not sanitised.
15. **Instance isolation.** Instances share a process. A misbehaving handler
    can affect others.
16. **Observability**: structured logs, metrics, distributed tracing. Trace IDs
    exist and thread correctly; nothing exports them.
17. **Load testing** at the stated 1,000+ definition scale. The design is
    elastic; that has not been measured.

---

## 6. Running it safely, as-is

- Leave it on loopback. The server refuses any other bind without
  `WORKFORCE_API_TOKEN`, and that token is a shared secret, not authentication.
- Keep `WORKFORCE_LLM_PROVIDER=mock` unless you intend to spend money.
- Treat `.data/workforce.db` as sensitive: it holds contracts, memory and the
  full audit trail.
- Do not point the owner-gated handlers at anything real.
