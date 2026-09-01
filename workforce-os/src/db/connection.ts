import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

/**
 * `node:sqlite` is loaded through createRequire rather than a static import.
 *
 * It is a real Node 22 builtin, but because it is still flagged experimental it
 * is absent from `module.builtinModules` — the list bundlers consult. Vite (and
 * so Vitest) therefore strips the `node:` prefix and tries to resolve a package
 * called "sqlite", which does not exist. A runtime require is opaque to that
 * static analysis and resolves correctly under both `tsx` and Vitest.
 */
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

/**
 * Local development persistence.
 *
 * node:sqlite is used deliberately: it ships with Node 22, so a clean checkout
 * runs the full suite with no native build step and no service to stand up.
 * Everything above this file talks to the `Db` interface, and every statement is
 * positional-parameter SQL that a PostgreSQL driver accepts with only the
 * placeholder style changed. See docs/V04_DATA_MODEL.md for the migration path.
 */

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface Db {
  readonly raw: DatabaseSyncType;
  readonly path: string;
  all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[];
  get<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T | undefined;
  run(sql: string, ...params: SqlValue[]): { changes: number };
  exec(sql: string): void;
  tx<T>(fn: () => T): T;
  close(): void;
}

export interface OpenOptions {
  /** ':memory:' is accepted for throwaway databases. */
  path?: string;
  readonly?: boolean;
}

export function openDatabase(options: OpenOptions = {}): Db {
  const path =
    options.path ?? process.env.WORKFORCE_DB_PATH ?? resolve(process.cwd(), '.data/workforce.db');

  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });

  const raw = new DatabaseSync(path, { readOnly: options.readonly ?? false });

  if (!options.readonly) {
    // Referential integrity is off by default in SQLite and the scope-isolation
    // guarantees lean on it, so it is enabled before anything else runs.
    raw.exec('PRAGMA foreign_keys = ON');
    if (path !== ':memory:') raw.exec('PRAGMA journal_mode = WAL');
    raw.exec('PRAGMA busy_timeout = 5000');
  }

  let txDepth = 0;

  const db: Db = {
    raw,
    path,
    all<T>(sql: string, ...params: SqlValue[]): T[] {
      return raw.prepare(sql).all(...params) as T[];
    },
    get<T>(sql: string, ...params: SqlValue[]): T | undefined {
      return raw.prepare(sql).get(...params) as T | undefined;
    },
    run(sql: string, ...params: SqlValue[]) {
      const info = raw.prepare(sql).run(...params);
      return { changes: Number(info.changes) };
    },
    exec(sql: string) {
      raw.exec(sql);
    },
    tx<T>(fn: () => T): T {
      // Nested calls join the outer transaction via savepoints so a composite
      // operation (delegate + audit + budget) is still all-or-nothing.
      const isOuter = txDepth === 0;
      const name = `sp_${txDepth}`;
      raw.exec(isOuter ? 'BEGIN' : `SAVEPOINT ${name}`);
      txDepth++;
      try {
        const result = fn();
        txDepth--;
        raw.exec(isOuter ? 'COMMIT' : `RELEASE ${name}`);
        return result;
      } catch (err) {
        txDepth--;
        raw.exec(isOuter ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
        throw err;
      }
    },
    close() {
      raw.close();
    },
  };

  return db;
}

/** Parse a JSON text column, falling back to a default rather than throwing. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

export function fromBool(value: boolean | undefined | null): number {
  return value ? 1 : 0;
}
