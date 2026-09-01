import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './connection.js';

/**
 * Versioned migrations applied from files on disk, not from application
 * startup code. Each applied migration's checksum is recorded, and a checksum
 * that no longer matches the file is a hard error rather than a silent
 * divergence between environments.
 */

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

const HERE = fileURLToPath(new URL('.', import.meta.url));

export function defaultMigrationsDir(): string {
  return resolve(HERE, '../../migrations');
}

export function loadMigrations(dir: string = defaultMigrationsDir()): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(dir, file), 'utf8');
      const version = file.split('_')[0] ?? file;
      return {
        version,
        name: file,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    });
}

function ensureMigrationsTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: string[];
}

export function migrate(db: Db, dir: string = defaultMigrationsDir()): MigrateResult {
  ensureMigrationsTable(db);
  const migrations = loadMigrations(dir);
  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  for (const m of migrations) {
    const existing = db.get<{ checksum: string }>(
      'SELECT checksum FROM schema_migrations WHERE version = ?',
      m.version,
    );

    if (existing) {
      if (existing.checksum !== m.checksum) {
        throw new Error(
          `Migration ${m.name} has changed since it was applied ` +
            `(recorded ${existing.checksum.slice(0, 12)}, file ${m.checksum.slice(0, 12)}). ` +
            'Add a new migration instead of editing an applied one.',
        );
      }
      alreadyApplied.push(m.name);
      continue;
    }

    db.tx(() => {
      db.exec(m.sql);
      db.run(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        m.version,
        m.name,
        m.checksum,
        new Date().toISOString(),
      );
    });
    applied.push(m.name);
  }

  return { applied, alreadyApplied };
}

export function appliedMigrations(db: Db): { version: string; name: string; applied_at: string }[] {
  ensureMigrationsTable(db);
  return db.all('SELECT version, name, applied_at FROM schema_migrations ORDER BY version');
}
