---
name: context-engineering-collection
description: A comprehensive collection of Agent Skills for context engineering, multi-agent architectures, agent workforce governance, and production agent systems. Use when building, optimizing, governing, or debugging agent systems that require effective context management or accountable multi-agent operation.
---

# Agent Skills for Context Engineering

This collection provides structured guidance for building production-grade AI agent systems through effective context engineering.

## When to Activate

Activate these skills when:
- Building new agent systems from scratch
- Optimizing existing agent performance
- Debugging context-related failures
- Designing multi-agent architectures
- Creating or evaluating tools for agents
- Implementing memory and persistence layers
- Governing what agents are permitted to do, spend, and create
- Scaling an agent fleet, or diagnosing why it does not scale

## Skill Map

### Foundational Context Engineering

**Understanding Context Fundamentals**
Context is not just prompt text—it is the complete state available to the language model at inference time, including system instructions, tool definitions, retrieved documents, message history, and tool outputs. Effective context engineering means understanding what information truly matters for the task at hand and curating that information for maximum signal-to-noise ratio.

**Recognizing Context Degradation**
Language models exhibit predictable degradation patterns as context grows: the "lost-in-middle" phenomenon where information in the center of context receives less attention; U-shaped attention curves that prioritize beginning and end; context poisoning when errors compound; and context distraction when irrelevant information overwhelms relevant content.

### Architectural Patterns

**Multi-Agent Coordination**
Production multi-agent systems converge on three dominant patterns: supervisor/orchestrator architectures with centralized control, peer-to-peer swarm architectures for flexible handoffs, and hierarchical structures for complex task decomposition. The critical insight is that sub-agents exist primarily to isolate context rather than to simulate organizational roles.

**Memory System Design**
Memory architectures range from simple scratchpads to sophisticated temporal knowledge graphs. Vector RAG provides semantic retrieval but loses relationship information. Knowledge graphs preserve structure but require more engineering investment. The file-system-as-memory pattern enables just-in-time context loading without stuffing context windows.

**Filesystem-Based Context**
The filesystem provides a single interface for storing, retrieving, and updating effectively unlimited context. Key patterns include scratch pads for tool output offloading, plan persistence for long-horizon tasks, sub-agent communication via shared files, and dynamic skill loading. Agents use `ls`, `glob`, `grep`, and `read_file` for targeted context discovery, often outperforming semantic search for structural queries.

**Hosted Agent Infrastructure**
Background coding agents run in remote sandboxed environments rather than on local machines. Key patterns include pre-built environment images refreshed on regular cadence, warm sandbox pools for instant session starts, filesystem snapshots for session persistence, and multiplayer support for collaborative agent sessions. Critical optimizations include allowing file reads before git sync completes (blocking only writes), predictive sandbox warming when users start typing, and self-spawning agents for parallel task execution.

**Tool Design Principles**
Tools are contracts between deterministic systems and non-deterministic agents. Effective tool design follows the consolidation principle (prefer single comprehensive tools over multiple narrow ones), returns contextual information in errors, supports response format options for token efficiency, and uses clear namespacing.

### Operational Excellence

**Context Compression**
When agent sessions exhaust memory, compression becomes mandatory. The correct optimization target is tokens-per-task, not tokens-per-request. Structured summarization with explicit sections for files, decisions, and next steps preserves more useful information than aggressive compression. Artifact trail integrity remains the weakest dimension across all compression methods.

**Context Optimization**
Techniques include compaction (summarizing context near limits), observation masking (replacing verbose tool outputs with references), prefix caching (reusing KV blocks across requests), and strategic context partitioning (splitting work across sub-agents with isolated contexts).

**Latent Briefing (KV Memory Sharing)**
Orchestrator-worker systems can compound tokens when supervisors accumulate long trajectories but workers see only narrow text slices. Latent Briefing compacts the orchestrator trajectory in the worker model's KV cache using task-guided attention (Attention Matching-style compaction) so workers receive relevant latent state without full-text replay when the stack exposes worker KV state and the models are compatible.

**Evaluation Frameworks**
Production agent evaluation requires multi-dimensional rubrics covering factual accuracy, completeness, tool efficiency, and process quality. Effective patterns include LLM-as-judge for scalability, human evaluation for edge cases, and end-state evaluation for agents that mutate persistent state.

### Workforce Governance

**Agents as Contracts**
Once agents create and direct other agents, a prompt is no longer a sufficient definition. An agent becomes a versioned, validated contract carrying its own tools, permissions, budgets, quality policy, and lifecycle — and the contract, not the prompt, is what the runtime enforces. The controlling design rule is that an invalid definition must be unable to reach an active state by any path, which is a property of the lifecycle graph rather than a rule someone must remember.

**Authority Separated from Reach**
Seniority widens what an agent can see and coordinate; it grants nothing. Authority comes from explicit capability grants, and a small set of actions — creating agents, raising budgets, overriding quality, defining ground truth — remains unreachable for any agent principal at any level. Approvals mint single-use credentials bound to specific parameters rather than expanding what an agent may do afterwards.

**Delegation as Protocol**
Agents exchange structured work packets rather than messages. A packet carries tools, budget, deadline, output schema, depth and spawn allowance as fields the runtime reads, so delegation can only narrow authority. Recursion is bounded by depth, fan-out width, and total task-tree size together, because any two of the three still leave the product unbounded.

**Elasticity over Headcount**
Agent count is not the metric; productive workflow loops are. Definitions are cheap and instances are not, so capacity follows demand and idle instances are reaped. Scaling claims are measured rather than asserted, and control-plane throughput is measured separately from model-provider throughput because they are different ceilings with different fixes.

### Development Methodology

**Project Development**
Effective LLM project development begins with task-model fit analysis: validating through manual prototyping that a task is well-suited for LLM processing before building automation. Production pipelines follow staged, idempotent architectures (acquire, prepare, process, parse, render) with file system state management for debugging and caching. Structured output design with explicit format specifications enables reliable parsing. Start with minimal architecture and add complexity only when proven necessary.

## Core Concepts

The collection is organized around three core themes. First, context fundamentals establish what context is, how attention mechanisms work, and why context quality matters more than quantity. Second, architectural patterns cover the structures and coordination mechanisms that enable effective agent systems. Third, operational excellence addresses the ongoing work of optimizing and evaluating production systems.

## Practical Guidance

Each skill can be used independently or in combination. Start with fundamentals to establish context management mental models. Branch into architectural patterns based on your system requirements. Reference operational skills when optimizing production systems.

The skills are platform-agnostic and work with Claude Code, Cursor, or any agent framework that supports custom instructions or skill-like constructs.

## Integration

This collection integrates with itself—skills reference each other and build on shared concepts. The fundamentals skill provides context for all other skills. Architectural skills (multi-agent, memory, tools) can be combined for complex systems. Operational skills (optimization, evaluation) apply to any system built using the foundational and architectural skills.

## References

Internal skills in this collection:
- [context-fundamentals](skills/context-fundamentals/SKILL.md)
- [context-degradation](skills/context-degradation/SKILL.md)
- [context-compression](skills/context-compression/SKILL.md)
- [multi-agent-patterns](skills/multi-agent-patterns/SKILL.md)
- [memory-systems](skills/memory-systems/SKILL.md)
- [tool-design](skills/tool-design/SKILL.md)
- [filesystem-context](skills/filesystem-context/SKILL.md)
- [hosted-agents](skills/hosted-agents/SKILL.md)
- [context-optimization](skills/context-optimization/SKILL.md)
- [latent-briefing](skills/latent-briefing/SKILL.md)
- [evaluation](skills/evaluation/SKILL.md)
- [advanced-evaluation](skills/advanced-evaluation/SKILL.md)
- [project-development](skills/project-development/SKILL.md)
- [bdi-mental-states](skills/bdi-mental-states/SKILL.md)
- [agent-contracts](skills/agent-contracts/SKILL.md)
- [agent-permissions](skills/agent-permissions/SKILL.md)
- [work-packets](skills/work-packets/SKILL.md)
- [tool-governance](skills/tool-governance/SKILL.md)
- [workforce-elasticity](skills/workforce-elasticity/SKILL.md)
- [quality-enforcement](skills/quality-enforcement/SKILL.md)
- [cost-governance](skills/cost-governance/SKILL.md)
- [agent-observability](skills/agent-observability/SKILL.md)

External resources on context engineering:
- Research on attention mechanisms and context window limitations
- Production experience from leading AI labs on agent system design
- Framework documentation for LangGraph, AutoGen, and CrewAI

---

## Skill Metadata

**Created**: 2025-12-20
**Last Updated**: 2026-09-01
**Author**: Agent Skills for Context Engineering Contributors
**Version**: 1.4.0
