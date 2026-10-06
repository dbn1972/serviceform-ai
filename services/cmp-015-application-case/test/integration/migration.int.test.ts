import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminUrl, DB_DIR, migrate, withAdmin } from './helpers.js';

const CMP015_FILES = [
  '1759540150000_cmp-015-application-case.sql',
  '1759540150001_cmp-015-outbox.sql',
];
const CHAIN = [
  '1759482000000_platform-baseline.sql',
  '1759490000000_shared-db-contracts.sql',
  ...CMP015_FILES,
];

const name = `sf_cmp015_mig_${randomBytes(4).toString('hex')}`;
const dir = mkdtempSync(join(tmpdir(), 'cmp015-mig-'));
const url = (() => {
  const u = new URL(adminUrl());
  u.pathname = `/${name}`;
  return u.toString();
})();

async function tables(): Promise<string[]> {
  return withAdmin(async (c) => {
    const r = await c.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_application_case' AND c.relkind = 'r' ORDER BY 1`,
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

describe('CMP-015 migrations (isolated database; up -> down -> up)', () => {
  it('applies on top of the platform baseline + shared DB contracts only (no cross-component dependency)', async () => {
    migrate('up', undefined, url, dir);
    expect(await tables()).toEqual([
      'application_case',
      'case_request_reference',
      'case_transition',
      'idempotency_record',
      'inbox_event',
      'inbox_event_platform',
      'outbox_event',
      'outbox_event_platform',
    ]);
    const owners = await withAdmin(async (c) => {
      const r = await c.query(
        `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_application_case' AND c.relkind = 'r'`,
      );
      return r.rows.map((x) => x['owner']);
    }, url);
    expect(owners).toEqual(['sf_migrator']);
    const publicGrants = await withAdmin(async (c) => {
      const r = await c.query(
        `SELECT count(*)::int AS n FROM information_schema.role_table_grants
          WHERE table_schema = 'sf_application_case' AND grantee = 'PUBLIC'`,
      );
      return Number(r.rows[0]?.['n']);
    }, url);
    expect(publicGrants).toBe(0);
  });

  it('rolls back both CMP-015 migrations cleanly and keeps the NOLOGIN role', async () => {
    migrate('down', 2, url, dir);
    expect(await tables()).toEqual([]);
    const schema = await withAdmin(
      async (c) =>
        (await c.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_application_case'`)).rows,
      url,
    );
    expect(schema).toEqual([]);
    const role = await withAdmin(
      async (c) =>
        (await c.query(`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'sf_cmp015_rw'`)).rows,
    );
    expect(role).toEqual([{ rolcanlogin: false }]);
  });

  it('re-applies after rollback', async () => {
    migrate('up', undefined, url, dir);
    expect(await tables()).toHaveLength(8);
    expect(migrate('up', undefined, url, dir)).toMatch(/No migrations to run/);
  });
});
