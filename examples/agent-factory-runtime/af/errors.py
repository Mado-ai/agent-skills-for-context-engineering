"""Error taxonomy.

The split that matters operationally is ``retryable`` vs not. The scheduler
consults that flag alone to decide between re-queueing with backoff and routing
straight to the dead-letter queue. Retrying a PermissionDenied would burn budget
to reach the same answer, so governance failures are terminal by construction.
"""

from __future__ import annotations

__all__ = [
    "AFError", "ValidationError", "LifecycleError", "PermissionDenied",
    "BudgetExceeded", "ApprovalRequired", "ApprovalExpired", "TokenInvalid",
    "ToolError", "ToolUnavailable", "QualityGateFailed", "ProviderError",
    "ProviderTimeout", "IsolationViolation", "SpawnLimitExceeded",
    "ConcurrencyLimitExceeded", "DuplicateWork", "QueueFull", "NotFound",
]


class AFError(Exception):
    """Base class. ``retryable`` drives scheduler policy; ``code`` is stable and
    safe to assert on in tests and to aggregate on in dashboards."""

    code = "af_error"
    retryable = False

    def __init__(self, message: str, **details: object) -> None:
        super().__init__(message)
        self.message = message
        self.details = details

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "details": self.details}


# --- Contract / lifecycle -------------------------------------------------
class ValidationError(AFError):
    code = "validation_error"


class LifecycleError(AFError):
    code = "lifecycle_error"


class NotFound(AFError):
    code = "not_found"


# --- Governance (never retryable: the answer will not change) -------------
class PermissionDenied(AFError):
    code = "permission_denied"


class IsolationViolation(PermissionDenied):
    code = "isolation_violation"


class BudgetExceeded(AFError):
    code = "budget_exceeded"


class SpawnLimitExceeded(BudgetExceeded):
    code = "spawn_limit_exceeded"


class ConcurrencyLimitExceeded(AFError):
    code = "concurrency_limit_exceeded"
    retryable = True  # Purely a capacity condition; later attempts may succeed.


class ApprovalRequired(AFError):
    code = "approval_required"


class ApprovalExpired(AFError):
    code = "approval_expired"


class TokenInvalid(AFError):
    code = "token_invalid"


# --- Execution ------------------------------------------------------------
class ToolError(AFError):
    code = "tool_error"


class ToolUnavailable(ToolError):
    code = "tool_unavailable"
    retryable = True


class QualityGateFailed(AFError):
    code = "quality_gate_failed"


class ProviderError(AFError):
    code = "provider_error"
    retryable = True


class ProviderTimeout(ProviderError):
    code = "provider_timeout"
    retryable = True


class DuplicateWork(AFError):
    """Raised when an idempotency key collides with completed work."""

    code = "duplicate_work"


class QueueFull(AFError):
    """Backpressure. Retryable, but only after backing off — an immediate retry
    makes the overload worse, which is why the scheduler treats this as a signal
    to slow down rather than as an ordinary transient failure."""

    code = "queue_full"
    retryable = True
