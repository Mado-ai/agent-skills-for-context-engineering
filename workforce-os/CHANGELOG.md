# Changelog

## 0.4.0 — pre-production runtime

### Provenance

The project brief described evolving an existing "AI Agent Factory Runtime v0.3" and
implementing `docs/claude/V04_BUILD_SPEC.md`. **Neither was present.** The session's
repository (`agent-skills-for-context-engineering`) is a Skills collection containing no
Python runtime, no SQLite persistence, no agent registry and no `docs/claude/`; the
designated branch was identical to `main`, and none of the other repositories reachable
from the session held the runtime either.

The Owner chose to build v0.4 greenfield here. The build spec and acceptance criteria in
`docs/claude/` were therefore **authored as part of this work** from the project
instructions, rather than being received as inputs. No baseline functionality was
discarded, because none existed to migrate.

### Added

**Governance kernel**
- Authority model with Owner primacy, a single active Chief Agent Architect, and levels
  L1–L5 that convey visibility and orchestration breadth but never tool scope.
- Deny-by-default scope checking across six independent gates: agent status, project,
  tool registration, contract tools, action types and data domains.
- Conservative risk classification driving an Owner approval requirement.

**Agent Builder and contracts**
- Validated contracts with field-level errors, content-addressed by checksum.
- Append-only versioning enforced by database triggers, with checksum verification on
  every read, plus rollback to any prior version.
- Lifecycle `draft → active ⇄ paused → retired`, with retirement terminal.

**Delegation and instantiation**
- Parent/child delegation graph enforcing same-project, strictly-downward delegation,
  scope attenuation, cycle rejection, and a depth cap that binds the entire chain
  beneath the agent that sets it.
- Typed, schema-validated inter-agent work packets.
- Agent templates with dynamic specialist instantiation, attenuated to the instantiating
  agent's own scope and budget.

**Execution controls**
- Per-agent and per-task budgets over USD, tokens and call count, enforced pre-flight
  with a reconciling ledger.
- Hardened Tool Gateway recording every call — allowed or denied — with a reason code.
- Owner approval flow with single-use tokens bound to agent, tool and argument hash,
  stored hashed and expiring.

**Knowledge and quality**
- Three memory layers (working, episodic, semantic) with mandatory provenance and
  project-isolated reads.
- Quality evaluator with an automatic rework loop, CAPA records past the failure
  threshold, and a completion gate while a CAPA is open. Self-evaluation is refused.

**Platform**
- SQLite persistence with numbered, checksum-verified migrations.
- Append-only, hash-chained audit trail with an integrity verification endpoint.
- Cost and latency telemetry aggregated by project, agent and task.
- Event bus and durable scheduler abstractions with exactly-once job claiming.
- Provider adapter interface plus a deterministic local adapter (offline by default).
- Standard-library HTTP API with an explicit route table, and a browser dashboard.
- 110 automated tests, including durable security-boundary tests.

### Deliberate limitations

- No external execution by agents: no shell, browser or network access. The one
  `transact` tool records an Owner-approved intent and returns `confirmed=False`, so the
  runtime reports it as `attempted` rather than claiming it happened.
- Agent-acting API routes currently require the Owner credential; agents run in-process
  and there is no separate agent credential yet.
- Only the local provider adapter ships.
- Not deployed or published — the build stops at a locally validated pre-production
  state, as instructed.
