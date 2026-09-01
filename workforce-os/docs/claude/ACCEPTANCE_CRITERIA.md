# AI Workforce OS v0.4 — Acceptance Criteria

A capability is accepted only when it is **persisted, enforced server-side, audited,
tested, represented in the API/schema, and documented**. UI display is not evidence.

Each criterion below names the automated test that proves it. `make test` must be green.

## A. Authority and governance

| ID | Criterion | Proof |
|----|-----------|-------|
| A1 | Only an Owner principal can approve an approval request | `test_security.py::test_agent_cannot_approve_own_request` |
| A2 | An agent cannot approve its own high-risk request | `test_security.py::test_agent_cannot_approve_own_request` |
| A3 | L5 visibility does not grant tool scope; a chief architect without a tool in its contract is denied | `test_security.py::test_l5_does_not_grant_tool_scope` |
| A4 | High-risk tool calls are denied without a valid approval token | `test_gateway.py::test_high_risk_requires_approval` |
| A5 | Approval tokens are single-use | `test_gateway.py::test_approval_token_is_single_use` |
| A6 | Approval tokens are bound to agent, tool and argument hash | `test_security.py::test_token_bound_to_arguments` |
| A7 | Expired approval tokens are refused | `test_gateway.py::test_expired_token_refused` |
| A8 | Exactly one active Chief Agent Architect may exist | `test_registry.py::test_single_active_chief_architect` |

## B. Agent Builder and contracts

| ID | Criterion | Proof |
|----|-----------|-------|
| B1 | Invalid contracts are rejected with field-level errors | `test_registry.py::test_builder_rejects_invalid_contract` |
| B2 | Editing an agent creates a new contract version; old versions remain readable | `test_registry.py::test_contract_versioning` |
| B3 | Contract rows are immutable (checksum verified on read) | `test_registry.py::test_contract_tamper_detected` |
| B4 | Rollback re-points an agent at a prior version | `test_registry.py::test_contract_rollback` |
| B5 | Lifecycle transitions are enforced (`draft→active⇄paused→retired`); retired is terminal | `test_registry.py::test_lifecycle_transitions` |
| B6 | A paused or retired agent cannot execute tools | `test_gateway.py::test_paused_agent_denied` |

## C. Delegation and packets

| ID | Criterion | Proof |
|----|-----------|-------|
| C1 | Delegation to an equal or higher level is refused | `test_delegation.py::test_cannot_delegate_upward` |
| C2 | Child scope is the intersection of parent and requested scope — never wider | `test_delegation.py::test_scope_attenuation` |
| C3 | Delegation cycles are rejected | `test_delegation.py::test_cycle_rejected` |
| C4 | Delegation depth cap is enforced | `test_delegation.py::test_depth_cap` |
| C5 | Cross-project delegation is refused | `test_security.py::test_cross_project_delegation_denied` |
| C6 | Work packets validate against their registered schema; invalid payloads are rejected | `test_packets.py::test_invalid_packet_rejected` |
| C7 | Specialist instantiation from a template yields an active, scope-capped agent | `test_templates.py::test_instantiate_specialist` |

## D. Budgets

| ID | Criterion | Proof |
|----|-----------|-------|
| D1 | Budget enforcement is pre-flight: an over-budget call never executes | `test_budgets.py::test_preflight_denial_does_not_execute` |
| D2 | Per-agent and per-task budgets are enforced independently | `test_budgets.py::test_task_and_agent_budgets_independent` |
| D3 | Every spend writes a ledger row that reconciles with the aggregate | `test_budgets.py::test_ledger_reconciles` |

## E. Memory

| ID | Criterion | Proof |
|----|-----------|-------|
| E1 | All three layers persist and are queryable by layer | `test_memory.py::test_layers_roundtrip` |
| E2 | Every memory row carries complete provenance; rows without it are rejected | `test_memory.py::test_provenance_required` |
| E3 | Cross-project memory reads are denied for agents at any level | `test_security.py::test_cross_project_memory_denied` |
| E4 | Working memory is task-scoped and invisible to other tasks | `test_memory.py::test_working_memory_task_scoped` |

## F. Quality, rework and CAPA

| ID | Criterion | Proof |
|----|-----------|-------|
| F1 | A failing evaluation opens a linked rework task | `test_quality.py::test_failing_evaluation_opens_rework` |
| F2 | Rework beyond the threshold opens a CAPA record | `test_quality.py::test_capa_opens_after_threshold` |
| F3 | A task with an open CAPA cannot be completed | `test_quality.py::test_open_capa_blocks_completion` |
| F4 | Evaluations are audited and attributable to an evaluator agent | `test_quality.py::test_evaluation_audited` |

## G. Tool Gateway

| ID | Criterion | Proof |
|----|-----------|-------|
| G1 | Unknown tools are denied | `test_gateway.py::test_unknown_tool_denied` |
| G2 | A tool absent from the contract is denied even if it exists | `test_gateway.py::test_tool_not_in_contract_denied` |
| G3 | Disallowed action types and data domains are denied | `test_gateway.py::test_action_type_denied`, `::test_data_domain_denied` |
| G4 | Every call — allowed or denied — writes a tool-call record with a reason code | `test_gateway.py::test_all_calls_audited` |
| G5 | No built-in tool performs shell, browser or network execution | `test_security.py::test_no_external_execution_tools` |
| G6 | A tool result is only reported confirmed when the adapter confirms it | `test_gateway.py::test_unconfirmed_result_not_claimed` |

## H. Persistence, audit and telemetry

| ID | Criterion | Proof |
|----|-----------|-------|
| H1 | Migrations apply from an empty database and are idempotent | `test_migrations.py::test_apply_and_reapply` |
| H2 | Migration checksums are verified; a tampered migration halts startup | `test_migrations.py::test_tampered_migration_detected` |
| H3 | The event log is append-only and hash-chained | `test_audit.py::test_event_chain_integrity` |
| H4 | Secrets are redacted before persistence and never logged | `test_security.py::test_secrets_redacted` |
| H5 | Cost and latency are recorded per tool and provider call and aggregate correctly | `test_telemetry.py::test_metrics_aggregate` |

## I. API and end-to-end

| ID | Criterion | Proof |
|----|-----------|-------|
| I1 | Every capability above is reachable through the HTTP API | `test_api.py` |
| I2 | Unauthenticated and mis-scoped API calls are refused | `test_api.py::test_auth_required`, `::test_owner_only_routes` |
| I3 | A full workflow loop — build → activate → delegate → execute → evaluate → rework → approve → retire — runs end to end | `test_e2e.py::test_full_workflow_loop` |
| I4 | The runtime starts and the whole suite passes with no network access and no third-party packages | `test_e2e.py` + stdlib-only imports |

## J. Documentation

| ID | Criterion | Proof |
|----|-----------|-------|
| J1 | The build spec and these criteria are checked in under `docs/claude/` | this file |
| J2 | README documents setup, offline mode, API surface and the authority model | `workforce-os/README.md` |
| J3 | CHANGELOG records the v0.4 scope and the greenfield provenance | `workforce-os/CHANGELOG.md` |
