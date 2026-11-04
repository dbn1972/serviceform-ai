import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PgCaseStore } from '../../src/store/pg-store.js';
import {
  CITIZEN,
  ctx,
  harness,
  key,
  OFFICER,
  pinsFor,
  TSB_T1,
  TSB_T2,
  type Harness as ServiceHarness,
} from '../doubles/fixtures.js';
import {
  asTenant,
  closeHarness,
  resetCmp015Data,
  setupHarness,
  T1,
  T2,
  withAdmin,
  type Harness,
} from './helpers.js';

const OTHER = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
const FORM = pinsFor(TSB_T1).form_version_id;
const DATA = { applicant_name: 'SAMPLE LAB Citizen', pincode: '751001' };

let db: Harness;
let svc: ServiceHarness;

const citizen = (id = CITIZEN, tenant = T1) =>
  ctx(tenant, 'CITIZEN', id, { roles: [], auth_assurance: 'OTP' });

async function draft(actor = CITIZEN, tenant = T1, tsb = TSB_T1): Promise<string> {
  const res = await svc.service.createDraft(
    citizen(actor, tenant),
    { tenant_service_binding_id: tsb },
    key(),
  );
  return (res.body as { application: { application_id: string } }).application.application_id;
}

function ids(res: { body: unknown }): string[] {
  return (res.body as { applications: { application_id: string }[] }).applications.map(
    (a) => a.application_id,
  );
}

beforeAll(async () => {
  db = await setupHarness();
});
afterAll(async () => {
  await closeHarness(db);
});
beforeEach(async () => {
  await withAdmin(resetCmp015Data);
  svc = harness(new PgCaseStore(db.rt));
});

describe('CCR-M10-001 on PostgreSQL (real LOGIN roles, FORCE RLS)', () => {
  it('application_working_data is FORCE RLS and writable only through sf_cmp015_rw', async () => {
    const rls = await db.admin.query(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_application_case' AND c.relname = 'application_working_data'`,
    );
    expect(rls.rows[0]).toEqual({ rls: true, force: true });
    for (const pool of [db.peer, db.appOnly]) {
      await expect(
        asTenant(pool, T1, (c) =>
          c.query('SELECT 1 FROM sf_application_case.application_working_data LIMIT 1'),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
    const del = await db.admin.query(
      `SELECT has_table_privilege('sf_cmp015_rw', 'sf_application_case.application_working_data', 'DELETE') AS d`,
    );
    expect(del.rows[0]?.['d']).toBe(false);
  });

  it('a citizen list returns only their rows; officers see the tenant; other tenants never', async () => {
    const mine = await draft(CITIZEN);
    const theirs = await draft(OTHER);
    const foreign = await draft(CITIZEN, T2, TSB_T2);
    const own = await svc.service.listApplications(citizen(), {});
    expect(ids(own)).toEqual([mine]);
    const officer = await svc.service.listApplications(ctx(T1, 'OFFICER', OFFICER), {});
    expect(ids(officer).sort()).toEqual([mine, theirs].sort());
    expect(ids(officer)).not.toContain(foreign);
    const t2 = await svc.service.listApplications(citizen(CITIZEN, T2), {});
    expect(ids(t2)).toEqual([foreign]);
  });

  it('working data round-trips with revisions and is invisible to another tenant', async () => {
    const id = await draft();
    await svc.service.putWorkingData(
      citizen(),
      id,
      { form_version_id: FORM, data: DATA, expected_revision: 0 },
      key(),
    );
    const got = await svc.service.getWorkingData(citizen(), id);
    expect(got.body).toMatchObject({ working_data: { revision: 1, data: DATA } });
    await expect(
      svc.service.putWorkingData(
        citizen(),
        id,
        { form_version_id: FORM, data: DATA, expected_revision: 0 },
        key(),
      ),
    ).rejects.toMatchObject({ code: 'SF-APP-001' });
    await expect(svc.service.getWorkingData(citizen(CITIZEN, T2), id)).rejects.toMatchObject({
      code: 'SF-SYS-002',
    });
    const rows = await asTenant(db.rt, T2, (c) =>
      c.query('SELECT count(*)::int AS n FROM sf_application_case.application_working_data'),
    );
    expect(rows.rows[0]?.['n']).toBe(0);
    const audit = await db.admin.query(
      `SELECT envelope::text AS e FROM sf_application_case.outbox_event WHERE topic = 'sf.audit.ingest.v1'`,
    );
    expect(audit.rows.map((r) => String(r['e'])).join('\n')).not.toContain('SAMPLE LAB Citizen');
  });

  it('NEGATIVE: a cross-tenant working-data insert is refused by RLS WITH CHECK', async () => {
    const id = await draft();
    await expect(
      asTenant(db.rt, T2, (c) =>
        c.query(
          `INSERT INTO sf_application_case.application_working_data
             (tenant_id, application_id, revision, form_version_id, data, data_hash, updated_by, updated_at, last_correlation_id)
           VALUES ($1, $2, 1, $3, '{}'::jsonb, $4, $5, now(), $5)`,
          [T1, id, FORM, `sha256:${'cd'.repeat(32)}`, CITIZEN],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
