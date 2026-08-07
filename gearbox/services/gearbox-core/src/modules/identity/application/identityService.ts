/**
 * Identity use cases: register, authenticate, refresh, device registration and
 * device assertion.
 *
 * Security behaviours implemented here are the ones docs/gearbox/07-authz-security.md
 * §7.3 and §7.5 call for, and each has a test in identityService.test.ts:
 *   T1  no user enumeration — unknown account and wrong password are indistinguishable
 *       in both response and timing
 *   T2  refresh rotation with reuse detection that revokes the whole family
 *   T12 single-use, expiring challenge nonces for device assertion
 */

import { v7 as uuidv7 } from 'uuid';
import { AppError, ERROR_TYPES } from '@gearbox/validation';
import type { RegisterRequest, RegisterDeviceRequest, TokenResponse } from '@gearbox/validation';
import { dummyHash, hashPassword, needsRehash, verifyPassword } from '../domain/password.js';
import type { AccessTokenIssuer } from '../domain/tokens.js';
import {
  generateNonce,
  generateRefreshToken,
  hashRefreshToken,
  verifyDeviceAssertion,
} from '../domain/tokens.js';
import type {
  ChallengeStore,
  Clock,
  DeviceRecord,
  DeviceRepository,
  ProfileRecord,
  RefreshTokenStore,
  UserRepository,
} from '../ports/index.js';
import { AUDIT_ACTIONS, type AuditSink } from '../../audit/ports/index.js';

export interface IdentityServiceDeps {
  users: UserRepository;
  devices: DeviceRepository;
  refreshTokens: RefreshTokenStore;
  challenges: ChallengeStore;
  audit: AuditSink;
  clock: Clock;
  issuer: AccessTokenIssuer;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

const CHALLENGE_TTL_MS = 2 * 60 * 1000;

export class IdentityService {
  constructor(private readonly deps: IdentityServiceDeps) {}

  async register(input: RegisterRequest): Promise<{ userId: string; tokens: TokenResponse }> {
    const { users, audit, clock } = this.deps;
    const now = clock.now();

    // Checked before insert for a clean error; the unique indexes remain the real
    // guarantee against the concurrent-signup race.
    if (await users.findByEmail(input.email)) {
      throw AppError.conflict('An account with that email already exists', { field: 'email' });
    }
    if (await users.findByHandle(input.handle)) {
      throw AppError.conflict('That handle is taken', { field: 'handle' });
    }

    const userId = uuidv7();
    const passwordHash = await hashPassword(input.password);

    const profile: ProfileRecord = {
      userId,
      handle: input.handle,
      displayName: input.displayName ?? input.handle,
      pronouns: null,
      bio: null,
      locale: 'en',
    };

    await users.create(
      {
        id: userId,
        email: input.email,
        emailVerified: false,
        passwordHash,
        status: 'active',
        ageBand: input.ageBand,
        createdAt: now,
        deletedAt: null,
      },
      profile,
    );

    await audit.record({
      actorId: userId,
      actorType: 'user',
      action: AUDIT_ACTIONS.USER_REGISTER,
      resourceType: 'user',
      resourceId: userId,
      outcome: 'allow',
      context: { ageBand: input.ageBand },
    });

    const tokens = await this.issueTokenPair(userId, input.ageBand, null, uuidv7());
    return { userId, tokens };
  }

  async authenticateWithPassword(
    email: string,
    password: string,
    deviceId?: string,
  ): Promise<TokenResponse> {
    const { users, audit, clock } = this.deps;
    const user = await users.findByEmail(email);

    // Always run a real verification, even for an unknown account, so response time
    // does not reveal whether the email is registered.
    const hash = user?.passwordHash ?? (await dummyHash());
    const passwordOk = await verifyPassword(password, hash);

    const usable = user !== null && user.status === 'active' && user.deletedAt === null;
    if (!usable || !passwordOk || user.passwordHash === null) {
      await audit.record({
        actorId: user?.id ?? null,
        actorType: 'user',
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        resourceType: 'user',
        resourceId: user?.id ?? null,
        outcome: 'deny',
        context: { reason: !usable ? 'no_active_account' : 'bad_password' },
      });
      // Deliberately identical for every failure cause.
      throw new AppError(ERROR_TYPES.CREDENTIALS_INVALID, 'Email or password is incorrect');
    }

    if (needsRehash(user.passwordHash)) {
      await users.updatePasswordHash(user.id, await hashPassword(password));
    }

    if (deviceId) {
      await this.assertDeviceUsable(deviceId, user.id);
      await this.deps.devices.touch(deviceId, clock.now());
    }

    return this.issueTokenPair(user.id, user.ageBand, deviceId ?? null, uuidv7());
  }

  /**
   * Rotating refresh with reuse detection.
   *
   * Presenting a token that has already been redeemed means either a replay or a
   * stolen token; either way the safe response is to revoke the entire family and
   * force a fresh login.
   */
  async refresh(refreshToken: string): Promise<TokenResponse> {
    const { refreshTokens, users, audit, clock } = this.deps;
    const now = clock.now();
    const hash = hashRefreshToken(refreshToken);

    const record = await refreshTokens.findByHash(hash);
    if (!record) {
      throw new AppError(ERROR_TYPES.UNAUTHENTICATED, 'Refresh token is not valid');
    }

    if (record.usedAt !== null) {
      const revoked = await refreshTokens.revokeFamily(record.familyId, now);
      await audit.record({
        actorId: record.userId,
        actorType: 'user',
        action: AUDIT_ACTIONS.TOKEN_REUSE_DETECTED,
        resourceType: 'refresh_token_family',
        resourceId: record.familyId,
        outcome: 'deny',
        context: { revokedCount: revoked },
      });
      throw new AppError(
        ERROR_TYPES.TOKEN_REUSED,
        'Refresh token was already used; all sessions for this device have been revoked',
      );
    }

    if (record.revokedAt !== null) {
      throw new AppError(ERROR_TYPES.UNAUTHENTICATED, 'Refresh token has been revoked');
    }
    if (record.expiresAt.getTime() <= now.getTime()) {
      throw new AppError(ERROR_TYPES.TOKEN_EXPIRED, 'Refresh token has expired');
    }

    const user = await users.findById(record.userId);
    if (!user || user.status !== 'active' || user.deletedAt !== null) {
      throw new AppError(ERROR_TYPES.UNAUTHENTICATED, 'Account is not active');
    }

    await refreshTokens.markUsed(record.id, now);
    await audit.record({
      actorId: user.id,
      actorType: 'user',
      action: AUDIT_ACTIONS.TOKEN_REFRESH,
      resourceType: 'user',
      resourceId: user.id,
      outcome: 'allow',
      context: { familyId: record.familyId },
    });

    // Same family: rotation within one login session.
    return this.issueTokenPair(user.id, user.ageBand, record.deviceId, record.familyId);
  }

  /** Profile lookup for other modules (e.g. session minting wants the handle). */
  async profile(userId: string): Promise<ProfileRecord | null> {
    return this.deps.users.getProfile(userId);
  }

  async registerDevice(userId: string, input: RegisterDeviceRequest): Promise<DeviceRecord> {
    const { devices, audit, clock } = this.deps;

    const existing = await devices.findByUser(userId);
    const duplicate = existing.find((d) => d.publicKey === input.publicKey && !d.revokedAt);
    if (duplicate) return duplicate;

    const device: DeviceRecord = {
      id: uuidv7(),
      userId,
      publicKey: input.publicKey,
      platform: input.platform,
      deviceName: input.deviceName ?? null,
      lastSeenAt: clock.now(),
      revokedAt: null,
    };
    await devices.create(device);

    await audit.record({
      actorId: userId,
      actorType: 'user',
      action: AUDIT_ACTIONS.DEVICE_REGISTER,
      resourceType: 'device',
      resourceId: device.id,
      outcome: 'allow',
      context: { platform: input.platform },
    });

    return device;
  }

  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    const { devices, audit, clock } = this.deps;
    const device = await devices.findById(deviceId);
    if (!device || device.userId !== userId) {
      // Not 403 — a caller must not learn that someone else's device id exists.
      throw AppError.notFound('Device');
    }
    await devices.revoke(deviceId, clock.now());
    await audit.record({
      actorId: userId,
      actorType: 'user',
      action: AUDIT_ACTIONS.DEVICE_REVOKE,
      resourceType: 'device',
      resourceId: deviceId,
      outcome: 'allow',
    });
  }

  /** Issues a single-use nonce for a device to sign. */
  async createDeviceChallenge(deviceId: string): Promise<{ nonce: string; expiresAt: Date }> {
    const now = this.deps.clock.now();
    const nonce = generateNonce();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    await this.deps.challenges.create({ nonce, deviceId, consumedAt: null, expiresAt });
    return { nonce, expiresAt };
  }

  /**
   * Device assertion grant — the path that also works with no internet, once the
   * offline grant work lands (docs/gearbox/07-authz-security.md §7.4).
   */
  async authenticateWithDeviceAssertion(
    deviceId: string,
    nonce: string,
    signature: string,
  ): Promise<TokenResponse> {
    const { devices, users, challenges, audit, clock } = this.deps;
    const now = clock.now();

    const fail = async (reason: string): Promise<never> => {
      await audit.record({
        actorId: null,
        actorType: 'device',
        action: AUDIT_ACTIONS.DEVICE_ASSERTION_FAILED,
        resourceType: 'device',
        resourceId: deviceId,
        outcome: 'deny',
        context: { reason },
      });
      throw new AppError(ERROR_TYPES.UNAUTHENTICATED, 'Device assertion failed');
    };

    const challenge = await challenges.consume(nonce, now);
    if (!challenge) return fail('nonce_unknown_or_used');
    if (challenge.deviceId !== deviceId) return fail('nonce_device_mismatch');
    if (challenge.expiresAt.getTime() <= now.getTime()) return fail('nonce_expired');

    const device = await devices.findById(deviceId);
    if (!device) return fail('device_unknown');
    if (device.revokedAt !== null) return fail('device_revoked');

    if (!verifyDeviceAssertion(device.publicKey, nonce, signature)) {
      return fail('bad_signature');
    }

    const user = await users.findById(device.userId);
    if (!user || user.status !== 'active' || user.deletedAt !== null) {
      return fail('account_inactive');
    }

    await devices.touch(deviceId, now);
    return this.issueTokenPair(user.id, user.ageBand, deviceId, uuidv7());
  }

  private async assertDeviceUsable(deviceId: string, userId: string): Promise<DeviceRecord> {
    const device = await this.deps.devices.findById(deviceId);
    if (!device || device.userId !== userId) {
      throw new AppError(ERROR_TYPES.DEVICE_UNKNOWN, 'Device is not registered to this account');
    }
    if (device.revokedAt !== null) {
      throw new AppError(ERROR_TYPES.DEVICE_REVOKED, 'Device has been revoked');
    }
    return device;
  }

  private async issueTokenPair(
    userId: string,
    ageBand: string,
    deviceId: string | null,
    familyId: string,
  ): Promise<TokenResponse> {
    const { issuer, refreshTokens, audit, clock, accessTtlSeconds, refreshTtlSeconds } = this.deps;
    const now = clock.now();

    const accessToken = await issuer.issue(
      { sub: userId, did: deviceId ?? undefined, ageBand, scope: ['user'] },
      now,
    );

    const refreshToken = generateRefreshToken();
    await refreshTokens.create({
      id: uuidv7(),
      familyId,
      userId,
      deviceId,
      tokenHash: hashRefreshToken(refreshToken),
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(now.getTime() + refreshTtlSeconds * 1000),
    });

    await audit.record({
      actorId: userId,
      actorType: 'user',
      action: AUDIT_ACTIONS.TOKEN_ISSUE,
      resourceType: 'user',
      resourceId: userId,
      outcome: 'allow',
      context: { deviceId, familyId },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: accessTtlSeconds,
      userId,
    };
  }
}
