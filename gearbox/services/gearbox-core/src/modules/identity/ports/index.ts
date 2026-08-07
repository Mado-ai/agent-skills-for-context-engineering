/**
 * The identity module's public interface.
 *
 * Other modules import from here and nowhere else — deep imports into domain/,
 * application/ or infrastructure/ are a lint error (see eslint.config.js).
 */

export interface UserRecord {
  id: string;
  email: string;
  emailVerified: boolean;
  passwordHash: string | null;
  status: 'active' | 'suspended' | 'deleted';
  ageBand: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface ProfileRecord {
  userId: string;
  handle: string;
  displayName: string;
  pronouns: string | null;
  bio: string | null;
  locale: string;
}

export interface DeviceRecord {
  id: string;
  userId: string;
  publicKey: string;
  platform: string;
  deviceName: string | null;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}

export interface RefreshTokenRecord {
  id: string;
  familyId: string;
  userId: string;
  deviceId: string | null;
  tokenHash: string;
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}

export interface ChallengeRecord {
  nonce: string;
  deviceId: string;
  consumedAt: Date | null;
  expiresAt: Date;
}

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findByHandle(handle: string): Promise<UserRecord | null>;
  create(user: UserRecord, profile: ProfileRecord): Promise<void>;
  updatePasswordHash(userId: string, hash: string): Promise<void>;
  getProfile(userId: string): Promise<ProfileRecord | null>;
}

export interface DeviceRepository {
  findById(id: string): Promise<DeviceRecord | null>;
  findByUser(userId: string): Promise<DeviceRecord[]>;
  create(device: DeviceRecord): Promise<void>;
  touch(id: string, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
}

export interface RefreshTokenStore {
  findByHash(hash: string): Promise<RefreshTokenRecord | null>;
  create(record: RefreshTokenRecord): Promise<void>;
  markUsed(id: string, at: Date): Promise<void>;
  /** Revokes every token in a family. Called on reuse detection. */
  revokeFamily(familyId: string, at: Date): Promise<number>;
}

export interface ChallengeStore {
  create(record: ChallengeRecord): Promise<void>;
  consume(nonce: string, at: Date): Promise<ChallengeRecord | null>;
}

/** Injected so tests can control time without sleeping. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface IdentityPort {
  /** Resolves an access token to a caller identity, or throws AppError. */
  authenticate(
    accessToken: string,
  ): Promise<{ userId: string; deviceId?: string; ageBand: string }>;
}
