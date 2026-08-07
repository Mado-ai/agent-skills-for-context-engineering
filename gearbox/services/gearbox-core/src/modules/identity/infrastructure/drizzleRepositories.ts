/**
 * Postgres adapters for the identity ports.
 *
 * These implement exactly the same contract as the in-memory adapters. The contract
 * test in repositoryContract.integration.test.ts runs against both, so behaviour
 * cannot drift — the usual failure mode being that the memory version is more
 * forgiving than the database.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  authChallenges,
  deviceIdentities,
  profiles,
  refreshTokens as refreshTokensTable,
  users,
} from '../../../db/schema.js';
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
import { auditEvents } from '../../../db/schema.js';
import { v7 as uuidv7 } from 'uuid';

type Db = PostgresJsDatabase<Record<string, unknown>>;

function toUser(row: typeof users.$inferSelect): UserRecord {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    passwordHash: row.passwordHash,
    status: row.status as UserRecord['status'],
    ageBand: row.ageBand,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toUser(row) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    // citext makes this case-insensitive at the database level.
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ? toUser(row) : null;
  }

  async findByHandle(handle: string): Promise<UserRecord | null> {
    const [row] = await this.db
      .select({ user: users })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(eq(profiles.handle, handle))
      .limit(1);
    return row ? toUser(row.user) : null;
  }

  /** User and profile are created together or not at all. */
  async create(user: UserRecord, profile: ProfileRecord): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        passwordHash: user.passwordHash,
        status: user.status,
        ageBand: user.ageBand,
        createdAt: user.createdAt,
      });
      await tx.insert(profiles).values({
        userId: profile.userId,
        handle: profile.handle,
        displayName: profile.displayName,
        pronouns: profile.pronouns,
        bio: profile.bio,
        locale: profile.locale,
      });
    });
  }

  async updatePasswordHash(userId: string, hash: string): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash: hash, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async getProfile(userId: string): Promise<ProfileRecord | null> {
    const [row] = await this.db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    return row
      ? {
          userId: row.userId,
          handle: row.handle,
          displayName: row.displayName,
          pronouns: row.pronouns,
          bio: row.bio,
          locale: row.locale,
        }
      : null;
  }
}

export class DrizzleDeviceRepository implements DeviceRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<DeviceRecord | null> {
    const [row] = await this.db
      .select()
      .from(deviceIdentities)
      .where(eq(deviceIdentities.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByUser(userId: string): Promise<DeviceRecord[]> {
    return this.db.select().from(deviceIdentities).where(eq(deviceIdentities.userId, userId));
  }

  async create(device: DeviceRecord): Promise<void> {
    await this.db.insert(deviceIdentities).values(device);
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.db
      .update(deviceIdentities)
      .set({ lastSeenAt: at })
      .where(eq(deviceIdentities.id, id));
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.db
      .update(deviceIdentities)
      .set({ revokedAt: at })
      .where(and(eq(deviceIdentities.id, id), isNull(deviceIdentities.revokedAt)));
  }
}

export class DrizzleRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly db: Db) {}

  async findByHash(hash: string): Promise<RefreshTokenRecord | null> {
    const [row] = await this.db
      .select()
      .from(refreshTokensTable)
      .where(eq(refreshTokensTable.tokenHash, hash))
      .limit(1);
    return row ?? null;
  }

  async create(record: RefreshTokenRecord): Promise<void> {
    await this.db.insert(refreshTokensTable).values(record);
  }

  /**
   * Conditional update: only marks the row used if it is still unused. Two concurrent
   * refreshes with the same token therefore cannot both succeed — the loser sees
   * zero rows affected and is treated as a reuse.
   */
  async markUsed(id: string, at: Date): Promise<void> {
    await this.db
      .update(refreshTokensTable)
      .set({ usedAt: at })
      .where(and(eq(refreshTokensTable.id, id), isNull(refreshTokensTable.usedAt)));
  }

  async revokeFamily(familyId: string, at: Date): Promise<number> {
    const rows = await this.db
      .update(refreshTokensTable)
      .set({ revokedAt: at })
      .where(and(eq(refreshTokensTable.familyId, familyId), isNull(refreshTokensTable.revokedAt)))
      .returning({ id: refreshTokensTable.id });
    return rows.length;
  }
}

export class DrizzleChallengeStore implements ChallengeStore {
  constructor(private readonly db: Db) {}

  async create(record: ChallengeRecord): Promise<void> {
    await this.db.insert(authChallenges).values(record);
  }

  /**
   * Single-use in one statement. Doing this as SELECT-then-UPDATE would let two
   * concurrent requests both redeem the same nonce, which is the replay hole the
   * challenge exists to close (docs/gearbox/07-authz-security.md §7.4).
   */
  async consume(nonce: string, at: Date): Promise<ChallengeRecord | null> {
    const rows = await this.db
      .update(authChallenges)
      .set({ consumedAt: at })
      .where(and(eq(authChallenges.nonce, nonce), isNull(authChallenges.consumedAt)))
      .returning();
    return rows[0] ?? null;
  }

  /** Housekeeping; called by a scheduled job. */
  async purgeExpired(before: Date): Promise<number> {
    const rows = await this.db
      .delete(authChallenges)
      .where(sql`${authChallenges.expiresAt} < ${before}`)
      .returning({ nonce: authChallenges.nonce });
    return rows.length;
  }
}

export class DrizzleAuditSink implements AuditSink {
  constructor(private readonly db: Db) {}

  async record(event: AuditEvent): Promise<void> {
    await this.db.insert(auditEvents).values({
      id: uuidv7(),
      actorId: event.actorId,
      actorType: event.actorType,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      outcome: event.outcome,
      context: event.context ?? {},
    });
  }
}
