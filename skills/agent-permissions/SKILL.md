---
name: agent-permissions
description: This skill should be used when the user asks to "restrict what an agent can do", "add human approval to an agent", "prevent agents from escalating privileges", "isolate tenants in an agent system", "design agent permissions", or mentions capability-based access, owner-gated actions, execution tokens, least privilege for agents, or multi-tenant agent isolation.
---

# Agent Permissions

Authority in an agent system must be read from durable records and enforced by code paths the agent cannot reach. Nothing a model emits may be an input to an authority decision.

This is the single rule that makes everything else work. A prompt instruction is a suggestion to a model, and a model that has been prompt-injected through retrieved content or a tool result will follow the injection instead. Permission checks that live in prose are not controls; they are documentation of intent.

## When to Activate

Activate this skill when:
- Agents can take actions with consequences outside the conversation
- A human must approve some agent actions but not others
- Multiple tenants, projects, or customers share one agent system
- An agent can create, configure, or delegate to other agents
- Designing which actions require human sign-off and which do not
- An agent must be prevented from expanding its own authority

## Core Concepts

**Level is reach, not authority.** Seniority widens what an agent can *see and coordinate*. It grants nothing. Authority comes from an explicit capability grant. Conflating the two produces a model where "make it more senior so it can do X" quietly becomes the escalation path.

**Some capabilities belong only to humans.** Mark them owner-gated and make them unsatisfiable for any principal of kind `agent` — at any level, holding any grant, in any project. Not "checked carefully"; unreachable.

**An approval is a token, not a promotion.** Approving one action must never change what the agent may do afterwards. Mint a single-use credential bound to that exact action and let the agent's standing authority stay exactly as it was.

**Isolation is a per-resource predicate.** Check the project of the *thing being touched* on every authority check, not once at session start. Access to project A must never imply access to project B, and that must be true by construction rather than by discipline.

## Detailed Topics

### Principals

Three kinds, and the distinctions carry weight:

| Kind | Who | Owner-gated capabilities |
|---|---|---|
| `owner` | The human | **All** — the only holder |
| `agent` | Every AI agent, including the most senior | **None**, at any level |
| `system` | Schedulers, reapers, retention sweeps | **None** — the runtime is not the owner |

The `system` principal deserves attention because it is where this model usually leaks. Internal machinery needs broad access to do its job, and the tempting shortcut is to make it omnipotent. Do not: anything that can induce the runtime to act on its behalf would then inherit human authority. Grant it everything *except* the owner-gated set.

Construct a principal from the stored contract, never from anything the model produced:

```python
principal = Principal.from_contract(instance_id, stored_contract)
```

An agent that asserts a capability it does not hold changes nothing, because the assertion is never consulted.

### The check

Four independent tests, all of which must pass, in this order:

```python
def check(principal, capability, project_id=None):
    cap = CAPABILITIES.get(capability)
    if cap is None:
        deny("unknown capability")            # typos fail closed

    # 1. Owner gate FIRST, so no combination of level and grants reaches past it.
    if cap.owner_gated and principal.kind is not OWNER:
        deny(f"'{capability}' is owner-gated")

    # 2. Grant: written in the contract, or the principal is the owner.
    if principal.kind is not OWNER and capability not in principal.granted:
        deny("not granted by contract")

    # 3. Level floor: reach must be sufficient.
    if principal.kind is AGENT and principal.level < cap.min_level:
        deny(f"requires level >= {cap.min_level}")

    # 4. Project scope, against the resource's project.
    if project_id is not None and cap.project_scoped:
        check_project(principal, project_id)
```

Ordering matters. Putting the owner gate first means a bug in the grant or level logic cannot expose an owner-only action.

### Choosing what is owner-gated

A capability belongs to the human when it **creates new authority** or **redefines the limits on existing authority**. Everything else operates inside limits some already-approved contract declared.

Typical set:

| Capability | Why |
|---|---|
| activate an agent | Brings a new autonomous worker into existence that consumes budget and holds tools |
| merge or retire agents | Changes the workforce structure |
| raise a budget ceiling | Redefines a spending limit |
| override a quality verdict | Removes the check on output |
| write authoritative knowledge | Defines what the whole system treats as ground truth |
| publish across tenant boundaries | Crosses the isolation boundary |

Keep this list short. Every entry is a human interruption, and a system that interrupts constantly gets its gates removed by the people it interrupts.

### Approvals and execution tokens

An approval request captures what is being asked and why. The decision, if positive, mints a token bound to:

- one approval, one agent, one task, one tool or action
- a **hash of the exact parameters** that were shown to the human
- a use count (one by default) and an expiry

The parameter binding is what closes the substitution attack: getting "email the accountant" approved must not authorise emailing anyone else.

```python
def consume(bearer, agent_id, action, params):
    token_id, _, secret = bearer.partition(".")
    row = load(token_id)

    if not hmac.compare_digest(row.secret_hash, sha256(secret)):
        reject("secret mismatch")
    if row.agent_id != agent_id:      reject("wrong agent")
    if row.action != action:          reject("wrong action")
    if row.params_hash != hash_params(action, params):
        reject("parameters differ from what was approved")

    # Atomic: the guard is in the WHERE clause, so two concurrent
    # redemptions of a single-use token cannot both succeed.
    if update("UPDATE tokens SET uses = uses + 1 "
              "WHERE id = ? AND uses < max_uses AND revoked_at IS NULL") == 0:
        reject("already consumed")
```

Store only a hash of the token secret and compare it in constant time. Return the plaintext exactly once, at mint time. A leaked database then yields no usable tokens.

Refuse self-approval explicitly, even when the owner check already implies it. It costs one line and it survives a future change that widens who may decide.

### Project isolation

Carry the project identifier **directly on every tenant-scoped row**, not reachable only through a join. Then the isolation predicate is a property of the row, which makes it cheap to check everywhere and straightforward to push down into database row-level security later.

Filter in the query, not after it:

```python
# Correct: rows the agent may not see never enter the process.
rows = db.query("SELECT * FROM records WHERE project_id IN (?)", scope)

# Wrong: they existed here, and will be in a log the first time someone debugs this.
rows = [r for r in db.query("SELECT * FROM records") if r.project_id in scope]
```

Cross-project reach is itself a capability, and it must not be project-scoped — checking it per project would be circular.

### Auditing denials

Record every denial *before* raising: capability denials, isolation violations, blocked actions, rejected tokens. A security control nobody can observe cannot be verified, and denial patterns are the earliest signal that an agent is malfunctioning or being manipulated.

Flush audit records synchronously. Buffered audit is lost in exactly the crash you most want to investigate.

## Practical Guidance

**Enumerate capabilities in one table with a description and a level floor.** A capability with no description is one nobody can review; a vocabulary that lives in scattered string literals cannot be audited at all.

**Make forbidden permissions absent, not merely rejected.** Permissions such as "modify own permissions" should not exist in the vocabulary, so that no code path can grant one even by accident.

**Test the maximally privileged agent.** Construct a principal at the highest level holding *every* capability and assert it still cannot cross the owner boundary. That single test is worth more than a dozen narrower ones.

## Examples

**Level does not grant authority:**

```
Input:  L5 agent, contract lists "agent.activate"
Output: PermissionDenied: 'agent.activate' is owner-gated and cannot be
        exercised by a principal of kind 'agent'
```

**Approval does not elevate:**

```
Input:  agent granted {"tool.call"}; owner approves one email; agent sends it
Output: send succeeds once; second attempt -> TokenInvalid (already consumed)
        agent.granted is still exactly {"tool.call"}
```

## Guidelines

1. Principals are derived from stored records, never from model output
2. The owner gate is checked before grant and level, not after
3. Owner-gated capabilities are unsatisfiable for agent principals by construction
4. Approvals mint tokens; they never mutate a principal's grants
5. Tokens are bound to agent, action, and a hash of the approved parameters
6. Token secrets are stored hashed and compared in constant time
7. Project scope is checked against the resource on every authority check
8. Access filtering happens in the query, not after the fetch
9. Every denial is recorded before the exception is raised

## Gotchas

1. **Level used as the escalation path**: When "let it do more" is solved by raising an agent's level, the permission model has already collapsed. Keep level checks and capability checks separate and assert both.
2. **The internal/system principal is made omnipotent**: Granting the runtime every capability creates a trivial backdoor — anything that can get the runtime to act on an agent's behalf inherits human authority. Grant it everything except the owner-gated set.
3. **Approval mutates permissions**: Adding the capability to the agent's grants "so it can proceed" turns a one-time decision into permanent elevation, and nobody ever removes it. Mint a token instead.
4. **Tokens not bound to parameters**: A token valid for "send email" authorises sending *any* email. Bind the parameter hash, or the approval means far less than the human thought it did.
5. **Isolation checked at session start**: Establishing scope once and trusting it afterwards fails as soon as one request touches a resource in another project. Check against the resource, every time.
6. **Post-fetch filtering**: Rows the principal may not see briefly existed in the process, and will eventually appear in a log, an error message, or a cache. Filter in the query.
7. **Unknown capability strings treated permissively**: A typo in a permission name that is silently ignored produces an agent that appears configured and is not. Reject unknown capabilities so mistakes fail closed.
8. **Self-approval left implicit**: Relying on the owner check to prevent an agent approving its own request works until someone widens who may decide. Make it an explicit, separate check.
9. **Audit buffered with everything else**: Batching audit writes for throughput loses precisely the records needed after a crash. Flush audit synchronously and buffer only observability.
10. **Denials that raise without recording**: An exception the caller swallows leaves no trace that an agent attempted something forbidden — which is the signal most worth having.

## Integration

- agent-contracts - Contracts declare the permissions this engine enforces
- tool-governance - The gateway consults this engine before every tool call
- work-packets - Delegation narrows authority; it can never widen it
- cost-governance - Budget ceilings are a parallel limit with the same "cannot raise your own" rule
- agent-observability - Denials and approvals are the highest-value audit events
- hosted-agents - Sandboxing constrains execution; this constrains authorisation

## References

- [Permission engine](./scripts/permission_engine.py) - Runnable capability model, owner gating, isolation, approvals, and single-use tokens
- Worked implementation: `examples/agent-factory-runtime/af/governance/`

---

## Skill Metadata

**Created**: 2026-09-01
**Last Updated**: 2026-09-01
**Version**: 1.0.0
