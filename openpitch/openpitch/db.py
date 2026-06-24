"""Persistence layer — SQLAlchemy Core, portable across SQLite and Postgres.

The engine is driven by ``DATABASE_URL``:

* unset  -> ``sqlite:///<PLAYMETRICS_DB>`` (default, dev)
* prod   -> ``postgresql+psycopg://user:pass@host/db``

Schema is defined as SQLAlchemy ``Table`` metadata (dialect-correct DDL).
``init_db()`` create-alls for dev; Alembic owns migrations in production
(``alembic upgrade head``). Every function returns plain dicts / ids so the
API and profile layers are storage-agnostic.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path

from sqlalchemy import (
    Column, Float, Integer, MetaData, Table, Text, UniqueConstraint,
    create_engine, delete, select, text,
)

ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_SQLITE = f"sqlite:///{os.environ.get('PLAYMETRICS_DB', ROOT / 'playmetrics.db')}"
DATABASE_URL = os.environ.get("DATABASE_URL", _DEFAULT_SQLITE)

_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
_engine = create_engine(DATABASE_URL, future=True, connect_args=_connect_args)

metadata = MetaData()

users = Table(
    "users", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("email", Text, unique=True, nullable=False),
    Column("password_hash", Text, nullable=False),
    Column("is_admin", Integer, default=0),
    Column("created_at", Float, nullable=False),
)
jobs = Table(
    "jobs", metadata,
    Column("id", Text, primary_key=True),
    Column("user_id", Integer, nullable=False),
    Column("input_name", Text),
    Column("detector", Text),
    Column("status", Text, nullable=False),
    Column("progress", Float, default=0),
    Column("message", Text),
    Column("summary", Text),
    Column("source", Text, default="upload"),
    Column("site_id", Text),
    Column("created_at", Float, nullable=False),
)
sites = Table(
    "sites", metadata,
    Column("id", Text, primary_key=True),
    Column("user_id", Integer, nullable=False),
    Column("name", Text, nullable=False),
    Column("package", Text, nullable=False),
    Column("created_at", Float, nullable=False),
)
devices = Table(
    "devices", metadata,
    Column("id", Text, primary_key=True),
    Column("site_id", Text, nullable=False),
    Column("kind", Text, nullable=False),
    Column("name", Text, nullable=False),
    Column("key_hash", Text, nullable=False),
    Column("last_seen", Float),
    Column("created_at", Float, nullable=False),
)
ingest_keys = Table(
    "ingest_keys", metadata,
    Column("idempotency_key", Text, primary_key=True),
    Column("job_id", Text, nullable=False),
)
audit_log = Table(
    "audit_log", metadata,
    Column("id", Text, primary_key=True),
    Column("user_id", Integer),
    Column("action", Text, nullable=False),
    Column("target_type", Text),
    Column("target_id", Text),
    Column("detail", Text),
    Column("created_at", Float, nullable=False),
)
teams = Table(
    "teams", metadata,
    Column("id", Text, primary_key=True),
    Column("user_id", Integer, nullable=False),
    Column("org_id", Text),
    Column("name", Text, nullable=False),
    Column("public_token", Text),
    Column("created_at", Float, nullable=False),
)
organizations = Table(
    "organizations", metadata,
    Column("id", Text, primary_key=True),
    Column("name", Text, nullable=False),
    Column("created_at", Float, nullable=False),
)
memberships = Table(
    "memberships", metadata,
    Column("id", Text, primary_key=True),
    Column("org_id", Text, nullable=False),
    Column("user_id", Integer, nullable=False),
    Column("role", Text, nullable=False),
    Column("player_id", Text),
    Column("created_at", Float, nullable=False),
    UniqueConstraint("org_id", "user_id", name="uq_member_org_user"),
)
players = Table(
    "players", metadata,
    Column("id", Text, primary_key=True),
    Column("team_id", Text, nullable=False),
    Column("name", Text, nullable=False),
    Column("position", Text),
    Column("jersey", Integer),
    Column("public_token", Text),
    Column("is_minor", Integer, default=1),
    Column("guardian_consent_at", Float),
    Column("guardian_consent_by", Integer),
    Column("avatar_url", Text),
    Column("created_at", Float, nullable=False),
)
matches = Table(
    "matches", metadata,
    Column("id", Text, primary_key=True),
    Column("user_id", Integer, nullable=False),
    Column("team_id", Text, nullable=False),
    Column("job_id", Text),
    Column("field_type", Integer, nullable=False),
    Column("opponent", Text),
    Column("played_on", Text),
    Column("home_score", Integer),
    Column("away_score", Integer),
    Column("summary", Text),
    Column("created_at", Float, nullable=False),
)
player_match_stats = Table(
    "player_match_stats", metadata,
    Column("id", Text, primary_key=True),
    Column("match_id", Text, nullable=False),
    Column("player_id", Text, nullable=False),
    Column("minutes", Integer, default=0),
    Column("distance_m", Float, default=0),
    Column("top_speed_ms", Float, default=0),
    Column("sprints", Integer, default=0),
    Column("passes", Integer, default=0),
    Column("passes_completed", Integer, default=0),
    Column("shots", Integer, default=0),
    Column("shots_on_target", Integer, default=0),
    Column("fouls", Integer, default=0),
    Column("goals", Integer, default=0),
    Column("assists", Integer, default=0),
    # FIFA-style event taxonomy (BePro "standard data"); entered/annotated.
    Column("key_passes", Integer, default=0),
    Column("crosses", Integer, default=0),
    Column("dribbles", Integer, default=0),
    Column("tackles", Integer, default=0),
    Column("interceptions", Integer, default=0),
    Column("clearances", Integer, default=0),
    Column("blocks", Integer, default=0),
    Column("duels_won", Integer, default=0),
    Column("recoveries", Integer, default=0),
    Column("offsides", Integer, default=0),
    Column("yellow_cards", Integer, default=0),
    Column("red_cards", Integer, default=0),
    Column("saves", Integer, default=0),
)

# Manual/annotated event fields (kept in sync across upsert, profiles, UI).
EVENT_FIELDS = ("key_passes", "crosses", "dribbles", "tackles", "interceptions",
                "clearances", "blocks", "duels_won", "recoveries", "offsides",
                "yellow_cards", "red_cards", "saves")

# --- coach tools: tagging, telestration, playbooks --------------------------

clip_tags = Table(
    "clip_tags", metadata,
    Column("id", Text, primary_key=True),
    Column("job_id", Text, nullable=False),
    Column("user_id", Integer, nullable=False),
    Column("t", Float, nullable=False),          # video timestamp (seconds)
    Column("label", Text, nullable=False),       # e.g. "press", "turnover"
    Column("note", Text),
    Column("player_id", Text),                   # optional player the tag is about
    Column("created_at", Float, nullable=False),
)
telestrations = Table(
    "telestrations", metadata,
    Column("id", Text, primary_key=True),
    Column("job_id", Text, nullable=False),
    Column("user_id", Integer, nullable=False),
    Column("name", Text, nullable=False),
    Column("t", Float, nullable=False),          # frame time the drawing pins to
    Column("shapes", Text, nullable=False),      # JSON list of vector shapes
    Column("created_at", Float, nullable=False),
)
playbooks = Table(
    "playbooks", metadata,
    Column("id", Text, primary_key=True),
    Column("team_id", Text, nullable=False),
    Column("user_id", Integer, nullable=False),
    Column("name", Text, nullable=False),
    Column("field_type", Integer, default=11),
    Column("data", Text, nullable=False),        # JSON: tokens + arrows
    Column("created_at", Float, nullable=False),
)


def init_db() -> None:
    metadata.create_all(_engine)


# --- helpers ----------------------------------------------------------------

def _rows(conn, stmt, params=None) -> list[dict]:
    return [dict(r) for r in conn.execute(stmt, params or {}).mappings().all()]


def _row(conn, stmt, params=None) -> dict | None:
    r = conn.execute(stmt, params or {}).mappings().first()
    return dict(r) if r else None


# --- users ------------------------------------------------------------------

def create_user(email: str, password_hash: str, is_admin: bool = False) -> dict:
    with _engine.begin() as c:
        res = c.execute(users.insert().values(
            email=email.lower(), password_hash=password_hash,
            is_admin=int(is_admin), created_at=time.time()))
        return {"id": res.inserted_primary_key[0], "email": email.lower(),
                "is_admin": is_admin}


def get_user_by_email(email: str) -> dict | None:
    with _engine.connect() as c:
        return _row(c, select(users).where(users.c.email == email.lower()))


def get_user_by_id(user_id: int) -> dict | None:
    with _engine.connect() as c:
        return _row(c, select(users).where(users.c.id == user_id))


def set_password(user_id: int, password_hash: str) -> None:
    with _engine.begin() as c:
        c.execute(users.update().where(users.c.id == user_id)
                  .values(password_hash=password_hash))


# --- audit log --------------------------------------------------------------

def add_audit(audit_id: str, user_id: int | None, action: str,
              target_type: str | None, target_id: str | None,
              detail: str | None = None) -> None:
    with _engine.begin() as c:
        c.execute(audit_log.insert().values(
            id=audit_id, user_id=user_id, action=action, target_type=target_type,
            target_id=target_id, detail=detail, created_at=time.time()))


def list_audit_for_target(target_type: str, target_id: str, limit: int = 100) -> list[dict]:
    sql = text(
        "SELECT a.action, a.detail, a.created_at, u.email AS actor "
        "FROM audit_log a LEFT JOIN users u ON u.id = a.user_id "
        "WHERE a.target_type = :tt AND a.target_id = :ti "
        "ORDER BY a.created_at DESC LIMIT :lim")
    with _engine.connect() as c:
        return _rows(c, sql, {"tt": target_type, "ti": target_id, "lim": limit})


# --- jobs -------------------------------------------------------------------

def create_job(job_id: str, user_id: int, input_name: str, detector: str,
               source: str = "upload", site_id: str | None = None) -> None:
    with _engine.begin() as c:
        c.execute(jobs.insert().values(
            id=job_id, user_id=user_id, input_name=input_name, detector=detector,
            status="queued", progress=0.0, message="queued", source=source,
            site_id=site_id, created_at=time.time()))


def update_job(job_id: str, **fields) -> None:
    if "summary" in fields and not isinstance(fields["summary"], str):
        fields["summary"] = json.dumps(fields["summary"])
    with _engine.begin() as c:
        c.execute(jobs.update().where(jobs.c.id == job_id).values(**fields))


def get_job(job_id: str) -> dict | None:
    with _engine.connect() as c:
        d = _row(c, select(jobs).where(jobs.c.id == job_id))
    if d and d.get("summary"):
        d["summary"] = json.loads(d["summary"])
    return d


def list_jobs_for_user(user_id: int) -> list[dict]:
    cols = (jobs.c.id, jobs.c.input_name, jobs.c.detector, jobs.c.status,
            jobs.c.progress, jobs.c.message, jobs.c.created_at)
    with _engine.connect() as c:
        return _rows(c, select(*cols).where(jobs.c.user_id == user_id)
                     .order_by(jobs.c.created_at.desc()))


def list_jobs_for_site(site_id: str) -> list[dict]:
    cols = (jobs.c.id, jobs.c.input_name, jobs.c.detector, jobs.c.status,
            jobs.c.progress, jobs.c.source, jobs.c.created_at)
    with _engine.connect() as c:
        return _rows(c, select(*cols).where(jobs.c.site_id == site_id)
                     .order_by(jobs.c.created_at.desc()))


def rename_job(job_id: str, name: str) -> None:
    with _engine.begin() as c:
        c.execute(jobs.update().where(jobs.c.id == job_id).values(input_name=name))


def delete_job(job_id: str) -> None:
    with _engine.begin() as c:
        c.execute(jobs.delete().where(jobs.c.id == job_id))


# --- sites & devices --------------------------------------------------------

def create_site(site_id: str, user_id: int, name: str, package: str) -> dict:
    with _engine.begin() as c:
        c.execute(sites.insert().values(
            id=site_id, user_id=user_id, name=name, package=package,
            created_at=time.time()))
    return {"id": site_id, "name": name, "package": package}


def get_site(site_id: str) -> dict | None:
    with _engine.connect() as c:
        return _row(c, select(sites).where(sites.c.id == site_id))


def list_sites(user_id: int) -> list[dict]:
    sql = text(
        "SELECT s.*, (SELECT COUNT(*) FROM devices d WHERE d.site_id = s.id) "
        "AS device_count FROM sites s WHERE s.user_id = :uid "
        "ORDER BY s.created_at DESC")
    with _engine.connect() as c:
        return _rows(c, sql, {"uid": user_id})


def create_device(device_id: str, site_id: str, kind: str, name: str,
                  key_hash: str) -> None:
    with _engine.begin() as c:
        c.execute(devices.insert().values(
            id=device_id, site_id=site_id, kind=kind, name=name,
            key_hash=key_hash, created_at=time.time()))


def list_devices(site_id: str) -> list[dict]:
    cols = (devices.c.id, devices.c.site_id, devices.c.kind, devices.c.name,
            devices.c.last_seen, devices.c.created_at)
    with _engine.connect() as c:
        return _rows(c, select(*cols).where(devices.c.site_id == site_id)
                     .order_by(devices.c.created_at))


def get_device_by_key_hash(key_hash: str) -> dict | None:
    with _engine.connect() as c:
        return _row(c, select(devices).where(devices.c.key_hash == key_hash))


def touch_device(device_id: str) -> None:
    with _engine.begin() as c:
        c.execute(devices.update().where(devices.c.id == device_id)
                  .values(last_seen=time.time()))


# --- ingest idempotency -----------------------------------------------------

def get_ingest_job(idempotency_key: str) -> str | None:
    with _engine.connect() as c:
        row = _row(c, select(ingest_keys.c.job_id)
                   .where(ingest_keys.c.idempotency_key == idempotency_key))
    return row["job_id"] if row else None


def record_ingest_job(idempotency_key: str, job_id: str) -> None:
    with _engine.begin() as c:  # insert-or-ignore, portable
        exists = c.execute(select(ingest_keys.c.idempotency_key)
                           .where(ingest_keys.c.idempotency_key == idempotency_key)
                           ).first()
        if not exists:
            c.execute(ingest_keys.insert().values(
                idempotency_key=idempotency_key, job_id=job_id))


# --- teams ------------------------------------------------------------------

def create_team(team_id: str, user_id: int, name: str, org_id: str | None = None) -> dict:
    with _engine.begin() as c:
        c.execute(teams.insert().values(
            id=team_id, user_id=user_id, org_id=org_id, name=name,
            created_at=time.time()))
    return {"id": team_id, "name": name, "org_id": org_id}


def get_team(team_id: str) -> dict | None:
    with _engine.connect() as c:
        return _row(c, select(teams).where(teams.c.id == team_id))


def get_team_by_token(token: str) -> dict | None:
    with _engine.connect() as c:
        return _row(c, select(teams).where(teams.c.public_token == token))


def list_teams(user_id: int) -> list[dict]:
    sql = text(
        "SELECT t.*, "
        "(SELECT COUNT(*) FROM players p WHERE p.team_id = t.id) AS player_count, "
        "(SELECT COUNT(*) FROM matches m WHERE m.team_id = t.id) AS match_count "
        "FROM teams t WHERE t.user_id = :uid ORDER BY t.created_at DESC")
    with _engine.connect() as c:
        return _rows(c, sql, {"uid": user_id})


def update_team(team_id: str, name: str) -> None:
    with _engine.begin() as c:
        c.execute(teams.update().where(teams.c.id == team_id).values(name=name))


def set_team_public(team_id: str, token: str | None) -> None:
    with _engine.begin() as c:
        c.execute(teams.update().where(teams.c.id == team_id)
                  .values(public_token=token))


def _delete_team_rows(c, team_id: str) -> None:
    mids = [r[0] for r in c.execute(select(matches.c.id)
                                    .where(matches.c.team_id == team_id))]
    for mid in mids:
        c.execute(delete(player_match_stats).where(player_match_stats.c.match_id == mid))
    c.execute(delete(matches).where(matches.c.team_id == team_id))
    c.execute(delete(players).where(players.c.team_id == team_id))
    c.execute(delete(teams).where(teams.c.id == team_id))


def delete_team(team_id: str) -> None:
    with _engine.begin() as c:
        _delete_team_rows(c, team_id)


def delete_org_cascade(org_id: str) -> None:
    with _engine.begin() as c:
        for tid in [r[0] for r in c.execute(select(teams.c.id)
                                            .where(teams.c.org_id == org_id))]:
            _delete_team_rows(c, tid)
        c.execute(delete(memberships).where(memberships.c.org_id == org_id))
        c.execute(delete(organizations).where(organizations.c.id == org_id))


def delete_user_cascade(user_id: int) -> list[str]:
    """Right-to-delete: remove the user's personal data; return job IDs (files)."""
    with _engine.begin() as c:
        job_ids = [r[0] for r in c.execute(select(jobs.c.id)
                                           .where(jobs.c.user_id == user_id))]
        personal = [r[0] for r in c.execute(
            select(teams.c.id).where(teams.c.user_id == user_id, teams.c.org_id.is_(None)))]
        for tid in personal:
            _delete_team_rows(c, tid)
        for sid in [r[0] for r in c.execute(select(sites.c.id)
                                            .where(sites.c.user_id == user_id))]:
            c.execute(delete(devices).where(devices.c.site_id == sid))
        c.execute(delete(sites).where(sites.c.user_id == user_id))
        c.execute(delete(jobs).where(jobs.c.user_id == user_id))
        c.execute(delete(memberships).where(memberships.c.user_id == user_id))
        c.execute(delete(users).where(users.c.id == user_id))
    return job_ids


# --- organizations & memberships --------------------------------------------

def create_org(org_id: str, name: str) -> dict:
    with _engine.begin() as c:
        c.execute(organizations.insert().values(
            id=org_id, name=name, created_at=time.time()))
    return {"id": org_id, "name": name}


def get_org(org_id: str) -> dict | None:
    with _engine.connect() as c:
        return _row(c, select(organizations).where(organizations.c.id == org_id))


def add_membership(membership_id: str, org_id: str, user_id: int, role: str,
                   player_id: str | None = None) -> None:
    with _engine.begin() as c:  # replace any existing membership for this pair
        c.execute(delete(memberships).where(
            memberships.c.org_id == org_id, memberships.c.user_id == user_id))
        c.execute(memberships.insert().values(
            id=membership_id, org_id=org_id, user_id=user_id, role=role,
            player_id=player_id, created_at=time.time()))


def get_membership(org_id: str, user_id: int) -> dict | None:
    with _engine.connect() as c:
        return _row(c, select(memberships).where(
            memberships.c.org_id == org_id, memberships.c.user_id == user_id))


def list_orgs_for_user(user_id: int) -> list[dict]:
    sql = text(
        "SELECT o.id, o.name, m.role, m.player_id "
        "FROM organizations o JOIN memberships m ON m.org_id = o.id "
        "WHERE m.user_id = :uid ORDER BY o.created_at DESC")
    with _engine.connect() as c:
        return _rows(c, sql, {"uid": user_id})


def list_members(org_id: str) -> list[dict]:
    sql = text(
        "SELECT m.id, m.user_id, m.role, m.player_id, u.email "
        "FROM memberships m JOIN users u ON u.id = m.user_id "
        "WHERE m.org_id = :oid ORDER BY m.created_at")
    with _engine.connect() as c:
        return _rows(c, sql, {"oid": org_id})


def list_org_teams(org_id: str) -> list[dict]:
    sql = text(
        "SELECT t.id, t.name, "
        "(SELECT COUNT(*) FROM players p WHERE p.team_id = t.id) AS player_count, "
        "(SELECT COUNT(*) FROM matches mt WHERE mt.team_id = t.id) AS match_count "
        "FROM teams t WHERE t.org_id = :oid ORDER BY t.created_at DESC")
    with _engine.connect() as c:
        return _rows(c, sql, {"oid": org_id})


# --- players ----------------------------------------------------------------

def create_player(player_id: str, team_id: str, name: str, position: str | None,
                  jersey: int | None, is_minor: bool = True) -> dict:
    with _engine.begin() as c:
        c.execute(players.insert().values(
            id=player_id, team_id=team_id, name=name, position=position,
            jersey=jersey, is_minor=int(is_minor), created_at=time.time()))
    return {"id": player_id, "name": name, "is_minor": is_minor}


def set_player_consent(player_id: str, granted_by: int | None) -> None:
    vals = ({"guardian_consent_at": None, "guardian_consent_by": None}
            if granted_by is None
            else {"guardian_consent_at": time.time(), "guardian_consent_by": granted_by})
    with _engine.begin() as c:
        c.execute(players.update().where(players.c.id == player_id).values(**vals))


def get_player(player_id: str) -> dict | None:
    with _engine.connect() as c:
        return _row(c, select(players).where(players.c.id == player_id))


def get_player_by_token(token: str) -> dict | None:
    with _engine.connect() as c:
        return _row(c, select(players).where(players.c.public_token == token))


def list_players(team_id: str) -> list[dict]:
    with _engine.connect() as c:
        return _rows(c, select(players).where(players.c.team_id == team_id)
                     .order_by(players.c.jersey, players.c.name))


def update_player(player_id: str, name: str, position: str | None,
                  jersey: int | None) -> None:
    with _engine.begin() as c:
        c.execute(players.update().where(players.c.id == player_id)
                  .values(name=name, position=position, jersey=jersey))


def set_player_public(player_id: str, token: str | None) -> None:
    with _engine.begin() as c:
        c.execute(players.update().where(players.c.id == player_id)
                  .values(public_token=token))


def set_player_avatar(player_id: str, avatar_url: str | None) -> None:
    with _engine.begin() as c:
        c.execute(players.update().where(players.c.id == player_id)
                  .values(avatar_url=avatar_url))


def delete_player(player_id: str) -> None:
    with _engine.begin() as c:
        c.execute(delete(player_match_stats).where(player_match_stats.c.player_id == player_id))
        c.execute(delete(players).where(players.c.id == player_id))


def list_all_players(user_id: int) -> list[dict]:
    """Every player across the user's teams (for the cross-team compare picker)."""
    sql = text(
        "SELECT p.id, p.name, p.jersey, p.team_id, p.avatar_url, t.name AS team_name "
        "FROM players p JOIN teams t ON t.id = p.team_id "
        "WHERE t.user_id = :uid ORDER BY t.name, p.jersey")
    with _engine.connect() as c:
        return _rows(c, sql, {"uid": user_id})


def match_for_job(job_id: str) -> dict | None:
    """The match (if any) a dashboard analysis job is linked to."""
    with _engine.connect() as c:
        return _row(c, select(matches).where(matches.c.job_id == job_id)
                    .order_by(matches.c.created_at.desc()))


# --- matches ----------------------------------------------------------------

def create_match(match_id: str, user_id: int, team_id: str, field_type: int,
                 opponent: str | None, played_on: str | None, job_id: str | None,
                 home_score: int | None, away_score: int | None,
                 summary: str | None) -> dict:
    with _engine.begin() as c:
        c.execute(matches.insert().values(
            id=match_id, user_id=user_id, team_id=team_id, job_id=job_id,
            field_type=field_type, opponent=opponent, played_on=played_on,
            home_score=home_score, away_score=away_score, summary=summary,
            created_at=time.time()))
    return {"id": match_id}


def get_match(match_id: str) -> dict | None:
    with _engine.connect() as c:
        d = _row(c, select(matches).where(matches.c.id == match_id))
    if d and d.get("summary"):
        d["summary"] = json.loads(d["summary"])
    return d


def list_matches(team_id: str) -> list[dict]:
    sql = text(
        "SELECT id, team_id, job_id, field_type, opponent, played_on, "
        "home_score, away_score, created_at FROM matches WHERE team_id = :tid "
        "ORDER BY COALESCE(played_on, '') DESC, created_at DESC")
    with _engine.connect() as c:
        return _rows(c, sql, {"tid": team_id})


def delete_match(match_id: str) -> None:
    with _engine.begin() as c:
        c.execute(delete(player_match_stats).where(player_match_stats.c.match_id == match_id))
        c.execute(delete(matches).where(matches.c.id == match_id))


# --- player match stats -----------------------------------------------------

def add_player_stat(stat_id: str, match_id: str, player_id: str, minutes: int,
                    distance_m: float, top_speed_ms: float, goals: int,
                    assists: int, sprints: int = 0, passes: int = 0,
                    passes_completed: int = 0, shots: int = 0,
                    shots_on_target: int = 0, fouls: int = 0) -> None:
    with _engine.begin() as c:
        c.execute(player_match_stats.insert().values(
            id=stat_id, match_id=match_id, player_id=player_id, minutes=minutes,
            distance_m=distance_m, top_speed_ms=top_speed_ms, sprints=sprints,
            passes=passes, passes_completed=passes_completed,
            shots=shots, shots_on_target=shots_on_target, fouls=fouls,
            goals=goals, assists=assists))


def upsert_player_stat(match_id: str, player_id: str, fields: dict) -> None:
    """Merge per-player match stats (one row per player per match).

    Reads any existing row, applies ``fields`` over it, and rewrites — so manual
    edits (goals/fouls/…) don't wipe auto-imported tracking metrics and vice
    versa."""
    cols = ("minutes", "distance_m", "top_speed_ms", "sprints", "passes",
            "passes_completed", "shots", "shots_on_target", "fouls",
            "goals", "assists", *EVENT_FIELDS)
    with _engine.begin() as c:
        existing = _row(c, select(player_match_stats).where(
            (player_match_stats.c.match_id == match_id)
            & (player_match_stats.c.player_id == player_id)))
        merged = {k: (existing.get(k) if existing else 0) or 0 for k in cols}
        for k, v in fields.items():
            if k in cols and v is not None:
                merged[k] = v
        c.execute(player_match_stats.delete().where(
            (player_match_stats.c.match_id == match_id)
            & (player_match_stats.c.player_id == player_id)))
        c.execute(player_match_stats.insert().values(
            id="st_" + uuid.uuid4().hex[:10], match_id=match_id,
            player_id=player_id, **merged))


def clear_match_stats(match_id: str) -> None:
    with _engine.begin() as c:
        c.execute(delete(player_match_stats).where(player_match_stats.c.match_id == match_id))


def stats_for_match(match_id: str) -> list[dict]:
    sql = text(
        "SELECT s.*, p.name AS player_name FROM player_match_stats s "
        "JOIN players p ON p.id = s.player_id WHERE s.match_id = :mid")
    with _engine.connect() as c:
        return _rows(c, sql, {"mid": match_id})


def stats_for_player(player_id: str) -> list[dict]:
    sql = text(
        "SELECT s.*, m.field_type, m.opponent, m.played_on, m.id AS match_id "
        "FROM player_match_stats s JOIN matches m ON m.id = s.match_id "
        "WHERE s.player_id = :pid ORDER BY COALESCE(m.played_on, '') DESC")
    with _engine.connect() as c:
        return _rows(c, sql, {"pid": player_id})


# --- clip tags (coding) -----------------------------------------------------

def add_clip_tag(tag_id: str, job_id: str, user_id: int, t: float,
                 label: str, note: str | None, player_id: str | None) -> dict:
    with _engine.begin() as c:
        c.execute(clip_tags.insert().values(
            id=tag_id, job_id=job_id, user_id=user_id, t=t, label=label,
            note=note, player_id=player_id, created_at=time.time()))
    return {"id": tag_id, "job_id": job_id, "t": t, "label": label,
            "note": note, "player_id": player_id}


def list_clip_tags(job_id: str) -> list[dict]:
    sql = text(
        "SELECT ct.*, p.name AS player_name FROM clip_tags ct "
        "LEFT JOIN players p ON p.id = ct.player_id "
        "WHERE ct.job_id = :jid ORDER BY ct.t ASC")
    with _engine.connect() as c:
        return _rows(c, sql, {"jid": job_id})


def get_clip_tag(tag_id: str) -> dict | None:
    with _engine.connect() as c:
        return _row(c, select(clip_tags).where(clip_tags.c.id == tag_id))


def delete_clip_tag(tag_id: str) -> None:
    with _engine.begin() as c:
        c.execute(delete(clip_tags).where(clip_tags.c.id == tag_id))


# --- telestrations ----------------------------------------------------------

def add_telestration(tid: str, job_id: str, user_id: int, name: str,
                     t: float, shapes: str) -> dict:
    with _engine.begin() as c:
        c.execute(telestrations.insert().values(
            id=tid, job_id=job_id, user_id=user_id, name=name, t=t,
            shapes=shapes, created_at=time.time()))
    return {"id": tid, "job_id": job_id, "name": name, "t": t, "shapes": shapes}


def list_telestrations(job_id: str) -> list[dict]:
    with _engine.connect() as c:
        return _rows(c, select(telestrations)
                     .where(telestrations.c.job_id == job_id)
                     .order_by(telestrations.c.t.asc()))


def get_telestration(tid: str) -> dict | None:
    with _engine.connect() as c:
        return _row(c, select(telestrations).where(telestrations.c.id == tid))


def delete_telestration(tid: str) -> None:
    with _engine.begin() as c:
        c.execute(delete(telestrations).where(telestrations.c.id == tid))


# --- playbooks --------------------------------------------------------------

def add_playbook(pid: str, team_id: str, user_id: int, name: str,
                 field_type: int, data: str) -> dict:
    with _engine.begin() as c:
        c.execute(playbooks.insert().values(
            id=pid, team_id=team_id, user_id=user_id, name=name,
            field_type=field_type, data=data, created_at=time.time()))
    return {"id": pid, "team_id": team_id, "name": name,
            "field_type": field_type, "data": data}


def update_playbook(pid: str, name: str, field_type: int, data: str) -> None:
    with _engine.begin() as c:
        c.execute(playbooks.update().where(playbooks.c.id == pid)
                  .values(name=name, field_type=field_type, data=data))


def list_playbooks(team_id: str) -> list[dict]:
    with _engine.connect() as c:
        return _rows(c, select(playbooks)
                     .where(playbooks.c.team_id == team_id)
                     .order_by(playbooks.c.created_at.desc()))


def get_playbook(pid: str) -> dict | None:
    with _engine.connect() as c:
        return _row(c, select(playbooks).where(playbooks.c.id == pid))


def delete_playbook(pid: str) -> None:
    with _engine.begin() as c:
        c.execute(delete(playbooks).where(playbooks.c.id == pid))
