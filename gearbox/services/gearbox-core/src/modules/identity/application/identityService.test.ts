import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ERROR_TYPES, type AppError } from '@gearbox/validation';
import { IdentityService } from './identityService.js';
import { AccessTokenIssuer, hashRefreshToken } from '../domain/tokens.js';
import { hashPassword, needsRehash, verifyPassword } from '../domain/password.js';
import {
  MemoryAuditSink,
  MemoryChallengeStore,
  MemoryDeviceRepository,
  MemoryRefreshTokenStore,
  MemoryUserRepository,
} from '../infrastructure/memoryRepositories.js';
import { AUDIT_ACTIONS } from '../../audit/ports/index.js';
import type { Clock } from '../ports/index.js';

class TestClock implements Clock {
  constructor(private current = new Date('2026-01-01T00:00:00Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

const ACCESS_TTL = 600;
const REFRESH_TTL = 60 * 60 * 24 * 30;

function build() {
  const users = new MemoryUserRepository();
  const devices = new MemoryDeviceRepository();
  const refreshTokens = new MemoryRefreshTokenStore();
  const challenges = new MemoryChallengeStore();
  const audit = new MemoryAuditSink();
  const clock = new TestClock();
  const issuer = new AccessTokenIssuer({
    secret: 'test-secret-that-is-definitely-long-enough',
    issuer: 'https://test.gearbox.dev',
    audience: 'gearbox-client',
    accessTtlSeconds: ACCESS_TTL,
  });

  const service = new IdentityService({
    users,
    devices,
    refreshTokens,
    challenges,
    audit,
    clock,
    issuer,
    accessTtlSeconds: ACCESS_TTL,
    refreshTtlSeconds: REFRESH_TTL,
  });

  return { service, users, devices, refreshTokens, challenges, audit, clock, issuer };
}

const VALID = {
  email: 'ada@example.com',
  password: 'correct horse battery staple',
  handle: 'ada',
  ageBand: 'adult' as const,
};

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('a-sufficiently-long-password');
    expect(await verifyPassword('a-sufficiently-long-password', hash)).toBe(true);
    expect(await verifyPassword('a-sufficiently-long-passworD', hash)).toBe(false);
  });

  it('salts: the same password hashes differently every time', async () => {
    const a = await hashPassword('same-password-twice-over');
    const b = await hashPassword('same-password-twice-over');
    expect(a).not.toBe(b);
  });

  it('rejects malformed or truncated stored hashes instead of throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1$2$3$abc$')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$1$2$3$abc$def')).toBe(false);
  });

  it('flags hashes below current cost parameters for rehash', async () => {
    expect(needsRehash(await hashPassword('current-params-password'))).toBe(false);
    expect(needsRehash('scrypt$1024$8$1$c2FsdA$aGFzaA')).toBe(true);
  });

  it('normalises unicode so the same typed password always verifies', async () => {
    const composed = 'passwörd-long-enough';
    const decomposed = 'passwörd-long-enough';
    const hash = await hashPassword(composed);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });
});

describe('register', () => {
  it('creates a user, a profile and an initial token pair', async () => {
    const { service, users } = build();
    const { userId, tokens } = await service.register(VALID);

    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(tokens.tokenType).toBe('Bearer');
    expect(tokens.expiresIn).toBe(ACCESS_TTL);

    const profile = await users.getProfile(userId);
    expect(profile?.handle).toBe('ada');
    expect(profile?.displayName).toBe('ada');
  });

  it('never stores the password in plaintext', async () => {
    const { service, users } = build();
    const { userId } = await service.register(VALID);
    const user = await users.findById(userId);
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.passwordHash).not.toContain(VALID.password);
    expect(await verifyPassword(VALID.password, user!.passwordHash!)).toBe(true);
  });

  it('rejects a duplicate email case-insensitively', async () => {
    const { service } = build();
    await service.register(VALID);
    await expect(
      service.register({ ...VALID, handle: 'other', email: 'ADA@example.com' }),
    ).rejects.toMatchObject({ type: ERROR_TYPES.CONFLICT, extra: { field: 'email' } });
  });

  it('rejects a duplicate handle case-insensitively', async () => {
    const { service } = build();
    await service.register(VALID);
    await expect(
      service.register({ ...VALID, email: 'other@example.com', handle: 'ADA' }),
    ).rejects.toMatchObject({ type: ERROR_TYPES.CONFLICT, extra: { field: 'handle' } });
  });

  it('writes an audit event', async () => {
    const { service, audit } = build();
    const { userId } = await service.register(VALID);
    const events = audit.byAction(AUDIT_ACTIONS.USER_REGISTER);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ resourceId: userId, outcome: 'allow' });
  });
});

describe('authenticate with password', () => {
  it('issues tokens for correct credentials', async () => {
    const { service, issuer, clock } = build();
    const { userId } = await service.register(VALID);
    const tokens = await service.authenticateWithPassword(VALID.email, VALID.password);
    expect(tokens.userId).toBe(userId);

    const claims = await issuer.verify(tokens.accessToken, clock.now());
    expect(claims.sub).toBe(userId);
    expect(claims.ageBand).toBe('adult');
  });

  it('gives an identical error for an unknown account and a wrong password (T1)', async () => {
    const { service } = build();
    await service.register(VALID);

    const wrongPassword = await service
      .authenticateWithPassword(VALID.email, 'not-the-password')
      .catch((e: AppError) => e);
    const unknownAccount = await service
      .authenticateWithPassword('nobody@example.com', 'not-the-password')
      .catch((e: AppError) => e);

    expect((wrongPassword as AppError).type).toBe(ERROR_TYPES.CREDENTIALS_INVALID);
    expect((unknownAccount as AppError).message).toBe((wrongPassword as AppError).message);
    expect((unknownAccount as AppError).status).toBe((wrongPassword as AppError).status);
  });

  it('does the same amount of hashing work for an unknown account (timing equalization)', async () => {
    const { service, users } = build();
    await service.register(VALID);

    // The observable proxy for "same work": both paths must call the KDF. If the
    // unknown-account path short-circuited, it would return in ~0ms while the real
    // path costs a full scrypt. Compare orders of magnitude, not exact timings.
    const t0 = performance.now();
    await service.authenticateWithPassword(VALID.email, 'wrong').catch(() => {});
    const realPath = performance.now() - t0;

    const t1 = performance.now();
    await service.authenticateWithPassword('nobody@example.com', 'wrong').catch(() => {});
    const unknownPath = performance.now() - t1;

    expect(unknownPath).toBeGreaterThan(realPath * 0.2);
    expect(await users.findByEmail('nobody@example.com')).toBeNull();
  });

  it('refuses a suspended account without saying so', async () => {
    const { service, users } = build();
    const { userId } = await service.register(VALID);
    const user = await users.findById(userId);
    user!.status = 'suspended';

    await expect(
      service.authenticateWithPassword(VALID.email, VALID.password),
    ).rejects.toMatchObject({ type: ERROR_TYPES.CREDENTIALS_INVALID });
  });

  it('records a failed login', async () => {
    const { service, audit } = build();
    await service.register(VALID);
    await service.authenticateWithPassword(VALID.email, 'wrong').catch(() => {});
    expect(audit.byAction(AUDIT_ACTIONS.LOGIN_FAILED)).toHaveLength(1);
  });
});

describe('refresh rotation and reuse detection (T2)', () => {
  it('rotates: the old token stops working after use', async () => {
    const { service } = build();
    const { tokens } = await service.register(VALID);

    const rotated = await service.refresh(tokens.refreshToken);
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);

    await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({
      type: ERROR_TYPES.TOKEN_REUSED,
    });
  });

  it('revokes the entire family when a used token is replayed', async () => {
    const { service, audit } = build();
    const { tokens } = await service.register(VALID);

    const second = await service.refresh(tokens.refreshToken);
    const third = await service.refresh(second.refreshToken);

    // Attacker replays the first token.
    await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({
      type: ERROR_TYPES.TOKEN_REUSED,
    });

    // The legitimate holder's current token is now dead too — that is the point.
    await expect(service.refresh(third.refreshToken)).rejects.toMatchObject({
      type: ERROR_TYPES.UNAUTHENTICATED,
    });

    expect(audit.byAction(AUDIT_ACTIONS.TOKEN_REUSE_DETECTED)).toHaveLength(1);
  });

  it('keeps rotations within one family', async () => {
    const { service, refreshTokens } = build();
    const { tokens } = await service.register(VALID);
    const second = await service.refresh(tokens.refreshToken);
    await service.refresh(second.refreshToken);

    // Any token in the family resolves the family id.
    const record = await refreshTokens.findByHash(hashRefreshToken(second.refreshToken));
    expect(record).not.toBeNull();
    expect(refreshTokens.countFamily(record!.familyId)).toBe(3);
  });

  it('rejects an unknown refresh token', async () => {
    const { service } = build();
    await expect(service.refresh('not-a-real-token-value-at-all')).rejects.toMatchObject({
      type: ERROR_TYPES.UNAUTHENTICATED,
    });
  });

  it('rejects an expired refresh token', async () => {
    const { service, clock } = build();
    const { tokens } = await service.register(VALID);
    clock.advance((REFRESH_TTL + 1) * 1000);
    await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({
      type: ERROR_TYPES.TOKEN_EXPIRED,
    });
  });
});

describe('device identity', () => {
  function makeKeyPair() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    return { privateKey, publicKeyB64: Buffer.from(raw).toString('base64url') };
  }

  it('registers a device and is idempotent for the same key', async () => {
    const { service } = build();
    const { userId } = await service.register(VALID);
    const { publicKeyB64 } = makeKeyPair();

    const a = await service.registerDevice(userId, { publicKey: publicKeyB64, platform: 'ios' });
    const b = await service.registerDevice(userId, { publicKey: publicKeyB64, platform: 'ios' });
    expect(b.id).toBe(a.id);
  });

  it('authenticates with a valid Ed25519 assertion', async () => {
    const { service } = build();
    const { userId } = await service.register(VALID);
    const { privateKey, publicKeyB64 } = makeKeyPair();
    const device = await service.registerDevice(userId, {
      publicKey: publicKeyB64,
      platform: 'quest',
    });

    const { nonce } = await service.createDeviceChallenge(device.id);
    const signature = cryptoSign(null, Buffer.from(nonce, 'utf8'), privateKey).toString(
      'base64url',
    );

    const tokens = await service.authenticateWithDeviceAssertion(device.id, nonce, signature);
    expect(tokens.userId).toBe(userId);
  });

  it('rejects a replayed nonce (T12)', async () => {
    const { service } = build();
    const { userId } = await service.register(VALID);
    const { privateKey, publicKeyB64 } = makeKeyPair();
    const device = await service.registerDevice(userId, {
      publicKey: publicKeyB64,
      platform: 'quest',
    });

    const { nonce } = await service.createDeviceChallenge(device.id);
    const signature = cryptoSign(null, Buffer.from(nonce, 'utf8'), privateKey).toString(
      'base64url',
    );

    await service.authenticateWithDeviceAssertion(device.id, nonce, signature);
    await expect(
      service.authenticateWithDeviceAssertion(device.id, nonce, signature),
    ).rejects.toMatchObject({ type: ERROR_TYPES.UNAUTHENTICATED });
  });

  it('rejects a signature from a different key', async () => {
    const { service } = build();
    const { userId } = await service.register(VALID);
    const { publicKeyB64 } = makeKeyPair();
    const attacker = makeKeyPair();
    const device = await service.registerDevice(userId, {
      publicKey: publicKeyB64,
      platform: 'ios',
    });

    const { nonce } = await service.createDeviceChallenge(device.id);
    const forged = cryptoSign(null, Buffer.from(nonce, 'utf8'), attacker.privateKey).toString(
      'base64url',
    );

    await expect(
      service.authenticateWithDeviceAssertion(device.id, nonce, forged),
    ).rejects.toMatchObject({ type: ERROR_TYPES.UNAUTHENTICATED });
  });

  it('rejects assertions from a revoked device', async () => {
    const { service } = build();
    const { userId } = await service.register(VALID);
    const { privateKey, publicKeyB64 } = makeKeyPair();
    const device = await service.registerDevice(userId, {
      publicKey: publicKeyB64,
      platform: 'ios',
    });
    await service.revokeDevice(userId, device.id);

    const { nonce } = await service.createDeviceChallenge(device.id);
    const signature = cryptoSign(null, Buffer.from(nonce, 'utf8'), privateKey).toString(
      'base64url',
    );

    await expect(
      service.authenticateWithDeviceAssertion(device.id, nonce, signature),
    ).rejects.toMatchObject({ type: ERROR_TYPES.UNAUTHENTICATED });
  });

  it("reports another account's device as not-found, not forbidden", async () => {
    const { service } = build();
    const owner = await service.register(VALID);
    const other = await service.register({
      ...VALID,
      email: 'other@example.com',
      handle: 'other',
    });
    const { publicKeyB64 } = makeKeyPair();
    const device = await service.registerDevice(owner.userId, {
      publicKey: publicKeyB64,
      platform: 'ios',
    });

    await expect(service.revokeDevice(other.userId, device.id)).rejects.toMatchObject({
      type: ERROR_TYPES.NOT_FOUND,
    });
  });
});

describe('access tokens', () => {
  it('rejects a token once it has expired', async () => {
    const { service, issuer, clock } = build();
    const { tokens } = await service.register(VALID);

    await expect(issuer.verify(tokens.accessToken, clock.now())).resolves.toBeTruthy();
    clock.advance((ACCESS_TTL + 1) * 1000);
    await expect(issuer.verify(tokens.accessToken, clock.now())).rejects.toThrow();
  });

  it('rejects a token signed with a different secret', async () => {
    const { service } = build();
    const { tokens } = await service.register(VALID);
    const otherIssuer = new AccessTokenIssuer({
      secret: 'a-completely-different-secret-value-here',
      issuer: 'https://test.gearbox.dev',
      audience: 'gearbox-client',
      accessTtlSeconds: ACCESS_TTL,
    });
    await expect(otherIssuer.verify(tokens.accessToken)).rejects.toThrow();
  });

  it('refuses to construct with a weak secret', () => {
    expect(
      () =>
        new AccessTokenIssuer({
          secret: 'too-short',
          issuer: 'i',
          audience: 'a',
          accessTtlSeconds: 60,
        }),
    ).toThrow(/at least 32/);
  });

  it('binds the token to a device when one is supplied', async () => {
    const { service, issuer, clock } = build();
    const { userId } = await service.register(VALID);
    const device = await service.registerDevice(userId, {
      publicKey: 'A'.repeat(43),
      platform: 'android',
    });
    const tokens = await service.authenticateWithPassword(VALID.email, VALID.password, device.id);
    const claims = await issuer.verify(tokens.accessToken, clock.now());
    expect(claims.did).toBe(device.id);
  });
});
