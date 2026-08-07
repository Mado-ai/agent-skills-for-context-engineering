/**
 * The single entry point for validating external input.
 *
 * Every boundary — HTTP handlers, realtime payloads, job arguments — goes through
 * `parseOrThrow`, so a validation failure always becomes the same Problem Details
 * shape rather than a stack trace or a 500.
 */

import type { ZodError, ZodTypeAny, z } from 'zod';
import { AppError, ERROR_TYPES } from './errors.js';

export interface FieldIssue {
  path: string;
  message: string;
}

export function toFieldIssues(error: ZodError): FieldIssue[] {
  return error.issues.map((i) => ({
    path: i.path.join('.') || '(root)',
    message: i.message,
  }));
}

export function parseOrThrow<T extends ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const issues = toFieldIssues(result.error);
  throw new AppError(ERROR_TYPES.VALIDATION_FAILED, 'Request validation failed', {
    extra: { issues },
  });
}
