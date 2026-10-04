import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-011 migration', () => {
  it('creates sf_evidence, the NOLOGIN privilege role and FORCE RLS on every tenant-scoped table', async () => {
    const schema = await h.admin.query(
      `SELECT nspname FROM pg_namespace WHERE nspname = 'sf_evidence'`,
    );
    expect(schema.rowCount).toBe(1);
    const role = await h.admin.query(
      `SELECT rolcanlogin, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'sf_cmp011_rw'`,
    );
    expect(role.rows[0]).toEqual({ rolcanlogin: false, rolbypassrls: false, rolsuper: false });

    const tables = await h.admin.query<{
      relname: string;
      rls: boolean;
      force: boolean;
      owner: string;
    }>(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force, pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_evidence' AND c.relkind = 'r'
          AND c.relname IN ('evidence_policy','evidence_resolution','idempotency_record','outbox_event','inbox_event')`,
    );
    expect(tables.rowCount).toBe(5);
    for (const t of tables.rows) {
      expect(t.rls, t.relname).toBe(true);
      expect(t.force, t.relname).toBe(true);
      expect(t.owner, t.relname).toBe('sf_migrator');
    }
  });

  it('keeps every sf_evidence table covered by an isolation declaration class', async () => {
    const all = await h.admin.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_evidence' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(all.rows.map((r) => r.relname)).toEqual([
      'evidence_policy',
      'evidence_resolution',
      'idempotency_record',
      'inbox_event',
      'inbox_event_platform',
      'outbox_event',
      'outbox_event_platform',
    ]);
  });

  it('grants the privilege role least privilege (no DELETE on policy/resolution, no PUBLIC access)', async () => {
    const grants = await h.admin.query<{
      table_name: string;
      privilege_type: string;
      grantee: string;
    }>(
      `SELECT table_name, privilege_type, grantee FROM information_schema.table_privileges
        WHERE table_schema = 'sf_evidence' AND table_name IN ('evidence_policy','evidence_resolution')`,
    );
    const rw = grants.rows.filter((g) => g.grantee === 'sf_cmp011_rw');
    expect(rw.some((g) => g.privilege_type === 'DELETE')).toBe(false);
    expect(rw.some((g) => g.privilege_type === 'TRUNCATE')).toBe(false);
    expect(grants.rows.some((g) => g.grantee === 'PUBLIC')).toBe(false);
    expect(
      rw
        .filter((g) => g.table_name === 'evidence_resolution')
        .map((g) => g.privilege_type)
        .sort(),
    ).toEqual(['INSERT', 'SELECT']);
  });
});
