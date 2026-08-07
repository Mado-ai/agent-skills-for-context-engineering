#!/usr/bin/env tsx
/**
 * Development seed. Idempotent — running it twice must not fail or duplicate, because
 * it will be run twice.
 */

import { v7 as uuidv7 } from 'uuid';
import { createDatabase } from './client.js';
import { loadConfig } from '../config.js';
import { DrizzleUserRepository } from '../modules/identity/infrastructure/drizzleRepositories.js';
import { hashPassword } from '../modules/identity/domain/password.js';

const SEED_USERS = [
  { email: 'ada@gearbox.test', handle: 'ada', displayName: 'Ada' },
  { email: 'grace@gearbox.test', handle: 'grace', displayName: 'Grace' },
];

const SEED_PASSWORD = 'gearbox-dev-password';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required to seed');
  if (config.isProduction) throw new Error('Refusing to seed a production database');

  const handle = createDatabase(config.DATABASE_URL, { max: 1 });
  const users = new DrizzleUserRepository(handle.db);

  try {
    const passwordHash = await hashPassword(SEED_PASSWORD);
    for (const spec of SEED_USERS) {
      if (await users.findByEmail(spec.email)) {
        console.log(`[seed] ${spec.email} already exists, skipping`);
        continue;
      }
      const id = uuidv7();
      await users.create(
        {
          id,
          email: spec.email,
          emailVerified: true,
          passwordHash,
          status: 'active',
          ageBand: 'adult',
          createdAt: new Date(),
          deletedAt: null,
        },
        {
          userId: id,
          handle: spec.handle,
          displayName: spec.displayName,
          pronouns: null,
          bio: null,
          locale: 'en',
        },
      );
      console.log(`[seed] created ${spec.email}`);
    }
    console.log(`[seed] done. Password for all seed users: ${SEED_PASSWORD}`);
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
