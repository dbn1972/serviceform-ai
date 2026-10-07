import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR,
  M05_RW_ROLES,
  M05_SCHEMAS,
  OFFICER_T1,
  T1,
  T2,
  asTenant,
  createLogin,
  dropRoles,
  ensurePeerGroupRoles,
  migrateUp,
  rolePassword,
  runtimePool,
  withAdmin,
} from './pg-harness.js';

const ROLES = [
  'sf_m05rls_015',
  'sf_m05rls_016',
  'sf_m05rls_017',
  'sf_m05rls_018',
  'sf_m05rls_019',
  'sf_m05rls_027',
  'sf_m05rls_028',
  'sf_m05rls_029',
  'sf_m05rls_peer',
] as const;

const ROLE_TO_RW = {
  sf_m05rls_015: 'sf_cmp015_rw',
  sf_m05rls_016: 'sf_cmp016_rw',
  sf_m05rls_017: 'sf_cmp017_rw',
  sf_m05rls_018: 'sf_cmp018_rw',
  sf_m05rls_019: 'sf_cmp019_rw',
  sf_m05rls_027: 'sf_cmp027_rw',
  sf_m05rls_028: 'sf_cmp028_rw',
  sf_m05rls_029: 'sf_cmp029_rw',
} as const;

const SCHEMA_PROBE: Record<(typeof M05_SCHEMAS)[number], string> = {
  sf_application_case: 'application_case',
  sf_workflow: 'workflow_version',
  sf_tasks: 'human_task',
  sf_inspection: 'inspection',
  sf_deficiency: 'deficiency_notice',
  sf_grievance: 'grievance',
  sf_appeal: 'appeal',
  sf_sla: 'sla_clock',
};

function requirePool(
  map: Map<string, ReturnType<typeof runtimePool>>,
  login: string,
): ReturnType<typeof runtimePool> {
  const pool = map.get(login);
  if (pool === undefined) throw new Error(`missing LOGIN pool ${login}`);
  return pool;
}

describe('INT-011 M05 LOGIN RLS catalog (independent)', () => {
  const password = rolePassword();
  const leaks: string[] = [];
  const pools = new Map<string, ReturnType<typeof runtimePool>>();

  beforeAll(async () => {
    await withAdmin(async (c) => {
      await dropRoles(c, ROLES);
    });
    migrateUp();
    await withAdmin(async (c) => {
      await ensurePeerGroupRoles(c);
      for (const [login, rw] of Object.entries(ROLE_TO_RW)) {
        await createLogin(c, login, rw, password);
      }
      await createLogin(c, 'sf_m05rls_peer', 'sf_cmp048_rw', password);
    });
    for (const login of Object.keys(ROLE_TO_RW)) {
      pools.set(login, runtimePool(login, password));
    }
    pools.set('sf_m05rls_peer', runtimePool('sf_m05rls_peer', password));
  }, 180_000);

  afterAll(async () => {
    await Promise.all([...pools.values()].map((p) => p.end()));
    const leakage = leaks.length;
    process.env['CROSS_TENANT_LEAKAGE'] = String(leakage);
    mkdirSync('test-results/m05-int', { recursive: true });
    writeFileSync(
      'test-results/m05-int/cross-tenant.json',
      JSON.stringify(
        {
          CROSS_TENANT_LEAKAGE: leakage,
          leaks,
          commit_sha: process.env['M05_COMMIT_SHA'] ?? '',
          production_base: process.env['M05_PRODUCTION_BASE'] ?? '',
        },
        null,
        2,
      ) + '\n',
    );
  });

  it('runtime identities are non-owner, not SUPERUSER, no BYPASSRLS; M05 schemas FORCE RLS', async () => {
    for (const login of Object.keys(ROLE_TO_RW)) {
      const pool = requirePool(pools, login);
      const client = await pool.connect();
      try {
        const id = await client.query<{
          rolsuper: boolean;
          rolbypassrls: boolean;
          session_user: string;
        }>(
          `SELECT r.rolsuper, r.rolbypassrls, session_user
             FROM pg_roles r WHERE r.rolname = session_user`,
        );
        expect(id.rows[0]?.rolsuper, login).toBe(false);
        expect(id.rows[0]?.rolbypassrls, login).toBe(false);
        expect(id.rows[0]?.session_user).toBe(login);
      } finally {
        client.release();
      }
    }

    await withAdmin(async (c) => {
      for (const schema of M05_SCHEMAS) {
        const rows = await c.query<{ relname: string; forced: boolean; rls: boolean }>(
          `SELECT c.relname, c.relforcerowsecurity AS forced, c.relrowsecurity AS rls
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relkind = 'r' AND c.relname = $2`,
          [schema, SCHEMA_PROBE[schema]],
        );
        expect(rows.rows[0]?.rls, `${schema}.${SCHEMA_PROBE[schema]}`).toBe(true);
        expect(rows.rows[0]?.forced, `${schema}.${SCHEMA_PROBE[schema]}`).toBe(true);
      }
      for (const role of M05_RW_ROLES) {
        const r = await c.query<{ rolcanlogin: boolean; rolbypassrls: boolean }>(
          `SELECT rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = $1`,
          [role],
        );
        expect(r.rows[0]?.rolcanlogin, role).toBe(false);
        expect(r.rows[0]?.rolbypassrls, role).toBe(false);
      }
    });
  });

  it('CMP-019 deficiency_notice hides T1 rows from T2 (CROSS_TENANT_LEAKAGE=0)', async () => {
    const p019 = requirePool(pools, 'sf_m05rls_019');
    const defId = randomUUID();
    const appId = randomUUID();
    const corr = randomUUID();
    const now = new Date().toISOString();
    await asTenant(p019, T1, OFFICER_T1, async (c) => {
      await c.query(
        `INSERT INTO sf_deficiency.deficiency_notice (
           tenant_id, deficiency_id, application_id, cell_id, status, reason_code, notice_code,
           instruction_ref, opened_at, opened_by, correlation_id, aggregate_version
         ) VALUES ($1,$2,$3,'cell-01','OPEN','MISSING_DOC','N1','ref-1',$4,$5,$6,1)`,
        [T1, defId, appId, now, OFFICER_T1, corr],
      );
    });
    const seen = await asTenant(p019, T2, OFFICER_T1, async (c) => {
      const r = await c.query(
        `SELECT deficiency_id FROM sf_deficiency.deficiency_notice WHERE deficiency_id = $1`,
        [defId],
      );
      return r.rowCount ?? 0;
    });
    if (seen > 0) leaks.push('CMP-019 deficiency_notice');
    expect(seen).toBe(0);

    await asTenant(p019, T2, OFFICER_T1, async (c) => {
      await expect(
        c.query(
          `INSERT INTO sf_deficiency.deficiency_notice (
             tenant_id, deficiency_id, application_id, cell_id, status, reason_code, notice_code,
             instruction_ref, opened_at, opened_by, correlation_id, aggregate_version
           ) VALUES ($1,$2,$3,'cell-01','OPEN','MISSING_DOC','N2','ref-2',$4,$5,$6,1)`,
          [T1, randomUUID(), randomUUID(), now, OFFICER_T1, randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('peer privilege role cannot SELECT deficiency_notice', async () => {
    const peer = requirePool(pools, 'sf_m05rls_peer');
    await asTenant(peer, T1, ACTOR, async (c) => {
      await expect(
        c.query(`SELECT deficiency_id FROM sf_deficiency.deficiency_notice LIMIT 1`),
      ).rejects.toThrow();
    });
  });
});
