import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminUrl, DB_DIR, migrate, withAdmin } from './helpers.js';

const CMP027_FILES = [
  '1759541270000_cmp-027-grievance-feedback.sql',
  '1759541270001_cmp-027-outbox.sql',
];
const CHAIN = [
  '1759482000000_platform-baseline.sql',
  '1759490000000_shared-db-contracts.sql',
  ...CMP027_FILES,
];

const name = `sf_cmp027_mig_${randomBytes(4).toString('hex')}`;
const dir = mkdtempSync(join(tmpdir(), 'cmp027-mig-'));
const url = (() => {
  const u = new URL(adminUrl());
  u.pathname = `/${name}`;
  return u.toString();
})();

async function tables(): Promise<string[]> {
  return withAdmin(async (c) => {
    const r = await c.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_grievance' AND c.relkind = 'r' ORDER BY 1`,
    );
    return r.rows.map((x) => String(x['relname']));
  }, url);
}

beforeAll(async () => {
  for (const f of CHAIN) copyFileSync(join(DB_DIR, 'migrations', f), join(dir, f));
  await withAdmin(async (c) => {
    const ddl = await c.query('SELECT format($1::text, $2::text) AS s', [
      'CREATE DATABASE %I TEMPLATE template0',
      name,
    ]);
    await c.query(String(ddl.rows[0]?.['s']));
  });
});

afterAll(async () => {
  await withAdmin(async (c) => {
    const ddl = await c.query('SELECT format($1::text, $2::text) AS s', [
      'DROP DATABASE IF EXISTS %I WITH (FORCE)',
      name,
    ]);
    await c.query(String(ddl.rows[0]?.['s']));
  });
  rmSync(dir, { recursive: true, force: true });
});

describe('CMP-027 migrations (isolated database; up -> down -> up)', () => {
  it('applies on platform baseline + shared DB contracts only', async () => {
    migrate('up', undefined, url, dir);
    expect(await tables()).toEqual([
      'ai_assist_record',
      'assignment_request',
      'grievance',
      'grievance_response',
      'grievance_transition',
      'idempotency_record',
      'inbox_event',
      'inbox_event_platform',
      'outbox_event',
      'outbox_event_platform',
    ]);
    const owners = await withAdmin(async (c) => {
      const r = await c.query(
        `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_grievance' AND c.relkind = 'r'`,
      );
      return r.rows.map((x) => x['owner']);
    }, url);
    expect(owners).toEqual(['sf_migrator']);
  });

  it('rolls back both CMP-027 migrations and keeps the NOLOGIN role', async () => {
    migrate('down', 2, url, dir);
    expect(await tables()).toEqual([]);
    const schema = await withAdmin(
      async (c) =>
        (await c.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_grievance'`)).rows,
      url,
    );
    expect(schema).toEqual([]);
    const role = await withAdmin(
      async (c) =>
        (await c.query(`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'sf_cmp027_rw'`)).rows,
    );
    expect(role).toEqual([{ rolcanlogin: false }]);
  });

  it('re-applies after rollback', async () => {
    migrate('up', undefined, url, dir);
    expect(await tables()).toHaveLength(10);
    expect(migrate('up', undefined, url, dir)).toMatch(/No migrations to run/);
  });
});
