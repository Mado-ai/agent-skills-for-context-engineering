"""Agent Runtime — executes one work packet under full governance.

This is where every subsystem meets. The execution path is fixed and every step
is enforced in code, not requested in a prompt:

    resolve receiver → derive principal from the STORED contract →
    reserve concurrency → budget pre-flight → assemble scoped context →
    route model → execute behaviour (tools via gateway only) →
    quality gate → PASS / REWORK / ESCALATE / REJECT →
    record usage → write episodic memory → release concurrency

The principal is derived from the stored contract on every execution. Nothing
the model emits can widen it, because the model's output is never an input to
authority.

The agent's "body" is pluggable (``AgentBehaviour``). The default is
model-backed; benchmarks inject a deterministic behaviour so control-plane
throughput can be measured without model calls. This is the seam that keeps
control-plane scalability measurable separately from provider scalability.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from af.budget.governor import BudgetGovernor, Usage
from af.clock import Clock, SystemClock
from af.errors import (AFError, ApprovalRequired, BudgetExceeded, ConcurrencyLimitExceeded,
                       NotFound, PermissionDenied, ProviderError, SpawnLimitExceeded)
from af.factory import AgentFactory
from af.governance.permissions import PermissionEngine, Principal
from af.memory.layers import Layer, MemoryStore, Trust
from af.quality.gates import QualityEngine, Verdict
from af.registry import AgentRegistry
from af.router.model_router import ModelRouter
from af.router.providers import ModelRequest
from af.scheduler.queue import ClaimedTask, TaskQueue
from af.store.sqlite_store import SqliteStore
from af.telemetry.events import Event, EventType, Telemetry
from af.tools.gateway import ToolGateway
from af.workpacket import TaskStatus, WorkPacket

__all__ = ["AgentRuntime", "ExecutionResult", "AgentBehaviour", "ExecutionContext",
           "ModelBackedBehaviour", "DeterministicBehaviour"]


@dataclass(slots=True)
class ExecutionContext:
    """Everything a behaviour is allowed to see and do.

    A behaviour receives this and nothing else — no store handle, no registry,
    no direct gateway. ``call_tool`` and ``delegate`` are bound closures that
    carry the governance checks with them, so a behaviour physically cannot
    reach an ungoverned path.
    """

    packet: WorkPacket
    contract: Any
    instance_id: str
    principal: Principal
    memories: list[Any] = field(default_factory=list)
    attempt: int = 1
    feedback: list[str] = field(default_factory=list)
    call_tool: Any = None
    delegate: Any = None
    complete_model_call: Any = None


class AgentBehaviour(Protocol):
    def __call__(self, ctx: ExecutionContext) -> dict[str, Any]:
        """Produce the agent's output. May call ctx.call_tool / ctx.delegate."""


@dataclass(slots=True)
class ExecutionResult:
    task_id: str
    status: str
    verdict: str | None = None
    output: Any = None
    error: str | None = None
    error_code: str | None = None
    usage: Usage = field(default_factory=Usage)
    instance_id: str | None = None
    review: Any = None
    duration_ms: float = 0.0


class ModelBackedBehaviour:
    """Default behaviour: one routed model call, structured output expected."""

    def __call__(self, ctx: ExecutionContext) -> dict[str, Any]:
        parts = [f"Objective: {ctx.packet.objective}"]
        if ctx.memories:
            # Highest-trust records first, and each labelled with its trust level
            # so the model can weight them — an authoritative policy and an
            # unverified draft must not read as equally reliable.
            parts.append("Context (highest trust first):")
            for m in ctx.memories:
                parts.append(f"  [{m.trust.value}] {m.key}: {m.content[:500]}")
        if ctx.feedback:
            parts.append("Previous attempt failed these checks; address them:")
            parts.extend(f"  - {f}" for f in ctx.feedback)
        if ctx.packet.inputs:
            parts.append(f"Inputs: {ctx.packet.inputs}")

        response = ctx.complete_model_call(ModelRequest(
            prompt="\n".join(parts),
            system=f"You are {ctx.contract.name}. Mission: {ctx.contract.mission}",
            output_schema=ctx.packet.required_output_schema or ctx.contract.output_schema,
            max_tokens=min(4096, ctx.packet.token_budget),
            seed=ctx.packet.id))
        # A model that returns nothing structured still has to produce something
        # the schema gate can judge; returning the raw text lets the gate fail
        # it honestly rather than the runtime crashing.
        return response.structured if response.structured is not None else {"text": response.text}


class DeterministicBehaviour:
    """Zero-model behaviour for benchmarking and infrastructure tests.

    Synthesises schema-satisfying output directly. Exists so that
    ``tasks/second`` measures the runtime — queue, store, governance, telemetry —
    rather than the latency of whatever model happened to be behind the router.
    """

    #: Valid arguments per reference tool. The gateway validates tool arguments
    #: against each tool's schema, so a benchmark that sends the wrong shape
    #: measures the rejection path rather than the tool path — which is exactly
    #: what happened before this table existed.
    _TOOL_PARAMS: dict[str, Any] = {
        "kb.search": {"query": "benchmark", "limit": 3},
        "calc.stats": {"numbers": [1, 2, 3]},
        "note.write": {"key": "bench", "content": "benchmark note"},
    }

    def __init__(self, *, tool_calls: int = 0, tool_id: str = "calc.stats",
                 fail_rate: float = 0.0, work_units: int = 0) -> None:
        self.tool_calls = tool_calls
        self.tool_id = tool_id
        if tool_calls and tool_id not in self._TOOL_PARAMS:
            raise ValueError(
                f"DeterministicBehaviour has no valid argument shape for '{tool_id}'; "
                f"add one to _TOOL_PARAMS rather than letting the gateway reject it")
        self.fail_rate = fail_rate
        #: Synthetic CPU work, to model an agent that actually computes something.
        self.work_units = work_units

    def __call__(self, ctx: ExecutionContext) -> dict[str, Any]:
        if self.fail_rate:
            # Deterministic per task id: the same task fails on every run, which
            # makes failure-path benchmarks reproducible.
            if (hash(ctx.packet.id) % 1000) / 1000.0 < self.fail_rate:
                raise ProviderError("synthetic failure", model="deterministic")
        params = self._TOOL_PARAMS[self.tool_id] if self.tool_calls else {}
        for i in range(self.tool_calls):
            ctx.call_tool(self.tool_id, dict(params), call_index=i)
        if self.work_units:
            total = 0
            for i in range(self.work_units * 1000):
                total += i * i
        out: dict[str, Any] = {"confidence": 0.9, "sources": ["deterministic"]}
        for name in ctx.contract.outputs:
            out[name] = f"output for {ctx.packet.objective[:40]}"
        return out


class AgentRuntime:
    def __init__(self, store: SqliteStore, registry: AgentRegistry, factory: AgentFactory,
                 queue: TaskQueue, telemetry: Telemetry, permissions: PermissionEngine,
                 gateway: ToolGateway, memory: MemoryStore, router: ModelRouter,
                 quality: QualityEngine, budget: BudgetGovernor,
                 clock: Clock | None = None, *,
                 behaviour: AgentBehaviour | None = None) -> None:
        self.store = store
        self.registry = registry
        self.factory = factory
        self.queue = queue
        self.telemetry = telemetry
        self.permissions = permissions
        self.gateway = gateway
        self.memory = memory
        self.router = router
        self.quality = quality
        self.budget = budget
        self.clock = clock or SystemClock()
        self.behaviour = behaviour or ModelBackedBehaviour()

    # -- main entry point --------------------------------------------------
    def execute(self, claimed: ClaimedTask) -> ExecutionResult:
        started = time.perf_counter()
        packet = claimed.packet
        usage = Usage(queue_ms=claimed.queue_ms, retries=max(0, claimed.attempts - 1))
        instance_id: str | None = None
        contract = None

        try:
            handle = self._resolve_receiver(packet)
            instance_id, contract = handle.id, handle.contract
            principal = Principal.from_contract(instance_id, contract)

            # Concurrency is reserved atomically; failing here is a capacity
            # condition, so the task returns to the queue rather than failing.
            if not self.factory.reserve_instance(instance_id, contract.runtime.concurrency_limit):
                raise ConcurrencyLimitExceeded(
                    f"instance '{instance_id}' is at its concurrency limit "
                    f"({contract.runtime.concurrency_limit})", instance_id=instance_id)

            try:
                return self._run(claimed, packet, contract, principal, instance_id,
                                 usage, started)
            finally:
                self.factory.release_instance(instance_id, ok=True)

        except AFError as exc:
            return self._fail(claimed, packet, exc, usage, instance_id, contract, started)
        except Exception as exc:  # noqa: BLE001 - a behaviour may raise anything
            return self._fail(claimed, packet, exc, usage, instance_id, contract, started)

    # -- inner execution ----------------------------------------------------
    def _run(self, claimed, packet, contract, principal, instance_id, usage, started):
        self.telemetry.emit(Event(
            type=EventType.TASK_STARTED, trace_id=packet.trace_id, task_id=packet.id,
            project_id=packet.project_id, agent_id=instance_id, status="RUNNING",
            payload={"attempt": claimed.attempts, "objective": packet.objective[:200]}))

        # Budget pre-flight against the projected cost, narrowest scope first.
        projected = min(packet.budget_micros, contract.budget.per_task_cost_limit_micros)
        self.budget.check(
            [("task", packet.id), ("agent", instance_id), ("project", packet.project_id),
             ("system", "system")],
            cost_micros=0, tokens=0, project_id=packet.project_id,
            task_id=packet.id, agent_id=instance_id)

        memories = self._assemble_context(packet, contract, principal)
        # Only a rework has previous findings, and fetching them forces a flush
        # of the write-behind buffer. Doing that unconditionally flushed on
        # every task and silently cancelled the batching it was meant to
        # coexist with — measured as zero improvement until this guard was added.
        feedback = self._previous_feedback(packet.id) if claimed.attempts > 1 else []

        tool_call_counts: dict[str, int] = {}
        granted = {t.tool_id: t for t in contract.tools}
        # The packet may narrow the contract's grants further, never widen them.
        if packet.allowed_tools:
            granted = {k: v for k, v in granted.items() if k in packet.allowed_tools}
        model_usage = {"tokens_in": 0, "tokens_out": 0, "cost": 0}

        def call_tool(tool_id: str, params: dict[str, Any], *,
                      execution_token: str | None = None, call_index: int = 0):
            count = tool_call_counts.get(tool_id, 0)
            if sum(tool_call_counts.values()) >= contract.runtime.max_tool_calls_per_task:
                raise PermissionDenied(
                    f"task tool-call budget exhausted "
                    f"({contract.runtime.max_tool_calls_per_task})", task_id=packet.id)
            result = self.gateway.call(
                principal=principal, tool_id=tool_id, params=params,
                project_id=packet.project_id, task_id=packet.id,
                granted_tools=granted, execution_token=execution_token,
                calls_this_task=count, trace_id=packet.trace_id)
            tool_call_counts[tool_id] = count + 1
            usage.tool_cost_micros += result.cost_micros
            return result

        def complete_model_call(request: ModelRequest):
            response, _ = self.router.complete(
                contract.model, request, project_id=packet.project_id,
                task_id=packet.id, agent_id=instance_id, trace_id=packet.trace_id,
                complexity=packet.constraints.get("complexity"))
            model_usage["tokens_in"] += response.tokens_in
            model_usage["tokens_out"] += response.tokens_out
            model_usage["cost"] += response.cost_micros
            # Enforce the per-task token budget as the work happens, so a
            # runaway multi-call behaviour is stopped mid-flight rather than
            # discovered afterwards.
            total = model_usage["tokens_in"] + model_usage["tokens_out"]
            if total > min(packet.token_budget, contract.budget.per_task_token_limit):
                raise BudgetExceeded(
                    f"task token budget exhausted ({total} tokens)",
                    task_id=packet.id, tokens=total)
            return response

        def delegate(objective: str, *, template_id: str, **overrides) -> str:
            return self.delegate(packet=packet, contract=contract, principal=principal,
                                 instance_id=instance_id, objective=objective,
                                 template_id=template_id, **overrides)

        ctx = ExecutionContext(
            packet=packet, contract=contract, instance_id=instance_id, principal=principal,
            memories=memories, attempt=claimed.attempts, feedback=feedback,
            call_tool=call_tool, delegate=delegate,
            complete_model_call=complete_model_call)

        output = self.behaviour(ctx)

        usage.tokens_in += model_usage["tokens_in"]
        usage.tokens_out += model_usage["tokens_out"]
        usage.model_cost_micros += model_usage["cost"]
        usage.duration_ms = (time.perf_counter() - started) * 1000.0

        review = self.quality.evaluate(output=output, packet=packet, contract=contract,
                                       attempt=claimed.attempts)
        self._settle(usage, packet, instance_id, contract)

        if review.verdict is Verdict.PASS:
            self.queue.complete(packet.id, {"output": output, "review": review.to_dict()})
            self._remember(packet, contract, principal, instance_id, output, ok=True)
            status = TaskStatus.COMPLETED.value
        elif review.verdict is Verdict.REWORK:
            self.queue.set_status(packet.id, TaskStatus.REVIEW,
                                  result={"output": output, "review": review.to_dict()})
            self.queue.requeue_for_rework(packet.id)
            self.telemetry.emit(Event(
                type=EventType.QUALITY_REWORK, trace_id=packet.trace_id, task_id=packet.id,
                project_id=packet.project_id, agent_id=instance_id,
                payload={"attempt": claimed.attempts, "findings": review.findings[:10]}))
            status = TaskStatus.REWORK.value
        elif review.verdict is Verdict.ESCALATE:
            status = self._escalate(packet, contract, instance_id, review, output)
        else:  # REJECT
            self.queue.fail(packet.id, {"code": "quality_rejected",
                                        "message": "; ".join(review.findings[:5])},
                            retryable=False)
            status = TaskStatus.DEAD_LETTER.value

        return ExecutionResult(
            task_id=packet.id, status=status, verdict=review.verdict.value, output=output,
            usage=usage, instance_id=instance_id, review=review,
            duration_ms=usage.duration_ms)

    # -- delegation ----------------------------------------------------------
    def delegate(self, *, packet: WorkPacket, contract, principal: Principal,
                 instance_id: str, objective: str, template_id: str,
                 depends_on: tuple[str, ...] = (), **overrides) -> str:
        """Create a child work packet under the full recursion controls."""
        self.permissions.check(principal, "task.delegate", project_id=packet.project_id)

        siblings = self.store.scalar(
            "SELECT count(*) FROM tasks WHERE parent_id = ?", (packet.id,)) or 0
        self.budget.check_spawn(
            depth=packet.depth + 1, max_depth=contract.runtime.max_spawn_depth,
            root_id=packet.root_id, max_total_spawns=contract.runtime.max_total_spawns,
            children_so_far=siblings, max_children=contract.runtime.max_children_per_task,
            project_id=packet.project_id, task_id=packet.id, agent_id=instance_id)
        if packet.spawn_budget <= 0:
            raise SpawnLimitExceeded(
                "this work packet's spawn budget is exhausted", task_id=packet.id)

        child = packet.child(objective=objective, receiver_template_id=template_id,
                             **overrides)
        child.sender_agent_id = instance_id
        self.queue.submit(child, depends_on=depends_on)
        return child.id

    # -- helpers --------------------------------------------------------------
    def _resolve_receiver(self, packet: WorkPacket):
        """Find or create the worker for this packet.

        Targeting a *template* rather than an instance is the normal case: the
        sender says what kind of agent it needs, and the factory decides which
        live worker serves it (or spawns one). That indirection is what makes
        the fleet elastic.
        """
        system = Principal.system("runtime")
        if packet.receiver_instance_id:
            row = self.registry.get_instance(packet.receiver_instance_id)
            if row is None:
                raise NotFound(f"instance '{packet.receiver_instance_id}' not found")
            contract = self.registry.get_contract(row["contract_id"])
            if contract is None:
                raise NotFound(f"contract '{row['contract_id']}' not found")
            from af.factory import InstanceHandle
            return InstanceHandle(id=row["id"], template_id=row["template_id"],
                                  contract_id=row["contract_id"],
                                  project_id=row["project_id"], contract=contract,
                                  depth=row["depth"], reused=True)
        if not packet.receiver_template_id:
            raise NotFound("work packet names neither a receiver instance nor a template",
                           task_id=packet.id)
        return self.factory.acquire_instance(
            packet.receiver_template_id, packet.project_id, principal=system,
            depth=packet.depth, spawned_by=packet.id)

    def _assemble_context(self, packet, contract, principal) -> list[Any]:
        """Retrieve context under the contract's context policy.

        The cap is the contract's ``max_retrieved_records``, not "everything
        that matched". Attention is the scarce resource; retrieving more and
        letting the model sort it out is the failure mode the whole
        context-engineering discipline exists to prevent.
        """
        try:
            records = self.memory.search(
                principal=principal, query=packet.objective,
                project_id=packet.project_id, contract=contract,
                limit=contract.context.max_retrieved_records, task_id=packet.id)
        except PermissionDenied:
            # A context read the agent is not entitled to is not a task failure;
            # it proceeds with less context.
            return []
        # Explicit refs from the packet are always included, ahead of search hits.
        pinned = []
        for ref in packet.context_refs:
            record = self.memory.get(ref, principal=principal)
            if record is not None:
                pinned.append(record)
        seen, merged = set(), []
        for record in pinned + records:
            if record.id not in seen:
                seen.add(record.id)
                merged.append(record)
        return merged[:contract.context.max_retrieved_records]

    def _previous_feedback(self, task_id: str) -> list[str]:
        """Findings from the last failed review, so a rework is informed.

        A rework without the reason is just a re-roll; passing the findings back
        is what makes the second attempt more likely to succeed than the first.

        Goes through ``quality.history`` rather than querying quality_reviews
        directly: reviews are written through the write-behind batcher, and a
        direct read can miss one still sitting in the buffer. That exact bug
        silently emptied rework feedback when batching was introduced — the
        rework still ran, but blind.
        """
        from af.store.sqlite_store import loads
        rows = [r for r in self.quality.history(task_id) if r["verdict"] != "PASS"]
        if not rows:
            return []
        return list(loads(rows[-1]["findings"]) or [])

    def _escalate(self, packet, contract, instance_id, review, output) -> str:
        """Route a failed task upward, and open a CAPA so it is not just moved."""
        rule = next((r for r in contract.escalation if r.condition == "quality_failed"), None)
        action = rule.action if rule else "escalate_parent"
        self.telemetry.emit(Event(
            type=EventType.QUALITY_ESCALATED, trace_id=packet.trace_id, task_id=packet.id,
            project_id=packet.project_id, agent_id=instance_id, status="ESCALATE",
            payload={"action": action, "findings": review.findings[:10],
                     "score": round(review.score, 3)}))
        if action == "abort":
            self.queue.fail(packet.id, {"code": "quality_escalated_abort",
                                        "message": "; ".join(review.findings[:5])},
                            retryable=False)
            return TaskStatus.DEAD_LETTER.value
        # Park the task for human/higher-level attention rather than looping.
        # WAITING_APPROVAL is a terminal-for-the-worker state: no worker will
        # claim it again until something explicitly acts on it.
        self.queue.set_status(packet.id, TaskStatus.WAITING_APPROVAL,
                              result={"output": output, "review": review.to_dict()})
        return TaskStatus.WAITING_APPROVAL.value

    def _settle(self, usage, packet, instance_id, contract) -> None:
        self.budget.record(
            usage,
            scopes=[("task", packet.id), ("agent", instance_id),
                    ("project", packet.project_id), ("system", "system")],
            project_id=packet.project_id, task_id=packet.id, agent_id=instance_id,
            template_id=contract.template_id)

    def _remember(self, packet, contract, principal, instance_id, output, *, ok: bool) -> None:
        """Write the episodic record. Trust is DERIVED at best — a completed,
        gated execution is evidence, not ground truth."""
        if "episodic" not in contract.memory.writable_layers:
            return
        try:
            self.memory.write(
                principal=principal, layer=Layer.EPISODIC,
                key=f"execution:{packet.objective[:80]}",
                content=str(output)[:4000], project_id=packet.project_id,
                contract=contract, trust=Trust.DERIVED, agent_id=instance_id,
                template_id=contract.template_id, task_id=packet.id,
                provenance={"trace_id": packet.trace_id, "outcome": "ok" if ok else "failed"},
                ttl_seconds=contract.memory.episodic_ttl_seconds)
        except (PermissionDenied, Exception):
            # Memory is an optimisation, never a reason to fail completed work.
            pass

    def _fail(self, claimed, packet, exc, usage, instance_id, contract, started):
        code = getattr(exc, "code", "internal_error")
        retryable = getattr(exc, "retryable", False)
        usage.duration_ms = (time.perf_counter() - started) * 1000.0

        if isinstance(exc, ApprovalRequired):
            # Not a failure: the task is waiting on a human. Parking it stops
            # retries from burning attempts against a decision nobody has made.
            self.queue.set_status(packet.id, TaskStatus.WAITING_APPROVAL,
                                  error={"code": code, "message": str(exc)})
            status = TaskStatus.WAITING_APPROVAL.value
        else:
            backoff = contract.retry.delay_for(claimed.attempts) if contract else 1.0
            jitter = contract.retry.jitter if contract else 0.2
            status = self.queue.fail(
                packet.id, {"code": code, "message": str(exc)[:1000]},
                retryable=retryable, backoff_seconds=backoff, jitter=jitter)

        self.telemetry.emit(Event(
            type=EventType.TASK_FAILED, trace_id=packet.trace_id, task_id=packet.id,
            project_id=packet.project_id, agent_id=instance_id, status=status,
            error_code=code, duration_ms=usage.duration_ms,
            payload={"error": str(exc)[:500], "attempt": claimed.attempts,
                     "retryable": retryable}))
        if instance_id and packet.project_id:
            try:
                self._settle(usage, packet, instance_id, contract) if contract else None
            except Exception:
                pass
        return ExecutionResult(task_id=packet.id, status=status, error=str(exc),
                               error_code=code, usage=usage, instance_id=instance_id,
                               duration_ms=usage.duration_ms)
