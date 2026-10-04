import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

let h: Harness;

describe('CMP-053 migration static + live checks', () => {
  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('creates schema, privilege role, FORCE RLS, and sf_migrator ownership', async () => {
    const present = await h.admin.query(
      "SELECT 1 FROM pg_namespace WHERE nspname = 'sf_localization'",
    );
    expect(present.rowCount).toBe(1);
    const role = await h.admin.query(
      `SELECT rolname, rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = 'sf_cmp053_rw'`,
    );
    expect(role.rows[0]).toMatchObject({
      rolname: 'sf_cmp053_rw',
      rolcanlogin: false,
      rolbypassrls: false,
    });
    const rls = await h.admin.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_localization'
          AND c.relkind = 'r'
          AND c.relname IN ('locale','catalog','catalog_version','message','format_profile')`,
    );
    expect(rls.rows.length).toBe(5);
    expect(rls.rows.every((r) => r.relforcerowsecurity)).toBe(true);
    const owner = await h.admin.query(
      `SELECT tableowner FROM pg_tables
        WHERE schemaname = 'sf_localization' AND tablename = 'catalog'`,
    );
    expect(owner.rows[0]?.tableowner).toBe('sf_migrator');
  });
});
