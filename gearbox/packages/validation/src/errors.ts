/**
 * Error taxonomy.
 *
 * Every error that can reach a client is an AppError with a stable machine-readable
 * `type`, so clients can branch on the type rather than on a message string.
 * Serialized as RFC 9457 Problem Details (docs/gearbox/06-api.md §6.1).
 */

export const ERROR_TYPES = {
  VALIDATION_FAILED: 'validation-failed',
  UNAUTHENTICATED: 'unauthenticated',
  PERMISSION_DENIED: 'permission-denied',
  NOT_FOUND: 'not-found',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rate-limited',
  CREDENTIALS_INVALID: 'credentials-invalid',
  TOKEN_EXPIRED: 'token-expired',
  TOKEN_REUSED: 'token-reused',
  DEVICE_UNKNOWN: 'device-unknown',
  DEVICE_REVOKED: 'device-revoked',
  PROTOCOL_VERSION_UNSUPPORTED: 'protocol-version-unsupported',
  INTERNAL: 'internal',
} as const;

export type ErrorType = (typeof ERROR_TYPES)[keyof typeof ERROR_TYPES];

const STATUS_BY_TYPE: Record<ErrorType, number> = {
  [ERROR_TYPES.VALIDATION_FAILED]: 400,
  [ERROR_TYPES.UNAUTHENTICATED]: 401,
  [ERROR_TYPES.PERMISSION_DENIED]: 403,
  [ERROR_TYPES.NOT_FOUND]: 404,
  [ERROR_TYPES.CONFLICT]: 409,
  [ERROR_TYPES.RATE_LIMITED]: 429,
  [ERROR_TYPES.CREDENTIALS_INVALID]: 401,
  [ERROR_TYPES.TOKEN_EXPIRED]: 401,
  [ERROR_TYPES.TOKEN_REUSED]: 401,
  [ERROR_TYPES.DEVICE_UNKNOWN]: 401,
  [ERROR_TYPES.DEVICE_REVOKED]: 401,
  [ERROR_TYPES.PROTOCOL_VERSION_UNSUPPORTED]: 426,
  [ERROR_TYPES.INTERNAL]: 500,
};

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
}

export class AppError extends Error {
  readonly type: ErrorType;
  readonly status: number;
  readonly extra: Record<string, unknown>;
  /** True when the message is safe to show a user verbatim. */
  readonly clientSafe: boolean;

  constructor(
    type: ErrorType,
    message: string,
    options: { extra?: Record<string, unknown>; clientSafe?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.type = type;
    this.status = STATUS_BY_TYPE[type];
    this.extra = options.extra ?? {};
    this.clientSafe = options.clientSafe ?? true;
  }

  toProblem(instance?: string, baseUri = 'https://gearbox.dev/errors'): ProblemDetails {
    return {
      type: `${baseUri}/${this.type}`,
      title: titleFor(this.type),
      status: this.status,
      // Never leak an internal error's message to a client.
      ...(this.clientSafe ? { detail: this.message } : {}),
      ...(instance ? { instance } : {}),
      ...this.extra,
    };
  }

  static notFound(what: string): AppError {
    return new AppError(ERROR_TYPES.NOT_FOUND, `${what} not found`);
  }

  static conflict(detail: string, extra?: Record<string, unknown>): AppError {
    return new AppError(ERROR_TYPES.CONFLICT, detail, extra ? { extra } : {});
  }

  static unauthenticated(detail = 'Authentication required'): AppError {
    return new AppError(ERROR_TYPES.UNAUTHENTICATED, detail);
  }

  static permissionDenied(detail: string, extra?: Record<string, unknown>): AppError {
    return new AppError(ERROR_TYPES.PERMISSION_DENIED, detail, extra ? { extra } : {});
  }

  static internal(message: string, cause?: unknown): AppError {
    return new AppError(ERROR_TYPES.INTERNAL, message, { clientSafe: false, cause });
  }
}

function titleFor(type: ErrorType): string {
  switch (type) {
    case ERROR_TYPES.VALIDATION_FAILED:
      return 'Validation failed';
    case ERROR_TYPES.UNAUTHENTICATED:
      return 'Authentication required';
    case ERROR_TYPES.PERMISSION_DENIED:
      return 'Permission denied';
    case ERROR_TYPES.NOT_FOUND:
      return 'Not found';
    case ERROR_TYPES.CONFLICT:
      return 'Conflict';
    case ERROR_TYPES.RATE_LIMITED:
      return 'Too many requests';
    case ERROR_TYPES.CREDENTIALS_INVALID:
      return 'Invalid credentials';
    case ERROR_TYPES.TOKEN_EXPIRED:
      return 'Token expired';
    case ERROR_TYPES.TOKEN_REUSED:
      return 'Token reuse detected';
    case ERROR_TYPES.DEVICE_UNKNOWN:
      return 'Unknown device';
    case ERROR_TYPES.DEVICE_REVOKED:
      return 'Device revoked';
    case ERROR_TYPES.PROTOCOL_VERSION_UNSUPPORTED:
      return 'Protocol version unsupported';
    case ERROR_TYPES.INTERNAL:
      return 'Internal server error';
  }
}
