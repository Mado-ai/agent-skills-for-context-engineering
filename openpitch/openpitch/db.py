"""SQLite persistence for users and analysis jobs.

Replaces the original in-memory job registry so accounts and job history
survive restarts. Single-file SQLite with a process-wide lock — adequate for
a self-hosted prototype; move to Postgres + object storage to scale.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(__import__("os").environ.get("PLAYMETRICS_DB", ROOT / "playmetrics.db"))

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _conn.row_factory = sqlite3.Row
    return _conn


def init_db() -> None:
    with _lock:
        c = _connect()
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                is_admin INTEGER DEFAULT 0,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                input_name TEXT,
                detector TEXT,
                status TEXT NOT NULL,
                progress REAL DEFAULT 0,
                message TEXT,
                summary TEXT,
                source TEXT DEFAULT 'upload',
                site_id TEXT,
                created_at REAL NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            -- Capture sites (a club/academy pitch deployment) and their devices.
            CREATE TABLE IF NOT EXISTS sites (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                package TEXT NOT NULL,
                created_at REAL NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY,
                site_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                name TEXT NOT NULL,
                key_hash TEXT NOT NULL,
                last_seen REAL,
                created_at REAL NOT NULL,
                FOREIGN KEY (site_id) REFERENCES sites(id)
            );
            CREATE TABLE IF NOT EXISTS ingest_keys (
                idempotency_key TEXT PRIMARY KEY,
                job_id TEXT NOT NULL
            );
            -- Profiles: teams, players, matches (by field type), per-player stats.
            CREATE TABLE IF NOT EXISTS teams (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                public_token TEXT,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS players (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL,
                name TEXT NOT NULL,
                position TEXT,
                jersey INTEGER,
                public_token TEXT,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS matches (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                team_id TEXT NOT NULL,
                job_id TEXT,
                field_type INTEGER NOT NULL,
                opponent TEXT,
                played_on TEXT,
                home_score INTEGER,
                away_score INTEGER,
                summary TEXT,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS player_match_stats (
                id TEXT PRIMARY KEY,
                match_id TEXT NOT NULL,
                player_id TEXT NOT NULL,
                minutes INTEGER DEFAULT 0,
                distance_m REAL DEFAULT 0,
                top_speed_ms REAL DEFAULT 0,
                goals INTEGER DEFAULT 0,
                assists INTEGER DEFAULT 0
            );
            """
        )
        # Migrate older DBs that predate the jobs.source / jobs.site_id columns.
        cols = {r["name"] for r in c.execute("PRAGMA table_info(jobs)")}
        if "source" not in cols:
            c.execute("ALTER TABLE jobs ADD COLUMN source TEXT DEFAULT 'upload'")
        if "site_id" not in cols:
            c.execute("ALTER TABLE jobs ADD COLUMN site_id TEXT")
        c.commit()


# --- users ------------------------------------------------------------------

def create_user(email: str, password_hash: str, is_admin: bool = False) -> dict:
    with _lock:
        c = _connect()
        cur = c.execute(
            "INSERT INTO users (email, password_hash, is_admin, created_at) "
            "VALUES (?,?,?,?)",
            (email.lower(), password_hash, int(is_admin), time.time()),
        )
        c.commit()
        return {"id": cur.lastrowid, "email": email.lower(), "is_admin": is_admin}


def get_user_by_email(email: str) -> sqlite3.Row | None:
    return _connect().execute(
        "SELECT * FROM users WHERE email = ?", (email.lower(),)
    ).fetchone()


def get_user_by_id(user_id: int) -> sqlite3.Row | None:
    return _connect().execute(
        "SELECT * FROM users WHERE id = ?", (user_id,)
    ).fetchone()


def set_password(user_id: int, password_hash: str) -> None:
    with _lock:
        c = _connect()
        c.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                  (password_hash, user_id))
        c.commit()


# --- jobs -------------------------------------------------------------------

def create_job(
    job_id: str,
    user_id: int,
    input_name: str,
    detector: str,
    source: str = "upload",
    site_id: str | None = None,
) -> None:
    with _lock:
        c = _connect()
        c.execute(
            "INSERT INTO jobs (id, user_id, input_name, detector, status, "
            "progress, message, source, site_id, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (job_id, user_id, input_name, detector, "queued", 0.0, "queued",
             source, site_id, time.time()),
        )
        c.commit()


def update_job(job_id: str, **fields) -> None:
    if "summary" in fields and not isinstance(fields["summary"], str):
        fields["summary"] = json.dumps(fields["summary"])
    cols = ", ".join(f"{k} = ?" for k in fields)
    with _lock:
        c = _connect()
        c.execute(f"UPDATE jobs SET {cols} WHERE id = ?",
                  (*fields.values(), job_id))
        c.commit()


def _job_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    if d.get("summary"):
        d["summary"] = json.loads(d["summary"])
    return d


def get_job(job_id: str) -> dict | None:
    row = _connect().execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return _job_to_dict(row) if row else None


def list_jobs_for_user(user_id: int) -> list[dict]:
    rows = _connect().execute(
        "SELECT id, input_name, detector, status, progress, message, created_at "
        "FROM jobs WHERE user_id = ? ORDER BY created_at DESC",
        (user_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def rename_job(job_id: str, name: str) -> None:
    with _lock:
        c = _connect()
        c.execute("UPDATE jobs SET input_name = ? WHERE id = ?", (name, job_id))
        c.commit()


def delete_job(job_id: str) -> None:
    with _lock:
        c = _connect()
        c.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        c.commit()


# --- sites & devices (capture-site registry) --------------------------------

def create_site(site_id: str, user_id: int, name: str, package: str) -> dict:
    with _lock:
        c = _connect()
        c.execute(
            "INSERT INTO sites (id, user_id, name, package, created_at) "
            "VALUES (?,?,?,?,?)",
            (site_id, user_id, name, package, time.time()),
        )
        c.commit()
    return {"id": site_id, "name": name, "package": package}


def get_site(site_id: str) -> sqlite3.Row | None:
    return _connect().execute("SELECT * FROM sites WHERE id = ?", (site_id,)).fetchone()


def list_sites(user_id: int) -> list[dict]:
    rows = _connect().execute(
        "SELECT s.*, "
        "(SELECT COUNT(*) FROM devices d WHERE d.site_id = s.id) AS device_count "
        "FROM sites s WHERE s.user_id = ? ORDER BY s.created_at DESC",
        (user_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def create_device(device_id: str, site_id: str, kind: str, name: str,
                  key_hash: str) -> None:
    with _lock:
        c = _connect()
        c.execute(
            "INSERT INTO devices (id, site_id, kind, name, key_hash, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (device_id, site_id, kind, name, key_hash, time.time()),
        )
        c.commit()


def list_devices(site_id: str) -> list[dict]:
    rows = _connect().execute(
        "SELECT id, site_id, kind, name, last_seen, created_at "
        "FROM devices WHERE site_id = ? ORDER BY created_at",
        (site_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_device_by_key_hash(key_hash: str) -> sqlite3.Row | None:
    return _connect().execute(
        "SELECT * FROM devices WHERE key_hash = ?", (key_hash,)
    ).fetchone()


def touch_device(device_id: str) -> None:
    with _lock:
        c = _connect()
        c.execute("UPDATE devices SET last_seen = ? WHERE id = ?",
                  (time.time(), device_id))
        c.commit()


# --- ingest idempotency -----------------------------------------------------

def get_ingest_job(idempotency_key: str) -> str | None:
    row = _connect().execute(
        "SELECT job_id FROM ingest_keys WHERE idempotency_key = ?",
        (idempotency_key,),
    ).fetchone()
    return row["job_id"] if row else None


def record_ingest_job(idempotency_key: str, job_id: str) -> None:
    with _lock:
        c = _connect()
        c.execute(
            "INSERT OR IGNORE INTO ingest_keys (idempotency_key, job_id) VALUES (?,?)",
            (idempotency_key, job_id),
        )
        c.commit()


def _exec(sql: str, params: tuple = ()) -> None:
    with _lock:
        c = _connect()
        c.execute(sql, params)
        c.commit()


# --- teams ------------------------------------------------------------------

def create_team(team_id: str, user_id: int, name: str) -> dict:
    _exec("INSERT INTO teams (id, user_id, name, created_at) VALUES (?,?,?,?)",
          (team_id, user_id, name, time.time()))
    return {"id": team_id, "name": name}


def get_team(team_id: str) -> sqlite3.Row | None:
    return _connect().execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()


def get_team_by_token(token: str) -> sqlite3.Row | None:
    return _connect().execute(
        "SELECT * FROM teams WHERE public_token = ?", (token,)
    ).fetchone()


def list_teams(user_id: int) -> list[dict]:
    rows = _connect().execute(
        "SELECT t.*, "
        "(SELECT COUNT(*) FROM players p WHERE p.team_id = t.id) AS player_count, "
        "(SELECT COUNT(*) FROM matches m WHERE m.team_id = t.id) AS match_count "
        "FROM teams t WHERE t.user_id = ? ORDER BY t.created_at DESC",
        (user_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def update_team(team_id: str, name: str) -> None:
    _exec("UPDATE teams SET name = ? WHERE id = ?", (name, team_id))


def set_team_public(team_id: str, token: str | None) -> None:
    _exec("UPDATE teams SET public_token = ? WHERE id = ?", (token, team_id))


def delete_team(team_id: str) -> None:
    with _lock:
        c = _connect()
        match_ids = [r["id"] for r in c.execute(
            "SELECT id FROM matches WHERE team_id = ?", (team_id,))]
        for mid in match_ids:
            c.execute("DELETE FROM player_match_stats WHERE match_id = ?", (mid,))
        c.execute("DELETE FROM matches WHERE team_id = ?", (team_id,))
        c.execute("DELETE FROM players WHERE team_id = ?", (team_id,))
        c.execute("DELETE FROM teams WHERE id = ?", (team_id,))
        c.commit()


# --- players ----------------------------------------------------------------

def create_player(player_id: str, team_id: str, name: str, position: str | None,
                  jersey: int | None) -> dict:
    _exec("INSERT INTO players (id, team_id, name, position, jersey, created_at) "
          "VALUES (?,?,?,?,?,?)",
          (player_id, team_id, name, position, jersey, time.time()))
    return {"id": player_id, "name": name}


def get_player(player_id: str) -> sqlite3.Row | None:
    return _connect().execute(
        "SELECT * FROM players WHERE id = ?", (player_id,)
    ).fetchone()


def get_player_by_token(token: str) -> sqlite3.Row | None:
    return _connect().execute(
        "SELECT * FROM players WHERE public_token = ?", (token,)
    ).fetchone()


def list_players(team_id: str) -> list[dict]:
    return [dict(r) for r in _connect().execute(
        "SELECT * FROM players WHERE team_id = ? ORDER BY jersey, name", (team_id,))]


def update_player(player_id: str, name: str, position: str | None,
                  jersey: int | None) -> None:
    _exec("UPDATE players SET name = ?, position = ?, jersey = ? WHERE id = ?",
          (name, position, jersey, player_id))


def set_player_public(player_id: str, token: str | None) -> None:
    _exec("UPDATE players SET public_token = ? WHERE id = ?", (token, player_id))


def delete_player(player_id: str) -> None:
    with _lock:
        c = _connect()
        c.execute("DELETE FROM player_match_stats WHERE player_id = ?", (player_id,))
        c.execute("DELETE FROM players WHERE id = ?", (player_id,))
        c.commit()


# --- matches ----------------------------------------------------------------

def create_match(match_id: str, user_id: int, team_id: str, field_type: int,
                 opponent: str | None, played_on: str | None, job_id: str | None,
                 home_score: int | None, away_score: int | None,
                 summary: str | None) -> dict:
    _exec(
        "INSERT INTO matches (id, user_id, team_id, job_id, field_type, opponent, "
        "played_on, home_score, away_score, summary, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (match_id, user_id, team_id, job_id, field_type, opponent, played_on,
         home_score, away_score, summary, time.time()),
    )
    return {"id": match_id}


def get_match(match_id: str) -> dict | None:
    row = _connect().execute("SELECT * FROM matches WHERE id = ?", (match_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    if d.get("summary"):
        d["summary"] = json.loads(d["summary"])
    return d


def list_matches(team_id: str) -> list[dict]:
    rows = _connect().execute(
        "SELECT id, team_id, job_id, field_type, opponent, played_on, "
        "home_score, away_score, created_at FROM matches "
        "WHERE team_id = ? ORDER BY COALESCE(played_on, '') DESC, created_at DESC",
        (team_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def delete_match(match_id: str) -> None:
    with _lock:
        c = _connect()
        c.execute("DELETE FROM player_match_stats WHERE match_id = ?", (match_id,))
        c.execute("DELETE FROM matches WHERE id = ?", (match_id,))
        c.commit()


# --- player match stats -----------------------------------------------------

def add_player_stat(stat_id: str, match_id: str, player_id: str, minutes: int,
                    distance_m: float, top_speed_ms: float, goals: int,
                    assists: int) -> None:
    _exec(
        "INSERT INTO player_match_stats (id, match_id, player_id, minutes, "
        "distance_m, top_speed_ms, goals, assists) VALUES (?,?,?,?,?,?,?,?)",
        (stat_id, match_id, player_id, minutes, distance_m, top_speed_ms, goals,
         assists),
    )


def stats_for_match(match_id: str) -> list[dict]:
    return [dict(r) for r in _connect().execute(
        "SELECT s.*, p.name AS player_name FROM player_match_stats s "
        "JOIN players p ON p.id = s.player_id WHERE s.match_id = ?", (match_id,))]


def stats_for_player(player_id: str) -> list[dict]:
    """Player's stat lines joined with each match's field type and metadata."""
    return [dict(r) for r in _connect().execute(
        "SELECT s.*, m.field_type, m.opponent, m.played_on, m.id AS match_id "
        "FROM player_match_stats s JOIN matches m ON m.id = s.match_id "
        "WHERE s.player_id = ? ORDER BY COALESCE(m.played_on,'') DESC", (player_id,))]
