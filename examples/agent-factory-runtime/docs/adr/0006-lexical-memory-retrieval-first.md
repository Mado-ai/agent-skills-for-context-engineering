# ADR-0006: Lexical retrieval now, vector retrieval behind the same port

**Status:** Accepted · **Date:** 2026-09-01

## Context
The mandate warns against blindly putting everything into one vector database,
and separately requires a layered memory architecture with retention, trust,
provenance, versioning and project scope.

## Decision
v0.4 ships the **layered governance** with **lexical retrieval** (indexed key +
substring). Semantic retrieval is deferred behind `MemoryStore.search()`.

## Rationale
The two halves of a memory system have very different costs to get wrong.

Retrieval quality is an *optimisation*: a worse retriever surfaces less relevant
context, and swapping it later is a contained change behind one method.

Metadata is *structural*: trust level, provenance, project scope, retention and
version have to be recorded **at write time**. Retrofitting provenance onto a
corpus that was accumulated without it is not a migration, it is an
archaeological exercise — the information is simply gone.

So v0.4 spends its effort on the half that cannot be added later:
- an agent cannot write `authoritative` or `shared_org` (owner-gated), and
- an agent cannot self-declare `authoritative` *trust* in any layer it can write,
- so model output can never launder itself into the fleet's ground truth.

Retrieval is filtered in SQL, not in Python, so rows an agent is not entitled to
never enter its process.

## Cost
Lexical search misses paraphrases. For v0.4's benchmark and test workloads this
is not the limiting factor; for a production knowledge agent it would be.

## Revisit when
A real corpus exists. The swap is: add an embedding column plus a vector index
(pgvector under ADR-0002), and change the ORDER BY inside `search()`. The access
filter, trust floor and project predicate stay exactly as they are — which is
the property this ADR exists to protect.
