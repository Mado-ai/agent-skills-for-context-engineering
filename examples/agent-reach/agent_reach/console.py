"""Terminal output helpers. No dependencies, degrades to plain text."""

from __future__ import annotations

import os
import sys

_CODES = {
    "reset": "\033[0m",
    "bold": "\033[1m",
    "dim": "\033[2m",
    "red": "\033[31m",
    "green": "\033[32m",
    "yellow": "\033[33m",
    "blue": "\033[34m",
    "cyan": "\033[36m",
}

# Status glyphs are ASCII so they survive Windows terminals and CI log capture.
PASS = "ok"
WARN = "warn"
FAIL = "fail"
SKIP = "skip"

_STATUS_COLOR = {PASS: "green", WARN: "yellow", FAIL: "red", SKIP: "dim"}


def color_enabled(stream=None) -> bool:
    stream = stream or sys.stdout
    if os.environ.get("NO_COLOR"):
        return False
    if os.environ.get("AGENT_REACH_FORCE_COLOR"):
        return True
    return bool(getattr(stream, "isatty", lambda: False)())


def paint(text: str, *styles: str) -> str:
    if not color_enabled():
        return text
    prefix = "".join(_CODES[s] for s in styles if s in _CODES)
    return f"{prefix}{text}{_CODES['reset']}" if prefix else text


def status_label(status: str) -> str:
    """Render a fixed-width status tag, e.g. `[ ok ]`."""
    return paint(f"[{status.center(4)}]", _STATUS_COLOR.get(status, "reset"))


def heading(text: str) -> str:
    return paint(text, "bold")


def dim(text: str) -> str:
    return paint(text, "dim")


def line(status: str, text: str, detail: str = "") -> str:
    out = f"{status_label(status)} {text}"
    if detail:
        out += f"\n       {dim(detail)}"
    return out


def table(rows: list[list[str]], headers: list[str]) -> str:
    """Left-aligned plain-text table. Widths come from the widest cell."""
    if not rows:
        return dim("(nothing to show)")
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))
    out = ["  ".join(paint(h.ljust(widths[i]), "bold") for i, h in enumerate(headers))]
    out.append("  ".join("-" * w for w in widths))
    for row in rows:
        out.append("  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)).rstrip())
    return "\n".join(out)
