/**
 * Every failure the runtime surfaces is one of these codes. The API renders
 * them into a single error envelope shape, and the UI keys its "blocked /
 * approval required" affordances off the code rather than off message text.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'CONFLICT',
  'IMMUTABLE',

  // Authorization — every denial is one of these, and every one is audited.
  'DENIED_DEFAULT',
  'DENIED_AGENT_INACTIVE',
  'DENIED_TOOL_NOT_ALLOWED',
  'DENIED_TOOL_DISABLED',
  'DENIED_PROJECT_SCOPE',
  'DENIED_DATA_SCOPE',
  'DENIED_ACCESS_LEVEL',
  'DENIED_RISK_CLASS',
  'DENIED_FORBIDDEN_ACTION',
  'DENIED_SELF_MUTATION',
  'DENIED_DELEGATION_ESCALATION',
  'DENIED_CONCURRENCY_LIMIT',
  'DENIED_SEPARATION_OF_DUTIES',

  // Approvals
  'APPROVAL_REQUIRED',
  'APPROVAL_TOKEN_INVALID',
  'APPROVAL_TOKEN_EXPIRED',
  'APPROVAL_TOKEN_CONSUMED',
  'APPROVAL_TOKEN_MISMATCH',
  'APPROVAL_TOKEN_REVOKED',

  // Budgets and limits
  'BUDGET_SOFT_EXCEEDED',
  'BUDGET_HARD_EXCEEDED',
  'DEADLINE_EXCEEDED',
  'TOOL_TIMEOUT',

  // Lifecycle
  'INVALID_LIFECYCLE_TRANSITION',
  'CONTRACT_INVALID',
  'REQUIRED_TESTS_NOT_PASSED',

  // Quality
  'QUALITY_GATE_FAILED',
  'REWORK_LIMIT_EXCEEDED',

  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  CONTRACT_INVALID: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IMMUTABLE: 409,
  INVALID_LIFECYCLE_TRANSITION: 409,
  REQUIRED_TESTS_NOT_PASSED: 409,
  APPROVAL_REQUIRED: 428,
  BUDGET_SOFT_EXCEEDED: 429,
  BUDGET_HARD_EXCEEDED: 429,
  TOOL_TIMEOUT: 504,
  DEADLINE_EXCEEDED: 504,
  INTERNAL: 500,
};

export class RuntimeError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  readonly traceId: string | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    traceId?: string,
  ) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
    this.details = details;
    this.traceId = traceId;
  }

  get httpStatus(): number {
    if (this.code.startsWith('DENIED_')) return 403;
    if (this.code.startsWith('APPROVAL_TOKEN_')) return 403;
    if (this.code.startsWith('QUALITY_')) return 422;
    if (this.code === 'REWORK_LIMIT_EXCEEDED') return 422;
    return STATUS_BY_CODE[this.code] ?? 400;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        trace_id: this.traceId ?? null,
      },
    };
  }
}

export function isDenial(err: unknown): err is RuntimeError {
  return err instanceof RuntimeError && err.code.startsWith('DENIED_');
}
