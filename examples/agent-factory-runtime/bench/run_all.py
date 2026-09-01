"""Run the full v0.4 benchmark matrix and write results as JSON.

Scenarios are executed as subprocesses so that peak-memory numbers are per
scenario rather than cumulative.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.join(HERE, "harness.py")
OUT = os.path.join(HERE, "results.json")

#: The mandate's required agent counts. Tasks scale with the fleet so that each
#: agent has real work; a scenario where 1,000 agents share 100 tasks would
#: measure idle capacity, not scale.
SCENARIOS = [
    {"agents": 10, "tasks": 500, "workers": 8},
    {"agents": 50, "tasks": 1000, "workers": 8},
    {"agents": 100, "tasks": 2000, "workers": 8},
    {"agents": 250, "tasks": 2500, "workers": 8},
    {"agents": 500, "tasks": 5000, "workers": 8},
    {"agents": 1000, "tasks": 10000, "workers": 8},
]

#: Worker-count sweep at a fixed fleet size, to find where added concurrency
#: stops helping — the real answer to "what is the bottleneck".
WORKER_SWEEP = [
    {"agents": 100, "tasks": 2000, "workers": w, "label": f"worker-sweep w={w}"}
    for w in (1, 2, 4, 8, 16, 32)
]

#: Work shapes: tool calls and CPU work change the balance between control-plane
#: overhead and useful work.
SHAPES = [
    {"agents": 100, "tasks": 1000, "workers": 8, "tool_calls": 2,
     "label": "with 2 tool calls/task"},
    {"agents": 100, "tasks": 1000, "workers": 8, "work_units": 20,
     "label": "with CPU work"},
    {"agents": 100, "tasks": 1000, "workers": 8, "fail_rate": 0.1,
     "label": "10% failure injection"},
]


def run_one(spec: dict) -> dict:
    cmd = [sys.executable, HARNESS,
           "--agents", str(spec["agents"]), "--tasks", str(spec["tasks"]),
           "--workers", str(spec["workers"]),
           "--db", f"/tmp/af_bench_{spec['agents']}_{spec['workers']}_"
                   f"{spec.get('tool_calls', 0)}_{spec.get('work_units', 0)}_"
                   f"{spec.get('fail_rate', 0)}.db"]
    if spec.get("label"):
        cmd += ["--label", spec["label"]]
    for key, flag in (("tool_calls", "--tool-calls"), ("work_units", "--work-units"),
                      ("fail_rate", "--fail-rate"), ("batch_size", "--batch-size")):
        if spec.get(key):
            cmd += [flag, str(spec[key])]
    started = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        return {"label": spec.get("label", str(spec)), "error": proc.stderr[-2000:],
                "wall_seconds": round(time.perf_counter() - started, 1)}
    result = json.loads(proc.stdout.strip().splitlines()[-1])
    result["wall_seconds"] = round(time.perf_counter() - started, 1)
    return result


def main() -> None:
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    groups = {"scale": SCENARIOS, "workers": WORKER_SWEEP, "shapes": SHAPES}
    if which == "all":
        selected = [("scale", SCENARIOS), ("workers", WORKER_SWEEP), ("shapes", SHAPES)]
    else:
        selected = [(which, groups[which])]

    from harness import environment
    out = {"environment": environment(), "groups": {}}
    for name, specs in selected:
        rows = []
        for spec in specs:
            print(f"[{name}] running {spec} ...", file=sys.stderr, flush=True)
            row = run_one(spec)
            status = row.get("error", f"{row.get('tasks_per_second', 0)} tasks/s")
            print(f"  -> {status}", file=sys.stderr, flush=True)
            rows.append(row)
        out["groups"][name] = rows

    existing = {}
    if os.path.exists(OUT):
        try:
            existing = json.load(open(OUT))
        except Exception:
            existing = {}
    merged = existing.get("groups", {})
    merged.update(out["groups"])
    out["groups"] = merged
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=2)
    print(f"\nwrote {OUT}", file=sys.stderr)


if __name__ == "__main__":
    sys.path.insert(0, HERE)
    main()
