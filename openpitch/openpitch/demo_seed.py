"""Rich demo data: a real-data dashboard analysis + two named squads.

Used by both ``scripts/seed_demo.py`` (CLI) and the server lifespan
(``maybe_seed`` — auto-seeds a fresh deployment when PLAYMETRICS_SEED_DEMO is
set). Seeding is deterministic and idempotent.
"""

from __future__ import annotations

import datetime as dt
import os
import random
import sys
import tempfile
import threading
import uuid
from pathlib import Path

from . import db, storage
from .metrica import FPS, build_analytics

JOB_ID = "metrica-demo"
DEFAULT_CACHE = Path(tempfile.gettempdir()) / "openpitch-metrica"

_FIRST = ["James", "Liam", "Noah", "Oliver", "Lucas", "Mason", "Ethan", "Leo",
          "Marco", "Diego", "Kai", "Omar", "Yusuf", "Andre", "Mateo", "Felix",
          "Hugo", "Ivan", "Samir", "Theo", "Niko", "Adam", "Elias", "Raul",
          "Tomas", "Bruno", "Karim", "Luka", "Pavel", "Sven"]
_LAST = ["Walker", "Reyes", "Bennett", "Costa", "Silva", "Moreno", "Haas",
         "Novak", "Larsen", "Okafor", "Bauer", "Rossi", "Nguyen", "Khan",
         "Mendez", "Carter", "Lindqvist", "Petrov", "Tahir", "Fontaine",
         "Vidal", "Park", "Romano", "Sauer", "Ibrahim", "Andersson",
         "Marchetti", "Dubois", "Keller", "Sokolov"]

# (full-90 distance km lo/hi, top-speed m/s lo/hi, sprints lo/hi,
#  passes-attempted lo/hi, pass-accuracy % lo/hi) keyed by role family.
_PROFILE = {
    "GK":  (4.8, 5.6, 6.4, 7.4, 0, 3, 22, 38, 72, 90),
    "DEF": (9.6, 11.0, 8.0, 9.4, 10, 24, 45, 80, 80, 93),
    "MID": (10.6, 12.4, 8.2, 9.6, 16, 32, 55, 95, 78, 92),
    "FWD": (9.4, 11.4, 8.6, 10.2, 18, 38, 28, 55, 70, 86),
}
# 14-man squad shape: (role family, position label).
_SQUAD = [
    ("GK", "GK"), ("DEF", "RB"), ("DEF", "CB"), ("DEF", "CB"), ("DEF", "LB"),
    ("MID", "CDM"), ("MID", "CM"), ("MID", "CAM"), ("FWD", "RW"), ("FWD", "ST"),
    ("FWD", "LW"), ("GK", "GK"), ("DEF", "CB"), ("FWD", "ST"),
]

TEAMS = ["Northgate United", "Riverside Athletic"]
# Per-team fixtures: (opponent, field_type, our_score, opp_score, days_ago, linked).
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
    first = _FIRST[(team_idx * 17 + jersey * 7) % len(_FIRST)]
    last = _LAST[(team_idx * 11 + jersey * 13) % len(_LAST)]
    return f"{first} {last}"


# Shot/foul propensity by role family (max shots, foul ceiling).
_ATTACK = {"GK": (0, 1), "DEF": (1, 3), "MID": (3, 2), "FWD": (5, 2)}


def _stat_line(rng: random.Random, family: str, minutes: int) -> dict:
    d0, d1, s0, s1, sp0, sp1, p0, p1, a0, a1 = _PROFILE[family]
    scale = minutes / 90.0
    passes = round(rng.randint(p0, p1) * scale)
    acc = rng.uniform(a0, a1)
    shot_max, foul_max = _ATTACK[family]
    shots = rng.randint(0, shot_max) if minutes >= 45 else 0
    return {
        "distance_m": round(rng.uniform(d0, d1) * 1000 * scale),
        "top_speed_ms": round(rng.uniform(s0, s1), 1),
        "sprints": round(rng.randint(sp0, sp1) * scale),
        "passes": passes,
        "passes_completed": round(passes * acc / 100),
        "shots": shots,
        "shots_on_target": rng.randint(0, shots) if shots else 0,
        "fouls": rng.randint(0, foul_max),
    }


def _events_line(rng: random.Random, family: str, minutes: int) -> dict:
    """Position-aware standard-data events for the demo squads."""
    if minutes < 30:
        return {}
    defend = {"GK": 0, "DEF": 3, "MID": 2, "FWD": 1}[family]
    attack = {"GK": 0, "DEF": 1, "MID": 3, "FWD": 3}[family]
    out = {
        "tackles": rng.randint(0, defend), "interceptions": rng.randint(0, defend),
        "clearances": rng.randint(0, defend + 1 if family == "DEF" else 1),
        "blocks": rng.randint(0, 1), "duels_won": rng.randint(0, defend + 2),
        "recoveries": rng.randint(1, defend + 3),
        "key_passes": rng.randint(0, attack), "crosses": rng.randint(0, attack),
        "dribbles": rng.randint(0, attack), "offsides": rng.randint(0, 1) if family == "FWD" else 0,
        "yellow_cards": 1 if rng.random() < 0.12 else 0, "red_cards": 0,
        "saves": rng.randint(1, 5) if family == "GK" else 0,
    }
    return out


def _distribute(n: int, pool: list[int], rng: random.Random) -> dict[int, int]:
    out: dict[int, int] = {}
    for _ in range(n):
        if pool:
            k = rng.choice(pool)
            out[k] = out.get(k, 0) + 1
    return out


def teams_present(user_id: int) -> bool:
    names = {t["name"] for t in db.list_teams(user_id)}
    return any(n in names for n in TEAMS)


def build_teams(user_id: int) -> list[str]:
    """Two named squads with timestamped matches of realistic stats. Idempotent."""
    existing = {t["name"]: t["id"] for t in db.list_teams(user_id)}
    for name in TEAMS:
        if name in existing:
            db.delete_team(existing[name])

    today = dt.date(2026, 6, 21)
    team_ids: list[str] = []
    for ti, tname in enumerate(TEAMS):
        team_id = "team_" + uuid.uuid4().hex[:10]
        db.create_team(team_id, user_id, tname)
        team_ids.append(team_id)

        roster = []  # (player_id, family)
        for j, (family, label) in enumerate(_SQUAD, start=1):
            pid = "ply_" + uuid.uuid4().hex[:10]
            db.create_player(pid, team_id, _name(ti, j), label, j, is_minor=False)
            roster.append((pid, family))

        for mi, (opp, field, gf, ga, days_ago, linked) in enumerate(_FIXTURES[ti]):
            mrng = random.Random(f"{tname}-{mi}")
            played_on = (today - dt.timedelta(days=days_ago)).isoformat()
            match_id = "match_" + uuid.uuid4().hex[:10]
            db.create_match(match_id, user_id, team_id, field, opp, played_on,
                            JOB_ID if linked else None, gf, ga, None)

            subbed = set(mrng.sample(range(1, 11), 2))
            attack = [i for i, (_pid, fam) in enumerate(roster[:11]) if fam in ("MID", "FWD")]
            goals = _distribute(gf, attack, mrng)
            assists = _distribute(gf, attack, mrng)
            for idx, (pid, family) in enumerate(roster):
                if idx < 11:
                    minutes = mrng.randint(60, 72) if idx in subbed else 90
                elif idx < 13:
                    minutes = mrng.randint(18, 30)
                else:
                    continue
                line = _stat_line(mrng, family, minutes)
                db.add_player_stat(
                    "st_" + uuid.uuid4().hex[:10], match_id, pid, minutes,
                    line["distance_m"], line["top_speed_ms"],
                    goals.get(idx, 0), assists.get(idx, 0),
                    line["sprints"], line["passes"], line["passes_completed"],
                    line["shots"], line["shots_on_target"], line["fouls"])
                ev = _events_line(mrng, family, minutes)
                if ev:
                    db.upsert_player_stat(match_id, pid, ev)
    return team_ids


def seed_job(user_id: int, frames: int, cache: Path) -> str:
    """Run the Metrica sample through Analytics and store it as a finished job."""
    print("[seed] running Metrica sample through the analytics engine…", file=sys.stderr)
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
    return JOB_ID


def seed_all(email: str, frames: int = 7500, cache: Path = DEFAULT_CACHE,
             with_job: bool = True, with_teams: bool = True) -> bool:
    """Seed teams (no network) then the dashboard analysis (network, best-effort).

    Returns True if the admin user was found and seeding ran.
    """
    db.init_db()
    user = db.get_user_by_email(email)
    if not user:
        print(f"[seed] admin user {email!r} not found — start the server once first",
              file=sys.stderr)
        return False
    if with_teams:
        build_teams(user["id"])
        print(f"[seed] seeded teams: {', '.join(TEAMS)}")
    if with_job:
        try:
            seed_job(user["id"], frames, cache)
            print(f"[seed] seeded dashboard analysis job {JOB_ID!r}")
        except Exception as exc:  # network/parse failure must not break startup
            print(f"[seed] dashboard analysis skipped ({exc})", file=sys.stderr)
    return True


def maybe_seed() -> None:
    """Auto-seed a fresh deployment in the background. No-op unless
    PLAYMETRICS_SEED_DEMO is truthy and the demo squads aren't already present."""
    flag = os.environ.get("PLAYMETRICS_SEED_DEMO", "").strip().lower()
    if flag not in ("1", "true", "yes", "on"):
        return
    email = os.environ.get("PLAYMETRICS_ADMIN_EMAIL", "yazanalshuibe14@gmail.com")
    user = db.get_user_by_email(email)
    if user and teams_present(user["id"]):
        return  # already seeded — don't clobber on restart

    def run() -> None:
        try:
            seed_all(email)
        except Exception as exc:  # never crash the server over demo data
            print(f"[seed] demo seeding failed: {exc}", file=sys.stderr)

    threading.Thread(target=run, name="demo-seed", daemon=True).start()
    print("[seed] demo seeding started in background (PLAYMETRICS_SEED_DEMO set)")
