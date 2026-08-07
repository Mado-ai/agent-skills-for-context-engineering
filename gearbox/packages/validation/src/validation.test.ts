import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, ERROR_TYPES } from './errors.js';
import { parseOrThrow } from './parse.js';
import {
  emailSchema,
  handleSchema,
  locationFixSchema,
  passwordSchema,
  registerRequestSchema,
  tokenRequestSchema,
} from './schemas.js';

describe('AppError', () => {
  it('maps each error type to the documented status code', () => {
    expect(new AppError(ERROR_TYPES.NOT_FOUND, 'x').status).toBe(404);
    expect(new AppError(ERROR_TYPES.CONFLICT, 'x').status).toBe(409);
    expect(new AppError(ERROR_TYPES.PERMISSION_DENIED, 'x').status).toBe(403);
    expect(new AppError(ERROR_TYPES.RATE_LIMITED, 'x').status).toBe(429);
    expect(new AppError(ERROR_TYPES.PROTOCOL_VERSION_UNSUPPORTED, 'x').status).toBe(426);
  });

  it('serializes to RFC 9457 Problem Details', () => {
    const problem = new AppError(ERROR_TYPES.PERMISSION_DENIED, 'Role viewer cannot move', {
      extra: { requiredRole: 'collaborator' },
    }).toProblem('/v1/environments/1/objects/2');

    expect(problem).toMatchObject({
      type: 'https://gearbox.dev/errors/permission-denied',
      title: 'Permission denied',
      status: 403,
      detail: 'Role viewer cannot move',
      instance: '/v1/environments/1/objects/2',
      requiredRole: 'collaborator',
    });
  });

  it('never leaks an internal error message to the client', () => {
    const problem = AppError.internal(
      'connection to 10.0.0.5 refused: password=hunter2',
    ).toProblem();
    expect(problem.status).toBe(500);
    expect(problem.detail).toBeUndefined();
    expect(JSON.stringify(problem)).not.toContain('hunter2');
  });

  it('keeps the cause for logging while hiding it from the client', () => {
    const cause = new Error('underlying');
    const err = AppError.internal('wrapped', cause);
    expect(err.cause).toBe(cause);
    expect(err.clientSafe).toBe(false);
  });
});

describe('parseOrThrow', () => {
  it('returns parsed data on success', () => {
    expect(parseOrThrow(z.object({ n: z.number() }), { n: 1 })).toEqual({ n: 1 });
  });

  it('throws a validation AppError listing each failing field path', () => {
    const err = (() => {
      try {
        parseOrThrow(registerRequestSchema, { email: 'nope', password: 'short', handle: '!!' });
      } catch (e) {
        return e as AppError;
      }
    })();

    expect(err?.type).toBe(ERROR_TYPES.VALIDATION_FAILED);
    expect(err?.status).toBe(400);
    const paths = (err?.extra.issues as { path: string }[]).map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['email', 'password', 'handle']));
  });
});

describe('schemas', () => {
  it('normalises email to lowercase and trims it', () => {
    expect(emailSchema.parse('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('rejects handles with characters that enable impersonation', () => {
    expect(handleSchema.safeParse('ada').success).toBe(true);
    expect(handleSchema.safeParse('ad a').success).toBe(false);
    expect(handleSchema.safeParse('ada!').success).toBe(false);
    expect(handleSchema.safeParse('аdа').success).toBe(false); // Cyrillic homoglyphs
    expect(handleSchema.safeParse('ab').success).toBe(false);
  });

  it('enforces length over composition for passwords', () => {
    expect(passwordSchema.safeParse('correct horse battery staple').success).toBe(true);
    expect(passwordSchema.safeParse('Sh0rt!').success).toBe(false);
  });

  it('discriminates the three token grants and rejects anything else', () => {
    expect(
      tokenRequestSchema.safeParse({
        grantType: 'password',
        email: 'a@b.co',
        password: 'x',
      }).success,
    ).toBe(true);
    expect(
      tokenRequestSchema.safeParse({ grantType: 'refresh', refreshToken: 'r'.repeat(30) }).success,
    ).toBe(true);
    expect(tokenRequestSchema.safeParse({ grantType: 'implicit' }).success).toBe(false);
  });

  it('defaults ageBand to adult but accepts an explicit band', () => {
    expect(
      registerRequestSchema.parse({
        email: 'a@b.co',
        password: 'a-long-enough-password',
        handle: 'abc',
      }).ageBand,
    ).toBe('adult');
    expect(
      registerRequestSchema.parse({
        email: 'a@b.co',
        password: 'a-long-enough-password',
        handle: 'abc',
        ageBand: 'teen',
      }).ageBand,
    ).toBe('teen');
  });

  it('rejects physically impossible location fixes at the boundary', () => {
    const base = { lat: 55.6, lon: 12.5, accuracyM: 8, capturedAt: '2026-01-01T00:00:00Z' };
    expect(locationFixSchema.safeParse(base).success).toBe(true);
    expect(locationFixSchema.safeParse({ ...base, lat: 91 }).success).toBe(false);
    expect(locationFixSchema.safeParse({ ...base, lon: -181 }).success).toBe(false);
    // Faster than any ground vehicle: rejected before it reaches the anti-cheat scorer.
    expect(locationFixSchema.safeParse({ ...base, speedMps: 500 }).success).toBe(false);
    expect(locationFixSchema.safeParse({ ...base, accuracyM: -1 }).success).toBe(false);
  });

  it('carries the anti-cheat signals the scorer depends on', () => {
    const parsed = locationFixSchema.parse({
      lat: 55.6,
      lon: 12.5,
      accuracyM: 8,
      capturedAt: '2026-01-01T00:00:00Z',
      stepDelta: 120,
      isMock: false,
    });
    expect(parsed.stepDelta).toBe(120);
    expect(parsed.isMock).toBe(false);
    expect(parsed.capturedAt).toBeInstanceOf(Date);
  });
});
