---
name: agent-contracts
description: This skill should be used when the user asks to "define an agent contract", "build an agent factory", "version agent definitions", "validate agent configuration", "let agents create agents", or mentions agent lifecycle, contract validation, agent templates versus instances, or governed agent creation at scale.
---

# Agent Contracts

An agent is a contract, not a prompt. The contract is the durable record of what an agent is, what it may do, and what it costs — and it is the surface every runtime check reads. A system whose agents are defined by prompts can only ask agents to behave; a system whose agents are defined by contracts can enforce it.

This distinction becomes load-bearing the moment agents create other agents. At that point "who authorised this behaviour" must be answerable months later, and only a versioned, validated, approved artifact can answer it.

## When to Activate

Activate this skill when:
- Agents must be created, versioned, or retired programmatically rather than hand-written
- An agent population is large enough that per-agent review does not scale
- One agent proposes or configures another agent
- Agent behaviour must be auditable after the fact ("what exactly was approved?")
- The same agent definition must be reused across projects or tenants
- Duplicate or drifting agent definitions are accumulating

## Core Concepts

**A contract is the enforcement surface.** Tools, budgets, memory scope, concurrency, and escalation are read from stored contract fields by code the agent cannot reach. Anything expressed only in the system prompt is advice, and a sufficiently confused model will route around advice.

**Definition is not instance.** An `AgentTemplate` (with its versioned contracts) is a *kind* of agent; an `AgentInstance` is a live worker holding concurrency and budget. Ten thousand definitions cost ten thousand rows. Ten thousand instances cost real resources. Conflating them makes elastic scaling impossible to express — see workforce-elasticity.

**Validation is a gate, not a lint.** A contract that fails validation must not be able to reach an active state by any path. This is the difference between a validator and a warning.

**Contracts are immutable after draft.** Improvement produces a new *version* that re-enters the pipeline. Mutating an approved contract destroys the only record of what the approval covered.

## Detailed Topics

### What a contract must carry

Group fields by who reads them. Fields nothing reads are decoration and should be deleted.

| Group | Fields | Read by |
|---|---|---|
| Identity | id, template_id, version, name, role, level, parent | registry, hierarchy |
| Purpose | mission, responsibilities, owned workflow loops, inputs, outputs, output_schema, capabilities | planner, quality gates |
| Scope & authority | project scope, knowledge domains, tools, permissions, forbidden actions | permission engine, tool gateway |
| Policies | memory, context, model, budget, runtime limits, retry, quality | runtime, router, governor |
| Governance | lifecycle state, created_by, approved_by, approved_at, audit metadata | audit, approvals |

Two fields do disproportionate work:

**`capabilities`** — named things this agent provides. This is what a planner matches against when deciding whether a new agent is needed. Without it, every request produces a new agent and the population grows without bound.

**`output_schema`** — what the agent promises to return. This is what a quality gate validates against. An agent with no declared output cannot be judged, only trusted.

### The lifecycle

```
DRAFT ──> VALIDATION ──> TESTING ──> APPROVAL ──> ACTIVE
  ^            │            │           │           │
  └────────────┴────────────┴───────────┘     ┌─────┼──────┬─────┐
       (failure returns to DRAFT)             │     │      │     │
                                        OBSERVATION │   PAUSED  RETIRED
                                              │ IMPROVEMENT     MERGED
                                              └─────┴──> VALIDATION
```

Design the transition table so that the active state has exactly one predecessor. Then "an invalid contract can never become active" is a property of the graph rather than a rule someone must remember, and it can be *proved*: delete the approval state from the table and confirm the active state becomes unreachable from draft.

Post-activation states matter as much as the promotion path. `OBSERVATION` is where a newly active agent is watched before being trusted at volume. `IMPROVEMENT` must route back to `VALIDATION`, never straight to `ACTIVE` — a revised contract is a new contract.

### Validation rules that earn their place

Write rules against threats, not style. A rule that cannot name what it prevents is noise.

```python
def validate(contract, known_tools, known_permissions):
    report = Report()

    # Authority: reject permissions that would let an agent rewrite its own limits.
    for permission in contract.permissions:
        if permission in FORBIDDEN_PERMISSIONS:
            report.error("forbidden_permission", permission)
        elif permission not in known_permissions:
            report.error("unknown_permission", permission)   # typos fail closed

    # Coherence: a contract that both grants and forbids an action is ambiguous,
    # and ambiguity in a security decision resolves badly under pressure.
    for overlap in set(contract.permissions) & set(contract.forbidden_actions):
        report.error("permission_conflict", overlap)

    # Ceilings: no contract may exceed system caps it does not control.
    if contract.runtime.max_spawn_depth > SYSTEM_CAPS["max_spawn_depth"]:
        report.error("runtime_over_cap", "max_spawn_depth")

    # Arithmetic: a per-task budget above the lifetime budget makes the
    # lifetime budget decorative — one task could consume it entirely.
    if contract.budget.per_task_cost > contract.budget.total_cost:
        report.error("task_budget_exceeds_total")

    # Level discipline: low-level workers execute, they do not build subtrees.
    if contract.level <= SPECIALIST and contract.runtime.max_spawn_depth > 1:
        report.error("low_level_deep_spawn")

    return report
```

Separate **errors** (block promotion) from **warnings** (recorded, surfaced, do not block). A validator that blocks on style creates pressure to bypass validation, and a bypassed validator protects nothing.

### System caps

Some ceilings must not be settable from inside a contract: maximum spawn depth, maximum instances, maximum concurrency, maximum cost. Keep them in system configuration and validate contracts against them. If a contract can raise its own ceiling, the ceiling is a suggestion.

### Content hashing and duplicate detection

Hash the *behaviour-defining* subset of the contract — excluding id, version, timestamps, author, and approval metadata. Two contracts describing identical behaviour then hash identically regardless of who wrote them or when.

This turns duplicate detection into an indexed equality check instead of fuzzy comparison, which matters when a planner is proposing agents continuously and nobody is reading every proposal.

## Practical Guidance

**Make defaults the safe values, not the typical ones.** A contract nobody tuned must be the most constrained one, not a convenient one. Coordinating agents opt *up* explicitly.

**Derive validator vocabularies from the engines that implement them.** If the validator has its own list of valid quality gates and the quality engine has another, they will drift, and the failure is silent in both directions.

**Store lifecycle state in one place.** If the state lives both in a column and inside a serialised spec blob, they will disagree after the first transition. Treat the column as authoritative and the embedded copy as a snapshot.

**Require approval at exactly one point.** Promotion to active is where a new autonomous worker starts consuming budget and holding tools — every other transition is bounded by limits an already-approved contract declared.

## Examples

**Rejecting a privilege-escalation attempt at draft time:**

```
Input:  contract.permissions = ("task.execute", "governance.permissions.write")
Output: [error] forbidden_permission @ permissions:
        'governance.permissions.write' may never be granted to an agent
        -> contract stays in DRAFT; no path forward exists
```

**Detecting a duplicate agent:**

```
Input:  two ACTIVE contracts, different names and authors
Output: identical content_hash a9b645b2...
        -> same agent under two names; recommend merge
```

## Guidelines

1. Every field in the contract is read by some enforcement path, or it is deleted
2. The active state has exactly one predecessor in the transition table
3. Validation runs again at promotion, not only at draft — registries change
4. Contracts are immutable after leaving draft; improvement creates a version
5. Content hashes exclude audit metadata so duplicates are detectable
6. Defaults are the most constrained configuration, not the most convenient
7. Validator vocabularies are derived from the engines, never restated
8. System caps live outside the contract and are validated against

## Gotchas

1. **Defaults that fail their own validator**: A default configuration that cannot pass validation makes every untuned contract unusable, and the failure appears at first use rather than at design time. Validate the default-constructed contract in the test suite — a lowered default spawn depth was the fix in one measured case.
2. **Validator and engine vocabularies drift**: When the validator keeps its own list of valid gate or permission names, a capability implemented in the engine gets rejected by the validator (or worse, a name the engine cannot execute gets accepted and always fails). Derive one from the other; never maintain both.
3. **Content hash includes audit fields**: Including created_by or timestamps in the behaviour hash makes every contract unique, and duplicate detection silently returns nothing forever. Nothing errors; the feature just stops working.
4. **Approval covers a contract that then changes**: If contracts stay mutable after approval, the audit trail records approval of something that no longer exists. Make immutability structural, not procedural.
5. **Level is treated as authority**: Raising an agent's level to "let it do more" grants reach, not rights, and conflating the two produces a permission model that quietly collapses. Keep level checks and capability checks separate — see agent-permissions.
6. **Warnings promoted to errors over time**: Each individually reasonable tightening eventually makes the validator so strict that teams route around it. Keep the error set tied to threats, and let warnings stay warnings.
7. **Serialised spec drifts from its state column**: Reading lifecycle state from an embedded JSON snapshot returns the state at write time, not now. Prefer the column and overwrite the snapshot's copy on load.
8. **Testing only the happy path of the state machine**: The valuable assertion is that illegal transitions are *impossible*, which requires enumerating the graph rather than walking one successful path through it.

## Integration

- agent-permissions - Contracts declare permissions; the permission engine enforces them
- work-packets - Contract policies bound what a delegated packet may carry
- workforce-elasticity - Contracts are definitions; instances are what scale
- cost-governance - Budget and runtime policy fields are read by the governor
- quality-enforcement - The output schema and quality policy drive gate verdicts
- multi-agent-patterns - Contracts formalise the roles that pattern describes
- evaluation - Evaluation measures whether a contract's KPIs are being met

## References

- [Contract validator](./scripts/contract_validator.py) - Runnable contract schema, validation rules, and lifecycle machine
- Worked implementation: `examples/agent-factory-runtime/af/contracts/`

---

## Skill Metadata

**Created**: 2026-09-01
**Last Updated**: 2026-09-01
**Version**: 1.0.0
