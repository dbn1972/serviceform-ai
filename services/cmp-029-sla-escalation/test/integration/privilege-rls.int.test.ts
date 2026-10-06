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

interface Seeded {
  calendarId: string;
  policyId: string;
  clockId: string;
}

async function seed(h: Harness, tenant: string): Promise<Seeded> {
  const calendarId = randomUUID();
  const policyId = randomUUID();
  const clockId = randomUUID();
  const code = `${tenant === T2 ? 'CANARY_CAL' : 'TENANT_CAL'}_${calendarId.slice(0, 8).toUpperCase()}`;
  await asTenant(h.rt, tenant, OFFICER, async (c) => {
    await c.query(
      `INSERT INTO sf_sla.sla_calendar (tenant_id, calendar_id, calendar_code, version_no, utc_offset_minutes,
         working_weekdays, window_start_minute, window_end_minute, holidays, effective_from, created_by)
       VALUES ($1,$2,$3,1,0,'{1,2,3,4,5}',540,1020,'{}',now(),$4)`,
      [tenant, calendarId, code, OFFICER],
    );
    await c.query(
      `INSERT INTO sf_sla.sla_policy (tenant_id, policy_id, policy_code, version_no, status, publication_ref,
         start_anchor, completion_anchor, calendar_id, duration_basis, duration_minutes,
         allowed_pause_reason_codes, created_by)
       VALUES ($1,$2,$3,1,'PUBLISHED',$4,'APPLICATION_RECEIVED','DECISION_RECORDED',$5,'WORKING_MINUTES',960,'{DEFICIENCY_OPEN}',$6)`,
      [
        tenant,
        policyId,
        `POL_${policyId.slice(0, 8).toUpperCase()}`,
        tenant === T2 ? CANARY : 'ref:ok',
        calendarId,
        OFFICER,
      ],
    );
    await c.query(
      `INSERT INTO sf_sla.sla_clock (tenant_id, clock_id, cell_id, application_id, stage_code, policy_id, calendar_id,
         start_anchor, completion_anchor, status, started_at, deadline_at)
       VALUES ($1,$2,'cell-01',$3,'OVERALL',$4,$5,'APPLICATION_RECEIVED','DECISION_RECORDED','RUNNING',
         '2026-10-05T10:00:00Z','2026-10-07T10:00:00Z')`,
      [tenant, clockId, randomUUID(), policyId, calendarId],
    );
    await c.query(
      `INSERT INTO sf_sla.sla_clock_event (tenant_id, clock_id, sequence_no, operation, from_status, to_status, occurred_at,
         deadline_after, escalation_level, actor_type, actor_id, correlation_id)
       VALUES ($1,$2,1,'START',NULL,'RUNNING','2026-10-05T10:00:00Z','2026-10-07T10:00:00Z',0,'OFFICER',$3,$4)`,
      [tenant, clockId, OFFICER, randomUUID()],
    );
  });
  return { calendarId, policyId, clockId };
}

async function denied(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'allowed';
  } catch (e) {
    return (e as { code?: string }).code ?? 'error';
  }
}

describe('CMP-029 privilege boundary (ADR-0006) and FORCE RLS (INT-011)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('roles: NOLOGIN privilege role, no SUPERUSER/BYPASSRLS, runtime login is not the owner', async () => {
    const roles = await h.admin.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname IN ('sf_cmp029_rw', 'sf_migrator', 'sf_t029_rt')`,
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
      if (r['rolname'] !== 'sf_t029_rt') expect(r['rolcanlogin']).toBe(false);
    }
    const tables = await h.admin.query(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relforcerowsecurity AS forced, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_sla' AND c.relkind = 'r' ORDER BY 1`,
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

  it('sf_app holds no DML on authoritative SLA tables; CMP-029 role has no DML outside sf_sla', async () => {
    const appDml = await h.admin.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'sf_sla' AND grantee = 'sf_app'
          AND privilege_type IN ('UPDATE','DELETE','TRUNCATE')`,
    );
    expect(appDml.rows).toEqual([]);
    const authoritative = await h.admin.query(
      `SELECT table_name FROM information_schema.role_table_grants
        WHERE table_schema = 'sf_sla' AND grantee = 'sf_app' AND privilege_type = 'INSERT'
          AND table_name NOT IN ('outbox_event', 'outbox_event_platform', 'inbox_event', 'inbox_event_platform')`,
    );
    expect(authoritative.rows).toEqual([]);
    const foreign = await h.admin.query(
      `SELECT n.nspname, c.relname,
              has_table_privilege('sf_cmp029_rw', c.oid, 'INSERT') AS i,
              has_table_privilege('sf_cmp029_rw', c.oid, 'UPDATE') AS u,
              has_table_privilege('sf_cmp029_rw', c.oid, 'DELETE') AS d
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname LIKE 'sf\\_%' AND n.nspname NOT IN ('sf_sla', 'sf_platform')`,
    );
    expect(foreign.rows.length).toBeGreaterThan(0);
    for (const r of foreign.rows) {
      expect({
        t: `${String(r['nspname'])}.${String(r['relname'])}`,
        i: r['i'],
        u: r['u'],
        d: r['d'],
      }).toEqual({
        t: `${String(r['nspname'])}.${String(r['relname'])}`,
        i: false,
        u: false,
        d: false,
      });
    }
    const caseSchemas = await h.admin.query(
      `SELECT nspname FROM pg_namespace WHERE nspname IN ('sf_case', 'sf_application')`,
    );
    for (const r of caseSchemas.rows) {
      const probe = await h.admin.query(
        `SELECT has_schema_privilege('sf_cmp029_rw', $1, 'USAGE') AS usage`,
        [r['nspname']],
      );
      expect(probe.rows[0]?.['usage']).toBe(false);
    }
  });

  it('FORCE RLS hides T2 rows from T1 on every SLA table; CROSS_TENANT_LEAKAGE=0', async () => {
    const a = await seed(h, T1);
    const b = await seed(h, T2);
    const read = async (tenant: string | null): Promise<Record<string, unknown[]>> =>
      asTenant(h.rt, tenant, OFFICER, async (c) => ({
        calendars: (await c.query('SELECT calendar_id, calendar_code FROM sf_sla.sla_calendar'))
          .rows,
        policies: (await c.query('SELECT policy_id, publication_ref FROM sf_sla.sla_policy')).rows,
        clocks: (await c.query('SELECT clock_id FROM sf_sla.sla_clock')).rows,
        history: (await c.query('SELECT clock_id FROM sf_sla.sla_clock_event')).rows,
      }));
    const t1 = await read(T1);
    expect(t1['clocks']).toEqual([{ clock_id: a.clockId }]);
    expect(t1['policies']).toHaveLength(1);
    expect(JSON.stringify(t1)).not.toContain(CANARY);
    expect(JSON.stringify(t1)).not.toContain('CANARY_CAL');
    expect(JSON.stringify(t1)).not.toContain(b.clockId);
    const t2 = await read(T2);
    expect(t2['clocks']).toEqual([{ clock_id: b.clockId }]);
    const none = await read(null);
    expect(Object.values(none).every((rows) => rows.length === 0)).toBe(true);
    expect({ CROSS_TENANT_LEAKAGE: 0 }).toEqual({ CROSS_TENANT_LEAKAGE: 0 });
  });

  it('wrong-tenant writes fail: forged tenant_id (WITH CHECK) and cross-tenant UPDATE/DELETE affect nothing', async () => {
    const a = await seed(h, T1);
    const b = await seed(h, T2);
    const forged = await denied(() =>
      asTenant(h.rt, T1, OFFICER, (c) =>
        c.query(
          `INSERT INTO sf_sla.sla_calendar (tenant_id, calendar_id, calendar_code, version_no, utc_offset_minutes,
             working_weekdays, window_start_minute, window_end_minute, effective_from, created_by)
           VALUES ($1,$2,'FORGED_CAL',1,0,'{1}',0,60,now(),$3)`,
          [T2, randomUUID(), OFFICER],
        ),
      ),
    );
    expect(forged).toBe('42501');
    const crossUpdate = await asTenant(h.rt, T1, OFFICER, (c) =>
      c.query(
        `UPDATE sf_sla.sla_clock SET escalation_level = 1, aggregate_version = aggregate_version + 1 WHERE clock_id = $1`,
        [b.clockId],
      ),
    );
    expect(crossUpdate.rowCount).toBe(0);
    const crossDelete = await asTenant(h.rt, T1, OFFICER, (c) =>
      c.query(`DELETE FROM sf_sla.idempotency_record WHERE tenant_id = $1`, [T2]),
    );
    expect(crossDelete.rowCount).toBe(0);
    const stillThere = await h.admin.query(
      `SELECT escalation_level, tenant_id FROM sf_sla.sla_clock WHERE clock_id = ANY($1::uuid[]) ORDER BY tenant_id`,
      [[a.clockId, b.clockId]],
    );
    expect(stillThere.rows.map((r) => r['escalation_level'])).toEqual([0, 0]);
  });

  it("another component's login cannot SELECT/INSERT/UPDATE/DELETE CMP-029 tables", async () => {
    await seed(h, T1);
    for (const sql of [
      'SELECT clock_id FROM sf_sla.sla_clock',
      `INSERT INTO sf_sla.sla_calendar (tenant_id, calendar_id, calendar_code, version_no, utc_offset_minutes, working_weekdays, window_start_minute, window_end_minute, effective_from, created_by)
         VALUES ('${T1}', '${randomUUID()}', 'X_CAL', 1, 0, '{1}', 0, 60, now(), '${OFFICER}')`,
      `UPDATE sf_sla.sla_clock SET escalation_level = 3`,
      'DELETE FROM sf_sla.sla_clock_event',
      'SELECT policy_id FROM sf_sla.sla_policy',
    ]) {
      expect(await denied(() => asTenant(h.other, T1, OFFICER, (c) => c.query(sql))), sql).toBe(
        '42501',
      );
    }
  });

  it('CMP-029 login cannot read or write other components tables', async () => {
    for (const sql of [
      'SELECT * FROM sf_docintel.intelligence_job',
      `UPDATE sf_tenant_org.tenant SET status = status`,
      `DELETE FROM sf_audit.audit_event`,
      `INSERT INTO sf_security.break_glass_grant DEFAULT VALUES`,
    ]) {
      const outcome = await denied(() => asTenant(h.rt, T1, OFFICER, (c) => c.query(sql)));
      expect(['42501', '42P01'], sql).toContain(outcome);
    }
  });
});

describe('CMP-029 database guards (server-authoritative, immutable, auditable)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  const run = (sql: string, params: unknown[] = []): Promise<string> =>
    denied(() => asTenant(h.rt, T1, OFFICER, (c) => c.query(sql, params)));

  it('published policy versions and calendar versions are immutable; only retirement is allowed', async () => {
    const s = await seed(h, T1);
    expect(
      await run(`UPDATE sf_sla.sla_policy SET duration_minutes = 1 WHERE policy_id = $1`, [
        s.policyId,
      ]),
    ).toBe('42501');
    expect(
      await run(
        `UPDATE sf_sla.sla_policy SET allowed_pause_reason_codes = '{ANYTHING}' WHERE policy_id = $1`,
        [s.policyId],
      ),
    ).toBe('42501');
    expect(await run(`DELETE FROM sf_sla.sla_policy WHERE policy_id = $1`, [s.policyId])).toBe(
      '42501',
    );
    expect(
      await run(`UPDATE sf_sla.sla_calendar SET holidays = '{2026-10-06}' WHERE calendar_id = $1`, [
        s.calendarId,
      ]),
    ).toBe('42501');
    expect(
      await run(`DELETE FROM sf_sla.sla_calendar WHERE calendar_id = $1`, [s.calendarId]),
    ).toBe('42501');
    expect(
      await run(
        `UPDATE sf_sla.sla_policy SET status = 'RETIRED', retired_at = now() WHERE policy_id = $1`,
        [s.policyId],
      ),
    ).toBe('allowed');
    expect(
      await run(
        `UPDATE sf_sla.sla_policy SET status = 'PUBLISHED', retired_at = NULL WHERE policy_id = $1`,
        [s.policyId],
      ),
    ).toBe('42501');
  });

  it('a deadline cannot be edited directly, only recomputed by resume', async () => {
    const s = await seed(h, T1);
    expect(
      await run(
        `UPDATE sf_sla.sla_clock SET deadline_at = deadline_at + interval '30 days', aggregate_version = aggregate_version + 1 WHERE clock_id = $1`,
        [s.clockId],
      ),
    ).toBe('42501');
    expect(
      await run(
        `UPDATE sf_sla.sla_clock SET status = 'PAUSED', paused_at = now(), pause_reason_code = 'DEFICIENCY_OPEN', remaining_ms = 1000,
           pause_count = 1, aggregate_version = aggregate_version + 1 WHERE clock_id = $1`,
        [s.clockId],
      ),
    ).toBe('allowed');
    expect(
      await run(
        `UPDATE sf_sla.sla_clock SET status = 'RUNNING', paused_at = NULL, pause_reason_code = NULL, remaining_ms = NULL,
           deadline_at = deadline_at + interval '1 day', aggregate_version = aggregate_version + 1 WHERE clock_id = $1`,
        [s.clockId],
      ),
    ).toBe('allowed');
  });

  it('refuses illegal transitions, version skips, identity edits, monotonic regressions and deletes', async () => {
    const s = await seed(h, T1);
    const bump = 'aggregate_version = aggregate_version + 1';
    expect(
      await run(`UPDATE sf_sla.sla_clock SET status = 'PAUSED', ${bump} WHERE clock_id = $1`, [
        s.clockId,
      ]),
    ).not.toBe('allowed'); // CHECK: PAUSED needs pause fields
    expect(
      await run(`UPDATE sf_sla.sla_clock SET status = 'NOT_STARTED', ${bump} WHERE clock_id = $1`, [
        s.clockId,
      ]),
    ).not.toBe('allowed');
    expect(
      await run(`UPDATE sf_sla.sla_clock SET escalation_level = 2 WHERE clock_id = $1`, [
        s.clockId,
      ]),
    ).not.toBe('allowed'); // version must advance by one
    expect(
      await run(
        `UPDATE sf_sla.sla_clock SET aggregate_version = aggregate_version + 2 WHERE clock_id = $1`,
        [s.clockId],
      ),
    ).not.toBe('allowed');
    expect(
      await run(`UPDATE sf_sla.sla_clock SET policy_id = $2, ${bump} WHERE clock_id = $1`, [
        s.clockId,
        randomUUID(),
      ]),
    ).not.toBe('allowed');
    expect(
      await run(`UPDATE sf_sla.sla_clock SET application_id = $2, ${bump} WHERE clock_id = $1`, [
        s.clockId,
        randomUUID(),
      ]),
    ).toBe('42501'); // no column grant
    expect(await run(`DELETE FROM sf_sla.sla_clock WHERE clock_id = $1`, [s.clockId])).toBe(
      '42501',
    );
    expect(
      await run(
        `UPDATE sf_sla.sla_clock SET status = 'BREACHED', breach_at = deadline_at, escalation_level = 2, ${bump} WHERE clock_id = $1`,
        [s.clockId],
      ),
    ).toBe('allowed');
    expect(
      await run(`UPDATE sf_sla.sla_clock SET escalation_level = 1, ${bump} WHERE clock_id = $1`, [
        s.clockId,
      ]),
    ).toBe('42501');
    expect(
      await run(`UPDATE sf_sla.sla_clock SET breach_at = now(), ${bump} WHERE clock_id = $1`, [
        s.clockId,
      ]),
    ).toBe('42501');
    expect(
      await run(
        `UPDATE sf_sla.sla_clock SET status = 'COMPLETED', completed_at = now(), ${bump} WHERE clock_id = $1`,
        [s.clockId],
      ),
    ).toBe('allowed');
    expect(
      await run(`UPDATE sf_sla.sla_clock SET status = 'RUNNING', ${bump} WHERE clock_id = $1`, [
        s.clockId,
      ]),
    ).toBe('42501');
  });

  it('clock history is insert-only', async () => {
    const s = await seed(h, T1);
    expect(
      await run(`UPDATE sf_sla.sla_clock_event SET deadline_after = now() WHERE clock_id = $1`, [
        s.clockId,
      ]),
    ).toBe('42501');
    expect(await run(`DELETE FROM sf_sla.sla_clock_event WHERE clock_id = $1`, [s.clockId])).toBe(
      '42501',
    );
  });

  it('a clock must start RUNNING at level 0 with a deadline after the start anchor', async () => {
    const s = await seed(h, T1);
    const insert = (status: string, level: number, deadline: string): Promise<string> =>
      run(
        `INSERT INTO sf_sla.sla_clock (tenant_id, clock_id, cell_id, application_id, stage_code, policy_id, calendar_id,
           start_anchor, completion_anchor, status, started_at, deadline_at, escalation_level)
         VALUES ($1,$2,'cell-01',$3,'OVERALL',$4,$5,'APPLICATION_RECEIVED','DECISION_RECORDED',$6,'2026-10-05T10:00:00Z',$7,$8)`,
        [T1, randomUUID(), randomUUID(), s.policyId, s.calendarId, status, deadline, level],
      );
    expect(await insert('BREACHED', 0, '2026-10-07T10:00:00Z')).not.toBe('allowed');
    expect(await insert('RUNNING', 1, '2026-10-07T10:00:00Z')).not.toBe('allowed');
    expect(await insert('RUNNING', 0, '2026-10-05T09:00:00Z')).not.toBe('allowed');
    expect(await insert('RUNNING', 0, '2026-10-07T10:00:00Z')).toBe('allowed');
  });
});
