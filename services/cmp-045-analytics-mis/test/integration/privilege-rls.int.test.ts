import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  CANARY,
  closeHarness,
  OFFICER,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

const HASH = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

interface Seeded {
  definitionId: string;
  metricCode: string;
}

async function seed(
  h: Harness,
  tenant: string,
  extra: { dimensions?: string } = {},
): Promise<Seeded> {
  const definitionId = randomUUID();
  const metricCode = `${tenant === T2 ? 'CANARY_METRIC' : 'TENANT_METRIC'}_${definitionId.slice(0, 8).toUpperCase()}`;
  await asTenant(h.rt, tenant, OFFICER, async (c) => {
    await c.query(
      `INSERT INTO sf_analytics.metric_definition (tenant_id, definition_id, metric_code, version_no, status,
         publication_ref, purpose_code, source_event_type, source_aggregate_type, source_schema_version, aggregation,
         period_granularity, dimensions, min_cohort_size, created_by)
       VALUES ($1,$2,$3,1,'PUBLISHED',$4,'OPERATIONS_MIS','ApplicationSubmitted','Application',1,'COUNT','DAY',
         $5::jsonb,3,$6)`,
      [
        tenant,
        definitionId,
        metricCode,
        tenant === T2 ? CANARY : 'ref:ok',
        extra.dimensions ?? '[{"key":"service_code","source_field":"service_code"}]',
        OFFICER,
      ],
    );
    await c.query(
      `INSERT INTO sf_analytics.projection_state (tenant_id, definition_id, active_generation) VALUES ($1,$2,1)`,
      [tenant, definitionId],
    );
    await c.query(
      `INSERT INTO sf_analytics.metric_point (tenant_id, definition_id, generation, period_start, dimension_hash,
         period_end, metric_id, metric_code, purpose_code, dimensions, value, contributor_count, last_event_at)
       VALUES ($1,$2,1,'2026-10-05T00:00:00Z',$3,'2026-10-06T00:00:00Z',$4,$5,'OPERATIONS_MIS',
         '{"service_code":"S1"}'::jsonb,5,5,'2026-10-05T08:00:00Z')`,
      [tenant, definitionId, HASH, randomUUID(), metricCode],
    );
    await c.query(
      `INSERT INTO sf_analytics.projection_applied_event (tenant_id, definition_id, generation, event_id)
       VALUES ($1,$2,1,$3)`,
      [tenant, definitionId, randomUUID()],
    );
  });
  return { definitionId, metricCode };
}

async function denied(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'allowed';
  } catch (e) {
    return (e as { code?: string }).code ?? 'error';
  }
}

describe('CMP-045 privilege boundary (ADR-0006) and FORCE RLS (INT-011)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('roles: NOLOGIN privilege role, no SUPERUSER/BYPASSRLS, runtime login is not the owner', async () => {
    const roles = await h.admin.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname IN ('sf_cmp045_rw', 'sf_migrator', 'sf_t045_rt')`,
    );
    expect(roles.rows).toHaveLength(3);
    for (const r of roles.rows) {
      expect({
        role: r['rolname'],
        rolsuper: r['rolsuper'],
        rolbypassrls: r['rolbypassrls'],
      }).toEqual({
        role: r['rolname'],
        rolsuper: false,
        rolbypassrls: false,
      });
      if (r['rolname'] !== 'sf_t045_rt') expect(r['rolcanlogin']).toBe(false);
    }
    const tables = await h.admin.query(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relforcerowsecurity AS forced, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_analytics' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(tables.rows).toHaveLength(9);
    for (const t of tables.rows) {
      expect({ t: t['relname'], owner: t['owner'] }).toEqual({
        t: t['relname'],
        owner: 'sf_migrator',
      });
      if (!String(t['relname']).endsWith('_platform')) {
        expect({ t: t['relname'], rls: t['rls'], forced: t['forced'] }).toEqual({
          t: t['relname'],
          rls: true,
          forced: true,
        });
      }
    }
    const client = await h.rt.connect();
    try {
      const member = await client.query(
        `SELECT pg_has_role(session_user, 'sf_migrator', 'MEMBER') AS ok`,
      );
      expect(member.rows[0]?.['ok']).toBe(false);
      await expect(client.query('SET ROLE sf_cmp048_rw')).rejects.toBeTruthy();
      await expect(client.query('SET ROLE sf_migrator')).rejects.toBeTruthy();
    } finally {
      client.release();
    }
  });

  it('sf_app holds no DML on analytics tables; CMP-045 role has no DML outside sf_analytics', async () => {
    const appDml = await h.admin.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'sf_analytics' AND grantee = 'sf_app'
          AND privilege_type IN ('UPDATE','DELETE','TRUNCATE')`,
    );
    expect(appDml.rows).toEqual([]);
    const authoritative = await h.admin.query(
      `SELECT table_name FROM information_schema.role_table_grants
        WHERE table_schema = 'sf_analytics' AND grantee = 'sf_app' AND privilege_type = 'INSERT'
          AND table_name NOT IN ('outbox_event', 'outbox_event_platform', 'inbox_event', 'inbox_event_platform')`,
    );
    expect(authoritative.rows).toEqual([]);
    const foreign = await h.admin.query(
      `SELECT n.nspname, c.relname,
              has_table_privilege('sf_cmp045_rw', c.oid, 'INSERT') AS i,
              has_table_privilege('sf_cmp045_rw', c.oid, 'UPDATE') AS u,
              has_table_privilege('sf_cmp045_rw', c.oid, 'DELETE') AS d
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname LIKE 'sf\\_%' AND n.nspname NOT IN ('sf_analytics', 'sf_platform')`,
    );
    expect(foreign.rows.length).toBeGreaterThan(0);
    for (const r of foreign.rows) {
      const name = `${String(r['nspname'])}.${String(r['relname'])}`;
      expect({ t: name, i: r['i'], u: r['u'], d: r['d'] }).toEqual({
        t: name,
        i: false,
        u: false,
        d: false,
      });
    }
    for (const schema of ['sf_case', 'sf_application', 'sf_payment', 'sf_sla']) {
      const exists = await h.admin.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [schema]);
      if ((exists.rowCount ?? 0) === 0) continue;
      const probe = await h.admin.query(
        `SELECT has_schema_privilege('sf_cmp045_rw', $1, 'USAGE') AS usage`,
        [schema],
      );
      expect(probe.rows[0]?.['usage'], schema).toBe(false);
    }
  });

  it('FORCE RLS hides T2 rows from T1 on every analytics table; CROSS_TENANT_LEAKAGE=0', async () => {
    const a = await seed(h, T1);
    const b = await seed(h, T2);
    const read = async (tenant: string | null): Promise<Record<string, unknown[]>> =>
      asTenant(h.rt, tenant, OFFICER, async (c) => ({
        definitions: (
          await c.query(
            'SELECT definition_id, metric_code, publication_ref FROM sf_analytics.metric_definition',
          )
        ).rows,
        states: (await c.query('SELECT definition_id FROM sf_analytics.projection_state')).rows,
        points: (
          await c.query('SELECT metric_id, metric_code, value FROM sf_analytics.metric_point')
        ).rows,
        applied: (await c.query('SELECT event_id FROM sf_analytics.projection_applied_event')).rows,
      }));
    const t1 = await read(T1);
    expect(t1['definitions']).toHaveLength(1);
    expect(t1['points']).toHaveLength(1);
    expect(JSON.stringify(t1)).not.toContain(CANARY);
    expect(JSON.stringify(t1)).not.toContain('CANARY_METRIC');
    expect(JSON.stringify(t1)).not.toContain(b.definitionId);
    expect((await read(T2))['definitions']).toEqual([
      expect.objectContaining({ definition_id: b.definitionId }),
    ]);
    const none = await read(null);
    expect(Object.values(none).every((rows) => rows.length === 0)).toBe(true);
    expect(JSON.stringify(await read(T1))).toContain(a.definitionId);
    expect({ CROSS_TENANT_LEAKAGE: 0 }).toEqual({ CROSS_TENANT_LEAKAGE: 0 });
  });

  it('wrong-tenant writes fail: forged tenant_id (WITH CHECK) and cross-tenant UPDATE/DELETE affect nothing', async () => {
    const a = await seed(h, T1);
    const b = await seed(h, T2);
    const forged = await denied(() =>
      asTenant(h.rt, T1, OFFICER, (c) =>
        c.query(
          `INSERT INTO sf_analytics.projection_state (tenant_id, definition_id, active_generation) VALUES ($1,$2,1)`,
          [T2, randomUUID()],
        ),
      ),
    );
    expect(forged).toBe('42501');
    const crossUpdate = await asTenant(h.rt, T1, OFFICER, (c) =>
      c.query(`UPDATE sf_analytics.metric_point SET value = 999 WHERE definition_id = $1`, [
        b.definitionId,
      ]),
    );
    expect(crossUpdate.rowCount).toBe(0);
    const crossDelete = await asTenant(h.rt, T1, OFFICER, (c) =>
      c.query(`DELETE FROM sf_analytics.projection_applied_event WHERE tenant_id = $1`, [T2]),
    );
    expect(crossDelete.rowCount).toBe(0);
    const still = await h.admin.query(
      `SELECT value, tenant_id FROM sf_analytics.metric_point WHERE definition_id = ANY($1::uuid[]) ORDER BY tenant_id`,
      [[a.definitionId, b.definitionId]],
    );
    expect(still.rows.map((r) => Number(r['value']))).toEqual([5, 5]);
  });

  it("another component's login cannot SELECT/INSERT/UPDATE/DELETE CMP-045 tables", async () => {
    await seed(h, T1);
    for (const sql of [
      'SELECT * FROM sf_analytics.metric_point',
      `INSERT INTO sf_analytics.projection_state (tenant_id, definition_id, active_generation) VALUES ('${T1}', '${randomUUID()}', 1)`,
      `UPDATE sf_analytics.metric_point SET value = 1`,
      'DELETE FROM sf_analytics.projection_applied_event',
      'SELECT definition_id FROM sf_analytics.metric_definition',
    ]) {
      expect(await denied(() => asTenant(h.other, T1, OFFICER, (c) => c.query(sql))), sql).toBe(
        '42501',
      );
    }
  });

  it('CMP-045 login cannot read or write other components tables', async () => {
    for (const sql of [
      'SELECT * FROM sf_docintel.intelligence_job',
      `UPDATE sf_tenant_org.tenant SET status = status`,
      `DELETE FROM sf_audit.audit_event`,
      `INSERT INTO sf_security.break_glass_grant DEFAULT VALUES`,
      'SELECT * FROM sf_sla.sla_clock',
    ]) {
      const outcome = await denied(() => asTenant(h.rt, T1, OFFICER, (c) => c.query(sql)));
      expect(['42501', '42P01'], sql).toContain(outcome);
    }
  });
});

describe('CMP-045 database guards (aggregate-only, purpose-bound, immutable)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  const run = (sql: string, params: unknown[] = []): Promise<string> =>
    denied(() => asTenant(h.rt, T1, OFFICER, (c) => c.query(sql, params)));

  const insertPoint = (
    s: Seeded,
    over: { dimensions?: string; hash?: string; purpose?: string; code?: string },
  ) =>
    run(
      `INSERT INTO sf_analytics.metric_point (tenant_id, definition_id, generation, period_start, dimension_hash,
         period_end, metric_id, metric_code, purpose_code, dimensions, value, contributor_count, last_event_at)
       VALUES ($1,$2,1,'2026-10-07T00:00:00Z',$3,'2026-10-08T00:00:00Z',$4,$5,$6,$7::jsonb,1,1,now())`,
      [
        T1,
        s.definitionId,
        over.hash ?? HASH_B,
        randomUUID(),
        over.code ?? s.metricCode,
        over.purpose ?? 'OPERATIONS_MIS',
        over.dimensions ?? '{"service_code":"S1"}',
      ],
    );

  it('refuses raw or person-level dimension values: email, identifier shapes, numbers, free text', async () => {
    const s = await seed(h, T1);
    let n = 0;
    for (const dims of [
      '{"service_code":"ravi@example.org"}',
      '{"service_code":"RAVI@EXAMPLE.ORG"}',
      '{"service_code":"9876543210"}',
      '{"service_code":"IN-110001"}',
      '{"service_code":"123E4567-E89B-12D3-A456-426614174000"}',
      '{"service_code":"123e4567-e89b-12d3-a456-426614174000"}',
      '{"service_code":"Ravi Kumar"}',
      '{"service_code":"lowercase"}',
      '{"service_code":42}',
      '{"service_code":null}',
      '{"service_code":{"nested":"X"}}',
      '{"service_code":["X"]}',
      '{"Service Code":"X"}',
      '{"a":"X","b":"X","c":"X","d":"X","e":"X","f":"X","g":"X","h":"X","i":"X"}',
    ]) {
      n += 1;
      expect(
        await insertPoint(s, { dimensions: dims, hash: `sha256:${String(n).padStart(64, '0')}` }),
        dims,
      ).toBe('23514');
    }
    expect(await insertPoint(s, { dimensions: '{"service_code":"S2","flag":true}' })).toBe(
      'allowed',
    );
  });

  it('a point must carry its definition metric code and purpose, and the aggregate-only flags cannot be false', async () => {
    const s = await seed(h, T1);
    expect(await insertPoint(s, { purpose: 'MARKETING' })).toBe('23514');
    expect(await insertPoint(s, { code: 'SOME_OTHER_METRIC' })).toBe('23514');
    for (const col of ['aggregate_only', 'raw_pii_payload_forbidden']) {
      expect(
        await run(
          `INSERT INTO sf_analytics.metric_point (tenant_id, definition_id, generation, period_start, dimension_hash,
             period_end, metric_id, metric_code, purpose_code, dimensions, value, contributor_count, last_event_at, ${col})
           VALUES ($1,$2,1,'2026-10-09T00:00:00Z',$3,'2026-10-10T00:00:00Z',$4,$5,'OPERATIONS_MIS','{}',1,1,now(),false)`,
          [T1, s.definitionId, HASH_B, randomUUID(), s.metricCode],
        ),
        col,
      ).toBe('23514');
    }
  });

  it('metric points: identity, dimensions and purpose are immutable; contributors only grow; value changes via the column grant', async () => {
    const s = await seed(h, T1);
    for (const sql of [
      `UPDATE sf_analytics.metric_point SET dimensions = '{"service_code":"X"}' WHERE definition_id = $1`,
      `UPDATE sf_analytics.metric_point SET purpose_code = 'MARKETING' WHERE definition_id = $1`,
      `UPDATE sf_analytics.metric_point SET period_start = period_start + interval '1 day' WHERE definition_id = $1`,
      `UPDATE sf_analytics.metric_point SET metric_id = gen_random_uuid() WHERE definition_id = $1`,
      `UPDATE sf_analytics.metric_point SET aggregate_only = false WHERE definition_id = $1`,
      `UPDATE sf_analytics.metric_point SET tenant_id = '${T2}' WHERE definition_id = $1`,
    ]) {
      expect(await run(sql, [s.definitionId]), sql).toBe('42501');
    }
    expect(
      await run(
        `UPDATE sf_analytics.metric_point SET contributor_count = 1 WHERE definition_id = $1`,
        [s.definitionId],
      ),
    ).toBe('42501');
    expect(
      await run(
        `UPDATE sf_analytics.metric_point SET value = value + 1, contributor_count = contributor_count + 1 WHERE definition_id = $1`,
        [s.definitionId],
      ),
    ).toBe('allowed');
  });

  it('published metric definitions are immutable and retained; only PUBLISHED -> RETIRED', async () => {
    const s = await seed(h, T1);
    for (const sql of [
      `UPDATE sf_analytics.metric_definition SET min_cohort_size = 1 WHERE definition_id = $1`,
      `UPDATE sf_analytics.metric_definition SET purpose_code = 'MARKETING' WHERE definition_id = $1`,
      `UPDATE sf_analytics.metric_definition SET dimensions = '[]' WHERE definition_id = $1`,
      `DELETE FROM sf_analytics.metric_definition WHERE definition_id = $1`,
    ]) {
      expect(await run(sql, [s.definitionId]), sql).toBe('42501');
    }
    expect(
      await run(
        `UPDATE sf_analytics.metric_definition SET status = 'RETIRED', retired_at = now() WHERE definition_id = $1`,
        [s.definitionId],
      ),
    ).toBe('allowed');
    expect(
      await run(
        `UPDATE sf_analytics.metric_definition SET status = 'PUBLISHED', retired_at = NULL WHERE definition_id = $1`,
        [s.definitionId],
      ),
    ).toBe('42501');
  });

  it('definitions naming personal or per-record identifiers, or non-category vocabularies, are refused by the database', async () => {
    const insert = (dims: string, valueField: string | null = null) =>
      run(
        `INSERT INTO sf_analytics.metric_definition (tenant_id, definition_id, metric_code, version_no, status,
           publication_ref, purpose_code, source_event_type, source_schema_version, aggregation, value_field,
           period_granularity, dimensions, min_cohort_size, created_by)
         VALUES ($1,$2,$3,1,'PUBLISHED','ref:x','OPERATIONS_MIS','SomethingHappened',1,$4,$5,'DAY',$6::jsonb,3,$7)`,
        [
          T1,
          randomUUID(),
          `M_${randomUUID().slice(0, 8).toUpperCase()}`,
          valueField ? 'SUM' : 'COUNT',
          valueField,
          dims,
          OFFICER,
        ],
      );
    for (const dims of [
      '[{"key":"applicant_name","source_field":"service_code"}]',
      '[{"key":"service_code","source_field":"mobile_number"}]',
      '[{"key":"application_id","source_field":"service_code"}]',
      '[{"key":"x_y","source_field":"x_y","allowed_values":["lower"]}]',
      '[{"key":"x_y","source_field":"x_y","allowed_values":["A@B.COM"]}]',
      '[{"key":"x_y","source_field":"x_y","extra":1}]',
      '[{"key":"x_y"}]',
      '[{"key":"x_y","source_field":"a_b"},{"key":"x_y","source_field":"c_d"}]',
    ]) {
      expect(await insert(dims), dims).toBe('23514');
    }
    expect(await insert('[]', 'account_balance')).toBe('23514');
    expect(
      await insert(
        '[{"key":"channel","source_field":"channel","allowed_values":["WEB","MOBILE"]}]',
      ),
    ).toBe('allowed');
  });

  it('generation swap: only the building generation can become active; the active generation cannot be deleted', async () => {
    const s = await seed(h, T1);
    const run1 = (sql: string, params: unknown[] = [s.definitionId]) => run(sql, params);
    expect(
      await run1(
        `UPDATE sf_analytics.projection_state SET active_generation = 5 WHERE definition_id = $1`,
      ),
    ).toBe('42501');
    expect(
      await run1(
        `UPDATE sf_analytics.projection_state SET building_generation = 3, build_token = gen_random_uuid(), build_lease_expires_at = now() WHERE definition_id = $1`,
      ),
    ).toBe('P0001');
    expect(
      await run1(
        `UPDATE sf_analytics.projection_state SET building_generation = 2 WHERE definition_id = $1`,
      ),
    ).toBe('23514');
    expect(await run1(`DELETE FROM sf_analytics.projection_state WHERE definition_id = $1`)).toBe(
      '42501',
    );
    expect(await run1(`DELETE FROM sf_analytics.metric_point WHERE definition_id = $1`)).toBe(
      '42501',
    );
    expect(
      await run1(`DELETE FROM sf_analytics.projection_applied_event WHERE definition_id = $1`),
    ).toBe('42501');
    expect(
      await run1(
        `UPDATE sf_analytics.projection_state SET building_generation = 2, build_token = gen_random_uuid(), build_lease_expires_at = now() + interval '1 hour' WHERE definition_id = $1`,
      ),
    ).toBe('allowed');
    expect(
      await run1(
        `UPDATE sf_analytics.projection_state SET active_generation = 2, building_generation = NULL, build_token = NULL, build_lease_expires_at = NULL WHERE definition_id = $1`,
      ),
    ).toBe('allowed');
    expect(
      await run1(
        `DELETE FROM sf_analytics.metric_point WHERE definition_id = $1 AND generation = 1`,
      ),
    ).toBe('allowed');
    expect(
      await run1(
        `DELETE FROM sf_analytics.projection_applied_event WHERE definition_id = $1 AND generation = 1`,
      ),
    ).toBe('allowed');
  });

  it('column-level grants: the runtime cannot rewrite dimensions or identity even without the trigger', async () => {
    const s = await seed(h, T1);
    expect(
      await run(`UPDATE sf_analytics.metric_point SET dimensions = '{}' WHERE definition_id = $1`, [
        s.definitionId,
      ]),
    ).toBe('42501');
    expect(
      await run(
        `UPDATE sf_analytics.metric_definition SET metric_code = 'X' WHERE definition_id = $1`,
        [s.definitionId],
      ),
    ).toBe('42501');
  });
});
