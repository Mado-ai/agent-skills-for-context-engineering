#!/usr/bin/env python3
"""Seed a real-data demo analysis into the dashboard.

Runs the Metrica Sports Sample_Game_1 ground-truth tracking data through the
same ``Analytics`` engine the video pipeline uses, then writes the result as a
finished job for the admin account — so the dashboard shows real possession,
movement, passing, xT and xG out of the box (the synthetic clip has no on-ball
events, leaving those panels empty).

Run against the same DB/storage the server uses (i.e. with the same
PLAYMETRICS_* env vars):

    python scripts/seed_demo.py
    python scripts/seed_demo.py --frames 0   # whole match (slower)

It is idempotent: re-running replaces the existing demo job.
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openpitch import db, storage  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_metrica import FPS, build_analytics  # noqa: E402

JOB_ID = "metrica-demo"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--frames", type=int, default=7500,
                    help="frame window to analyse (0 = whole match)")
    ap.add_argument("--cache", type=Path,
                    default=Path(tempfile.gettempdir()) / "openpitch-metrica")
    ap.add_argument("--email", default=os.environ.get(
        "PLAYMETRICS_ADMIN_EMAIL", "yazanalshuibe14@gmail.com"))
    args = ap.parse_args()

    db.init_db()
    user = db.get_user_by_email(args.email)
    if not user:
        print(f"admin user {args.email!r} not found — start the server once to seed it",
              file=sys.stderr)
        return 1

    print("running Metrica sample through the analytics engine…", file=sys.stderr)
    engine, n = build_analytics(args.frames, args.cache)

    store = storage.get_storage()
    out_dir = store.job_dir(JOB_ID)
    summary = engine.summary(out_dir)  # writes heatmap PNGs into the job dir
    store.finalize_job(JOB_ID)

    full = {
        "possession": summary["possession"],
        "possession_timeline": summary["possession_timeline"],
        "players": summary["players"][:28],
        "team_stats": summary["team_stats"],
        "heatmaps": summary["heatmaps"],
        "highlights": [],
        "broadcast": False,  # tracking data has no broadcast video
        "meta": {
            "source": "Metrica Sample Game 1",
            "data": "ground-truth tracking",
            "minutes": round(n / FPS / 60, 1),
            "fps": FPS,
        },
    }

    db.delete_job(JOB_ID)  # idempotent replace
    db.create_job(JOB_ID, user["id"], "Metrica Sample — real tracking data",
                  detector="tracking", source="seed")
    db.update_job(JOB_ID, status="done", progress=1.0, message="done", summary=full)

    ts = summary["team_stats"]
    print(f"seeded job {JOB_ID!r} for {args.email}: "
          f"{n} frames · possession {summary['possession']} · "
          f"shots {sum(t['shots'] for t in ts.values())} · "
          f"xG {round(sum(t['xg'] for t in ts.values()), 2)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
