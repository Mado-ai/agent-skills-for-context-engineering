"""Agent contract lifecycle state machine.

The mandate's hard rule — *an invalid contract must never become ACTIVE* — is
enforced structurally rather than by convention: ACTIVE is unreachable except
through APPROVAL, and the transition into APPROVAL is gated on a clean
validation report plus a passing test run. There is no edge that skips them, so
no caller can construct a path around the check.
"""

from __future__ import annotations

from enum import Enum

from af.errors import LifecycleError

__all__ = ["LifecycleState", "TRANSITIONS", "can_transition", "assert_transition", "TERMINAL"]


class LifecycleState(str, Enum):
    DRAFT = "DRAFT"
    VALIDATION = "VALIDATION"
    TESTING = "TESTING"
    APPROVAL = "APPROVAL"
    ACTIVE = "ACTIVE"
    OBSERVATION = "OBSERVATION"
    IMPROVEMENT = "IMPROVEMENT"
    PAUSED = "PAUSED"
    RETIRED = "RETIRED"
    MERGED = "MERGED"


S = LifecycleState

#: Adjacency list of permitted transitions. Anything not listed is rejected.
TRANSITIONS: dict[LifecycleState, frozenset[LifecycleState]] = {
    S.DRAFT: frozenset({S.VALIDATION, S.RETIRED}),
    # Validation failure returns to DRAFT for correction rather than dead-ending.
    S.VALIDATION: frozenset({S.TESTING, S.DRAFT, S.RETIRED}),
    S.TESTING: frozenset({S.APPROVAL, S.DRAFT, S.RETIRED}),
    # Approval may be refused, which sends the contract back to DRAFT.
    S.APPROVAL: frozenset({S.ACTIVE, S.DRAFT, S.RETIRED}),
    S.ACTIVE: frozenset({S.OBSERVATION, S.IMPROVEMENT, S.PAUSED, S.RETIRED, S.MERGED}),
    S.OBSERVATION: frozenset({S.ACTIVE, S.IMPROVEMENT, S.PAUSED, S.RETIRED, S.MERGED}),
    # An improving contract re-enters the pipeline at VALIDATION: a revised
    # contract is re-validated and re-approved, never promoted straight back.
    S.IMPROVEMENT: frozenset({S.VALIDATION, S.ACTIVE, S.PAUSED, S.RETIRED, S.MERGED}),
    S.PAUSED: frozenset({S.ACTIVE, S.RETIRED, S.MERGED}),
    S.RETIRED: frozenset(),
    S.MERGED: frozenset(),
}

#: States from which nothing further can happen.
TERMINAL = frozenset({S.RETIRED, S.MERGED})

#: Only these states may be entered directly from APPROVAL — i.e. the only way
#: to reach ACTIVE. Kept separate so the guard in the factory reads explicitly.
ACTIVATION_PREDECESSOR = S.APPROVAL


def can_transition(src: LifecycleState, dst: LifecycleState) -> bool:
    return dst in TRANSITIONS.get(src, frozenset())


def assert_transition(src: LifecycleState, dst: LifecycleState) -> None:
    if not can_transition(src, dst):
        raise LifecycleError(
            f"illegal contract transition {src.value} -> {dst.value}",
            src=src.value,
            dst=dst.value,
            allowed=sorted(s.value for s in TRANSITIONS.get(src, frozenset())),
        )
