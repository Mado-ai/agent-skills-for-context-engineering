#!/usr/bin/env tsx
/**
 * Migration runner. Runs as a separate job before app rollout, never on app startup —
 * startup migrations race across replicas and turn a bad migration into an outage
 * (docs/gearbox/10-quality-devops.md §10.2).
 */

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client.js';
import { loadConfig } from '../config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const handle = createDatabase(config.DATABASE_URL, { max: 1 });
  try {
    console.log('[migrate] applying migrations…');
    await migrate(handle.db, { migrationsFolder: 'drizzle' });
    console.log('[migrate] done');
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
