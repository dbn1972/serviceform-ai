import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-008 migration', () => {
  it('creates sf_rules, the NOLOGIN privilege role and FORCE RLS on every tenant table', async () => {
    const role = await h.admin.query(
      `SELECT rolcanlogin, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'sf_cmp008_rw'`,
    );
    expect(role.rows[0]).toEqual({ rolcanlogin: false, rolbypassrls: false, rolsuper: false });
    const tables = await h.admin.query<{
      relname: string;
      rls: boolean;
      force: boolean;
      owner: string;
    }>(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
              pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_rules' AND c.relkind = 'r'
          AND c.relname IN ('rule_pack_snapshot','evaluation_record','idempotency_record','outbox_event','inbox_event')`,
    );
    expect(tables.rowCount).toBe(5);
    for (const t of tables.rows) {
      expect(t.rls, t.relname).toBe(true);
      expect(t.force, t.relname).toBe(true);
      expect(t.owner, t.relname).toBe('sf_migrator');
    }
  });

  it('PUBLIC has no privileges on the schema or tables', async () => {
    const res = await h.admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.role_table_grants
        WHERE table_schema = 'sf_rules' AND grantee = 'PUBLIC'`,
    );
    expect(res.rows[0]?.n).toBe('0');
    const usage = await h.admin.query<{ ok: boolean }>(
      `SELECT has_schema_privilege('public', 'sf_rules', 'USAGE') AS ok`,
    );
    expect(usage.rows[0]?.ok).toBe(false);
  });
});
