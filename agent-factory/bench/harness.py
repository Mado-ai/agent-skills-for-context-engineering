"""Benchmark harness for AI Agent Factory v0.4.

Two rules govern everything here, both from the mandate:

1. **Do not claim scale because rows exist.** Every number below comes from
   tasks actually flowing through the real runtime — queue, governance,
   telemetry, quality gates, budget ledger — not from counting inserts.

2. **Separate control-plane scalability from model-provider scalability.**
   Benchmarks run with ``DeterministicBehaviour`` and zero simulated model
   latency, so ``tasks/second`` measures the infrastructure. A provider rate
   limit is a different ceiling and is modelled separately, not conflated with
   an architecture limit.

Measured on the machine described by ``environment()`` and reported honestly,
including the parts that are slow.
"""

from __future__ import annotations

import gc
import json
import os
import platform
import resource
import statistics
import sys
import time
from dataclasses import asdict, dataclass, field
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from af.chief import ChiefAgentArchitect            # noqa: E402
from af.runtime import DeterministicBehaviour       # noqa: E402
from af.scheduler.worker import WorkerPool          # noqa: E402
from af.system import build_system                  # noqa: E402
from af.workpacket import Priority, WorkPacket      # noqa: E402

__all__ = ["BenchResult", "run_scenario", "environment", "percentiles"]


def environment() -> dict[str, Any]:
    try:
        import sqlite3
        sqlite_version = sqlite3.sqlite_version
    except Exception:
        sqlite_version = "unknown"
    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "processor": platform.machine(),
        "cpu_count": os.cpu_count(),
        "sqlite": sqlite_version,
    }


def rss_mb() -> float:
    """Peak resident set size. ru_maxrss is KB on Linux, bytes on macOS."""
    raw = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return raw / 1024.0 if sys.platform != "darwin" else raw / (1024.0 * 1024.0)


def percentiles(values: list[float]) -> dict[str, float]:
    if not values:
        return {"p50": 0.0, "p95": 0.0, "p99": 0.0, "max": 0.0, "mean": 0.0}
    ordered = sorted(values)

    def at(q: float) -> float:
        # Nearest-rank. With small samples an interpolating percentile invents
        # values that were never observed, which is misleading in a report.
        idx = min(len(ordered) - 1, max(0, int(round(q * len(ordered))) - 1))
        return ordered[idx]

    return {"p50": round(at(0.50), 3), "p95": round(at(0.95), 3),
            "p99": round(at(0.99), 3), "max": round(ordered[-1], 3),
            "mean": round(statistics.fmean(ordered), 3)}


@dataclass
class BenchResult:
    label: str
    agents: int
    tasks: int
    workers: int
    # factory phase
    factory_seconds: float = 0.0
    contracts_per_second: float = 0.0
    # execution phase
    execution_seconds: float = 0.0
    tasks_per_second: float = 0.0
    completed: int = 0
    failed: int = 0
    error_rate: float = 0.0
    retry_rate: float = 0.0
    # latencies (ms)
    queue_latency: dict[str, float] = field(default_factory=dict)
    execution_latency: dict[str, float] = field(default_factory=dict)
    claim_latency: dict[str, float] = field(default_factory=dict)
    db_write_latency: dict[str, float] = field(default_factory=dict)
    # resources
    peak_rss_mb: float = 0.0
    db_size_mb: float = 0.0
    events_written: int = 0
    events_per_task: float = 0.0
    ledger_rows: int = 0
    final_queue_depth: int = 0
    live_instances: int = 0
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _make_specialists(system, chief, owner, project: str, n: int) -> tuple[list[str], float]:
    """Create and activate ``n`` specialists through the real governed pipeline.

    Every one goes DRAFT → VALIDATION → TESTING → APPROVAL → ACTIVE with full
    validation. This is the honest cost of governed agent creation.
    """
    started = time.perf_counter()
    template_ids = []
    for i in range(n):
        contract = chief.propose_specialist(
            capability=f"bench_capability_{i}", project_id=project,
            outputs=("result",))
        active = system.factory.activate(contract.id, principal=owner)
        template_ids.append(active.template_id)
    return template_ids, time.perf_counter() - started


def run_scenario(*, agents: int, tasks: int, workers: int, db_path: str,
                 label: str = "", tool_calls: int = 0, work_units: int = 0,
                 fail_rate: float = 0.0, batch_size: int = 8,
                 event_buffer: int = 512) -> BenchResult:
    """One full scenario: build a workforce, submit work, drain it, measure."""
    gc.collect()
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(db_path + suffix)
        except OSError:
            pass

    system = build_system(
        db_path,
        behaviour=DeterministicBehaviour(tool_calls=tool_calls, work_units=work_units,
                                         fail_rate=fail_rate,
                                         tool_id="kb.search"),
        max_queue_depth=1_000_000, event_buffer=event_buffer)
    owner = system.owner()
    chief = ChiefAgentArchitect(system)
    chief.bootstrap(owner)
    project = system.factory.create_project("bench", principal=owner)

    result = BenchResult(label=label or f"{agents} agents", agents=agents,
                         tasks=tasks, workers=workers)

    # --- phase 1: build the workforce ---------------------------------
    template_ids, factory_seconds = _make_specialists(system, chief, owner, project, agents)
    result.factory_seconds = round(factory_seconds, 3)
    result.contracts_per_second = round(agents / factory_seconds, 2) if factory_seconds else 0.0

    # --- phase 2: submit work ------------------------------------------
    # Bulk submit: the realistic shape for a fan-out, and it isolates queue
    # drain throughput from submission overhead.
    packets = []
    for i in range(tasks):
        template_id = template_ids[i % len(template_ids)]
        packets.append(WorkPacket(
            project_id=project, objective=f"bench task {i}",
            sender_agent_id="chief", receiver_template_id=template_id,
            allowed_tools=("kb.search",),
            required_output_schema={"type": "object", "required": ["result"]},
            priority=int(Priority.NORMAL), budget_micros=50_000, token_budget=50_000))
    submit_started = time.perf_counter()
    for chunk in range(0, len(packets), 500):
        system.queue.submit_many(packets[chunk:chunk + 500])
    submit_seconds = time.perf_counter() - submit_started
    system.telemetry.flush()
    system.store.analyze()          # give the planner statistics before timing

    # --- phase 3: drain -------------------------------------------------
    pool = WorkerPool(system.queue, system.runtime, system.telemetry,
                      size=workers, batch_size=batch_size, lease_seconds=120.0)
    gc.collect()
    drain_started = time.perf_counter()
    stats = pool.run(max_seconds=900.0, drain=True, max_idle_polls=25)
    execution_seconds = time.perf_counter() - drain_started

    system.telemetry.flush()
    queue_stats = system.queue.stats(project)

    result.execution_seconds = round(execution_seconds, 3)
    result.tasks_per_second = round(stats.completed / execution_seconds, 2) if execution_seconds else 0.0
    result.completed = stats.completed
    result.failed = stats.failed
    total = stats.completed + stats.failed
    result.error_rate = round(stats.failed / total, 5) if total else 0.0
    attempts = system.store.scalar("SELECT COALESCE(SUM(attempts),0) FROM tasks") or 0
    result.retry_rate = round(max(0, attempts - total) / total, 5) if total else 0.0
    result.queue_latency = percentiles(stats.queue_waits_ms)
    result.execution_latency = percentiles(stats.latencies_ms)

    # --- phase 4: isolated measurements ----------------------------------
    result.claim_latency = _measure_claim_latency(system, project)
    result.db_write_latency = _measure_write_latency(system)

    result.peak_rss_mb = round(rss_mb(), 1)
    result.db_size_mb = round(system.store.size_bytes() / (1024 * 1024), 2)
    result.events_written = system.store.scalar("SELECT count(*) FROM events") or 0
    result.events_per_task = round(result.events_written / max(1, total), 2)
    result.ledger_rows = system.store.scalar("SELECT count(*) FROM usage_ledger") or 0
    result.final_queue_depth = queue_stats.depth
    result.live_instances = system.registry.workforce_overview(project)["live_instances"]
    result.notes = (f"submit={submit_seconds:.2f}s for {tasks} packets; "
                    f"empty_polls={stats.empty_polls}")
    system.store.close()
    return result


def _measure_claim_latency(system, project: str, samples: int = 200) -> dict[str, float]:
    """Claim latency against the drained table.

    Measured after the drain so the tasks table holds its full history — this is
    the number that reveals whether the claim index is doing its job as history
    accumulates, which is the failure mode that only appears at scale.
    """
    packets = [WorkPacket(project_id=project, objective=f"probe {i}") for i in range(samples)]
    system.queue.submit_many(packets)
    timings = []
    for _ in range(samples):
        started = time.perf_counter()
        claimed = system.queue.claim("probe", limit=1)
        timings.append((time.perf_counter() - started) * 1000.0)
        if not claimed:
            break
    return percentiles(timings)


def _measure_write_latency(system, samples: int = 200) -> dict[str, float]:
    """Single-row insert latency: the floor under every other operation."""
    timings = []
    for i in range(samples):
        started = time.perf_counter()
        system.store.execute(
            "INSERT INTO events (id, ts, type, payload) VALUES (?,?,?,?)",
            (f"probe_{i}_{time.time_ns()}", time.time(), "bench.probe", "{}"))
        timings.append((time.perf_counter() - started) * 1000.0)
    return percentiles(timings)


def _cli() -> None:
    """Run one scenario and print JSON.

    Each scenario runs in its own process because ``ru_maxrss`` is a *peak*
    across the whole process lifetime — running scenarios in sequence would
    report the largest scenario's memory for every subsequent one.
    """
    import argparse

    parser = argparse.ArgumentParser(description="Run one AF v0.4 benchmark scenario")
    parser.add_argument("--agents", type=int, required=True)
    parser.add_argument("--tasks", type=int, required=True)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--db", default="/tmp/af_bench.db")
    parser.add_argument("--label", default="")
    parser.add_argument("--tool-calls", type=int, default=0)
    parser.add_argument("--work-units", type=int, default=0)
    parser.add_argument("--fail-rate", type=float, default=0.0)
    parser.add_argument("--batch-size", type=int, default=8)
    args = parser.parse_args()

    result = run_scenario(
        agents=args.agents, tasks=args.tasks, workers=args.workers, db_path=args.db,
        label=args.label or f"{args.agents} agents", tool_calls=args.tool_calls,
        work_units=args.work_units, fail_rate=args.fail_rate, batch_size=args.batch_size)
    print(json.dumps(result.to_dict()))


if __name__ == "__main__":
    _cli()
