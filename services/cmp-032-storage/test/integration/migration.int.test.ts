import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-032 migration', () => {
  it('creates sf_storage schema, privilege role, FORCE RLS tables', async () => {
    const schema = await h.admin.query(
      `SELECT nspname FROM pg_namespace WHERE nspname = 'sf_storage'`,
    );
    expect(schema.rowCount).toBe(1);
    const role = await h.admin.query(
      `SELECT rolname, rolcanlogin, rolbypassrls, rolsuper
         FROM pg_roles WHERE rolname = 'sf_cmp032_rw'`,
    );
    expect(role.rows[0]?.['rolcanlogin']).toBe(false);
    expect(role.rows[0]?.['rolbypassrls']).toBe(false);
    expect(role.rows[0]?.['rolsuper']).toBe(false);

    const tables = await h.admin.query<{ relname: string; rls: boolean; force: boolean }>(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_storage' AND c.relkind = 'r'
          AND c.relname IN ('object_metadata','storage_policy','idempotency_record','outbox_event','inbox_event')`,
    );
    expect(tables.rowCount).toBe(5);
    for (const t of tables.rows) {
      expect(t.rls, t.relname).toBe(true);
      expect(t.force, t.relname).toBe(true);
    }
  });
});
