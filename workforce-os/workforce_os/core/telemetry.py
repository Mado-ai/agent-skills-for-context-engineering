"""Cost and latency telemetry, recorded per call and aggregated on demand."""

from __future__ import annotations

from ..schemas import new_id, utcnow


class Telemetry:
    def __init__(self, db):
        self.db = db

    def record(self, *, project_id: str, metric: str, value: float, unit: str, source: str,
               agent_id: str | None = None, task_id: str | None = None,
               ref_id: str | None = None) -> None:
        self.db.execute(
            """INSERT INTO metrics (id, project_id, agent_id, task_id, metric, value, unit,
                   source, ref_id, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (new_id("mtr"), project_id, agent_id, task_id, metric, float(value), unit,
             source, ref_id, utcnow()))

    def record_call(self, *, project_id: str, agent_id: str | None, task_id: str | None,
                    source: str, cost_usd: float, latency_ms: float, tokens: int = 0,
                    ref_id: str | None = None) -> None:
        """Record the standard trio for one call."""
        for metric, value, unit in (("cost_usd", cost_usd, "usd"),
                                    ("latency_ms", latency_ms, "ms"),
                                    ("tokens", tokens, "tokens")):
            self.record(project_id=project_id, metric=metric, value=value, unit=unit,
                        source=source, agent_id=agent_id, task_id=task_id, ref_id=ref_id)

    def summary(self, *, project_id: str | None = None, agent_id: str | None = None,
                task_id: str | None = None) -> dict:
        """Totals plus per-metric aggregates for the requested scope."""
        where, params = "WHERE 1=1", []
        for column, value in (("project_id", project_id), ("agent_id", agent_id),
                              ("task_id", task_id)):
            if value:
                where += f" AND {column} = ?"
                params.append(value)

        rows = self.db.query(
            f"""SELECT metric, source, COUNT(*) AS samples, SUM(value) AS total,
                       AVG(value) AS average, MAX(value) AS maximum
                FROM metrics {where} GROUP BY metric, source""", tuple(params))

        totals: dict[str, float] = {}
        for row in rows:
            totals[row["metric"]] = totals.get(row["metric"], 0.0) + (row["total"] or 0.0)

        return {
            "scope": {"project_id": project_id, "agent_id": agent_id, "task_id": task_id},
            "totals": {
                "cost_usd": round(totals.get("cost_usd", 0.0), 6),
                "tokens": int(totals.get("tokens", 0)),
                "latency_ms": round(totals.get("latency_ms", 0.0), 3),
            },
            "by_metric": [
                {"metric": r["metric"], "source": r["source"], "samples": r["samples"],
                 "total": round(r["total"] or 0.0, 6), "average": round(r["average"] or 0.0, 6),
                 "maximum": round(r["maximum"] or 0.0, 6)}
                for r in rows
            ],
        }
