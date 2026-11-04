import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  call,
  citizenLogin,
  closeAdmin,
  command,
  createDraft,
  FIXTURE_A,
  FIXTURE_B,
  HOST_A,
  HOST_B,
  officerLogin,
  putWorkingData,
  syntheticForm,
  syntheticMobile,
  type App,
  type CitizenSession,
  type OfficerSession,
  TSB_A,
  TSB_B,
} from './support/platform.js';

/**
 * INT-011 on the wired path: two host instances (portal placements for tenants A and B) against the
 * same PostgreSQL and the same CMP-004 citizen directory. Tenant B's OPA carries both tenants' data,
 * so isolation must come from placement + CMP-004 session tenant + RLS, not missing policy data.
 */
describe('INT-011 tenant isolation across two portal placements', () => {
  const mobile = syntheticMobile();
  let cA: CitizenSession;
  let cB: CitizenSession;
  let oA: OfficerSession;
  let oB: OfficerSession;
  let appA: App;
  let appB: App;

  beforeAll(async () => {
    cA = await citizenLogin(HOST_A(), mobile);
    cB = await citizenLogin(HOST_B(), mobile);
    oA = await officerLogin(HOST_A(), FIXTURE_A().officer.subject);
    oB = await officerLogin(HOST_B(), FIXTURE_B().officer.subject);

    const mk = async (host: string, c: CitizenSession, tsb: string) => {
      let app = (await createDraft(host, c.token, tsb)).body['application'] as App;
      expect((await putWorkingData(host, c.token, app, syntheticForm(), 0)).status).toBe(200);
      for (const cmd of ['MARK_READY_TO_SUBMIT', 'SUBMIT']) {
        const r = await command(host, c.token, app, cmd);
        expect(r.status, `${host} ${cmd}`).toBe(200);
        app = r.body['application'] as App;
      }
      return app;
    };
    appA = await mk(HOST_A(), cA, TSB_A());
    appB = await mk(HOST_B(), cB, TSB_B());
  });
  afterAll(closeAdmin);

  it('the same mobile is the same CMP-004 citizen on both portals; case rows carry different tenants', async () => {
    expect(cA.citizen_id).toBe(cB.citizen_id);
    const rows = await admin().query<{
      application_id: string;
      tenant_id: string;
      applicant_id: string;
    }>(
      `SELECT application_id, tenant_id, applicant_id FROM sf_application_case.application_case
        WHERE application_id = ANY($1::uuid[])`,
      [[appA.application_id, appB.application_id]],
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.application_id, r]));
    expect(byId[appA.application_id]?.tenant_id).toBe(FIXTURE_A().placement.tenant_id);
    expect(byId[appB.application_id]?.tenant_id).toBe(FIXTURE_B().placement.tenant_id);
    expect(byId[appA.application_id]?.applicant_id).toBe(cA.citizen_id);
    expect(byId[appB.application_id]?.applicant_id).toBe(cA.citizen_id);
    expect(appB.pins).toEqual(FIXTURE_B().binding.pins);
    expect(appA.pins).not.toEqual(appB.pins);
  });

  it('a citizen sees only the current portal tenant', async () => {
    for (const [host, token, own, other] of [
      [HOST_A(), cA.token, appA, appB],
      [HOST_B(), cB.token, appB, appA],
    ] as const) {
      const list = await call(host, 'GET', '/v1/applications?limit=100', { token });
      expect(list.status).toBe(200);
      const ids = (list.body['applications'] as App[]).map((a) => a.application_id);
      expect(ids).toContain(own.application_id);
      expect(ids).not.toContain(other.application_id);
      for (const path of [
        `/v1/applications/${other.application_id}`,
        `/v1/applications/${other.application_id}/working-data`,
        `/v1/applications/${other.application_id}/transitions`,
      ]) {
        const r = await call(host, 'GET', path, { token });
        expect(r.status, `${host}${path}`).toBe(404);
      }
      const cmd = await command(host, token, other, 'RETURN_TO_DRAFT');
      expect(cmd.status).toBe(404);
      const wd = await putWorkingData(
        host,
        token,
        { ...other, state: 'DRAFT' },
        syntheticForm(),
        1,
      );
      expect(wd.status).toBe(404);
    }
  });

  it("the citizen token from portal A works on portal B but only with B's tenant (ADR-0007 D-1)", async () => {
    const list = await call(HOST_B(), 'GET', '/v1/applications?limit=100', { token: cA.token });
    expect(list.status).toBe(200);
    const ids = (list.body['applications'] as App[]).map((a) => a.application_id);
    expect(ids).not.toContain(appA.application_id);
    expect(ids).toContain(appB.application_id);
  });

  it("an officer sees only their tenant's queue and is refused on the other tenant's host", async () => {
    const qA = await call(HOST_A(), 'GET', '/v1/applications?limit=100', { token: oA.token });
    const qB = await call(HOST_B(), 'GET', '/v1/applications?limit=100', { token: oB.token });
    const idsA = (qA.body['applications'] as App[]).map((a) => a.application_id);
    const idsB = (qB.body['applications'] as App[]).map((a) => a.application_id);
    expect(idsA).toContain(appA.application_id);
    expect(idsA).not.toContain(appB.application_id);
    expect(idsB).toContain(appB.application_id);
    expect(idsB).not.toContain(appA.application_id);

    for (const [host, token, other] of [
      [HOST_B(), oA.token, appB],
      [HOST_A(), oB.token, appA],
    ] as const) {
      const list = await call(host, 'GET', '/v1/applications', { token });
      expect(list.status).toBe(401);
      expect(list.body['applications']).toBeUndefined();
      const get = await call(host, 'GET', `/v1/applications/${other.application_id}`, { token });
      expect(get.status).toBe(401);
      const cmd = await command(host, token, other, 'MARK_RECEIVED');
      expect(cmd.status).toBe(401);
    }
    const crossGet = await call(HOST_A(), 'GET', `/v1/applications/${appB.application_id}`, {
      token: oA.token,
    });
    expect(crossGet.status).toBe(404);
    const crossCmd = await command(HOST_A(), oA.token, appB, 'MARK_RECEIVED');
    expect(crossCmd.status).toBe(404);
    const row = await admin().query<{ state: string }>(
      'SELECT state FROM sf_application_case.application_case WHERE application_id = $1',
      [appB.application_id],
    );
    expect(row.rows[0]?.state).toBe('SUBMITTED');
  });

  it('a citizen cannot create a draft on a binding offered by the other tenant', async () => {
    const r = await createDraft(HOST_A(), cA.token, TSB_B());
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(r.body['application']).toBeUndefined();
  });

  it('outbox rows for each case carry only that case tenant', async () => {
    const r = await admin().query<{
      aggregate_id: string;
      tenant_id: string;
      resource: string | null;
    }>(
      `SELECT aggregate_id, tenant_id, envelope->'data'->>'resource_id' AS resource
         FROM sf_application_case.outbox_event
        WHERE aggregate_id = ANY($1::uuid[]) OR envelope->'data'->>'resource_id' = ANY($2::text[])`,
      [
        [appA.application_id, appB.application_id],
        [appA.application_id, appB.application_id],
      ],
    );
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) {
      const target = row.resource ?? row.aggregate_id;
      const expected =
        target === appA.application_id
          ? FIXTURE_A().placement.tenant_id
          : FIXTURE_B().placement.tenant_id;
      expect(row.tenant_id).toBe(expected);
    }
  });

  it('runtime logins cannot bypass RLS (NOSUPERUSER, NOBYPASSRLS, FORCE RLS on case tables)', async () => {
    const roles = await admin().query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('sf_lab_cmp004','sf_lab_cmp015')`,
    );
    expect(roles.rows).toHaveLength(2);
    for (const r of roles.rows) {
      expect(r.rolsuper).toBe(false);
      expect(r.rolbypassrls).toBe(false);
    }
    const t = await admin().query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_application_case' AND c.relkind = 'r'
          AND c.relname IN ('application_case','application_working_data','case_transition','outbox_event')`,
    );
    expect(t.rows).toHaveLength(4);
    for (const r of t.rows) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.relforcerowsecurity, r.relname).toBe(true);
    }
    const cross = await admin().query<{ ok: boolean }>(
      `SELECT pg_has_role('sf_lab_cmp015', 'sf_cmp004_rw', 'MEMBER') AS ok`,
    );
    expect(cross.rows[0]?.ok).toBe(false);
  });
});
