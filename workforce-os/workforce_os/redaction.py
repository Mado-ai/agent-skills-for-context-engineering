"""Secret redaction. Applied to every payload before it reaches the database or a log.

Two independent defences:
  1. Key-name matching  — anything that *looks* like a credential field.
  2. Value matching     — the literal values of configured secrets, wherever they appear.
"""

import os
import re

from .config import SECRET_ENV_KEYS

REDACTED = "[REDACTED]"

_SECRET_KEY_PATTERN = re.compile(
    r"(api[_-]?key|secret|password|passwd|token|authorization|credential|private[_-]?key|bearer)",
    re.IGNORECASE,
)

# Values shorter than this are too likely to collide with ordinary text to blind-match.
_MIN_SECRET_VALUE_LEN = 8


def _secret_values() -> list[str]:
    values = []
    for key in SECRET_ENV_KEYS:
        val = os.environ.get(key, "")
        if len(val) >= _MIN_SECRET_VALUE_LEN:
            values.append(val)
    return values


def redact_text(text: str, extra_secrets: list[str] | None = None) -> str:
    """Replace any known secret value occurring inside a string."""
    if not isinstance(text, str):
        return text
    for secret in _secret_values() + [s for s in (extra_secrets or []) if len(s) >= _MIN_SECRET_VALUE_LEN]:
        if secret in text:
            text = text.replace(secret, REDACTED)
    return text


def redact(value, extra_secrets: list[str] | None = None):
    """Recursively redact a JSON-compatible structure.

    A key whose *name* looks like a credential has its value replaced outright; all
    strings are additionally scanned for known secret values.
    """
    if isinstance(value, dict):
        out = {}
        for key, val in value.items():
            if isinstance(key, str) and _SECRET_KEY_PATTERN.search(key):
                out[key] = REDACTED
            else:
                out[key] = redact(val, extra_secrets)
        return out
    if isinstance(value, (list, tuple)):
        return [redact(item, extra_secrets) for item in value]
    if isinstance(value, str):
        return redact_text(value, extra_secrets)
    return value
