# AI Workforce OS v0.4 — Test Report

Results below are from an actual run, not an expectation. Reproduce with
`npm run typecheck && npm test && npm run smoke`.

**Environment**: Node v22.22.2, Linux x64, `node:sqlite` in-memory per suite,
`DeterministicMockProvider`. **No network access and no API key were used.**

---

## 1. Results

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **PASS** — 0 errors, strict mode with `noUncheckedIndexedAccess` |
| Unit and integration | `npm test` | **PASS** — 184 passed, 0 failed, 0 skipped (12 files, ~6s) |
| End-to-end smoke | `npm run smoke` | **PASS** — 15/15 steps, from a fresh database |

### By suite

| Suite | Tests | Covers |
|---|---:|---|
| `contracts.test.ts` | 20 | Contract validation, authority bounds, lifecycle, activation gating, immutability |
| `api.test.ts` | 21 | Route regressions, error envelope, status codes, auth posture |
| `approvals.test.ts` | 17 | Request, decision, token issue/use/expiry/replay/revocation |
| `delegation.test.ts` | 17 | Packet lifecycle, delegation bounds, dynamic instantiation, reaping |
| `security.test.ts` | 21 | One test per security property the runtime claims, plus handler-level scope enforcement |
| `chief.test.ts` | 15 | Situation reporting, mechanical skepticism, proposals, gateway-bound actions |
| `memory.test.ts` | 14 | Four layers, precedence, scope, provenance, supersession, TTL |
| `gateway.test.ts` | 13 | Authorization, schema validation, audit, dry-run, tool catalogue |
| `budgets.test.ts` | 12 | Limits, soft/hard behaviour, roll-up, escalation, append-only usage |
| `quality.test.ts` | 12 | Gates, rework, escalation, CAPA, separation of duties |
| `scheduler.test.ts` | 12 | One-shot, interval and event jobs, claiming, retries, loop triggering |
| `persistence.test.ts` | 10 | Migrations, checksum drift, FKs, CHECKs, transactions, secret-free schema |
| **Total** | **184** | |

---

## 2. Coverage against the specification

Every testing requirement in the brief, with where it is covered.

| Required | Covered by | Status |
|---|---|---|
| Agent contract validation | `contracts.test.ts` — 12 validation cases including every escalation class | ✅ |
| Lifecycle transitions | `contracts.test.ts` — legal transitions, both activation gates, revision-to-draft | ✅ |
| Permission denial | `gateway.test.ts`, `security.test.ts` — allowlist, disabled, forbidden, access level | ✅ |
| Scope isolation | `security.test.ts`, `memory.test.ts`, `gateway.test.ts` — tool, memory and delegation paths | ✅ |
| Dynamic child creation limits | `delegation.test.ts` — template permission, project scope, per-parent cap, per-agent concurrency | ✅ |
| Work packet lifecycle | `delegation.test.ts` — full walk, illegal transitions, narrowing, TTL expiry | ✅ |
| Task execution | `delegation.test.ts`, `quality.test.ts` — execute, deliver, status routing | ✅ |
| Quality pass / rework / failure | `quality.test.ts` — accept, rework, escalate, schema and provenance failures | ✅ |
| CAPA generation | `quality.test.ts` — auto-open on repeat failure, close preconditions | ✅ |
| Approval request/token/use/expiry/replay | `approvals.test.ts` — 17 tests covering every failure mode separately | ✅ |
| Memory precedence and scope | `memory.test.ts` — precedence, cross-project denial, supersession direction | ✅ |
| Budget enforcement | `budgets.test.ts` — pre-flight, hard/soft, most-restrictive-scope, pause | ✅ |
| Tool gateway checks | `gateway.test.ts` — all nine ordered checks, audit on both paths | ✅ |
| Chief delegation with a deterministic provider | `chief.test.ts` — proposals, filtering, gateway-bound delegation | ✅ |
| API regressions | `api.test.ts` — envelope, codes, path traversal, token posture | ✅ |
| Suite runs without paid API access | Every suite uses `DeterministicMockProvider`; no test opens a socket to a model provider | ✅ |

### Security properties

Each is a named test in `security.test.ts`:

| Property | Result |
|---|---|
| Default deny | ✅ including the strongest form — an empty allowlist denies every catalogued tool, enumerated |
| Project isolation | ✅ tool calls, memory reads, and cross-master delegation |
| Parent cannot delegate authority it lacks | ✅ at delegation and at validation |
| Inactive/retired agents cannot execute | ✅ paused, retired, and never-activated |
| Expired token cannot execute | ✅ |
| Token cannot be replayed | ✅ different args, different tool, different agent, second use |
| Unlisted tool blocked | ✅ |
| Authoritative write requires permission | ✅ grant *and* provenance, tested separately |
| Agent cannot alter its own contract | ✅ via the registry and via `policy.update` with a valid Owner token |
| Audit remains append-only | ✅ interface shape asserted, plus database triggers |
| Handlers cannot reach an unchecked project | ✅ `task.create`, `quality.evaluate`, `report.compose` each tested across a project boundary |
| Authoritative provenance cannot be forged | ✅ tested with a valid execution token in hand |

---

## 3. What is *not* tested

Stated plainly, because a coverage claim without this is not worth much.

1. **The Claude provider adapter.** `AnthropicProvider` needs a real API key.
   It is compiled and typechecked but never executed by the suite. Its request
   shape is written against current API documentation; treat it as unverified
   until someone runs it.
2. **Concurrency across processes.** Job claiming and token consumption use
   conditional UPDATEs that are correct in principle, and single-process races
   are exercised. Multi-process contention on one SQLite file is not.
3. **Scale.** The design targets 1,000+ specialist definitions with elastic
   execution. The largest tested population is a few dozen agents. Nothing here
   validates the performance claim.
4. **PostgreSQL.** The schema is written to port and the path is documented.
   The migration has not been run.
5. **The Control Center's JavaScript.** Verified by driving a real browser
   against a running server — all 15 views render from live state with zero
   console errors — but there are no automated UI tests in the suite. A
   regression in `app.js` would not fail `npm test`.
6. **Long-running behaviour.** TTL expiry, idle reaping and approval lapse are
   tested by passing an explicit future timestamp rather than by waiting. Clock
   skew and long-uptime behaviour are untested.
7. **Adversarial model output.** The mock provider is cooperative. Nothing
   tests a provider that returns malicious payloads, though schema validation
   and quality gates bound the damage.
8. **Load and failure injection.** No chaos testing, no disk-full, no partial
   write.

---

## 4. Bugs found while building

Six real defects, all fixed. Three came from tests failing; three from
auditing the tool handlers against what the policy engine actually checks.

### Found by tests

1. **Schema feedback leaked before authorization.** The gateway validated
   arguments against the tool's declared schema *before* deciding
   authorization, so an unauthorized caller could learn a tool's shape by
   probing it. Authorization now runs first. Found by an API test expecting 403
   and getting 400.
2. **A packet that could not start had no path to escalation.**
   `PACKET_TRANSITIONS` omitted `dispatched -> escalated`, so a budget denial
   during execution died on a lifecycle error that *masked the real cause*.
   Escalation is now reachable from every live packet state. Found by
   `escalates rather than continuing when execution would exceed a hard limit`.
3. **Tasks had the same gap** from `pending` and `assigned`. Same fix, found by
   the same test once the packet fix landed.

The second and third are the useful kind: the system did the right thing
(refused to overspend) and then reported the wrong reason.

### Found by auditing handlers against the policy engine

The pattern in all three: **the gateway authorizes against the project on the
request, and a handler then acted on a different one it resolved from its own
arguments.**

4. **`memory.write_authoritative` forged human provenance.** The handler
   hard-coded `origin: 'human'` using the caller's `source` argument, which
   defeated the exact rule it was meant to uphold — an agent could launder its
   own inference into canonical fact by passing `source: "owner"`. The handler
   now records the write as the agent write it is, so the memory service
   requires a granted Owner approval among the evidence references. Migration
   004 brings the catalogue entry in line and makes `evidence_refs` required.
5. **`task.create` acted on `args.project_id`**, unchecked, so an agent could
   authorize against a project it held and create a task in one it did not.
6. **`quality.evaluate` and `report.compose`** resolved a task from arguments
   and acted on that task's project — reading another project's artifact
   content through evaluation results, or writing an artifact into another
   project's task.

All three now route through a `requireProjectScope` guard, and each has a test
that exercises the crossing directly.

Worth noting what the audit *also* found: `memory.write_authoritative` was
already gated by the gateway on risk class alone, since its `high` class meets
the default approval threshold. The provenance hole was therefore reachable
only by an agent whose contract set a laxer threshold — but that threshold is a
contract field, so relying on it was the wrong defence. Both layers now hold
independently, and there is a test for each.

---

## 5. Manual verification

Beyond the automated suite:

- **Control Center**, driven with Playwright against a live server: all 15
  views render from real backend state, no console errors, no view stuck
  loading.
- **Fresh-checkout path**: `npm install && npm run migrate && npm run seed`
  from an empty `.data/` produces 3 projects, 3 loops, 5 templates and 4
  active agents — each of which walked the full validation → test → activate
  gate during seeding.
- **Offline confirmation**: the suite runs with no `ANTHROPIC_API_KEY` set and
  makes no outbound request.
