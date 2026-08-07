/**
 * In-memory adapters for the identity ports.
 *
 * These are not "test doubles that pretend" — they implement the same contract as the
 * Drizzle adapters, including case-insensitive email/handle lookup (which is `citext`
 * in Postgres) and single-use nonce consumption. Both implementations are exercised by
 * the same contract test, so behaviour cannot silently diverge.
 *
 * They are also what the `LOCAL` deployment profile will build on
 * (docs/gearbox/02-stack.md §2.1).
 */

import type {
  ChallengeRecord,
  ChallengeStore,
  DeviceRecord,
  DeviceRepository,
  ProfileRecord,
  RefreshTokenRecord,
  RefreshTokenStore,
  UserRecord,
  UserRepository,
} from '../ports/index.js';
import type { AuditEvent, AuditSink } from '../../audit/ports/index.js';

const fold = (s: string): string => s.trim().toLowerCase();

export class MemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, UserRecord>();
  private readonly profilesByUser = new Map<string, ProfileRecord>();

  async findById(id: string): Promise<UserRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const target = fold(email);
    for (const u of this.byId.values()) {
      if (fold(u.email) === target) return u;
    }
    return null;
  }

  async findByHandle(handle: string): Promise<UserRecord | null> {
    const target = fold(handle);
    for (const p of this.profilesByUser.values()) {
      if (fold(p.handle) === target) return this.byId.get(p.userId) ?? null;
    }
    return null;
  }

  async create(user: UserRecord, profile: ProfileRecord): Promise<void> {
    if (await this.findByEmail(user.email)) throw new Error('duplicate email');
    if (await this.findByHandle(profile.handle)) throw new Error('duplicate handle');
    this.byId.set(user.id, { ...user });
    this.profilesByUser.set(user.id, { ...profile });
  }

  async updatePasswordHash(userId: string, hash: string): Promise<void> {
    const u = this.byId.get(userId);
    if (u) u.passwordHash = hash;
  }

  async getProfile(userId: string): Promise<ProfileRecord | null> {
    return this.profilesByUser.get(userId) ?? null;
  }
}

export class MemoryDeviceRepository implements DeviceRepository {
  private readonly byId = new Map<string, DeviceRecord>();

  async findById(id: string): Promise<DeviceRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async findByUser(userId: string): Promise<DeviceRecord[]> {
    return [...this.byId.values()].filter((d) => d.userId === userId);
  }

  async create(device: DeviceRecord): Promise<void> {
    this.byId.set(device.id, { ...device });
  }

  async touch(id: string, at: Date): Promise<void> {
    const d = this.byId.get(id);
    if (d) d.lastSeenAt = at;
  }

  async revoke(id: string, at: Date): Promise<void> {
    const d = this.byId.get(id);
    if (d) d.revokedAt = at;
  }
}

export class MemoryRefreshTokenStore implements RefreshTokenStore {
  private readonly byId = new Map<string, RefreshTokenRecord>();
  private readonly idByHash = new Map<string, string>();

  async findByHash(hash: string): Promise<RefreshTokenRecord | null> {
    const id = this.idByHash.get(hash);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async create(record: RefreshTokenRecord): Promise<void> {
    this.byId.set(record.id, { ...record });
    this.idByHash.set(record.tokenHash, record.id);
  }

  async markUsed(id: string, at: Date): Promise<void> {
    const r = this.byId.get(id);
    if (r) r.usedAt = at;
  }

  async revokeFamily(familyId: string, at: Date): Promise<number> {
    let n = 0;
    for (const r of this.byId.values()) {
      if (r.familyId === familyId && r.revokedAt === null) {
        r.revokedAt = at;
        n++;
      }
    }
    return n;
  }

  /** Test helper: how many tokens exist in a family. */
  countFamily(familyId: string): number {
    return [...this.byId.values()].filter((r) => r.familyId === familyId).length;
  }
}

export class MemoryChallengeStore implements ChallengeStore {
  private readonly byNonce = new Map<string, ChallengeRecord>();

  async create(record: ChallengeRecord): Promise<void> {
    this.byNonce.set(record.nonce, { ...record });
  }

  /** Consumption is atomic: a nonce can be redeemed exactly once. */
  async consume(nonce: string, at: Date): Promise<ChallengeRecord | null> {
    const rec = this.byNonce.get(nonce);
    if (!rec || rec.consumedAt !== null) return null;
    rec.consumedAt = at;
    return { ...rec };
  }
}

export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  byAction(action: string): AuditEvent[] {
    return this.events.filter((e) => e.action === action);
  }
}
