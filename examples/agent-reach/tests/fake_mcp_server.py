"""A minimal MCP stdio server used to test the health checker without a network.

Behavior is driven by argv so a single script can stand in for a healthy server,
a renamed-tool server, a crashing one, or a hanging one:

    python fake_mcp_server.py [--tools a,b] [--fail-probe] [--empty-probe]
                              [--crash-on initialize|tools/list] [--hang]
                              [--banner] [--no-tools]
"""

from __future__ import annotations

import argparse
import json
import sys
import time


def send(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tools", default="search,fetch_content")
    parser.add_argument("--fail-probe", action="store_true")
    parser.add_argument("--empty-probe", action="store_true")
    parser.add_argument("--crash-on", default="")
    parser.add_argument("--hang", action="store_true")
    parser.add_argument("--banner", action="store_true")
    parser.add_argument("--no-tools", action="store_true")
    parser.add_argument("--probe-text", default=None)
    args = parser.parse_args()

    tools = [] if args.no_tools else [t for t in args.tools.split(",") if t]

    if args.banner:
        # Some real servers print non-JSON noise on stdout; it must be skipped.
        sys.stdout.write("starting fake server...\n")
        sys.stdout.flush()

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        message = json.loads(raw)
        method = message.get("method", "")

        if args.crash_on and method == args.crash_on:
            return 3
        if args.hang and method == "tools/list":
            time.sleep(30)

        if method == "initialize":
            send(
                {
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "result": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "fake-server", "version": "9.9.9"},
                    },
                }
            )
        elif method == "tools/list":
            send(
                {
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "result": {
                        "tools": [
                            {"name": name, "description": name, "inputSchema": {"type": "object"}}
                            for name in tools
                        ]
                    },
                }
            )
        elif method == "tools/call":
            if args.fail_probe:
                send(
                    {
                        "jsonrpc": "2.0",
                        "id": message["id"],
                        "result": {
                            "isError": True,
                            "content": [{"type": "text", "text": "upstream rejected the key"}],
                        },
                    }
                )
            else:
                if args.probe_text is not None:
                    text = args.probe_text
                else:
                    text = "" if args.empty_probe else "result one\nresult two"
                send(
                    {
                        "jsonrpc": "2.0",
                        "id": message["id"],
                        "result": {"content": [{"type": "text", "text": text}]},
                    }
                )
        elif method.startswith("notifications/"):
            continue
        else:
            send(
                {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "error": {"code": -32601, "message": f"unknown method {method}"},
                }
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
