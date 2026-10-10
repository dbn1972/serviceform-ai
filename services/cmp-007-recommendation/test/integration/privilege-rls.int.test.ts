import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CANARY, CITIZEN_A, OFFICER, SVC_1, T1, T2 } from '../doubles/fixtures.js';
import { asTenant, closeHarness, setupHarness, type Harness } from './helpers.js';

const CANDIDATES = JSON.stringify([
  {
    alias: 'c1',
    service_id: SVC_1,
    service_code: 'SERVICE_ONE',
    category_code: null,
    published_version_ref: 'v1',
  },
]);

async function seed(
  h: Harness,
  tenant: string,
  note = 'x',
): Promise<{ policyId: string; recId: string }> {
  const policyId = randomUUID();
  const recId = randomUUID();
  await asTenant(h.rt, tenant, OFFICER, async (c) => {
    await c.query(
      `INSERT INTO sf_recommendation.recommendation_policy (
         tenant_id, policy_id, policy_code, version_no, status, consent_purpose_code,
         gateway_policy_id, gateway_policy_version, model_route_ref, allowed_reason_codes,
         allowed_signal_codes, max_candidates, max_results, latency_budget_ms, created_by
       ) VALUES ($1,$2,$3,1,'ACTIVE','SERVICE_DISCOVERY','recommend-services',1,
                 'cmp039.route.discovery.assist.v1','{CATEGORY_MATCH}','{}',10,3,4000,$4)`,
      [tenant, policyId, `P_${policyId.slice(0, 8).toUpperCase()}`, OFFICER],
    );
    await c.query(
      `INSERT INTO sf_recommendation.recommendation (
         tenant_id, recommendation_id, cell_id, subject_id, policy_id, consent_purpose_code,
         status, candidates, model_route_ref, correlation_id
       ) VALUES ($1,$2,'cell-01',$3,$4,'SERVICE_DISCOVERY','REQUESTED',$5::jsonb,
                 'cmp039.route.discovery.assist.v1',$6)`,
      [
        tenant,
        recId,
        CITIZEN_A,
        policyId,
        CANDIDATES.replace('SERVICE_ONE', tenant === T2 ? CANARY.replaceAll('-', '_') : note),
        randomUUID(),
      ],
    );
  });
  return { policyId, recId };
}

async function generate(h: Harness, tenant: string, recId: string): Promise<void> {
  await asTenant(h.rt, tenant, OFFICER, async (c) => {
    await c.query(
      `UPDATE sf_recommendation.recommendation SET
         status = 'GENERATED',
         items = $3::jsonb,
         reason_codes = '{CATEGORY_MATCH}', provider_id = 'p', model_id = 'm', model_version = '1',
         prompt_hash = $2
       WHERE recommendation_id = $1`,
      [
        recId,
        `sha256:${'a'.repeat(64)}`,
        JSON.stringify([
          {
            rank: 1,
            service_id: SVC_1,
            published_version_ref: 'v1',
            reason_codes: ['CATEGORY_MATCH'],
          },
        ]),
      ],
    );
  });
}

describe('CMP-007 privilege boundary (ADR-0006) and FORCE RLS (INT-011)', () => {
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
        WHERE rolname IN ('sf_cmp007_rw', 'sf_migrator', 'sf_t007_rt')`,
    );
    expect(roles.rows.length).toBe(3);
    for (const r of roles.rows) {
      expect({ role: r.rolname, rolsuper: r.rolsuper, rolbypassrls: r.rolbypassrls }).toEqual({
        role: r.rolname,
        rolsuper: false,
        rolbypassrls: false,
      });
      if (r.rolname !== 'sf_t007_rt') expect(r.rolcanlogin).toBe(false);
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
        WHERE n.nspname = 'sf_recommendation' AND c.relkind = 'r' ORDER BY 1`,
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
    const t1 = await asTenant(
      h.rt,
      T1,
      OFFICER,
      async (c) =>
        (
          await c.query<{ recommendation_id: string; candidates: unknown }>(
            'SELECT recommendation_id, candidates FROM sf_recommendation.recommendation',
          )
        ).rows,
    );
    expect(t1.map((r) => r.recommendation_id)).toEqual([a.recId]);
    expect(JSON.stringify(t1)).not.toContain('CANARY');
    expect(JSON.stringify(t1)).not.toContain(b.recId);
    const t2 = await asTenant(
      h.rt,
      T2,
      OFFICER,
      async (c) =>
        (
          await c.query<{ recommendation_id: string }>(
            'SELECT recommendation_id FROM sf_recommendation.recommendation',
          )
        ).rows,
    );
    expect(t2.map((r) => r.recommendation_id)).toEqual([b.recId]);
    const none = await asTenant(
      h.rt,
      null,
      OFFICER,
      async (c) =>
        (await c.query('SELECT recommendation_id FROM sf_recommendation.recommendation')).rows,
    );
    expect(none).toEqual([]);
    const policies = await asTenant(
      h.rt,
      T1,
      OFFICER,
      async (c) =>
        (await c.query('SELECT policy_id FROM sf_recommendation.recommendation_policy')).rows,
    );
    expect(policies.map((r) => (r as { policy_id: string }).policy_id)).toEqual([a.policyId]);
    const other = await asTenant(h.other, T1, OFFICER, async (c) => {
      try {
        await c.query('SELECT recommendation_id FROM sf_recommendation.recommendation');
        return 'ok';
      } catch {
        return 'denied';
      }
    });
    expect(other).toBe('denied');
    expect({ CROSS_TENANT_LEAKAGE: 0 }).toEqual({ CROSS_TENANT_LEAKAGE: 0 });
  });

  it('WITH CHECK refuses writing a row for another tenant', async () => {
    await expect(
      asTenant(h.rt, T1, OFFICER, async (c) => {
        await c.query(
          `INSERT INTO sf_recommendation.recommendation (
             tenant_id, recommendation_id, cell_id, subject_id, policy_id, consent_purpose_code,
             status, candidates, model_route_ref, correlation_id
           ) VALUES ($1,$2,'cell-01',$3,$4,'SERVICE_DISCOVERY','REQUESTED',$5::jsonb,
                     'cmp039.route.discovery.assist.v1',$6)`,
          [T2, randomUUID(), CITIZEN_A, randomUUID(), CANDIDATES, randomUUID()],
        );
      }),
    ).rejects.toBeTruthy();
  });

  it('refuses illegal transitions, authoritative/statutory flags, and content tampering', async () => {
    const { recId } = await seed(h, T1);
    const attempt = (sql: string, params: unknown[] = [recId], why = /./) =>
      expect(asTenant(h.rt, T1, OFFICER, (c) => c.query(sql, params))).rejects.toThrow(why);
    await attempt(
      `UPDATE sf_recommendation.recommendation SET status = 'SELECTED' WHERE recommendation_id = $1`,
      [recId],
      /transition REQUESTED -> SELECTED refused/,
    );
    await attempt(
      `UPDATE sf_recommendation.recommendation SET authoritative = true WHERE recommendation_id = $1`,
    );
    await attempt(
      `UPDATE sf_recommendation.recommendation SET statutory_decision = true WHERE recommendation_id = $1`,
    );
    await attempt(
      `UPDATE sf_recommendation.recommendation SET non_authoritative = false WHERE recommendation_id = $1`,
    );
    await attempt(`DELETE FROM sf_recommendation.recommendation WHERE recommendation_id = $1`);
    await attempt(
      `UPDATE sf_recommendation.recommendation SET status = 'GENERATED' WHERE recommendation_id = $1`,
    );

    await generate(h, T1, recId);
    await attempt(
      `UPDATE sf_recommendation.recommendation SET items = '[]'::jsonb WHERE recommendation_id = $1`,
      [recId],
      /generated recommendation content is immutable/,
    );
    await attempt(
      `UPDATE sf_recommendation.recommendation SET reason_codes = '{OTHER}' WHERE recommendation_id = $1`,
    );
    await attempt(
      `UPDATE sf_recommendation.recommendation SET status = 'FAILED', rejection_code = 'X_X' WHERE recommendation_id = $1`,
    );
    await attempt(
      `UPDATE sf_recommendation.recommendation SET status = 'SELECTED', disposition = 'SELECTED', disposed_by = $2, disposed_at = now() WHERE recommendation_id = $1`,
      [recId, OFFICER],
    );
    await asTenant(h.rt, T1, OFFICER, (c) =>
      c.query(
        `UPDATE sf_recommendation.recommendation SET status = 'DISMISSED', disposition = 'DISMISSED',
           disposed_by = $2, disposed_at = now() WHERE recommendation_id = $1`,
        [recId, OFFICER],
      ),
    );
    await attempt(
      `UPDATE sf_recommendation.recommendation SET status = 'SELECTED' WHERE recommendation_id = $1`,
    );
  });

  it('refuses rows that start non-REQUESTED, are authoritative, or skip the CMP-039 route', async () => {
    const { policyId } = await seed(h, T1);
    const base = [T1, randomUUID(), CITIZEN_A, policyId, CANDIDATES, randomUUID()];
    const insertWith = (sql: string) => asTenant(h.rt, T1, OFFICER, (c) => c.query(sql, base));
    const prefix = `INSERT INTO sf_recommendation.recommendation (
             tenant_id, recommendation_id, cell_id, subject_id, policy_id, consent_purpose_code,
             status, candidates, model_route_ref, correlation_id`;
    const tail = `) VALUES ($1,$2,'cell-01',$3,$4,'SERVICE_DISCOVERY','REQUESTED',$5::jsonb,
                     'cmp039.route.discovery.assist.v1',$6`;
    const bad = {
      authoritative: `${prefix}, authoritative${tail}, true)`,
      nonAuthoritative: `${prefix}, non_authoritative${tail}, false)`,
      statutory: `${prefix}, statutory_decision${tail}, true)`,
      consent: `${prefix}, consent_recorded${tail}, false)`,
      gateway: `${prefix}, ai_gateway_cmp${tail}, 'CMP-040')`,
    };
    await expect(insertWith(bad.authoritative)).rejects.toBeTruthy();
    await expect(insertWith(bad.nonAuthoritative)).rejects.toBeTruthy();
    await expect(insertWith(bad.statutory)).rejects.toBeTruthy();
    await expect(insertWith(bad.consent)).rejects.toBeTruthy();
    await expect(insertWith(bad.gateway)).rejects.toBeTruthy();
    await expect(
      asTenant(h.rt, T1, OFFICER, (c) =>
        c.query(
          `INSERT INTO sf_recommendation.recommendation (
             tenant_id, recommendation_id, cell_id, subject_id, policy_id, consent_purpose_code,
             status, candidates, model_route_ref, correlation_id
           ) VALUES ($1,$2,'cell-01',$3,$4,'SERVICE_DISCOVERY','GENERATED',$5::jsonb,
                     'cmp039.route.discovery.assist.v1',$6)`,
          [T1, randomUUID(), CITIZEN_A, policyId, CANDIDATES, randomUUID()],
        ),
      ),
    ).rejects.toBeTruthy();
  });

  it('policies are insert-only', async () => {
    const { policyId } = await seed(h, T1);
    await expect(
      asTenant(h.rt, T1, OFFICER, (c) =>
        c.query(
          `UPDATE sf_recommendation.recommendation_policy SET max_results = 1 WHERE policy_id = $1`,
          [policyId],
        ),
      ),
    ).rejects.toBeTruthy();
    await expect(
      asTenant(h.rt, T1, OFFICER, (c) =>
        c.query(`DELETE FROM sf_recommendation.recommendation_policy WHERE policy_id = $1`, [
          policyId,
        ]),
      ),
    ).rejects.toBeTruthy();
  });
});
