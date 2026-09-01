"""Injectable clock.

Every timeout, lease expiry, retry backoff and approval TTL in the system reads
time through this port. Tests drive a ManualClock so that expiry behaviour is
asserted deterministically instead of with sleeps, which is what keeps the
governance test suite fast and non-flaky.
"""

from __future__ import annotations

import time
from typing import Protocol

__all__ = ["Clock", "SystemClock", "ManualClock"]


class Clock(Protocol):
    def now(self) -> float:
        """Epoch seconds."""


class SystemClock:
    __slots__ = ()

    def now(self) -> float:
        return time.time()


class ManualClock:
    """Test clock. Time only moves when advanced."""

    __slots__ = ("_t",)

    def __init__(self, start: float = 1_700_000_000.0) -> None:
        self._t = start

    def now(self) -> float:
        return self._t

    def advance(self, seconds: float) -> float:
        self._t += seconds
        return self._t
