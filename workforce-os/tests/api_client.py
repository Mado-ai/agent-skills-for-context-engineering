"""Minimal HTTP client used by the API tests — stdlib only, real sockets."""

import json
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from workforce_os.server.app import create_server  # noqa: E402


class ApiHarness:
    """Runs the real server on an ephemeral port and speaks HTTP to it."""

    def __init__(self, runtime, owner_token):
        self.runtime = runtime
        self.owner_token = owner_token
        self.server = create_server(runtime, host="127.0.0.1", port=0)
        self.host, self.port = self.server.server_address
        self._thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self._thread.join(timeout=5)

    def request(self, method, path, body=None, *, token="owner", headers=None):
        url = f"http://{self.host}:{self.port}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if token == "owner":
            req.add_header("X-Owner-Token", self.owner_token)
        elif token:
            req.add_header("X-Owner-Token", token)
        for key, value in (headers or {}).items():
            req.add_header(key, value)
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            try:
                return exc.code, json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return exc.code, {"raw": raw.decode(errors="replace")}

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self.request("POST", path, body if body is not None else {}, **kw)
