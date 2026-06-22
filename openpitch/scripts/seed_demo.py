#!/usr/bin/env python3
"""Seed the database with rich, realistic demo data.

Two parts:

1. A real-data **dashboard analysis** — the Metrica Sports Sample_Game_1
   ground-truth tracking run through the Analytics engine and stored as a
   finished job, so the dashboard's charts (possession, xT, shots → xG, …)
   populate out of the box.

2. Two fully-named **teams** (14 players each: real-looking names, positions,
   jersey numbers) and a handful of recorded matches with timestamps and
   realistic per-player stats — distance, top speed, sprints, passing with
   accuracy, goals and assists. One match is linked to the dashboard analysis
   so the "import stats from analysis" data path is demonstrable.

Run against the same DB/storage the server uses (same PLAYMETRICS_* env vars):

    python scripts/seed_demo.py
    python scripts/seed_demo.py --no-teams   # dashboard job only

Idempotent: re-running replaces the demo job and the demo teams.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import random
import sys
import tempfile
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openpitch import db, storage  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_metrica import FPS, build_analytics  # noqa: E402

JOB_ID = "metrica-demo"

_FIRST = ["James", "Liam", "Noah", "Oliver", "Lucas", "Mason", "Ethan", "Leo",
          "Marco", "Diego", "Kai", "Omar", "Yusuf", "Andre", "Mateo", "Felix",
          "Hugo", "Ivan", "Samir", "Theo", "Niko", "Adam", "Elias", "Raul",
          "Tomas", "Bruno", "Karim", "Luka", "Pavel", "Sven"]
_LAST = ["Walker", "Reyes", "Bennett", "Costa", "Silva", "Moreno", "Haas",
         "Novak", "Larsen", "Okafor", "Bauer", "Rossi", "Nguyen", "Khan",
         "Mendez", "Carter", "Lindqvist", "Petrov", "Tahir", "Fontaine",
         "Vidal", "Park", "Romano", "Sauer", "Ibrahim", "Andersson",
         "Marchetti", "Dubois", "Keller", "Sokolov"]

# (position, full-90 distance km range, top-speed m/s range, sprint range,
#  passes-attempted range, pass-accuracy % range)
_PROFILE = {
    "GK":  (4.8, 5.6, 6.4, 7.4, 0, 3, 22, 38, 72, 90),
    "DEF": (9.6, 11.0, 8.0, 9.4, 10, 24, 45, 80, 80, 93),
    "MID": (10.6, 12.4, 8.2, 9.6, 16, 32, 55, 95, 78, 92),
    "FWD": (9.4, 11.4, 8.6, 10.2, 18, 38, 28, 55, 70, 86),
}
# 14-man squad shape (jersey -> role family + label).
_SQUAD = [
    ("GK", "GK"), ("DEF", "RB"), ("DEF", "CB"), ("DEF", "CB"), ("DEF", "LB"),
    ("MID", "CDM"), ("MID", "CM"), ("MID", "CAM"), ("FWD", "RW"), ("FWD", "ST"),
    ("FWD", "LW"), ("GK", "GK"), ("DEF", "CB"), ("FWD", "ST"),
]

TEAMS = ["Northgate United", "Riverside Athletic"]
# Per-team match fixtures: (opponent, field_type, our_score, opp_score, days_ago,
#                           link_to_analysis)
_FIXTURES = [
    [("Riverside Athletic", 11, 3, 1, 35, False),
     ("Eastfield Rangers", 11, 2, 2, 21, False),
     ("Hilltop FC", 7, 1, 0, 12, False),
     ("Metrica Sample", 11, 2, 1, 4, True)],
    [("Northgate United", 11, 1, 3, 35, False),
     ("Parkside City", 11, 2, 0, 19, False),
     ("Eastfield Rangers", 11, 0, 0, 9, False)],
]


def _name(team_idx: int, jersey: int) -> str:
    f = _FIRST[(team_idx * 17 + jersey * 7) % len(_FIRST)]
    last = _LAST[(team_idx * 11 + jersey * 13) % len(_LAST)]
    return f"{f} {last}"


def _stat_line(rng: random.Random, family: str, minutes: int) -> dict:
    d0, d1, s0, s1, sp0, sp1, p0, p1, a0, a1 = _PROFILE[family]
    scale = minutes / 90.0
    passes = round(rng.randint(p0, p1) * scale)
    acc = rng.uniform(a0, a1)
    return {
        "distance_m": round(rng.uniform(d0, d1) * 1000 * scale),
        "top_speed_ms": round(rng.uniform(s0, s1), 1),
        "sprints": round(rng.randint(sp0, sp1) * scale),
        "passes": passes,
        "passes_completed": round(passes * acc / 100),
    }


def _distribute(n: int, pool: list[int], rng: random.Random) -> dict[int, int]:
    out: dict[int, int] = {}
    for _ in range(n):
        if pool:
            k = rng.choice(pool)
            out[k] = out.get(k, 0) + 1
    return out


def build_teams(user_id: int) -> list[str]:
    """Create two named squads with several timestamped matches of real-looking
    stats. Idempotent — drops any prior demo team of the same name first."""
    existing = {t["name"]: t["id"] for t in db.list_teams(user_id)}
    for name in TEAMS:
        if name in existing:
            db.delete_team(existing[name])

    today = dt.date(2026, 6, 21)
    team_ids: list[str] = []
    for ti, tname in enumerate(TEAMS):
        rng = random.Random(tname)
        team_id = "team_" + uuid.uuid4().hex[:10]
        db.create_team(team_id, user_id, tname)
        team_ids.append(team_id)

        roster = []  # (player_id, family, jersey)
        for j, (family, label) in enumerate(_SQUAD, start=1):
            pid = "ply_" + uuid.uuid4().hex[:10]
            db.create_player(pid, team_id, _name(ti, j), label, j, is_minor=False)
            roster.append((pid, family, j))

        for mi, (opp, field, gf, ga, days_ago, linked) in enumerate(_FIXTURES[ti]):
            mrng = random.Random(f"{tname}-{mi}")
            played_on = (today - dt.timedelta(days=days_ago)).isoformat()
            match_id = "match_" + uuid.uuid4().hex[:10]
            db.create_match(match_id, user_id, team_id, field, opp, played_on,
                            JOB_ID if linked else None, gf, ga, None)

            # 11 starters (two subbed off ~65'), 2 bench appearances.
            subbed = set(mrng.sample(range(1, 11), 2))
            attack = [i for i, (_pid, fam, _j) in enumerate(roster[:11]) if fam in ("MID", "FWD")]
            goals = _distribute(gf, attack, mrng)
            assists = _distribute(gf, attack, mrng)
            for idx, (pid, family, _j) in enumerate(roster):
                if idx < 11:
                    minutes = mrng.randint(60, 72) if idx in subbed else 90
                elif idx < 13:
                    minutes = mrng.randint(18, 30)
                else:
                    continue  # unused sub this match
                line = _stat_line(mrng, family, minutes)
                db.add_player_stat(
                    "st_" + uuid.uuid4().hex[:10], match_id, pid, minutes,
                    line["distance_m"], line["top_speed_ms"],
                    goals.get(idx, 0), assists.get(idx, 0),
                    line["sprints"], line["passes"], line["passes_completed"])
    return team_ids


def seed_job(user_id: int, frames: int, cache: Path) -> str:
    print("running Metrica sample through the analytics engine…", file=sys.stderr)
    engine, n = build_analytics(frames, cache)
    store = storage.get_storage()
    summary = engine.summary(store.job_dir(JOB_ID))  # writes heatmap PNGs
    store.finalize_job(JOB_ID)
    full = {
        "possession": summary["possession"],
        "possession_timeline": summary["possession_timeline"],
        "players": summary["players"][:28],
        "team_stats": summary["team_stats"],
        "heatmaps": summary["heatmaps"],
        "highlights": [],
        "broadcast": False,
        "meta": {"source": "Metrica Sample Game 1", "data": "ground-truth tracking",
                 "minutes": round(n / FPS / 60, 1), "fps": FPS},
    }
    db.delete_job(JOB_ID)
    db.create_job(JOB_ID, user_id, "Metrica Sample — real tracking data",
                  detector="tracking", source="seed")
    db.update_job(JOB_ID, status="done", progress=1.0, message="done", summary=full)
    ts = summary["team_stats"]
    print(f"seeded job {JOB_ID!r}: {n} frames · possession {summary['possession']} · "
          f"shots {sum(t['shots'] for t in ts.values())} · "
          f"xG {round(sum(t['xg'] for t in ts.values()), 2)}")
    return JOB_ID


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--frames", type=int, default=7500)
    ap.add_argument("--cache", type=Path,
                    default=Path(tempfile.gettempdir()) / "openpitch-metrica")
    ap.add_argument("--email", default=os.environ.get(
        "PLAYMETRICS_ADMIN_EMAIL", "yazanalshuibe14@gmail.com"))
    ap.add_argument("--no-teams", action="store_true",
                    help="seed only the dashboard job, not the demo squads")
    args = ap.parse_args()

    db.init_db()
    user = db.get_user_by_email(args.email)
    if not user:
        print(f"admin user {args.email!r} not found — start the server once to seed it",
              file=sys.stderr)
        return 1

    seed_job(user["id"], args.frames, args.cache)
    if not args.no_teams:
        ids = build_teams(user["id"])
        print(f"seeded {len(ids)} named teams "
              f"({', '.join(TEAMS)}) with timestamped matches + stats")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
