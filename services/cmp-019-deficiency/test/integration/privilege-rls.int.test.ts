import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  CANARY,
  closeHarness,
  migrate,
  migrateDown,
  OFFICER,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

async function denied(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'allowed';
  } catch (e) {
    return (e as { code?: string }).code ?? 'error';
  }
}

describe('CMP-019 privilege boundary (ADR-0006) and FORCE RLS (INT-011)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('roles: NOLOGIN privilege role, no SUPERUSER/BYPASSRLS, runtime login is not the owner', async () => {
    const roles = await h.admin.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname IN ('sf_cmp019_rw', 'sf_migrator', 'sf_t019_rt')`,
    );
    expect(roles.rows).toHaveLength(3);
    for (const r of roles.rows) {
      expect(r['rolsuper']).toBe(false);
      expect(r['rolbypassrls']).toBe(false);
      if (r['rolname'] !== 'sf_t019_rt') expect(r['rolcanlogin']).toBe(false);
    }
    const tables = await h.admin.query(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relforcerowsecurity AS forced, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_deficiency' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(tables.rows.length).toBeGreaterThanOrEqual(10);
    for (const t of tables.rows) {
      expect(t['owner']).toBe('sf_migrator');
      if (!String(t['relname']).endsWith('_platform')) {
        expect(t['rls']).toBe(true);
        expect(t['forced']).toBe(true);
      }
    }
  });

  it('sf_app holds no DML on authoritative deficiency tables; peer login is denied', async () => {
    const appDml = await h.admin.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'sf_deficiency' AND grantee = 'sf_app'
          AND privilege_type IN ('UPDATE','DELETE','TRUNCATE')`,
    );
    expect(appDml.rows).toEqual([]);
    const code = await denied(() =>
      asTenant(h.other, T1, OFFICER, (c) =>
        c.query(
          `INSERT INTO sf_deficiency.deficiency_notice (
             tenant_id, deficiency_id, application_id, cell_id, status, reason_code, notice_code,
             instruction_ref, opened_at, opened_by, correlation_id
           ) VALUES ($1,$2,$3,'cell-01','OPEN','MISSING_PROOF','N1','ref:x',now(),$4,$5)`,
          [T1, randomUUID(), randomUUID(), OFFICER, randomUUID()],
        ),
      ),
    );
    expect(code).not.toBe('allowed');
  });

  it('FORCE RLS hides the other tenant; no global-tail read', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    await asTenant(h.rt, T1, OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_deficiency.deficiency_notice (
           tenant_id, deficiency_id, application_id, cell_id, status, reason_code, notice_code,
           instruction_ref, opened_at, opened_by, correlation_id
         ) VALUES ($1,$2,$3,'cell-01','OPEN','MISSING_PROOF','NOTICE_A','ref:a',now(),$4,$5)`,
        [T1, id1, randomUUID(), OFFICER, randomUUID()],
      );
    });
    await asTenant(h.rt, T2, OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_deficiency.deficiency_notice (
           tenant_id, deficiency_id, application_id, cell_id, status, reason_code, notice_code,
           instruction_ref, opened_at, opened_by, correlation_id
         ) VALUES ($1,$2,$3,'cell-01','OPEN','MISSING_PROOF','NOTICE_B','ref:b',now(),$4,$5)`,
        [T2, id2, randomUUID(), OFFICER, randomUUID()],
      );
    });
    const t1 = await asTenant(h.rt, T1, OFFICER, async (c) =>
      (await c.query(`SELECT notice_code FROM sf_deficiency.deficiency_notice`)).rows.map(
        (r) => r['notice_code'],
      ),
    );
    expect(t1).toEqual(['NOTICE_A']);
    expect(t1).not.toContain(CANARY);
    const none = await asTenant(
      h.rt,
      null,
      OFFICER,
      async (c) => (await c.query(`SELECT notice_code FROM sf_deficiency.deficiency_notice`)).rows,
    );
    expect(none).toEqual([]);
  });

  it('isolated reversibility: down of CMP-019 migrations then up restores the schema', async () => {
    migrateDown(3);
    const missing = await h.admin.query(
      `SELECT 1 FROM pg_namespace WHERE nspname = 'sf_deficiency'`,
    );
    expect(missing.rows).toEqual([]);
    migrate();
    const present = await h.admin.query(
      `SELECT 1 FROM pg_namespace WHERE nspname = 'sf_deficiency'`,
    );
    expect(present.rows).toHaveLength(1);
    const role = await h.admin.query(
      `SELECT rolcanlogin FROM pg_roles WHERE rolname = 'sf_cmp019_rw'`,
    );
    expect(role.rows[0]?.['rolcanlogin']).toBe(false);
  });
});
