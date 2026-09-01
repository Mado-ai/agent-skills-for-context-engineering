"""Identifier and trace primitives.

Uses lexicographically-sortable ULID-style identifiers so that primary keys
carry creation order. This matters at scale: monotonic keys keep B-tree inserts
append-mostly (avoiding page splits on random UUID4 inserts) and let us do
time-range scans and keyset pagination on the primary key alone, without a
secondary index on created_at.
"""

from __future__ import annotations

import os
import threading
import time

__all__ = ["new_id", "new_trace_id", "ULID_ALPHABET", "timestamp_of"]

# Crockford base32: no I, L, O, U — avoids transcription ambiguity in logs.
ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_DECODE = {c: i for i, c in enumerate(ULID_ALPHABET)}

_lock = threading.Lock()
_last_ms = 0
_last_rand = 0


def _encode(value: int, length: int) -> str:
    out = []
    for _ in range(length):
        out.append(ULID_ALPHABET[value & 0x1F])
        value >>= 5
    return "".join(reversed(out))


def _ulid() -> str:
    """Monotonic ULID: 48-bit ms timestamp + 80 bits of randomness.

    Within the same millisecond the random component is incremented rather than
    redrawn, which guarantees strict ordering for IDs minted back-to-back. That
    property is relied on by keyset pagination and by tests that assert ordering.
    """
    global _last_ms, _last_rand
    with _lock:
        ms = int(time.time() * 1000)
        if ms == _last_ms:
            _last_rand += 1
        elif ms < _last_ms:
            # Clock moved backwards (NTP step). Hold the previous timestamp and
            # keep incrementing so IDs never regress.
            ms = _last_ms
            _last_rand += 1
        else:
            _last_ms = ms
            _last_rand = int.from_bytes(os.urandom(10), "big")
        return _encode(ms, 10) + _encode(_last_rand & ((1 << 80) - 1), 16)


def new_id(prefix: str) -> str:
    """Prefixed identifier, e.g. ``agt_01J8...``.

    The prefix makes IDs self-describing in logs and audit trails, so an ID
    pasted into a bug report identifies its own table.
    """
    return f"{prefix}_{_ulid()}"


def new_trace_id() -> str:
    return new_id("trc")


def timestamp_of(identifier: str) -> float:
    """Recover the creation time (epoch seconds) encoded in an ID."""
    body = identifier.split("_", 1)[-1]
    ms = 0
    for ch in body[:10]:
        ms = (ms << 5) | _DECODE[ch]
    return ms / 1000.0
