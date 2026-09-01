# CURRENT_STATE.md — Phase 0 Audit

**Date:** 2026-09-01
**Auditor:** Chief Agent Architect (R&D session, branch `claude/agent-factory-v04-8ld5em`)
**Scope:** Full repository audit prior to AI Agent Factory v0.4 implementation.

---

## 0. Headline finding: the assumed v0.3 baseline does not exist

The v0.4 build mandate states the repository "already contains the current AI Agent Factory
work, including MASTER_BUILD_PROMPT.md, existing v0.3 runtime, Agent Registry, Chief Agent
Architect concept/runtime, permissions and governance concepts, task execution, memory
foundation, audit/events, approval foundation, tool gateway foundation."

**None of that is present.** Verified by exhaustive search of the working tree and of git
history on both `main` and `origin/claude/agent-factory-v04-8ld5em` (the branches are
identical; the feature branch carries zero commits beyond `main`).

| Asserted artifact | Present? | Evidence |
|---|---|---|
| `MASTER_BUILD_PROMPT.md` | **No** | No file matching `*MASTER*` or `*BUILD_PROMPT*` anywhere |
| v0.3 runtime | **No** | No service, server, worker, or entrypoint module of any kind |
| Agent Registry | **No** | No file matching `*registry*` |
| Chief Agent Architect runtime | **No** | No matching module or symbol |
| Permissions / governance | **No** | No permission, capability, or policy code |
| Task execution | **No** | No queue, scheduler, or executor |
| Memory foundation | **Conceptual only** | See §2 — a teaching script, not a runtime |
| Audit / events | **No** | No event bus, no audit log, no event schema |
| Approval foundation | **No** | No approval or token code |
| Tool gateway foundation | **No** | No gateway, no tool risk model |
| SQLite runtime (§9 of the mandate) | **No** | `grep` for `sqlite3`/`psycopg`/`CREATE TABLE` across all `.py`/`.ts`/`.sql`: **zero hits repo-wide** |

There is no database, no persistence of any kind, no network service, and no long-running
process anywhere in this repository.

**Consequence for v0.4:** this is a **greenfield build**, not a refactor. Sections of the
mandate that presuppose an existing implementation are reinterpreted accordingly:

- "Evaluate whether SQLite should remain only for local development" becomes a forward-looking
  storage decision (recorded as ADR-0002) rather than an evaluation of running code.
- "Refactor or replace weak parts of v0.3" has no referent. Nothing is being replaced.
- The Definition of Done is unchanged and remains the binding acceptance criterion.

This is stated plainly because the final performance report must not imply that v0.4
improved on a measured predecessor. **There is no baseline to compare against.** All v0.4
numbers are absolute first measurements.

---

## 1. What this repository actually is

`Agent Skills for Context Engineering` — a documentation and teaching collection of 14 Agent
Skills covering context engineering for AI agent systems, plus 5 example projects. It is
distributed as a Claude Code plugin / Open Plugins package. It is a **knowledge artifact**,
not a software platform.

```
skills/       14 skill dirs (SKILL.md + optional references/ + scripts/)  ~3.6k lines of Markdown
examples/     5 demonstration projects (2 with real tooling)
docs/         9 research/reference Markdown files
researcher/   2 research output examples
template/     canonical SKILL.md template
```

### What works

- **The skills themselves.** Well-structured, consistent frontmatter, good progressive-disclosure
  discipline. These are the repository's actual value and v0.4 must not disturb them.
- **`examples/llm-as-judge-skills`** — TypeScript, Node >= 18, real toolchain (tsc, vitest, eslint,
  prettier), 19 tests. The only example with production-shaped engineering.
- **`examples/interleaved-thinking`** — Python >= 3.10, pytest + ruff, packaged with `pyproject.toml`.
- **Plugin manifests** (`.claude-plugin/marketplace.json`, `.plugin/plugin.json`) are coherent;
  the single-plugin consolidation (commit `81f3336`) correctly avoids per-plugin cache duplication.

### What is prototype-only

All 13 `skills/*/scripts/*.py` files (~7.2k lines total). Every one is a **pedagogical
in-process demonstration**:

- No persistence — all state is Python dicts, lost on exit.
- No concurrency — synchronous, single-threaded.
- No failure handling beyond illustrative `try`/`except`.
- No security boundary, no authentication, no authorization.
- Several carry `if __name__ == "__main__"` demo blocks as their only exercise path.
- Only 1 of 13 has tests (`context-compression`).

They are correct as teaching material and should stay as they are. They are **not** reusable
runtime components.

---

## 2. Reusable components assessment

Assessed honestly against v0.4 requirements. "Reusable" means *importable into the runtime*,
not *conceptually informative*.

| Component | Runtime-reusable | Notes |
|---|---|---|
| `memory-systems/scripts/memory_store.py` (616 ln) | **No** | Requires `numpy`; in-memory dicts; no retention, provenance, trust level, or project scope. The v0.4 six-layer memory model needs all of those. **Concepts reused, code not.** |
| `multi-agent-patterns/scripts/coordination.py` (613 ln) | **No** | `SupervisorAgent`, `HandoffProtocol`, `CircuitBreaker` are single-process and unpersisted. The circuit-breaker *state machine* informed the v0.4 retry/DLQ design. |
| `evaluation/scripts/evaluator.py` (627 ln) | **Partially — as a model** | The rubric-dimension → weighted-score shape maps well onto v0.4 Quality Gates. Reimplemented against the v0.4 schema rather than imported. |
| `advanced-evaluation/scripts/evaluation_example.py` | **No** | Calls the live Anthropic API; unsuitable for deterministic gates. |
| `tool-design/scripts/description_generator.py` | **No** | Generates docs; no execution, no risk model, no permission. |
| `context-optimization/scripts/compaction.py` | **Concepts only** | Compaction strategy informs working-memory eviction. |

**Verdict: no code is imported from `skills/` into the v0.4 runtime.** The two hard blockers
are the `numpy` dependency and the absence of any persistence contract. Design ideas are
credited in the architecture documents where they applied.

---

## 3. Technical debt (of the existing repository)

Modest, because the repository is mostly prose. Recorded for completeness; **v0.4 does not
attempt to fix these** — they are out of scope and touching them risks the collection.

1. **Test coverage on skill scripts is ~8%** (1 of 13 script dirs has tests). The scripts are
   illustrative, so this is defensible, but drift between a skill's prose and its script is
   currently undetectable.
2. **No CI.** No `.github/workflows`. Nothing verifies that the TypeScript example builds, that
   the Python example passes, or that skill frontmatter stays valid.
3. **Undeclared dependency.** `memory_store.py` imports `numpy` with no `requirements.txt` or
   `pyproject.toml` in `skills/`. It fails on a clean checkout.
4. **Manifest drift risk.** Skill lists are duplicated across `README.md`, root `SKILL.md`,
   `.claude-plugin/marketplace.json`, and `.plugin/plugin.json` with nothing enforcing agreement.

---

## 4. Security gaps

There is no attack surface today (no service, no data, no credentials), so this section is
**forward-looking**: it enumerates what v0.4 must establish from zero, since none of it exists.

| Requirement | Current state |
|---|---|
| Authn / authz | Absent. No identity concept at all. |
| Project / tenant isolation | Absent. No project concept. |
| Secret handling | No secrets present (good), but also no pattern for handling them. |
| Tool execution sandboxing | Absent. `hosted-agents/scripts/sandbox_manager.py` describes sandboxing; it does not implement it. |
| Model output validation | Absent. Example scripts trust model output directly. |
| Audit trail | Absent. |
| Privilege escalation controls | Absent. |

The one concrete hazard worth naming: `examples/llm-as-judge-skills` and
`advanced-evaluation` read `ANTHROPIC_API_KEY` from the environment. No key is committed
(verified), and `.gitignore` covers `.env`. That pattern is fine and v0.4 follows it —
**secrets by reference, never in source, never in a prompt.**

---

## 5. Scalability risks

Nothing here scales because nothing here runs. The risks below are the ones v0.4's
architecture must answer, derived from the mandate rather than from measured behaviour:

1. **Single-writer storage.** SQLite serialises writes. Under many concurrent workers the
   write lock becomes the throughput ceiling. Addressed in ADR-0002 and measured in the
   benchmark suite rather than assumed.
2. **Queue contention.** A naive `SELECT ... WHERE status='pending'` claim pattern causes
   thundering-herd and duplicate delivery. v0.4 uses leased claims with an atomic
   compare-and-set.
3. **Unbounded recursion.** An agent that can create agents can exhaust the system. Spawn
   depth, fan-out width, and per-tree budgets must be enforced *before* execution, not after.
4. **Provider rate limits vs. control-plane limits.** These are different ceilings and
   conflating them would make benchmark numbers meaningless. The benchmark suite separates
   them explicitly and uses deterministic mock workers for control-plane measurement.
5. **Unbounded event/audit growth.** Full traceability implies high write volume. Needs a
   retention and partitioning strategy from day one.

---

## 6. Recommended approach for v0.4

1. **Build greenfield, fully self-contained under `agent-factory/`.** The skills collection is
   this repository's published product; the runtime must not entangle with it. Everything v0.4
   adds lives in one directory and is removable without trace.
2. **Zero third-party dependencies in the runtime core.** The environment has no packages
   pre-installed. A stdlib-only core (asyncio, sqlite3, dataclasses) means the test and
   benchmark suites run anywhere, which is the difference between a benchmark suite that gets
   run and one that gets described. Dependencies are permitted in the *adapter* layer.
3. **Ports and adapters throughout.** Store, queue, event bus, and model provider are each an
   interface with a SQLite/in-process implementation. This is what makes the eventual
   PostgreSQL/Redis migration a swap rather than a rewrite.
4. **Deterministic mock model provider as the default.** Benchmarking the control plane must
   not require paid model calls, and quality gates must be reproducible.
5. **Enforce governance in the runtime, not in prompts.** Permissions, budgets, and approvals
   are checked by code paths an agent cannot reach. A prompt instruction is not a security
   control.

Proceeding to Phase 1 (architecture) and Phase 2 (implementation) on this basis.
