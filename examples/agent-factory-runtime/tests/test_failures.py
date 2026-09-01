"""Failure-mode tests (mandate §7).

Every scenario the mandate names, plus the ones found while building. The
standard each must meet is not "does not crash" but **fails safely**: no work
silently lost, no limit silently bypassed, no unbounded growth.
"""

from __future__ import annotations

import threading

import pytest

from af.clock import ManualClock
from af.errors import (BudgetExceeded, PermissionDenied, ProviderError, QueueFull,
                       SpawnLimitExceeded, TokenInvalid)
from af.router.model_router import ModelRouter
from af.router.providers import MockProvider, ModelRequest, ModelSpec
from af.runtime import DeterministicBehaviour, ExecutionContext
from af.scheduler.queue import TaskQueue
from af.store.sqlite_store import SqliteStore
from af.system import build_system
from af.workpacket import Priority, TaskStatus, WorkPacket


# --- worker crash ----------------------------------------------------------
def test_worker_crash_returns_work_via_lease_expiry(system, clock, project):
    task = WorkPacket(project_id=project, objective="survive a crash", max_attempts=3)
    system.queue.submit(task)
    system.queue.claim("doomed-worker", lease_seconds=30)
    assert system.queue.get(task.id)["status"] == TaskStatus.RUNNING.value

    # The worker dies. Nothing signals this; the lease simply lapses.
    assert system.queue.reap_expired_leases() == 0
    clock.advance(31)
    assert system.queue.reap_expired_leases() == 1
    assert system.queue.get(task.id)["status"] == TaskStatus.READY.value


def test_poison_message_dead_letters_instead_of_looping(system, clock, project):
    """A task that kills every worker must stop, not cycle forever."""
    task = WorkPacket(project_id=project, objective="poison", max_attempts=2)
    system.queue.submit(task)
    for _ in range(4):
        system.queue.claim("w", lease_seconds=10)
        clock.advance(11)
        system.queue.reap_expired_leases()
    row = system.queue.get(task.id)
    assert row["status"] == TaskStatus.DEAD_LETTER.value
    assert row["dlq_reason"] == "lease_expired_exhausted"


# --- model failures ---------------------------------------------------------
def test_model_timeout_fails_over_then_opens_breaker(clock, system):
    bad = [ModelSpec("bad-1", "badprov", "standard", "intermediate", 200_000, 100, 10, 10)]
    good = [ModelSpec("good-1", "goodprov", "standard", "intermediate", 200_000, 500, 900, 4500)]
    router = ModelRouter(system.telemetry, clock)
    router.register(MockProvider("badprov", timeout_rate=1.0, specs=bad))
    router.register(MockProvider("goodprov", specs=good))
    from af.contracts.schema import ModelPolicy
    policy = ModelPolicy(max_context_tokens=100_000, max_latency_ms=30_000)

    assert router.select(policy).model.model_id == "bad-1"       # primary
    response, _ = router.complete(policy, ModelRequest(prompt="x"))
    assert response.model_id == "good-1"                          # failed over

    for i in range(6):
        try:
            router.complete(policy, ModelRequest(prompt=f"q{i}"))
        except ProviderError:
            pass
    assert router.breaker.state("badprov") == "OPEN"
    assert router.select(policy).model.model_id == "good-1"       # breaker respected


def test_total_provider_outage_fails_cleanly(clock, system):
    spec = [ModelSpec("only", "p", "standard", "intermediate", 200_000, 100, 10, 10)]
    router = ModelRouter(system.telemetry, clock)
    router.register(MockProvider("p", failure_rate=1.0, specs=spec))
    from af.contracts.schema import ModelPolicy
    with pytest.raises(ProviderError) as exc:
        router.complete(ModelPolicy(max_context_tokens=100_000, max_latency_ms=30_000),
                        ModelRequest(prompt="x"))
    assert "all candidate models failed" in exc.value.message


# --- malformed output --------------------------------------------------------
def test_malformed_output_is_caught_by_the_gate_not_the_runtime(system, chief, owner, project):
    class Garbage:
        def __call__(self, ctx: ExecutionContext):
            return {"totally": "wrong", "shape": [1, 2, 3]}

    system.runtime.behaviour = Garbage()
    contract = chief.propose_specialist(capability="malformed_demo", project_id=project,
                                        outputs=("result",))
    active = system.factory.activate(contract.id, principal=owner)
    chief.assign(objective="produce", project_id=project, template_id=active.template_id)
    result = system.runtime.execute(system.queue.claim("w")[0])
    # The runtime survives; the gate makes the judgement.
    assert result.verdict in ("REWORK", "REJECT")
    assert any("missing required property" in f for f in result.review.findings)


def test_behaviour_exception_does_not_kill_the_worker(system, chief, owner, project):
    class Exploding:
        def __call__(self, ctx: ExecutionContext):
            raise RuntimeError("behaviour blew up")

    system.runtime.behaviour = Exploding()
    contract = chief.propose_specialist(capability="explode_demo", project_id=project)
    active = system.factory.activate(contract.id, principal=owner)
    task_id = chief.assign(objective="boom", project_id=project,
                           template_id=active.template_id)
    result = system.runtime.execute(system.queue.claim("w")[0])
    assert result.error_code == "internal_error"
    # An unexpected exception is not retryable, so it dead-letters rather than
    # looping on a bug that will reproduce identically.
    assert system.queue.get(task_id)["status"] == TaskStatus.DEAD_LETTER.value


# --- recursion & spawn ---------------------------------------------------------
def test_recursive_spawn_is_bounded(system, chief, owner, project):
    """An agent that tries to spawn without limit is stopped by the runtime."""
    contract = chief.propose_specialist(capability="spawner", project_id=project)
    active = system.factory.activate(contract.id, principal=owner)

    class Recursive:
        def __call__(self, ctx: ExecutionContext):
            for i in range(1000):        # deliberately unbounded intent
                ctx.delegate(f"child {i}", template_id=active.template_id)
            return {"result": "never reached"}

    system.runtime.behaviour = Recursive()
    chief.assign(objective="spawn forever", project_id=project,
                 template_id=active.template_id)
    result = system.runtime.execute(system.queue.claim("w")[0])
    assert result.error_code in ("spawn_limit_exceeded", "permission_denied")
    children = system.store.scalar("SELECT count(*) FROM tasks WHERE parent_id IS NOT NULL")
    assert children <= active.runtime.max_children_per_task


def test_spawn_depth_and_tree_size_are_independent_limits(system, project):
    from af.budget.governor import BudgetGovernor
    governor = system.budget
    with pytest.raises(SpawnLimitExceeded) as exc:
        governor.check_spawn(depth=9, max_depth=3, root_id="r", max_total_spawns=100,
                             children_so_far=0, max_children=8)
    assert exc.value.details["reason"] == "depth"
    with pytest.raises(SpawnLimitExceeded) as exc:
        governor.check_spawn(depth=1, max_depth=3, root_id="r", max_total_spawns=100,
                             children_so_far=8, max_children=8)
    assert exc.value.details["reason"] == "fan_out"


def test_delegation_can_only_narrow_authority():
    parent = WorkPacket(project_id="p", objective="parent", budget_micros=1_000,
                        token_budget=5_000, spawn_budget=2, allowed_tools=("a", "b"))
    child = parent.child(objective="child", budget_micros=10**9, token_budget=10**9,
                         spawn_budget=99, allowed_tools=("a", "c", "d"))
    assert child.budget_micros == 1_000
    assert child.token_budget == 5_000
    assert child.spawn_budget == 1
    assert child.allowed_tools == ("a",)      # 'c' and 'd' were never the parent's
    assert child.depth == parent.depth + 1


# --- cost -----------------------------------------------------------------------
def test_excessive_cost_request_is_refused_before_spending(system, project):
    system.budget.set_budget("project", project, cost_limit_micros=1_000)
    with pytest.raises(BudgetExceeded):
        system.budget.check([("project", project)], cost_micros=10_000, project_id=project)
    state = system.budget.get("project", project)
    assert state.spend_micros == 0          # nothing was spent to discover this


def test_token_budget_stops_a_runaway_behaviour_mid_flight(system, chief, owner, project):
    class Chatty:
        def __call__(self, ctx: ExecutionContext):
            for _ in range(500):
                ctx.complete_model_call(ModelRequest(prompt="x" * 4000, max_tokens=4000))
            return {"result": "done"}

    contract = chief.propose_specialist(capability="chatty", project_id=project)
    active = system.factory.activate(contract.id, principal=owner)
    system.runtime.behaviour = Chatty()
    chief.assign(objective="burn tokens", project_id=project,
                 template_id=active.template_id, token_budget=5_000)
    result = system.runtime.execute(system.queue.claim("w")[0])
    assert result.error_code == "budget_exceeded"


# --- approvals ------------------------------------------------------------------
def test_expired_approval_cannot_be_used(system, clock, project):
    from af.governance.permissions import Principal, PrincipalKind
    from af.errors import ApprovalExpired
    agent = Principal(id="a1", kind=PrincipalKind.AGENT, level=3, project_id=project,
                      granted=frozenset({"tool.call"}))
    request = system.approvals.request(
        principal=agent, project_id=project, action="email.send", risk_level="R3",
        reason="r", params={"to": "a@b.com"}, tool_id="email.send", ttl_seconds=10)
    clock.advance(20)
    with pytest.raises(ApprovalExpired):
        system.approvals.decide(request.id, principal=system.owner(), approve=True)


def test_expired_token_cannot_be_redeemed(system, clock, project):
    from af.governance.permissions import Principal, PrincipalKind
    agent = Principal(id="a1", kind=PrincipalKind.AGENT, level=3, project_id=project,
                      granted=frozenset({"tool.call"}))
    params = {"to": "a@b.com", "subject": "s", "body": "b"}
    request = system.approvals.request(
        principal=agent, project_id=project, action="email.send", risk_level="R3",
        reason="r", params=params, tool_id="email.send")
    token = system.approvals.decide(request.id, principal=system.owner(), approve=True,
                                    token_ttl_seconds=60)
    clock.advance(61)
    with pytest.raises(TokenInvalid) as exc:
        system.approvals.consume(token.bearer(), agent_id="a1", tool_id="email.send",
                                 params=params)
    assert exc.value.details["reason"] == "token expired"


# --- queue -------------------------------------------------------------------------
def test_duplicate_submission_is_idempotent(system, project):
    a = WorkPacket(project_id=project, objective="once", idempotency_key="K")
    b = WorkPacket(project_id=project, objective="again", idempotency_key="K")
    assert system.queue.submit(a) == system.queue.submit(b)
    assert system.store.scalar(
        "SELECT count(*) FROM tasks WHERE idempotency_key = 'K'") == 1


def test_backpressure_rejects_rather_than_growing_unbounded(system, project):
    system.queue.max_queue_depth = 5
    accepted = 0
    with pytest.raises(QueueFull):
        for i in range(50):
            system.queue.submit(WorkPacket(project_id=project, objective=f"t{i}"))
            accepted += 1
    assert accepted == 5


def test_retry_storm_is_spread_by_jitter(system, project):
    """A thousand tasks failing together must not retry in the same instant."""
    delays = set()
    for i in range(50):
        task = WorkPacket(project_id=project, objective=f"t{i}", max_attempts=5)
        system.queue.submit(task)
        system.queue.claim("w")
        system.queue.fail(task.id, {"code": "provider_error"}, retryable=True,
                          backoff_seconds=10.0, jitter=0.5)
        delays.add(round(system.queue.get(task.id)["available_at"], 4))
    assert len(delays) > 40, "retry times are not spread; a storm would recur"


def test_dead_letter_releases_waiting_dependents(system, project):
    dep = WorkPacket(project_id=project, objective="dep")
    waiter = WorkPacket(project_id=project, objective="waiter")
    system.queue.submit(dep)
    system.queue.submit(waiter, depends_on=[dep.id])
    system.queue.claim("w")
    system.queue.fail(dep.id, {"code": "fatal"}, retryable=False)
    row = system.queue.get(waiter.id)
    # Must not block forever on a dead branch.
    assert row["status"] == TaskStatus.CANCELLED.value
    assert row["dlq_reason"] == "dependency_failed"


def test_missing_receiver_fails_the_task_safely(system, project):
    orphan = WorkPacket(project_id=project, objective="nobody home",
                        receiver_template_id="tpl_does_not_exist")
    system.queue.submit(orphan)
    result = system.runtime.execute(system.queue.claim("w")[0])
    assert result.error_code == "not_found"
    assert system.queue.get(orphan.id)["status"] == TaskStatus.DEAD_LETTER.value


# --- concurrency ---------------------------------------------------------------------
def test_no_task_is_delivered_twice_under_concurrent_claims(tmp_path):
    """The claim must be atomic across real threads, not just in theory."""
    from af.telemetry.events import Telemetry
    store = SqliteStore(str(tmp_path / "claims.db"))
    telemetry = Telemetry(store, buffer_size=1000)
    queue = TaskQueue(store, telemetry)
    store.execute("INSERT INTO projects (id,name,status,created_at) VALUES ('p','p','active',1)")
    queue.submit_many([WorkPacket(project_id="p", objective=f"t{i}") for i in range(400)])

    seen: list[str] = []
    lock = threading.Lock()

    def worker(name: str) -> None:
        while True:
            batch = queue.claim(name, limit=7)
            if not batch:
                return
            with lock:
                seen.extend(t.id for t in batch)

    threads = [threading.Thread(target=worker, args=(f"w{i}",)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(seen) == 400
    assert len(set(seen)) == 400, "a task was delivered to more than one worker"


def test_concurrency_limit_cannot_be_exceeded_by_racing_reservations(system, specialist,
                                                                     project, owner):
    handle = system.factory.acquire_instance(specialist.template_id, project,
                                             principal=owner)
    limit = specialist.runtime.concurrency_limit
    granted = sum(1 for _ in range(limit * 4)
                  if system.factory.reserve_instance(handle.id, limit))
    assert granted == limit
    row = system.registry.get_instance(handle.id)
    assert row["inflight"] == limit


def test_double_release_cannot_drive_inflight_negative(system, specialist, project, owner):
    handle = system.factory.acquire_instance(specialist.template_id, project,
                                             principal=owner)
    system.factory.reserve_instance(handle.id, 4)
    for _ in range(5):
        system.factory.release_instance(handle.id)
    assert system.registry.get_instance(handle.id)["inflight"] == 0


def test_database_contention_does_not_lose_writes(tmp_path):
    """Concurrent writers under WAL + BEGIN IMMEDIATE must all land."""
    store = SqliteStore(str(tmp_path / "contention.db"))
    errors: list[Exception] = []

    def writer(n: int) -> None:
        try:
            for i in range(100):
                store.execute(
                    "INSERT INTO events (id, ts, type, payload) VALUES (?,?,?,?)",
                    (f"e{n}_{i}", 1.0, "t", "{}"))
        except Exception as exc:      # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, errors[:3]
    assert store.scalar("SELECT count(*) FROM events") == 800
