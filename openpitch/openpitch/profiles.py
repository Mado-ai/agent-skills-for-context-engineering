"""Profile aggregation + import/export for teams and players.

Turns raw matches and per-player stat lines into the aggregated profiles the
apps render: matches played by field type (5/7/11-a-side), totals, records,
and roster leaderboards. Also bundles a team (players + matches + stats) for
export and re-creates it on import.
"""

from __future__ import annotations

import uuid

from . import db

FIELD_TYPES = (5, 7, 11)


def _by_field(rows: list[dict]) -> dict[str, int]:
    out = {str(f): 0 for f in FIELD_TYPES}
    for r in rows:
        key = str(r.get("field_type"))
        if key in out:
            out[key] += 1
    return out


def player_profile(player_id: str) -> dict | None:
    p = db.get_player(player_id)
    if not p:
        return None
    stats = db.stats_for_player(player_id)
    completed = sum(s.get("passes_completed") or 0 for s in stats)
    totals = {
        "matches": len(stats),
        "distance_m": round(sum(s["distance_m"] or 0 for s in stats), 1),
        "top_speed_ms": round(max((s["top_speed_ms"] or 0 for s in stats), default=0), 2),
        "sprints": sum(s["sprints"] or 0 for s in stats),
        "passes": sum(s["passes"] or 0 for s in stats),
        "passes_completed": completed,
        "shots": sum(s.get("shots") or 0 for s in stats),
        "shots_on_target": sum(s.get("shots_on_target") or 0 for s in stats),
        "fouls": sum(s.get("fouls") or 0 for s in stats),
        "goals": sum(s["goals"] or 0 for s in stats),
        "assists": sum(s["assists"] or 0 for s in stats),
        "minutes": sum(s["minutes"] or 0 for s in stats),
    }
    totals["pass_accuracy"] = (
        round(100 * completed / totals["passes"], 1) if totals["passes"] else None)
    totals["avg_distance_m"] = round(totals["distance_m"] / totals["matches"], 1) if stats else 0
    return {
        "player": {**{k: p[k] for k in ("id", "name", "position", "jersey")},
                   "avatar": bool(p.get("avatar_url"))},
        "team_id": p["team_id"],
        "matches_by_field": _by_field(stats),
        "totals": totals,
        "recent": stats[:10],
    }


def team_profile(team_id: str) -> dict | None:
    t = db.get_team(team_id)
    if not t:
        return None
    players = db.list_players(team_id)
    matches = db.list_matches(team_id)

    wins = draws = losses = gf = ga = 0
    for m in matches:
        hs, as_ = m.get("home_score"), m.get("away_score")
        if hs is None or as_ is None:
            continue
        gf += hs
        ga += as_
        wins += hs > as_
        draws += hs == as_
        losses += hs < as_

    # Roster leaderboard: aggregate per-player stats across the team's matches.
    agg: dict[str, dict] = {}
    for m in matches:
        for s in db.stats_for_match(m["id"]):
            a = agg.setdefault(
                s["player_id"],
                {"player_id": s["player_id"], "name": s["player_name"],
                 "matches": 0, "distance_m": 0.0, "top_speed_ms": 0.0,
                 "sprints": 0, "passes": 0, "passes_completed": 0,
                 "shots": 0, "shots_on_target": 0, "fouls": 0,
                 "goals": 0, "assists": 0},
            )
            a["matches"] += 1
            a["distance_m"] = round(a["distance_m"] + (s["distance_m"] or 0), 1)
            a["top_speed_ms"] = round(max(a["top_speed_ms"], s["top_speed_ms"] or 0), 2)
            a["sprints"] += s["sprints"] or 0
            a["passes"] += s["passes"] or 0
            a["passes_completed"] += s.get("passes_completed") or 0
            a["shots"] += s.get("shots") or 0
            a["shots_on_target"] += s.get("shots_on_target") or 0
            a["fouls"] += s.get("fouls") or 0
            a["goals"] += s["goals"] or 0
            a["assists"] += s["assists"] or 0
    avatar_by_pid = {p["id"]: bool(p.get("avatar_url")) for p in players}
    for a in agg.values():
        a["pass_accuracy"] = (
            round(100 * a["passes_completed"] / a["passes"], 1) if a["passes"] else None)
        a["avatar"] = avatar_by_pid.get(a["player_id"], False)
    leaderboard = sorted(agg.values(), key=lambda a: a["distance_m"], reverse=True)

    return {
        "team": {"id": t["id"], "name": t["name"], "public_token": t["public_token"]},
        "players": [{"id": p["id"], "name": p["name"], "position": p["position"],
                     "jersey": p["jersey"], "avatar": bool(p.get("avatar_url"))} for p in players],
        "player_count": len(players),
        "matches_by_field": _by_field(matches),
        "record": {"played": len(matches), "wins": wins, "draws": draws,
                   "losses": losses, "goals_for": gf, "goals_against": ga},
        "recent_matches": matches[:10],
        "leaderboard": leaderboard[:10],
    }


def export_team(team_id: str) -> dict:
    """Self-contained bundle: team + players + matches + stats."""
    t = db.get_team(team_id)
    players = db.list_players(team_id)
    matches = db.list_matches(team_id)
    full_matches = []
    for m in matches:
        fm = db.get_match(m["id"])
        fm["stats"] = db.stats_for_match(m["id"])
        full_matches.append(fm)
    return {
        "version": 1,
        "team": {"name": t["name"]},
        "players": [{"id": p["id"], "name": p["name"], "position": p["position"],
                     "jersey": p["jersey"]} for p in players],
        "matches": [{"id": m["id"], "field_type": m["field_type"], "opponent": m["opponent"],
                     "played_on": m["played_on"], "home_score": m["home_score"],
                     "away_score": m["away_score"], "summary": m.get("summary"),
                     "stats": [{"player_id": s["player_id"], "minutes": s["minutes"],
                                "distance_m": s["distance_m"], "top_speed_ms": s["top_speed_ms"],
                                "sprints": s.get("sprints") or 0, "passes": s.get("passes") or 0,
                                "passes_completed": s.get("passes_completed") or 0,
                                "shots": s.get("shots") or 0,
                                "shots_on_target": s.get("shots_on_target") or 0,
                                "fouls": s.get("fouls") or 0,
                                "goals": s["goals"], "assists": s["assists"]}
                               for s in m["stats"]]}
                    for m in full_matches],
    }


def import_team(user_id: int, bundle: dict) -> dict:
    """Recreate a team (+players+matches+stats) under user_id with fresh IDs."""
    import json as _json

    name = (bundle.get("team") or {}).get("name", "Imported team")
    team_id = "team_" + uuid.uuid4().hex[:10]
    db.create_team(team_id, user_id, name)

    id_map: dict[str, str] = {}
    for p in bundle.get("players", []):
        pid = "ply_" + uuid.uuid4().hex[:10]
        id_map[p.get("id", pid)] = pid
        db.create_player(pid, team_id, p.get("name", "Player"),
                         p.get("position"), p.get("jersey"))

    for m in bundle.get("matches", []):
        mid = "match_" + uuid.uuid4().hex[:10]
        summary = m.get("summary")
        db.create_match(mid, user_id, team_id, int(m.get("field_type", 11)),
                        m.get("opponent"), m.get("played_on"), None,
                        m.get("home_score"), m.get("away_score"),
                        _json.dumps(summary) if isinstance(summary, dict) else summary)
        for s in m.get("stats", []):
            old = s.get("player_id")
            if old not in id_map:
                continue
            db.add_player_stat("st_" + uuid.uuid4().hex[:10], mid, id_map[old],
                               int(s.get("minutes") or 0), float(s.get("distance_m") or 0),
                               float(s.get("top_speed_ms") or 0), int(s.get("goals") or 0),
                               int(s.get("assists") or 0), int(s.get("sprints") or 0),
                               int(s.get("passes") or 0), int(s.get("passes_completed") or 0),
                               int(s.get("shots") or 0), int(s.get("shots_on_target") or 0),
                               int(s.get("fouls") or 0))
    return {"team_id": team_id, "name": name}
