# MEMORY_ARCHITECTURE.md

## 1. Why six layers instead of one store

The mandate's instruction — "never blindly place all information into one vector
database" — is the design constraint, and it is correct for a reason worth
stating: different knowledge has different **retention, trust, scope and deletion**
rules, and flattening it into one store loses exactly the distinctions that
matter operationally.

A refund policy the owner approved and a draft paragraph a model produced ninety
seconds ago are not the same kind of thing. In a single undifferentiated store
they retrieve identically, and the model has no way to tell them apart.

| Layer | Scope | Default TTL | Default trust | Written by |
|---|---|---|---|---|
| `working` | task | 1 hour | unverified | any agent, freely |
| `episodic` | agent | 30 days | derived | runtime, on completion |
| `project` | project | none | derived | agents with the grant |
| `authoritative` | project | none | **authoritative** | **OWNER ONLY** |
| `agent` | template | 90 days | derived | the agent itself |
| `shared_org` | **global** | none | verified | **OWNER ONLY** |

`shared_org` is the only layer that is not project-scoped. That is its entire
purpose, and it is why writing it is owner-gated.

---

## 2. Trust, and the ceiling that matters most

```
authoritative  owner-approved ground truth
verified       passed a quality gate or human check
derived        produced by a completed, gated execution
unverified     raw model output — assume nothing
```

Two independent controls prevent model output from laundering itself into the
fleet's ground truth:

1. **Layer gate.** Writing `authoritative` or `shared_org` requires an
   owner-gated capability. No agent holds one.
2. **Trust ceiling.** Each layer declares `max_trust_writable_by_agent`. An
   agent writing a layer it *is* permitted to write still cannot stamp its
   content `authoritative`.

The second exists because the first alone is insufficient. Without it, an agent
could write `authoritative` *trust* into the `working` layer it is freely allowed
to write, and a later retrieval with a trust floor would surface it as ground
truth. Both are tested
(`test_agent_cannot_launder_its_output_into_authoritative_knowledge`).

Retrieval can demand a floor (`min_trust_for_read`), so a compliance agent can be
configured to see authoritative records only and never model speculation.

---

## 3. Provenance

Every record carries: `source` (the writing principal), `provenance` (principal
kind, timestamp, trace id, outcome), `version`, `supersedes`, `task_id`,
`agent_id`, `template_id`, `created_at`, `expires_at`.

This is recorded **at write time** because it cannot be reconstructed afterwards.
That asymmetry is the whole argument of ADR-0006: retrieval quality is an
optimisation that can be swapped later; provenance that was never recorded is
simply gone.

**Versioning.** Superseding a record soft-deletes the old one and inherits
`version + 1`, so history is preserved rather than overwritten. "What did the
refund policy say in March, and who changed it" stays answerable.

---

## 4. Access control

The access filter is applied **in SQL, not after fetching**. Filtering in Python
would mean rows the agent is not entitled to briefly existed in its process — a
subtle leak that becomes a real one the first time someone logs an intermediate
result.

The predicate combines: readable layers (from the contract), project scope (from
the principal), trust floor (from the contract or the call), soft-delete, and
expiry. Results are ordered highest-trust-first, so a truncated context keeps
the most reliable records.

---

## 5. Retention

`sweep_expired()` soft-deletes past-TTL records. Working memory in particular
must not accumulate: it is the highest-volume, lowest-value layer, and it is the
reason `working` gets a one-hour default while `project` gets none.

Deletion is **soft**: the row is retained with `deleted_at` set so the audit
trail can still show that a record existed and was removed. A hard delete would
make deletion itself untraceable. Hard erasure for a data-subject request is a
separate, owner-driven operation, and is not implemented in v0.4.

---

## 6. Context assembly

The runtime retrieves under the contract's **context policy**, capped at
`max_retrieved_records` — not "everything that matched".

This is the context-engineering discipline applied as an enforced runtime limit
rather than as advice. Attention is the scarce resource; retrieving more and
letting the model sort it out is precisely the failure mode (distraction,
lost-in-the-middle) that the discipline exists to prevent.

Records explicitly pinned by the packet's `context_refs` are included ahead of
search hits. Each record is labelled with its trust level when placed in the
prompt, so the model can weight an authoritative policy above an unverified
draft rather than treating them as equally reliable.

`ContextPolicy.offload_outputs_over_bytes` expresses the filesystem-as-context
pattern: large tool outputs go to memory and a *reference* is passed, rather than
being inlined into the window.

---

## 7. What v0.4 does not do

- **No semantic retrieval.** Lexical only (ADR-0006). Paraphrases are missed.
- **No knowledge graph.** Entity relationships are not modelled.
- **No automatic promotion.** Nothing moves from `derived` to `verified` on its
  own; promotion is a governed act. This is deliberate — automatic promotion is
  how unverified output becomes ground truth without anyone deciding it should.
- **No cross-project sharing flow.** `shared_org` exists and is owner-gated, but
  no workflow drives records into it.
