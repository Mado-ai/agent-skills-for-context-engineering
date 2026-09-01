"""HTTP API over the runtime.

Standard library only, so the server runs offline with no install step. Authentication
happens here at the boundary: the principal is derived from the presented credential and
never from anything in the request body. Routes are matched against an explicit table —
there is no dynamic dispatch on user input.
"""

from __future__ import annotations

import json
import re
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from ..errors import (
    AuthenticationError, NotFoundError, PolicyDenied, ValidationError, WorkforceError,
)
from ..policy.authority import Principal, authenticate_owner, owner_principal
from ..runtime import Runtime
from .routes import ROUTES

MAX_BODY_BYTES = 1 * 1024 * 1024
STATIC_DIR = Path(__file__).parent / "static"


class ApiError(WorkforceError):
    pass


def _compile(routes):
    compiled = []
    for method, pattern, handler, auth in routes:
        regex = re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern) + "$")
        compiled.append((method, regex, handler, auth))
    return compiled


COMPILED_ROUTES = _compile(ROUTES)


class Handler(BaseHTTPRequestHandler):
    server_version = "WorkforceOS/0.4"
    runtime: Runtime = None  # injected by create_server

    # ------------------------------------------------------------------ plumbing

    def log_message(self, fmt, *args):  # keep the test output clean
        if getattr(self.server, "verbose", False):
            super().log_message(fmt, *args)

    def _send(self, status: int, payload, *, content_type="application/json"):
        if content_type == "application/json":
            body = json.dumps(payload, default=str, indent=2).encode("utf-8")
        else:
            body = payload if isinstance(payload, bytes) else str(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        # This API is same-origin only; no cross-origin access is granted.
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY_BYTES:
            raise ValidationError("Request body is too large", details={"max_bytes": MAX_BODY_BYTES})
        raw = self.rfile.read(length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValidationError("Request body must be valid JSON") from exc
        if not isinstance(parsed, dict):
            raise ValidationError("Request body must be a JSON object")
        return parsed

    # ------------------------------------------------------------ authentication

    def _principal(self, auth: str) -> Principal:
        """Derive the acting principal from credentials, never from the request body."""
        token = self.headers.get("X-Owner-Token") or ""
        bearer = self.headers.get("Authorization", "")
        if not token and bearer.startswith("Bearer "):
            token = bearer[len("Bearer "):]

        if auth == "owner":
            return authenticate_owner(token, self.runtime.config.owner_token)
        if auth == "any":
            # Agent-acting routes still require the Owner credential in v0.4: agents run
            # in-process, so there is no separate agent credential to present yet.
            return authenticate_owner(token, self.runtime.config.owner_token)
        return Principal(kind="system", id="anonymous", level=0)

    # --------------------------------------------------------------- dispatching

    def _dispatch(self, method: str):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if method == "GET" and path in ("/", "/dashboard"):
            return self._serve_dashboard()

        for route_method, regex, handler, auth in COMPILED_ROUTES:
            if route_method != method:
                continue
            match = regex.match(path)
            if not match:
                continue
            try:
                principal = self._principal(auth)
                query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
                body = self._read_json() if method in ("POST", "PATCH", "PUT") else {}
                status, payload = handler(self.runtime, principal, match.groupdict(), query, body)
                return self._send(status, payload)
            except WorkforceError as exc:
                return self._send(exc.http_status, exc.to_dict())
            except Exception:  # never leak a stack trace to the client
                if getattr(self.server, "verbose", False):
                    traceback.print_exc()
                return self._send(500, {"error": "internal_error",
                                        "message": "An unexpected error occurred"})

        return self._send(404, {"error": "not_found", "message": f"No route for {method} {path}"})

    def _serve_dashboard(self):
        index = STATIC_DIR / "index.html"
        if not index.exists():
            return self._send(404, {"error": "not_found", "message": "Dashboard not installed"})
        return self._send(200, index.read_bytes(), content_type="text/html; charset=utf-8")

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PATCH(self):
        self._dispatch("PATCH")


def create_server(runtime: Runtime, *, host: str | None = None, port: int | None = None,
                  verbose: bool = False) -> ThreadingHTTPServer:
    handler = type("BoundHandler", (Handler,), {"runtime": runtime})
    server = ThreadingHTTPServer((host or runtime.config.host, port or runtime.config.port), handler)
    server.verbose = verbose
    server.daemon_threads = True
    return server


def main() -> None:  # pragma: no cover - manual entry point
    from ..config import load_config

    runtime = Runtime(load_config())
    server = create_server(runtime, verbose=True)
    host, port = server.server_address
    mode = "offline (local provider)" if runtime.config.offline else runtime.config.provider
    print(f"AI Workforce OS v0.4 — http://{host}:{port}  [{mode}]")
    if not runtime.config.owner_token:
        print("WARNING: WORKFORCE_OS_OWNER_TOKEN is not set; Owner actions are disabled.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        server.server_close()
        runtime.close()


if __name__ == "__main__":  # pragma: no cover
    main()
