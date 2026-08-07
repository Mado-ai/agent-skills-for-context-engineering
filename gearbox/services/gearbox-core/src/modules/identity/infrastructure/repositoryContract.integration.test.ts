/**
 * Repository contract test.
 *
 * The same suite runs against the in-memory adapters and the Drizzle adapters. This is
 * the mechanism that stops the two from drifting — the usual failure being that the
 * in-memory version is quietly more forgiving than Postgres, so unit tests pass and
 * production does not.
 *
 * Requires a real database. Skipped (loudly) when DATABASE_URL is absent, so a
 * developer without Docker still gets a green unit suite and an explicit note that
 * this layer was not exercised.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { sql } from 'drizzle-orm';
import { createDatabase, type DbHandle } from '../../../db/client.js';
import {
  MemoryChallengeStore,
  MemoryDeviceRepository,
  MemoryRefreshTokenStore,
  MemoryUserRepository,
} from './memoryRepositories.js';
import {
  DrizzleChallengeStore,
  DrizzleDeviceRepository,
  DrizzleRefreshTokenStore,
  DrizzleUserRepository,
} from './drizzleRepositories.js';
import type {
  ChallengeStore,
  DeviceRepository,
  RefreshTokenStore,
  UserRepository,
} from '../ports/index.js';

const DATABASE_URL = process.env.DATABASE_URL;
let handle: DbHandle | undefined;

interface Suite {
  users: UserRepository;
  devices: DeviceRepository;
  refreshTokens: RefreshTokenStore;
  challenges: ChallengeStore;
  reset: () => Promise<void>;
}

function memorySuite(): Suite {
  let s = freshMemory();
  function freshMemory() {
    return {
      users: new MemoryUserRepository(),
      devices: new MemoryDeviceRepository(),
      refreshTokens: new MemoryRefreshTokenStore(),
      challenges: new MemoryChallengeStore(),
    };
  }
  return {
    get users() {
      return s.users;
    },
    get devices() {
      return s.devices;
    },
    get refreshTokens() {
      return s.refreshTokens;
    },
    get challenges() {
      return s.challenges;
    },
    reset: async () => {
      s = freshMemory();
    },
  } as unknown as Suite;
}

function drizzleSuite(h: DbHandle): Suite {
  return {
    users: new DrizzleUserRepository(h.db),
    devices: new DrizzleDeviceRepository(h.db),
    refreshTokens: new DrizzleRefreshTokenStore(h.db),
    challenges: new DrizzleChallengeStore(h.db),
    reset: async () => {
      await h.db.execute(
        sql`TRUNCATE auth_challenges, refresh_tokens, device_identities, profiles, users RESTART IDENTITY CASCADE`,
      );
    },
  };
}

const implementations: Array<[string, () => Suite]> = [['memory', memorySuite]];

if (DATABASE_URL) {
  handle = createDatabase(DATABASE_URL, { max: 2 });
  const h = handle;
  implementations.push(['drizzle', () => drizzleSuite(h)]);
} else {
  // Not silent: a skipped contract test that nobody notices is worse than no test.
  console.warn(
    '[contract] DATABASE_URL is not set — the Drizzle adapters were NOT exercised. ' +
      'Run `pnpm dev:infra && pnpm db:migrate` to cover them.',
  );
}

afterAll(async () => {
  await handle?.close();
});

describe.each(implementations)('repository contract: %s', (_name, make) => {
  let repos: Suite;

  beforeEach(async () => {
    repos = make();
    await repos.reset();
  });

  function newUser(over: Partial<{ email: string; handle: string }> = {}) {
    const id = uuidv7();
    return {
      user: {
        id,
        email: over.email ?? `u${id.slice(0, 8)}@example.com`,
        emailVerified: false,
        passwordHash: 'scrypt$32768$8$1$c2FsdA$aGFzaA',
        status: 'active' as const,
        ageBand: 'adult',
        createdAt: new Date(),
        deletedAt: null,
      },
      profile: {
        userId: id,
        handle: over.handle ?? `h${id.slice(0, 8)}`,
        displayName: 'Test User',
        pronouns: null,
        bio: null,
        locale: 'en',
      },
    };
  }

  it('creates and reads back a user with its profile', async () => {
    const { user, profile } = newUser();
    await repos.users.create(user, profile);

    expect((await repos.users.findById(user.id))?.email).toBe(user.email);
    expect((await repos.users.getProfile(user.id))?.handle).toBe(profile.handle);
  });

  it('looks up email case-insensitively', async () => {
    const { user, profile } = newUser({ email: 'MixedCase@Example.com' });
    await repos.users.create(user, profile);
    expect(await repos.users.findByEmail('mixedcase@example.com')).not.toBeNull();
    expect(await repos.users.findByEmail('MIXEDCASE@EXAMPLE.COM')).not.toBeNull();
  });

  it('looks up handle case-insensitively', async () => {
    const { user, profile } = newUser({ handle: 'MixedHandle' });
    await repos.users.create(user, profile);
    expect(await repos.users.findByHandle('mixedhandle')).not.toBeNull();
  });

  it('rejects a duplicate email at the storage layer', async () => {
    const a = newUser({ email: 'dup@example.com' });
    const b = newUser({ email: 'DUP@example.com' });
    await repos.users.create(a.user, a.profile);
    await expect(repos.users.create(b.user, b.profile)).rejects.toThrow();
  });

  it('rejects a duplicate handle at the storage layer', async () => {
    const a = newUser({ handle: 'taken' });
    const b = newUser({ handle: 'TAKEN' });
    await repos.users.create(a.user, a.profile);
    await expect(repos.users.create(b.user, b.profile)).rejects.toThrow();
  });

  it('consumes a challenge nonce exactly once', async () => {
    const nonce = `n-${uuidv7()}`;
    const deviceId = uuidv7();
    await repos.challenges.create({
      nonce,
      deviceId,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(await repos.challenges.consume(nonce, new Date())).not.toBeNull();
    expect(await repos.challenges.consume(nonce, new Date())).toBeNull();
  });

  it('revokes every unrevoked token in a family and reports the count', async () => {
    const { user, profile } = newUser();
    await repos.users.create(user, profile);

    const familyId = uuidv7();
    for (let i = 0; i < 3; i++) {
      await repos.refreshTokens.create({
        id: uuidv7(),
        familyId,
        userId: user.id,
        deviceId: null,
        tokenHash: `hash-${familyId}-${i}`,
        usedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
      });
    }

    expect(await repos.refreshTokens.revokeFamily(familyId, new Date())).toBe(3);
    // Idempotent: a second call finds nothing left to revoke.
    expect(await repos.refreshTokens.revokeFamily(familyId, new Date())).toBe(0);

    const one = await repos.refreshTokens.findByHash(`hash-${familyId}-0`);
    expect(one?.revokedAt).not.toBeNull();
  });

  it('marks a refresh token used without clobbering an earlier use', async () => {
    const { user, profile } = newUser();
    await repos.users.create(user, profile);

    const id = uuidv7();
    await repos.refreshTokens.create({
      id,
      familyId: uuidv7(),
      userId: user.id,
      deviceId: null,
      tokenHash: `hash-${id}`,
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const first = new Date('2026-01-01T00:00:00Z');
    const second = new Date('2026-01-02T00:00:00Z');
    await repos.refreshTokens.markUsed(id, first);
    await repos.refreshTokens.markUsed(id, second);

    const row = await repos.refreshTokens.findByHash(`hash-${id}`);
    expect(row?.usedAt?.toISOString()).toBe(first.toISOString());
  });

  it('revokes a device and keeps it readable', async () => {
    const { user, profile } = newUser();
    await repos.users.create(user, profile);

    const device = {
      id: uuidv7(),
      userId: user.id,
      publicKey: 'A'.repeat(43),
      platform: 'ios',
      deviceName: null,
      lastSeenAt: null,
      revokedAt: null,
    };
    await repos.devices.create(device);
    await repos.devices.revoke(device.id, new Date());

    const found = await repos.devices.findById(device.id);
    expect(found?.revokedAt).not.toBeNull();
    expect(await repos.devices.findByUser(user.id)).toHaveLength(1);
  });
});
