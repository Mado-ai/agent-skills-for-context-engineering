"""Front-end ↔ infrastructure audit.

Cross-checks that every `/api/...` path the React client calls actually exists
as a route on the FastAPI app — catches renamed/removed endpoints that would
silently 404 in the browser.
"""

from __future__ import annotations

import re
from pathlib import Path

from openpitch.api import app

WEB_SRC = Path(__file__).resolve().parent.parent / "web" / "src"


def _norm(path: str) -> str:
    path = re.sub(r"\$\{[^}]+\}", "{}", path)   # JS template literal -> {}
    path = re.sub(r"\{[^}]+\}", "{}", path)     # FastAPI path param  -> {}
    return path.split("?")[0].rstrip("/")


def _backend_paths() -> set[str]:
    return {_norm(r.path) for r in app.routes
            if getattr(r, "path", "").startswith("/api")}


def _frontend_paths() -> set[str]:
    paths: set[str] = set()
    # Only match URLs that begin a string literal (quote/backtick), so import
    # paths like "../api/client" aren't picked up.
    pattern = re.compile(r"""["'`](/api/[A-Za-z0-9_/${}.:-]+)""")
    for f in WEB_SRC.rglob("*.ts*"):
        for m in pattern.findall(f.read_text()):
            paths.add(_norm(m))
    return paths


def test_every_frontend_api_call_has_a_backend_route():
    backend = _backend_paths()
    missing = sorted(p for p in _frontend_paths() if p not in backend)
    assert not missing, f"frontend calls without a backend route: {missing}\nbackend={sorted(backend)}"
