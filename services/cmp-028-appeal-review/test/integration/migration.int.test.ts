import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, migrate, setupHarness, type Harness } from './helpers.js';

const MIGRATIONS = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../db/migrations');
const FROM_CMP028 = readdirSync(MIGRATIONS).filter(
  (f) => f.endsWith('.sql') && f >= '1759540280000',
).length;

let h: Harness;
beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => closeHarness(h));

describe('CMP-028 migrations on PostgreSQL', () => {
  it('creates sf_appeal tables, all FORCE RLS, owned by sf_migrator', async () => {
    const { rows } = await h.admin.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_appeal' AND c.relkind = 'r' ORDER BY c.relname`,
    );
    const names = rows.map((r) => r['relname']);
    expect(names).toEqual(
      expect.arrayContaining([
        'appeal',
        'appeal_history',
        'assist_note',
        'idempotency_record',
        'outbox_event',
        'inbox_event',
      ]),
    );
    for (const r of rows.filter((x) => !String(x['relname']).endsWith('_platform'))) {
      expect(r['relrowsecurity'], String(r['relname'])).toBe(true);
      expect(r['relforcerowsecurity'], String(r['relname'])).toBe(true);
      expect(r['owner']).toBe('sf_migrator');
    }
  });

  it('role sf_cmp028_rw is NOLOGIN, not superuser, no BYPASSRLS', async () => {
    const { rows } = await h.admin.query(
      `SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles
        WHERE rolname IN ('sf_cmp028_rw', 'sf_t028_rt')`,
    );
    const byName = Object.fromEntries(rows.map((r) => [String(r['rolname']), r]));
    expect(byName['sf_cmp028_rw']).toMatchObject({
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false,
    });
    expect(byName['sf_t028_rt']).toMatchObject({
      rolcanlogin: true,
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  it('PUBLIC holds nothing; sf_app holds no DML on authoritative tables', async () => {
    const { rows } = await h.admin.query(
      `SELECT c.relname,
              has_table_privilege('sf_app', c.oid, 'SELECT') AS app_select,
              has_table_privilege('sf_app', c.oid, 'UPDATE') AS app_update,
              has_table_privilege('sf_app', c.oid, 'DELETE') AS app_delete,
              has_table_privilege('sf_app', c.oid, 'INSERT') AS app_insert
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_appeal' AND c.relname IN ('appeal', 'appeal_history', 'assist_note', 'idempotency_record')`,
    );
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r).toMatchObject({
        app_select: false,
        app_update: false,
        app_delete: false,
        app_insert: false,
      });
    }
  });

  it('down then up is reversible and leaves the role in place', async () => {
    migrate('down', FROM_CMP028);
    const gone = await h.admin.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_appeal'`);
    expect(gone.rows).toHaveLength(0);
    const role = await h.admin.query(`SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp028_rw'`);
    expect(role.rows).toHaveLength(1);
    migrate('up');
    const back = await h.admin.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_appeal'`);
    expect(back.rows).toHaveLength(1);
  });
});
