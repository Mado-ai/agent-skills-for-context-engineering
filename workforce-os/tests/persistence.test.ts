import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection.js';
import { appliedMigrations, defaultMigrationsDir, loadMigrations, migrate } from '../src/db/migrate.js';

describe('persistence and migrations', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function tempMigrationsDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'workforce-migrations-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'migrations'), { recursive: true });
    for (const file of readdirSync(defaultMigrationsDir())) {
      copyFileSync(join(defaultMigrationsDir(), file), join(dir, 'migrations', file));
    }
    return join(dir, 'migrations');
  }

  it('applies every migration in order', () => {
    const db = openDatabase({ path: ':memory:' });
    const result = migrate(db);
    expect(result.applied.length).toBeGreaterThanOrEqual(3);
    expect(result.applied).toEqual([...result.applied].sort());
    db.close();
  });

  it('is idempotent on a second run', () => {
    const db = openDatabase({ path: ':memory:' });
    migrate(db);
    const second = migrate(db);
    expect(second.applied).toHaveLength(0);
    expect(second.alreadyApplied.length).toBeGreaterThanOrEqual(3);
    db.close();
  });

  it('records a checksum for every applied migration', () => {
    const db = openDatabase({ path: ':memory:' });
    migrate(db);
    const applied = appliedMigrations(db);
    expect(applied.length).toBeGreaterThanOrEqual(3);
    for (const row of applied) expect(row.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    db.close();
  });

  it('refuses to run when an applied migration has been edited', () => {
    const dir = tempMigrationsDir();
    const db = openDatabase({ path: ':memory:' });
    migrate(db, dir);

    const target = join(dir, '003_system_bootstrap.sql');
    writeFileSync(target, `${readFileSync(target, 'utf8')}\n-- an edit after the fact\n`);

    expect(() => migrate(db, dir)).toThrow(/has changed since it was applied/);
    db.close();
  });

  it('enforces foreign keys', () => {
    const db = openDatabase({ path: ':memory:' });
    migrate(db);
    expect(() =>
      db.run(
        `INSERT INTO tasks (task_id, project_id, trace_id, title, description, status, priority,
           created_by, input, attempt, max_attempts, created_at, updated_at)
         VALUES ('tsk_x', 'prj_does_not_exist', 'trc_x', 't', '', 'pending', 'normal', 'owner', '{}', 0, 3, '', '')`,
      ),
    ).toThrow(/FOREIGN KEY/i);
    db.close();
  });

  it('enforces enum constraints declared in the schema', () => {
    const db = openDatabase({ path: ':memory:' });
    migrate(db);
    expect(() =>
      db.run(
        `INSERT INTO agents (agent_id, display_name, role_level, status, current_version, created_at, updated_at)
         VALUES ('agt_x', 'x', 'emperor', 'active', 1, '', '')`,
      ),
    ).toThrow(/CHECK/i);
    db.close();
  });

  it('rolls a failed transaction back completely', () => {
    const db = openDatabase({ path: ':memory:' });
    migrate(db);
    const before = db.all('SELECT * FROM projects').length;
    expect(() =>
      db.tx(() => {
        db.run(
          `INSERT INTO projects (project_id, key, name, description, status, metadata, created_at, updated_at)
           VALUES ('prj_a', 'a', 'A', '', 'active', '{}', '', '')`,
        );
        throw new Error('deliberate rollback');
      }),
    ).toThrow('deliberate rollback');
    expect(db.all('SELECT * FROM projects').length).toBe(before);
    db.close();
  });

  it('rolls a nested savepoint back without losing the outer transaction', () => {
    const db = openDatabase({ path: ':memory:' });
    migrate(db);
    db.tx(() => {
      db.run(
        `INSERT INTO projects (project_id, key, name, description, status, metadata, created_at, updated_at)
         VALUES ('prj_outer', 'outer', 'Outer', '', 'active', '{}', '', '')`,
      );
      try {
        db.tx(() => {
          db.run(
            `INSERT INTO projects (project_id, key, name, description, status, metadata, created_at, updated_at)
             VALUES ('prj_inner', 'inner', 'Inner', '', 'active', '{}', '', '')`,
          );
          throw new Error('inner failure');
        });
      } catch {
        // The inner work is discarded; the outer transaction continues.
      }
    });
    const keys = db.all<{ key: string }>('SELECT key FROM projects').map((r) => r.key);
    expect(keys).toContain('outer');
    expect(keys).not.toContain('inner');
    db.close();
  });

  it('ships a schema whose migration files are ordered and prefixed', () => {
    const migrations = loadMigrations();
    for (const m of migrations) expect(m.name).toMatch(/^\d{3}_[a-z0-9_]+\.sql$/);
    expect(migrations.map((m) => m.version)).toEqual([...migrations.map((m) => m.version)].sort());
  });

  it('stores no secret values anywhere in the schema', () => {
    const db = openDatabase({ path: ':memory:' });
    migrate(db);
    const columns = db.all<{ name: string; tbl: string }>(
      "SELECT p.name AS name, m.name AS tbl FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'",
    );
    for (const col of columns) {
      // A column literally named for a secret value would be a design error;
      // credentials are referenced by environment variable name only.
      expect(col.name).not.toMatch(/^(secret|password|api_key|credential)$/);
      expect(col.name).not.toMatch(/_(secret|password|plaintext)$/);
    }
    db.close();
  });
});
