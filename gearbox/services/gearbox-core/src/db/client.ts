/**
 * Database client. One pool per process; created lazily so that unit tests, which use
 * the in-memory adapters, never open a connection.
 */

import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema } from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  close: () => Promise<void>;
}

export function createDatabase(url: string, opts: { max?: number } = {}): DbHandle {
  const sql = postgres(url, {
    max: opts.max ?? 10,
    // Fail fast on a wedged connection rather than hanging a request thread.
    connect_timeout: 10,
    idle_timeout: 30,
    onnotice: () => {},
  });
  return {
    db: drizzle(sql, { schema }),
    close: () => sql.end({ timeout: 5 }),
  };
}
