# ADR-0003: Structured WorkPackets, not free-form agent conversation

**Status:** Accepted · **Date:** 2026-09-01

## Context
Multi-agent systems commonly let agents exchange natural-language messages. The
mandate explicitly asks for "governed, traceable protocols rather than
uncontrolled free-form agent chat."

## Decision
Agents exchange `WorkPacket` records only. There is no agent-to-agent message
channel. Delegation goes through `AgentRuntime.delegate`, which creates a child
packet and enqueues it.

## Rationale
A natural-language message carries no enforceable constraints. If agent A tells
agent B "research this, and you may use the web tool, but keep it under a
dollar", then every one of those limits has to be re-derived by B's model from
prose — which is to say, not enforced. A packet carries `allowed_tools`,
`budget_micros`, `token_budget`, `deadline_at`, `required_output_schema`,
`depth` and `spawn_budget` as *data the runtime reads*, and B's model cannot
alter any of them.

Three properties follow that free-form chat cannot provide:

1. **Authority only narrows.** `WorkPacket.child()` clamps every budget to the
   parent's, decrements the spawn budget, and intersects `allowed_tools` with
   the parent's set. A parent cannot grant what it does not hold, and it cannot
   grant more than it holds. This is enforced by the constructor, not by review.
2. **Recursion is bounded structurally.** `depth` and `spawn_budget` travel with
   the work, so limits apply across process and worker boundaries.
3. **Traceability is free.** Every packet carries `trace_id` and `root_id`, so a
   whole task tree is one indexed query.

## Costs
- Less flexible than open-ended negotiation. An agent cannot ask a clarifying
  question of a peer mid-task; it must escalate, which is slower and sometimes
  unnecessary.
- Schemas must be defined up front.

## Accepted because
The mandate's forensic requirements ("which agent did it, why, what did it cost,
who approved it") are answerable by construction under this model and require
after-the-fact log reconstruction under the other. Flexibility that cannot be
audited is not a feature of a workforce operating system.
