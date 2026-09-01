---
name: tool-governance
description: This skill should be used when the user asks to "control which tools an agent can call", "classify tool risk", "require approval before an agent acts", "audit agent tool calls", "stop prompt injection reaching a tool", or mentions tool risk levels, tool gateways, permissioned tool execution, or validating model-generated tool arguments.
---

# Tool Governance

An agent should never hold a callable. It should hold a tool identifier and ask a gateway, which decides whether the call happens.

This differs from designing good tools. A well-designed tool with a clear description and a clean schema is still an unrestricted capability the moment an agent can invoke it directly. Tool governance is about the layer between the agent and the implementation: who may call what, under which conditions, with which arguments, and what is recorded.

## When to Activate

Activate this skill when:
- Agent tool calls have effects outside the conversation
- Some actions need human approval and others do not
- Agents operate on behalf of multiple tenants
- Tool arguments originate from model output, which is always
- An agent system needs an auditable record of what was attempted
- Deciding what an autonomous agent may never be permitted to do

## Core Concepts

**Model output is untrusted input.** Tool arguments are produced by a language model that may have been influenced by retrieved content, a previous tool result, or a user. Validate them against the tool's schema before the implementation is reached. A tool whose arguments are taken on faith is an injection vector regardless of how carefully permissions were designed.

**Classify by reversibility and blast radius, not by category.** "Sends an email" is not a risk level. "Irreversible, external, and visible to a customer" is.

**The strongest control is absence.** There should be no shell tool, no arbitrary-SQL tool, and no eval tool in the catalogue at any risk level. A capability that does not exist cannot be granted by mistake, misconfigured, or unlocked by a sufficiently persuasive argument.

**A contract may tighten a risk policy, never loosen it.** Loosening is a human decision expressed by approving a specific action, not a property an agent's own definition can assert about itself.

## Detailed Topics

### Risk classes

| Class | Meaning | Approval | Example |
|---|---|---|---|
| **R0** | Read-only internal | no | search internal knowledge |
| **R1** | Low-risk internal write | no | write a note |
| **R2** | External, reversible | no | create an unpublished draft |
| **R3** | Sensitive external | **required** | send an email |
| **R4** | Owner approval mandatory | **required** | publish externally |
| **R5** | Prohibited for autonomous execution | **never runs** | move money |

R5 is the class that matters most and is most often omitted. It is not "R4 but stricter" — it is a hard stop that no approval unlocks from inside the runtime. If an action should only ever be performed by a human in a different system, it belongs here, and the gateway refuses it even when presented with a valid token.

Assign classes by asking two questions: *can this be undone*, and *who sees it if it goes wrong*. A tool that posts to an internal log and a tool that posts to a customer's timeline may both be "write an entry" and belong three classes apart.

### The policy chain

Run every check before the implementation is reached, cheapest and most decisive first, so a denied call costs a lookup rather than a full validation pass:

```
 1. does the contract grant THIS tool?      holding "may use tools" is not
                                            permission for a specific tool
 2. capability + tenant isolation
 3. the tool's own project scope
 4. level floor for the risk class
 5. R5 hard stop
 6. approval + single-use token (R3/R4)
 7. per-task call ceiling
 8. rate limit
 9. budget pre-flight
10. VALIDATE ARGUMENTS against the input schema
--- execute ---
11. validate the tool's OUTPUT against its schema
--- record ---
```

Step 10 is the load-bearing one for safety. Step 11 is the one most often skipped: a tool that returns an unexpected shape puts malformed data into the agent's context, where it becomes part of the next prompt.

### Validating arguments

```python
errors = validate(params, spec.input_schema)
if errors:
    block("validation_error", f"invalid tool arguments: {errors}")
```

Set `additionalProperties: false`. Extra fields are the shape an injection takes when a model has been persuaded to smuggle a parameter through. Constrain string lengths and numeric ranges too — an unbounded string field is a denial-of-service vector and an unbounded integer is a surprising bill.

Return every error at once rather than the first. Handing a model one error at a time turns a single correction into several round trips.

### Rate limits that survive a restart

Compute the limit from the audited call log rather than an in-process counter:

```python
recent = count("SELECT count(*) FROM tool_calls "
               "WHERE agent_id = ? AND tool_id = ? AND ts > ? AND status != 'blocked'",
               agent_id, tool_id, now - 60)
if recent >= spec.rate_limit_per_minute:
    block("rate_limited", ...)
```

An in-memory counter resets when the process does, which turns a crash loop into an unthrottled agent — precisely when throttling matters most.

### Auditing

Record every call, **including the blocked ones**. Blocked calls are the interesting ones for security review, and an attempt that leaves no trace is an attempt nobody can learn from.

Store a **hash** of the arguments rather than the arguments themselves. Arguments carry customer data, credentials in transit, and personal information; the hash is enough to prove what was attempted and to correlate a retry, without the audit table becoming a second copy of the sensitive data.

Record which token authorised the call, so an approved action can be traced back to the human who approved it.

## Practical Guidance

**Give the gateway the tool registry, not the agent.** The agent receives tool *descriptions* for its context and tool *identifiers* to call with. It never receives a function reference.

**Mark irreversibility explicitly.** A boolean on the tool spec, surfaced in the approval request, so the human deciding knows whether "undo" exists. It also blocks the reflexive "just retry it" response to a failure.

**Fail closed on unknown tools.** An unregistered tool identifier is a refusal, never a pass-through.

**Keep the catalogue small.** Every registered tool is attack surface and context weight. See tool-design for consolidation strategy; this skill assumes the set has already been minimised.

## Examples

**Argument injection is refused before execution:**

```
Input:  kb.search({"query": "x", "__proto__": "evil"})
Output: ValidationError: $: unexpected properties ['__proto__']
        -> recorded as a blocked call, implementation never reached
```

**R5 is a hard stop even with a valid approval:**

```
Input:  most senior agent, tool granted in contract, valid owner-issued token
Output: PermissionDenied: R5 tool 'finance.transfer' cannot be executed
        autonomously
```

## Guidelines

1. Agents hold tool identifiers; the gateway holds implementations
2. Risk class is assigned by reversibility and blast radius, not by category
3. R5 exists and is unlocked by nothing inside the runtime
4. Contracts may tighten a risk policy; only an owner approval loosens one
5. Arguments are validated against the input schema before execution
6. Tool output is validated before it enters agent context
7. Rate limits are computed from durable records, not in-process counters
8. Every call is audited, blocked calls included
9. Audit stores an argument hash, never the raw arguments
10. No shell, SQL, or eval tool exists in the catalogue at any level

## Gotchas

1. **The agent holds a callable**: Once a function reference is in the agent's runtime, every check around it is advisory. Pass identifiers and resolve them inside the gateway.
2. **Arguments trusted because permissions passed**: Permission answers *who may call*, not *with what*. A correctly authorised call with attacker-influenced arguments is the more common breach.
3. **Tool output not validated**: Malformed or hostile tool output flows straight into context and becomes part of the next prompt. Validate the response shape as strictly as the request.
4. **Contracts allowed to waive approval**: A field like `requires_approval: false` on the agent's own definition lets the thing being governed set its own policy. Only an owner approval may loosen a class.
5. **Risk assigned by category**: Grouping all "communication" tools at one level puts an internal log write and a customer email in the same class. Classify each tool by what happens when it goes wrong.
6. **R5 omitted entirely**: Without a class that nothing unlocks, every action becomes reachable given a sufficiently convincing approval request. Some actions should not have a code path.
7. **Rate limits held in memory**: They reset on restart, so a crash-looping process becomes an unthrottled agent at the worst moment.
8. **Blocked calls not recorded**: The refused attempts are the security signal. Recording only successes produces an audit log that describes a system where nothing ever went wrong.
9. **Full arguments in the audit log**: The audit table becomes a second copy of every sensitive payload the agent ever handled, usually with weaker access controls than the source.
10. **Approval checked after the expensive work**: Running the tool and then checking authorisation means the effect already happened. Every check precedes execution.

## Integration

- tool-design - Designs the tool surface; this skill governs execution of it
- agent-permissions - Supplies the capability and isolation checks the chain calls
- agent-contracts - Contracts declare which tools an agent is granted, and their per-task ceilings
- work-packets - A packet may narrow the tool set further, never widen it
- cost-governance - Tool cost is charged against the same budget scopes as model spend
- agent-observability - Tool call records are a primary audit source
- hosted-agents - Sandboxing contains execution; this decides whether it happens

## References

- [Tool gateway](./scripts/tool_gateway.py) - Runnable risk classes, policy chain, argument validation, and audit
- Worked implementation: `examples/agent-factory-runtime/af/tools/`

---

## Skill Metadata

**Created**: 2026-09-01
**Last Updated**: 2026-09-01
**Version**: 1.0.0
