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
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openpitch import db, storage  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_metrica import FPS, build_analytics  # noqa: E402

JOB_ID = "metrica-demo"
TEAM_NAME = "Metrica FC"

# Deterministic name pool so jersey N always maps to the same real player name
# (the tracking data is anonymous — players are numbers — so we give the demo
# squad proper names and profiles).
_FIRST = ["James", "Liam", "Noah", "Oliver", "Lucas", "Mason", "Ethan", "Leo",
          "Marco", "Diego", "Kai", "Omar", "Yusuf", "Andre", "Mateo", "Felix",
          "Hugo", "Ivan", "Samir", "Theo", "Niko", "Adam", "Elias", "Raul"]
_LAST = ["Walker", "Reyes", "Bennett", "Costa", "Silva", "Moreno", "Haas",
         "Novak", "Larsen", "Okafor", "Bauer", "Rossi", "Nguyen", "Khan",
         "Mendez", "Carter", "Lindqvist", "Petrov", "Tahir", "Fontaine",
         "Vidal", "Park", "Romano", "Sauer"]


def name_for(jersey: int) -> str:
    return f"{_FIRST[(jersey * 7) % len(_FIRST)]} {_LAST[(jersey * 13) % len(_LAST)]}"


def position_for(jersey: int) -> str:
    if jersey == 1:
        return "GK"
    if jersey <= 5:
        return "DF"
    if jersey <= 8:
        return "MF"
    return "FW"


def build_team(user_id: int, players: list[dict], minutes: int) -> tuple[str, int]:
    """Create a fully-named demo squad with one match's worth of real stats.

    Replicates the dashboard's auto-import: the Home side's detected players
    (keyed by jersey) become named roster players with per-match metrics.
    Idempotent — drops any existing demo team first.
    """
    for t in db.list_teams(user_id):
        if t["name"] == TEAM_NAME:
            db.delete_team(t["id"])

    home = sorted(
        (p for p in players if p["team"] == "Home" and p.get("jersey") is not None),
        key=lambda p: p["jersey"],
    )[:14]

    team_id = "team_" + uuid.uuid4().hex[:10]
    db.create_team(team_id, user_id, TEAM_NAME)
    match_id = "match_" + uuid.uuid4().hex[:10]
    db.create_match(match_id, user_id, team_id, 11, "Away XI (5-min sample)",
                    "2026-06-21", JOB_ID, 2, 1, None)

    for p in home:
        j = p["jersey"]
        pid = "ply_" + uuid.uuid4().hex[:10]
        db.create_player(pid, team_id, name_for(j), position_for(j), j, is_minor=False)
        db.add_player_stat(
            "st_" + uuid.uuid4().hex[:10], match_id, pid, minutes,
            float(p.get("distance_m") or 0), float(p.get("top_speed_ms") or 0),
            0, 0, int(p.get("sprints") or 0), int(p.get("passes") or 0))
    return team_id, len(home)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--frames", type=int, default=7500,
                    help="frame window to analyse (0 = whole match)")
    ap.add_argument("--cache", type=Path,
                    default=Path(tempfile.gettempdir()) / "openpitch-metrica")
    ap.add_argument("--email", default=os.environ.get(
        "PLAYMETRICS_ADMIN_EMAIL", "yazanalshuibe14@gmail.com"))
    ap.add_argument("--no-team", action="store_true",
                    help="seed only the dashboard job, not the named demo squad")
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

    if not args.no_team:
        minutes = max(1, round(n / FPS / 60))
        team_id, roster = build_team(user["id"], summary["players"], minutes)
        print(f"seeded named team {TEAM_NAME!r} ({roster} players) with "
              f"one imported match — id {team_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

