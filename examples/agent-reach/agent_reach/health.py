"""Live health checks: start the server and speak MCP to it.

A config file that merely *looks* right is worth little — the failure modes that
matter (package pulled, launcher missing, key rejected, tool renamed upstream)
only appear when something actually completes the handshake. So every check here
spawns the real server over stdio and runs the real protocol.
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
from dataclasses import dataclass, field
from typing import Any

from .console import FAIL, PASS, SKIP, WARN
from .registry import Provider
from .runtime import missing_keys, present_keys, resolve_command

PROTOCOL_VERSION = "2025-06-18"
CLIENT_INFO = {"name": "agent-reach", "version": "0.1.0"}

# npx/uvx may download a package on first run, so the default is generous.
DEFAULT_TIMEOUT = 90.0


@dataclass
class Check:
    name: str
    status: str
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.status in (PASS, SKIP)


@dataclass
class HealthResult:
    provider_id: str
    status: str
    checks: list[Check] = field(default_factory=list)
    tools: list[str] = field(default_factory=list)
    server: str = ""
    duration: float = 0.0
    stderr_tail: str = ""

    @property
    def ok(self) -> bool:
        return self.status != FAIL

    def add(self, name: str, status: str, detail: str = "") -> Check:
        check = Check(name=name, status=status, detail=detail)
        self.checks.append(check)
        return check

    def as_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider_id,
            "status": self.status,
            "server": self.server,
            "tools": self.tools,
            "duration_seconds": round(self.duration, 2),
            "checks": [
                {"name": c.name, "status": c.status, "detail": c.detail} for c in self.checks
            ],
            "stderr_tail": self.stderr_tail,
        }


class StdioSession:
    """A minimal MCP client over a subprocess's stdin/stdout."""

    def __init__(self, command: list[str], env: dict[str, str], timeout: float):
        self.command = command
        self.env = env
        self.timeout = timeout
        self.process: subprocess.Popen[str] | None = None
        self._lines: queue.Queue[str | None] = queue.Queue()
        self._stderr: list[str] = []
        self._next_id = 0
        self._readers: list[threading.Thread] = []

    def __enter__(self) -> StdioSession:
        self.process = subprocess.Popen(
            self.command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=self.env,
            text=True,
            bufsize=1,
        )
        self._readers = [
            threading.Thread(target=self._pump_stdout, daemon=True),
            threading.Thread(target=self._pump_stderr, daemon=True),
        ]
        for reader in self._readers:
            reader.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _pump_stdout(self) -> None:
        assert self.process and self.process.stdout
        for line in self.process.stdout:
            self._lines.put(line)
        self._lines.put(None)

    def _pump_stderr(self) -> None:
        assert self.process and self.process.stderr
        for line in self.process.stderr:
            self._stderr.append(line.rstrip())
            del self._stderr[:-40]

    @property
    def stderr_tail(self) -> str:
        return "\n".join(self._stderr[-6:]).strip()

    def close(self) -> None:
        """Shut the server down and release its pipes.

        Closing stdin asks a well-behaved server to exit; anything still running
        after that is terminated, then killed. The reader threads are joined
        before the pipes close so a reader never reads a closed file.
        """
        process = self.process
        if process is None:
            return
        try:
            if process.stdin and not process.stdin.closed:
                process.stdin.close()
        except OSError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        for reader in self._readers:
            reader.join(timeout=2)
        for stream in (process.stdout, process.stderr):
            try:
                if stream and not stream.closed:
                    stream.close()
            except OSError:
                pass
        self.process = None

    def _send(self, payload: dict[str, Any]) -> None:
        assert self.process and self.process.stdin
        self.process.stdin.write(json.dumps(payload) + "\n")
        self.process.stdin.flush()

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params or {}})

    def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Send a request and return its response, skipping unrelated traffic."""
        self._next_id += 1
        request_id = self._next_id
        self._send(
            {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}
        )

        deadline = time.monotonic() + self.timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"no response to {method} within {self.timeout:.0f}s")
            try:
                line = self._lines.get(timeout=remaining)
            except queue.Empty:
                raise TimeoutError(f"no response to {method} within {self.timeout:.0f}s") from None
            if line is None:
                code = self.process.poll() if self.process else None
                raise ConnectionError(f"server exited before answering {method} (exit {code})")
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue  # servers sometimes emit banner text on stdout
            if isinstance(message, dict) and message.get("id") == request_id:
                return message


def _process_env(provider: Provider, extra: dict[str, str] | None = None) -> dict[str, str]:
    env = dict(os.environ)
    env.update(extra or {})
    env.setdefault("NO_COLOR", "1")
    return env


def check_provider(
    provider: Provider,
    timeout: float = DEFAULT_TIMEOUT,
    probe: bool = False,
    env: dict[str, str] | None = None,
) -> HealthResult:
    """Start the server, complete the handshake, list tools, optionally call one."""
    result = HealthResult(provider_id=provider.id, status=PASS)
    started = time.monotonic()

    command, resolved = resolve_command(provider)
    if not resolved:
        result.add("launcher", FAIL, f"`{command.exec}` is not on PATH")
        result.status = FAIL
        result.duration = time.monotonic() - started
        return result
    result.add("launcher", PASS, command.display())

    absent = missing_keys(provider, env)
    if absent:
        result.add("credentials", FAIL, f"missing {', '.join(absent)}")
        result.status = FAIL
        result.duration = time.monotonic() - started
        return result
    if provider.required_keys:
        result.add("credentials", PASS, "required keys present in environment")
    elif provider.keys:
        # Optional keys usually mean "works keyless, better with a key" — say which.
        supplied = present_keys(provider, env)
        if supplied:
            result.add("credentials", PASS, f"optional key set: {', '.join(supplied)}")
        else:
            result.add(
                "credentials",
                SKIP,
                f"running keyless; {', '.join(k.env for k in provider.optional_keys)} "
                "would raise the rate limit",
            )

    session_env = _process_env(provider, env)
    try:
        with StdioSession(command.as_list(), session_env, timeout) as session:
            response = session.request(
                "initialize",
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": CLIENT_INFO,
                },
            )
            if "error" in response:
                raise ConnectionError(f"initialize failed: {response['error']}")

            info = response.get("result", {}).get("serverInfo", {})
            result.server = f"{info.get('name', '?')} {info.get('version', '')}".strip()
            result.add("handshake", PASS, f"connected to {result.server}")
            session.notify("notifications/initialized")

            listed = session.request("tools/list")
            if "error" in listed:
                raise ConnectionError(f"tools/list failed: {listed['error']}")
            tools = [t.get("name", "") for t in listed.get("result", {}).get("tools", [])]
            result.tools = tools

            if not tools:
                result.add("tools", FAIL, "server exposes no tools")
                result.status = FAIL
            else:
                missing_tools = [t for t in provider.expected_tools if t not in tools]
                if missing_tools:
                    # Upstream renamed something. The server works; the catalog is stale.
                    result.add(
                        "tools",
                        WARN,
                        f"{len(tools)} tools, but expected {', '.join(missing_tools)} "
                        "— catalog may be out of date",
                    )
                    result.status = WARN if result.status == PASS else result.status
                else:
                    result.add("tools", PASS, f"{len(tools)} tools: {', '.join(tools[:6])}")

            if probe:
                _run_probe(session, provider, result)
            elif provider.probe:
                result.add("probe", SKIP, "live call not requested (use --probe)")

            result.stderr_tail = session.stderr_tail
    except (TimeoutError, ConnectionError) as exc:
        result.add("handshake", FAIL, str(exc))
        result.status = FAIL
    except OSError as exc:
        result.add("launch", FAIL, f"could not start server: {exc}")
        result.status = FAIL

    result.duration = time.monotonic() - started
    return result


def _run_probe(session: StdioSession, provider: Provider, result: HealthResult) -> None:
    """Call one real tool — the only check that proves the key and network work."""
    if not provider.probe:
        result.add("probe", SKIP, "no probe defined for this provider")
        return
    tool = provider.probe.get("tool", "")
    if tool not in result.tools:
        result.add("probe", SKIP, f"probe tool '{tool}' not exposed by this server")
        return
    try:
        response = session.request(
            "tools/call",
            {"name": tool, "arguments": provider.probe.get("arguments", {})},
        )
    except (TimeoutError, ConnectionError) as exc:
        result.add("probe", FAIL, f"{tool}: {exc}")
        result.status = FAIL
        return

    if "error" in response:
        result.add("probe", FAIL, f"{tool}: {response['error'].get('message', 'error')}")
        result.status = FAIL
        return

    payload = response.get("result", {})
    if payload.get("isError"):
        text = _first_text(payload)
        result.add("probe", FAIL, f"{tool} returned an error: {text[:160]}")
        result.status = FAIL
        return

    text = _first_text(payload)
    if not text.strip():
        result.add("probe", WARN, f"{tool} returned an empty result")
        result.status = WARN if result.status == PASS else result.status
        return

    signal = negative_signal(text)
    if signal:
        result.add(
            "probe",
            WARN,
            f"{tool} succeeded but the response reads like a failure "
            f"('{signal}'): {text[:120]!r}",
        )
        result.status = WARN if result.status == PASS else result.status
        return

    result.add("probe", PASS, f"{tool} returned {len(text)} chars: {text[:80]!r}")


# Some servers answer a failed call with a *successful* response whose body says
# it failed ("no results", "rate limit exceeded", "bot detection"). A check that
# went green on those would defeat the point of probing at all. Only short bodies
# are tested: a genuine result set is long, so this cannot fire on a snippet that
# merely mentions one of these phrases.
NEGATIVE_SIGNALS = (
    "no results",
    "rate limit",
    "quota exceed",
    "bot detection",
    "unauthorized",
    "invalid api key",
    "forbidden",
    "captcha",
    "try again later",
)
NEGATIVE_SIGNAL_MAX_CHARS = 800


def negative_signal(text: str) -> str:
    """Return the failure phrase found in a short response body, else ''."""
    if len(text) > NEGATIVE_SIGNAL_MAX_CHARS:
        return ""
    lowered = text.lower()
    return next((signal for signal in NEGATIVE_SIGNALS if signal in lowered), "")


def _first_text(payload: dict[str, Any]) -> str:
    parts = [c.get("text", "") for c in payload.get("content", []) if c.get("type") == "text"]
    return "\n".join(parts)
