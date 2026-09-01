# SECURITY_MODEL.md

## 1. The one sentence

**Authority is read from stored contracts and enforced by code paths an agent
cannot reach. Nothing an agent emits is ever an input to an authority decision.**

A prompt instruction is a suggestion to a model. It is not a security control,
and this system never treats it as one.

---

## 2. Threat model

The adversary assumed throughout is **a capable, misaligned or compromised
agent** — one that will attempt exactly what it is told not to. This includes an
agent whose model has been prompt-injected through retrieved content or tool
output, since that produces the same behaviour.

| Threat | Control | Test |
|---|---|---|
| Agent grants itself permissions | Forbidden permissions are not in the capability vocabulary; contract validation rejects them | `test_agents_cannot_modify_their_own_permissions` |
| Agent approves its own high-risk request | Only `PrincipalKind.OWNER` may decide; self-approval blocked explicitly | `test_agent_cannot_approve_its_own_request` |
| Agent activates a new agent | `agent.activate` is owner-gated; unreachable by any agent | `test_14_owner_gated_actions_protected` |
| Agent escalates via level | Level and capability are separate checks; both must pass | `test_a_maximally_privileged_agent_still_cannot_cross_the_owner_boundary` |
| Approved action reused for a different action | Token bound to (agent, tool, params-hash), single use | `test_approved_parameters_cannot_be_substituted` |
| Approval becomes standing privilege | Approval mints a token; it never mutates permissions | `test_approval_does_not_permanently_elevate` |
| Cross-tenant data access | `project_id` predicate on every authority check and every query | `test_project_a_agent_cannot_read_project_b` |
| Model output drives a tool | Arguments validated against the tool's schema before execution | `test_model_generated_tool_arguments_are_validated` |
| Model output becomes ground truth | Trust ceiling: agents cannot write `authoritative` trust anywhere | `test_agent_cannot_launder_its_output_into_authoritative_knowledge` |
| Agent gets raw infrastructure | No shell/SQL/eval tool exists in the catalogue at any risk level | `test_no_shell_or_sql_tool_exists` |
| Runaway recursion | Depth + fan-out + per-tree cumulative caps, all pre-flight | `test_recursive_spawn_is_bounded` |
| Packet widens tool access | Runtime intersects packet tools with contract grants | `test_work_packet_cannot_widen_the_contracts_tool_grant` |
| Credential theft from the database | Token secrets stored as SHA-256; constant-time compare | `test_token_secret_is_hashed_at_rest` |

**Explicitly out of scope for v0.4:** a compromised *host*, a malicious owner, a
malicious operator with direct database access, and side channels. These require
controls below the application (disk encryption, OS isolation, key management)
and are noted rather than claimed.

---

## 3. Principals

| Kind | Who | Owner-gated capabilities |
|---|---|---|
| `OWNER` | The human | **All** — the only holder |
| `AGENT` | Every AI agent, Chief included | **None**, at any level |
| `SYSTEM` | Schedulers, reapers, sweeps | **None** — the runtime is not the owner |

A `Principal` is constructed by the runtime from the stored contract
(`Principal.from_contract`). It is never constructed from model output. An agent
asserting a capability it does not hold changes nothing, because the assertion is
not consulted.

The `SYSTEM` principal deserves emphasis: internal machinery holds
`ALL_CAPABILITIES - OWNER_GATED`. Making it omnipotent would have created a
trivial escalation path — anything that could get the runtime to act on its
behalf would inherit owner authority.

---

## 4. Capability model

Authority is capability-based, not role-based. Three orthogonal checks, all of
which must pass, evaluated in this order:

1. **Owner gate** — is this capability owner-only, and is the principal an owner?
   Checked first so no combination of level and grants can reach past it.
2. **Grant** — does the principal's contract list this capability?
3. **Level floor** — does the principal's level meet the capability's minimum?
4. **Project scope** — is the principal entitled to *this project*?

Owner-gated capabilities:

```
agent.activate                 bring a new autonomous worker into existence
agent.merge                    collapse two agents into one
budget.raise                   increase a spending ceiling
quality.override               overrule a quality verdict
memory.authoritative.write     define what the fleet treats as ground truth
memory.shared_org.write        publish knowledge across tenant boundaries
```

These share a property: each either **creates new authority** or **redefines the
limits on existing authority**. Everything else operates within limits some
already-approved contract declared.

Permissions that may never be granted to anyone, and are absent from the
vocabulary entirely so a typo cannot conjure them:

```
governance.permissions.write     governance.contract.self_modify
governance.approval.self_approve governance.budget.self_raise
system.sql.execute               system.shell.execute
system.secrets.read
```

---

## 5. Project isolation

Projects are first-class security boundaries. Access to project A never implies
access to project B.

- Every tenant-scoped row carries `project_id` **directly**, not through a join.
- Project scope is checked on every authority check, against the project of the
  *resource*, not at session start.
- Memory retrieval filters by project **in SQL**. Filtering after fetching would
  mean rows briefly existed in a process not entitled to them — a leak that
  becomes real the first time an intermediate result is logged.
- Cross-project reach requires `project.cross_access`, which is itself not
  project-scoped (checking it per project would be circular).

Enforcement is currently in application code. Because the schema already carries
`project_id` on every tenant table, PostgreSQL row-level security is one policy
per table (ADR-0002) — which moves enforcement *below* the application, where a
mistaken query cannot bypass it. That is the intended end state.

---

## 6. Untrusted input

Two sources are treated as hostile:

**Model output.** Tool arguments are validated against the tool's declared input
schema before the handler is reached. Agent output is validated against the
declared output schema before it can pass a quality gate. Tool *output* is also
validated, because a tool returning an unexpected shape would otherwise put
malformed data into an agent's context.

**Retrieved content.** Memory records carry a trust level, retrieval can demand
a floor, and content is labelled with its trust when placed in context so the
model can weight it. An authoritative policy and an unverified draft must not
read as equally reliable.

---

## 7. Secrets

- No secret is stored in source, in a contract, or in a prompt.
- Token secrets are stored as SHA-256 hashes and compared with
  `hmac.compare_digest`. A leaked database yields no usable tokens.
- The plaintext token is returned exactly once, at mint time.
- `test_secrets_are_never_stored_in_source_or_prompts` scans the runtime package
  for embedded-credential patterns on every test run.
- Provider credentials, when real adapters exist, come from the environment —
  never from a contract, which is a governed artefact that gets versioned,
  audited and shown to reviewers.

---

## 8. Audit

Every denial is recorded before the exception is raised: capability denials,
isolation violations, blocked tool calls, rejected tokens, budget refusals,
blocked spawns. Audit events bypass the write buffer and are flushed
synchronously — a record of who was denied what must survive a crash.

`Telemetry.explain_trace(trace_id)` answers the mandate's forensic questions in
one call: what happened, which agents, which tools, which approvals, what
failed, what it cost. It exists as a named method rather than a documented query
because a capability that requires knowing the schema is one most people will
not have during an incident.
