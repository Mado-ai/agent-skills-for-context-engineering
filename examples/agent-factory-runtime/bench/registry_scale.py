"""Registry-scale probe: does lookup stay flat as the catalogue grows?

The mandate distinguishes *agent definitions* from *live instances* and asks for
higher registry/template counts where practical. This measures the read paths
the Chief uses on every planning cycle — capability search, listing,
duplicate detection — against catalogues from 100 to 10,000 templates.

Rows are inserted directly here rather than through the governed pipeline. That
is a deliberate shortcut and it is NOT a scale claim about agent creation: the
governed creation rate is measured separately in the main harness. This probe
answers one narrower question — whether registry *reads* degrade with catalogue
size.
"""

from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from af.contracts.schema import AgentCapability, AgentContract   # noqa: E402
from af.ids import new_id                                        # noqa: E402
from af.store.sqlite_store import dumps                          # noqa: E402
from af.system import build_system                               # noqa: E402
from bench.harness import percentiles                            # noqa: E402


def seed(system, project: str, n: int) -> None:
    now = system.clock.now()
    templates, contracts, caps = [], [], []
    for i in range(n):
        template_id, contract_id = new_id("tpl"), new_id("ctr")
        contract = AgentContract(
            id=contract_id, template_id=template_id, version=1,
            name=f"seeded-agent-{i}", role="specialist", level=2, project_id=project,
            mission="Seeded registry entry for scale measurement of read paths.",
            responsibilities=("work",), outputs=("result",),
            capabilities=(AgentCapability(name=f"capability_{i}"),),
            state="ACTIVE")
        templates.append((template_id, project, f"seeded-agent-{i}", "specialist", 2,
                          1, contract_id, "seed", now))
        contracts.append((contract_id, template_id, 1, project, "ACTIVE",
                          dumps(contract.to_dict()), contract.content_hash, "{}",
                          "seed", now, now))
        caps.append((contract_id, template_id, project, f"capability_{i}", "ACTIVE"))
    with system.store.write() as c:
        c.executemany(
            "INSERT INTO agent_templates (id, project_id, name, role, level, "
            "latest_version, active_contract_id, created_by, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)", templates)
        c.executemany(
            "INSERT INTO agent_contracts (id, template_id, version, project_id, state, "
            "spec, content_hash, validation, created_by, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)", contracts)
        c.executemany(
            "INSERT INTO agent_capabilities (contract_id, template_id, project_id, "
            "capability, state) VALUES (?,?,?,?,?)", caps)
    system.store.analyze()


def probe(system, project: str, samples: int = 30) -> dict:
    def timed(fn):
        out = []
        for i in range(samples):
            started = time.perf_counter()
            fn(i)
            out.append((time.perf_counter() - started) * 1000.0)
        return percentiles(out)

    return {
        "capability_search_ms": timed(
            lambda i: system.registry.find_by_capability(f"capability_{i}", project)),
        "list_page_ms": timed(
            lambda i: system.registry.list_templates(project, limit=50)),
        "duplicate_scan_ms": timed(
            lambda i: system.registry.find_duplicate_contracts(project)),
        "overview_ms": timed(lambda i: system.registry.workforce_overview(project)),
    }


def main() -> None:
    results = []
    for size in (100, 1_000, 5_000, 10_000):
        path = f"/tmp/af_registry_{size}.db"
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(path + suffix)
            except OSError:
                pass
        system = build_system(path)
        owner = system.owner()
        project = system.factory.create_project("registry-bench", principal=owner)
        started = time.perf_counter()
        seed(system, project, size)
        seed_seconds = time.perf_counter() - started
        row = {"templates": size, "seed_seconds": round(seed_seconds, 2),
               "db_mb": round(system.store.size_bytes() / (1024 * 1024), 2)}
        row.update(probe(system, project))
        results.append(row)
        print(f"{size:>6} templates: "
              f"capability_search p95={row['capability_search_ms']['p95']}ms  "
              f"list p95={row['list_page_ms']['p95']}ms  "
              f"dup_scan p95={row['duplicate_scan_ms']['p95']}ms",
              file=sys.stderr, flush=True)
        system.store.close()

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results.json")
    existing = json.load(open(out_path)) if os.path.exists(out_path) else {"groups": {}}
    existing.setdefault("groups", {})["registry"] = results
    with open(out_path, "w") as fh:
        json.dump(existing, fh, indent=2)
    print(f"wrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
