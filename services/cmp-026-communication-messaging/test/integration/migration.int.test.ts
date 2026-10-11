import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminUrl, DB_DIR, migrate, withAdmin } from './helpers.js';

const CMP026_FILES = [
  '1759542600000_cmp-026-communication-messaging.sql',
  '1759542600001_cmp-026-outbox.sql',
];
const CHAIN = [
  '1759482000000_platform-baseline.sql',
  '1759490000000_shared-db-contracts.sql',
  ...CMP026_FILES,
];

const name = `sf_cmp026_mig_${randomBytes(4).toString('hex')}`;
const dir = mkdtempSync(join(tmpdir(), 'cmp026-mig-'));
const url = (() => {
  const u = new URL(adminUrl());
  u.pathname = `/${name}`;
  return u.toString();
})();

async function tables(): Promise<string[]> {
  return withAdmin(async (c) => {
    const r = await c.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_messaging' AND c.relkind = 'r' ORDER BY 1`,
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

describe('CMP-026 migrations (isolated database; up -> down -> up)', () => {
  it('applies on platform baseline + shared DB contracts only', async () => {
    migrate('up', undefined, url, dir);
    expect(await tables()).toEqual([
      'idempotency_record',
      'inbox_event',
      'inbox_event_platform',
      'message',
      'message_attachment',
      'message_retraction',
      'notice_acknowledgement',
      'outbox_event',
      'outbox_event_platform',
      'participant',
      'read_receipt',
      'thread',
      'thread_transition',
    ]);
    const owners = await withAdmin(async (c) => {
      const r = await c.query(
        `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_messaging' AND c.relkind = 'r'`,
      );
      return r.rows.map((x) => x['owner']);
    }, url);
    expect(owners).toEqual(['sf_migrator']);
  });

  it('rolls back both CMP-026 migrations and keeps the NOLOGIN role', async () => {
    migrate('down', 2, url, dir);
    expect(await tables()).toEqual([]);
    const schema = await withAdmin(
      async (c) =>
        (await c.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_messaging'`)).rows,
      url,
    );
    expect(schema).toEqual([]);
    const role = await withAdmin(
      async (c) =>
        (await c.query(`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'sf_cmp026_rw'`)).rows,
    );
    expect(role).toEqual([{ rolcanlogin: false }]);
  });

  it('re-applies after rollback', async () => {
    migrate('up', undefined, url, dir);
    expect(await tables()).toHaveLength(13);
    expect(migrate('up', undefined, url, dir)).toMatch(/No migrations to run/);
  });
});
