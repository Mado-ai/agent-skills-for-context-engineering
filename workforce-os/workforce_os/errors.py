"""Typed runtime errors. Every error carries a machine-readable reason code."""


class WorkforceError(Exception):
    """Base error. `code` is stable and safe to expose over the API."""

    code = "error"
    http_status = 400

    def __init__(self, message: str, *, code: str | None = None, details: dict | None = None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        self.details = details or {}

    def to_dict(self) -> dict:
        return {"error": self.code, "message": self.message, "details": self.details}


class ValidationError(WorkforceError):
    code = "validation_failed"
    http_status = 422


class NotFoundError(WorkforceError):
    code = "not_found"
    http_status = 404


class AuthenticationError(WorkforceError):
    code = "unauthenticated"
    http_status = 401


class PolicyDenied(WorkforceError):
    """Deny-by-default refusal from the policy layer or gateway."""

    code = "policy_denied"
    http_status = 403


class ApprovalRequired(WorkforceError):
    """A high-risk action needs an Owner approval token before it may execute."""

    code = "approval_required"
    http_status = 403

    def __init__(self, message: str, *, request_id: str | None = None, details: dict | None = None):
        super().__init__(message, details=details)
        self.request_id = request_id
        if request_id:
            self.details["approval_request_id"] = request_id


class BudgetExceeded(PolicyDenied):
    code = "budget_exceeded"


class LifecycleError(WorkforceError):
    code = "invalid_lifecycle_transition"
    http_status = 409


class IntegrityError(WorkforceError):
    """Tamper or corruption detected in append-only or content-addressed data."""

    code = "integrity_violation"
    http_status = 500
