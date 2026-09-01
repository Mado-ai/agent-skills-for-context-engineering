# Changelog

## v0.4.0 — pre-production governed runtime

First runtime build. There was no v0.3 codebase to upgrade: the repository
audit found documentation and skills, no runtime, so v0.4 was built greenfield
under `workforce-os/`.

**Not deployable.** No Owner authentication; owner-gated effects are simulated.
`docs/V04_SECURITY.md` §5 lists the blockers.

---

### Domain and persistence

- Zod schemas for every runtime object: agent contracts, work packets, memory
  records, quality gates and evaluations, CAPA, approvals and tokens, budgets
  and usage, tool definitions and calls, events, jobs.
- 23 entities across four versioned SQL migrations. Application-generated
  time-sortable ids, so the audit tables need no sequence and stay portable.
- Migration runner with per-migration checksums. Editing an applied migration
  is a hard error, not a warning.
- `node:sqlite` for local development — no native build step, no service.
- Seed data separate from schema: a bootstrap organisation of 3 projects,
  3 workflow loops, 5 templates, the Chief, 3 masters, budgets, authoritative
  memory and credential *references*.

### Agents

- Versioned, immutable contracts covering all 27 fields the specification
  requires.
- Lifecycle `draft → validated → testing → approved → active → paused →
  merged/retired`, with transitions enforced centrally.
- **Activation gate**: no agent becomes active without a passing validation and
  a passing test run. The test run exercises the real policy engine, including
  the negative cases — an unlisted tool, an out-of-scope project, each
  forbidden action.
- Validation catches authority escalation against the parent: role, access
  level, tools, project scope, derived scopes, memory layers, child templates.
- Templates (definitions) separated from instances (runtime), with concurrency
  limits, idle reaping and merge/retirement recommendations.

### Tool Gateway and policy

- One authorization point, default deny, ordered checks recorded on every
  decision so a denial names the rule that fired.
- Tool schemas live in the database and are enforced from there, so the
  governance record and the thing enforced are the same object.
- Every call audited before execution and again on settlement.
- **No shell, filesystem-write or arbitrary-code tool is registered**, and a
  test enumerates the catalogue to keep it that way.
- `dryRun` gives the same verdict without side effects; the activation tests
  and the UI both use it.

### Delegation

- Typed `WorkPacket`s as the only control channel — no free-form agent chat.
- A packet can never carry authority its sender lacks; `allowed_tools` narrows
  and never widens.
- Elastic specialist instantiation, clamped to the parent's envelope before
  validation, capped per parent, reaped when idle.

### Memory

- Four layers — working, episodic, project, authoritative — with precedence.
- Mandatory provenance; confidence on anything inferred; supersession chains;
  TTL sweeping for working memory.
- Agents cannot launder an inference into a fact: an authoritative write needs
  the contract grant *and* human-sourced or Owner-approved provenance.
- Reads are scope-bound in the repository; an out-of-scope read is a denial,
  not an empty list.

### Quality

- Gates as data: checks, threshold, blocking, separation of duties.
- Six checks; five deterministic. A criterion nobody can check automatically
  does not silently pass.
- Runtime loop: execute → evaluate → rework → escalate.
- CAPA records on repeated failure, and a CAPA cannot close without a root
  cause, both actions and a verification result.

### Approvals

- Seven owner-gated action classes.
- Execution tokens bound by fingerprint to action, arguments, actor and
  project; single-use, short-lived, stored only as a hash.
- Distinct codes for every failure mode, so a replay is distinguishable from an
  expiry in the audit trail.
- An Owner token does not permit self-mutation: `policy.update` still refuses
  an agent targeting its own contract.

### Budgets, scheduler, telemetry

- Budgets at project, agent and task scope over model calls, tokens, cost, tool
  calls, executions, retries and elapsed time.
- Pre-flight checks; the most restrictive scope wins; a hard limit pauses and
  escalates rather than continuing quietly.
- Durable job queue with conditional-UPDATE claiming; one-shot, interval and
  event-triggered work behind a narrow interface built to be replaced.
- Append-only telemetry enforced by both the interface and the database.

### Chief Agent Architect

- System-wide situation reporting.
- **Mechanical skepticism**: findings derive from registry, budget, quality and
  approval state with no model call, so they cannot be talked out of.
- Team proposals filtered against what the Chief may actually instantiate; a
  hallucinated template never reaches the Owner as an option.
- Acts only through the Tool Gateway, on its own contract, so it cannot bypass
  an Owner gate.
- Merge and retirement recommendations with the evidence behind each.

### API and Control Center

- 78 routes, one error envelope, status codes that separate "you may not" (403)
  from "a human must decide" (428).
- Fifteen views on real backend state, no optimistic updates.
- Loopback-only by default; refuses any other bind without a token.

### Model provider

- Provider interface with a deterministic offline default. The entire build,
  including every test, runs without paid API access.
- Thin Claude adapter over the official SDK as an optional dependency, lazily
  imported, not exercised by the test suite.

### Fixed while building

Found by the tests, or by auditing the handlers against the policy engine:

- The gateway validated arguments before deciding authorization, letting an
  unauthorized caller learn a tool's schema. Authorization now comes first.
- Packets and tasks had no legal path from their pre-start states to
  `escalated`, so a budget denial died on a lifecycle error that masked the
  real cause.
- **`memory.write_authoritative` forged human provenance.** The handler
  hard-coded `origin: 'human'` from the caller's `source` argument, which
  defeated the rule it was supposed to uphold: an agent could launder its own
  inference into canonical fact. The handler now records the write as an agent
  write, so the memory service requires a granted Owner approval among the
  evidence references.
- **Three handlers reached projects the policy engine never checked.**
  `task.create` acted on `args.project_id`, and `quality.evaluate` and
  `report.compose` acted on whatever project a supplied task belonged to, while
  the gateway had authorized against the project on the *request*. All three
  now re-check scope for the project they actually resolved.
