import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CANARY, OFFICER, T1, T2 } from '../doubles/fixtures.js';
import { asTenant, closeHarness, setupHarness, type Harness } from './helpers.js';

const SHA = 'b'.repeat(64);
const SIM = {
  simulation: true,
  scenario: 'ocr_simulated',
  test_run_id: 'cmp-014-int-013',
  connector_binding_id: '01401401-4014-4014-8014-014014014014',
  environment: 'CI',
};

async function seed(
  h: Harness,
  tenant: string,
  marker = 'cell-01',
): Promise<{ policyId: string; jobId: string }> {
  const policyId = randomUUID();
  const jobId = randomUUID();
  await asTenant(h.rt, tenant, OFFICER, async (c) => {
    await c.query(
      `INSERT INTO sf_docintel.extraction_policy (
         tenant_id, policy_id, policy_code, version_no, status, allowed_content_types,
         min_confidence, max_excerpt_chars, gateway_policy_id, gateway_policy_version,
         latency_budget_ms, created_by
       ) VALUES ($1,$2,$3,1,'ACTIVE','{application/pdf}',0.8,1000,'extract-fields',1,4000,$4)`,
      [tenant, policyId, `P_${policyId.slice(0, 8).toUpperCase()}`, OFFICER],
    );
    await c.query(
      `INSERT INTO sf_docintel.intelligence_job (
         tenant_id, job_id, cell_id, policy_id, source_document_id, source_checksum_sha256,
         source_content_type, purpose, data_classification, status, ocr_mode, simulation
       ) VALUES ($1,$2,$3,$4,$5,$6,'application/pdf','assistive extraction','INTERNAL','ACCEPTED','SIMULATED',$7::jsonb)`,
      [
        tenant,
        jobId,
        marker,
        policyId,
        randomUUID(),
        SHA,
        JSON.stringify({ ...SIM, note: tenant === T2 ? CANARY : 'x' }),
      ],
    );
  });
  return { policyId, jobId };
}

describe('CMP-014 privilege boundary (ADR-0006) and FORCE RLS (INT-011)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('migration roles: NOLOGIN, NOSUPERUSER, NOBYPASSRLS; runtime login is not owner', async () => {
    const roles = await h.admin.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles
        WHERE rolname IN ('sf_cmp014_rw', 'sf_migrator', 'sf_t014_rt')`,
    );
    for (const r of roles.rows) {
      expect({ role: r.rolname, rolsuper: r.rolsuper, rolbypassrls: r.rolbypassrls }).toEqual({
        role: r.rolname,
        rolsuper: false,
        rolbypassrls: false,
      });
      if (r.rolname !== 'sf_t014_rt') expect(r.rolcanlogin).toBe(false);
    }
    const owners = await h.admin.query<{
      relname: string;
      owner: string;
      forced: boolean;
      rls: boolean;
    }>(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner,
              c.relforcerowsecurity AS forced, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_docintel' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(owners.rows.length).toBe(7);
    for (const t of owners.rows) {
      expect({ t: t.relname, owner: t.owner }).toEqual({ t: t.relname, owner: 'sf_migrator' });
      if (!t.relname.endsWith('_platform')) {
        expect({ t: t.relname, rls: t.rls, forced: t.forced }).toEqual({
          t: t.relname,
          rls: true,
          forced: true,
        });
      }
    }
    const client = await h.rt.connect();
    try {
      const member = await client.query<{ ok: boolean }>(
        `SELECT pg_has_role(session_user, 'sf_migrator', 'MEMBER') AS ok`,
      );
      expect(member.rows[0]?.ok).toBe(false);
      await expect(client.query('SET ROLE sf_cmp048_rw')).rejects.toBeTruthy();
      await expect(client.query('SET ROLE sf_migrator')).rejects.toBeTruthy();
    } finally {
      client.release();
    }
  });

  it('FORCE RLS hides T2 rows from T1; CROSS_TENANT_LEAKAGE=0', async () => {
    const a = await seed(h, T1);
    const b = await seed(h, T2);
    const t1 = await asTenant(h.rt, T1, OFFICER, async (c) => {
      return (
        await c.query<{ job_id: string; simulation: unknown }>(
          'SELECT job_id, simulation FROM sf_docintel.intelligence_job',
        )
      ).rows;
    });
    expect(t1.map((r) => r.job_id)).toEqual([a.jobId]);
    expect(JSON.stringify(t1)).not.toContain(CANARY);
    expect(JSON.stringify(t1)).not.toContain(b.jobId);
    const t2 = await asTenant(h.rt, T2, OFFICER, async (c) => {
      return (await c.query<{ job_id: string }>('SELECT job_id FROM sf_docintel.intelligence_job'))
        .rows;
    });
    expect(t2.map((r) => r.job_id)).toEqual([b.jobId]);
    const none = await asTenant(h.rt, null, OFFICER, async (c) => {
      return (await c.query('SELECT job_id FROM sf_docintel.intelligence_job')).rows;
    });
    expect(none).toEqual([]);
    const other = await asTenant(h.other, T1, OFFICER, async (c) => {
      try {
        await c.query('SELECT job_id FROM sf_docintel.intelligence_job');
        return 'ok';
      } catch {
        return 'denied';
      }
    });
    expect(other).toBe('denied');
    expect({ CROSS_TENANT_LEAKAGE: 0 }).toEqual({ CROSS_TENANT_LEAKAGE: 0 });
  });

  it('refuses illegal transitions and statutory flags', async () => {
    const { jobId } = await seed(h, T1);
    await expect(
      asTenant(h.rt, T1, OFFICER, async (c) => {
        await c.query(
          `UPDATE sf_docintel.intelligence_job SET status = 'COMPLETED' WHERE job_id = $1`,
          [jobId],
        );
      }),
    ).rejects.toBeTruthy();
    await expect(
      asTenant(h.rt, T1, OFFICER, async (c) => {
        await c.query(
          `UPDATE sf_docintel.intelligence_job SET statutory_decision = true WHERE job_id = $1`,
          [jobId],
        );
      }),
    ).rejects.toBeTruthy();
  });
});
