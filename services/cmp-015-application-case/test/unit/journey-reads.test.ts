import { beforeEach, describe, expect, it } from 'vitest';
import { TOPIC_AUDIT } from '../../src/events.js';
import { createApplicationCaseRoutes } from '../../src/http.js';
import {
  CITIZEN,
  ctx,
  harness,
  key,
  OFFICER,
  pinsFor,
  T1,
  T2,
  TSB_T1,
  TSB_T2,
  type Harness,
} from '../doubles/fixtures.js';
import { MemoryCaseStore } from '../doubles/memory-store.js';

const OTHER_CITIZEN = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
const FORM = pinsFor(TSB_T1).form_version_id;
const DATA = { applicant_name: 'SAMPLE LAB Citizen', residence_duration_months: 36 };

let store: MemoryCaseStore;
let h: Harness;

beforeEach(() => {
  store = new MemoryCaseStore();
  h = harness(store);
});

async function draft(tenant = T1, actor = CITIZEN, tsb = TSB_T1): Promise<string> {
  const res = await h.service.createDraft(
    ctx(tenant, 'CITIZEN', actor, { roles: [] }),
    { tenant_service_binding_id: tsb },
    key(),
  );
  return (res.body as { application: { application_id: string } }).application.application_id;
}

function citizen(id = CITIZEN, tenant = T1) {
  return ctx(tenant, 'CITIZEN', id, { roles: [], auth_assurance: 'OTP' });
}

function ids(res: { body: unknown }): string[] {
  return (res.body as { applications: { application_id: string }[] }).applications.map(
    (a) => a.application_id,
  );
}

describe('CCR-M10-001 listApplications', () => {
  it('a citizen sees only their own applications even when the PDP allows', async () => {
    const mine = await draft(T1, CITIZEN);
    const theirs = await draft(T1, OTHER_CITIZEN);
    const res = await h.service.listApplications(citizen(), {});
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([mine]);
    expect(ids(res)).not.toContain(theirs);
  });

  it('authorizes as the owner for citizens and via the role path for officers', async () => {
    await h.service.listApplications(citizen(), {});
    const asCitizen = h.authorizer.inputs.at(-1);
    expect(asCitizen?.action).toBe('APPLICATION_LIST');
    expect(asCitizen?.resource.owner_id).toBe(CITIZEN);
    await h.service.listApplications(ctx(T1, 'OFFICER', OFFICER), {});
    expect(h.authorizer.inputs.at(-1)?.resource.owner_id).toBeUndefined();
  });

  it('authorizes before reading and returns nothing when denied', async () => {
    await draft();
    h.authorizer.denied.add('APPLICATION_LIST');
    const before = store.txCount;
    await expect(h.service.listApplications(citizen(), {})).rejects.toMatchObject({
      code: 'SF-AUTH-002',
    });
    expect(store.txCount).toBe(before + 1);
    expect(store.outboxFor(T1, TOPIC_AUDIT).at(-1)?.envelope.data).toMatchObject({
      result: 'DENIED',
    });
  });

  it('officers list the tenant queue filtered by state; other tenants are invisible', async () => {
    const a = await draft(T1, CITIZEN);
    const b = await draft(T1, OTHER_CITIZEN);
    const other = await draft(T2, CITIZEN, TSB_T2);
    const all = await h.service.listApplications(ctx(T1, 'OFFICER', OFFICER), {});
    expect(ids(all).sort()).toEqual([a, b].sort());
    expect(ids(all)).not.toContain(other);
    const submitted = await h.service.listApplications(ctx(T1, 'OFFICER', OFFICER), {
      state: 'SUBMITTED',
    });
    expect(ids(submitted)).toEqual([]);
  });

  it('validates the query', async () => {
    for (const q of [
      { state: 'WITHDRAWAL_REQUESTED' },
      { limit: '0' },
      { limit: '101' },
      { limit: 'ten' },
      { limit: ['1', '2'] },
      { owner: CITIZEN },
      'state=DRAFT',
    ]) {
      await expect(h.service.listApplications(citizen(), q)).rejects.toMatchObject({
        code: 'SF-SYS-003',
      });
    }
    const limited = await h.service.listApplications(citizen(), { limit: '1' });
    expect(limited.status).toBe(200);
  });

  it('refuses a citizen without tenant context', async () => {
    await expect(
      h.service.listApplications({ ...citizen(), tenant_id: null }, {}),
    ).rejects.toMatchObject({ code: 'SF-TEN-001' });
  });
});

describe('CCR-M10-001 working data', () => {
  it('stores, reads back and revisions working data; audit carries only the hash', async () => {
    const id = await draft();
    const first = await h.service.putWorkingData(
      citizen(),
      id,
      { form_version_id: FORM, data: DATA, expected_revision: 0 },
      key(),
    );
    expect(first.status).toBe(200);
    const wd = (first.body as { working_data: { revision: number; data_hash: string } })
      .working_data;
    expect(wd.revision).toBe(1);
    expect(wd.data_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const read = await h.service.getWorkingData(citizen(), id);
    expect((read.body as { working_data: { data: unknown } }).working_data.data).toEqual(DATA);
    const second = await h.service.putWorkingData(
      citizen(),
      id,
      {
        form_version_id: FORM,
        data: { ...DATA, residence_duration_months: 40 },
        expected_revision: 1,
      },
      key(),
    );
    expect((second.body as { working_data: { revision: number } }).working_data.revision).toBe(2);
    const audit = JSON.stringify(store.outboxFor(T1, TOPIC_AUDIT));
    expect(audit).toContain('APPLICATION_WORKING_DATA_WRITE');
    expect(audit).not.toContain('SAMPLE LAB Citizen');
    expect(JSON.stringify(store.outboxFor(T1))).not.toContain('SAMPLE LAB Citizen');
  });

  it('rejects a stale revision and replays an identical idempotent write', async () => {
    const id = await draft();
    const k = key();
    const body = { form_version_id: FORM, data: DATA, expected_revision: 0 };
    await h.service.putWorkingData(citizen(), id, body, k);
    const replay = await h.service.putWorkingData(citizen(), id, body, k);
    expect(replay.replayed).toBe(true);
    await expect(h.service.putWorkingData(citizen(), id, body, key())).rejects.toMatchObject({
      code: 'SF-APP-001',
      details: [{ code: 'STALE_REVISION' }],
    });
    await expect(
      h.service.putWorkingData(citizen(), id, { ...body, expected_revision: 1, data: {} }, k),
    ).rejects.toMatchObject({ code: 'SF-APP-002' });
  });

  it('refuses a form version that is not the pinned one', async () => {
    const id = await draft();
    await expect(
      h.service.putWorkingData(
        citizen(),
        id,
        {
          form_version_id: '99999999-9999-4999-8999-999999999999',
          data: DATA,
          expected_revision: 0,
        },
        key(),
      ),
    ).rejects.toMatchObject({ code: 'SF-FORM-001' });
  });

  it('is not editable after submission', async () => {
    const id = await draft();
    await h.service.executeCommand(
      citizen(),
      id,
      { command: 'MARK_READY_TO_SUBMIT', expected_state: 'DRAFT', expected_version: 1 },
      key(),
    );
    await expect(
      h.service.putWorkingData(
        citizen(),
        id,
        { form_version_id: FORM, data: DATA, expected_revision: 0 },
        key(),
      ),
    ).rejects.toMatchObject({
      code: 'SF-APP-001',
      details: [{ code: 'WORKING_DATA_NOT_EDITABLE' }],
    });
  });

  it('validates the body', async () => {
    const id = await draft();
    const big = { blob: 'x'.repeat(70_000) };
    for (const body of [
      null,
      { form_version_id: FORM, data: [], expected_revision: 0 },
      { form_version_id: FORM, data: big, expected_revision: 0 },
      { form_version_id: FORM, data: DATA, expected_revision: -1 },
      { form_version_id: FORM, data: DATA, expected_revision: 1.5 },
      { form_version_id: 'not-a-uuid', data: DATA, expected_revision: 0 },
      { form_version_id: FORM, data: DATA, expected_revision: 0, tenant_id: T2 },
    ]) {
      await expect(h.service.putWorkingData(citizen(), id, body, key())).rejects.toMatchObject({
        code: 'SF-SYS-003',
      });
    }
    await expect(
      h.service.putWorkingData(
        citizen(),
        id,
        { form_version_id: FORM, data: DATA, expected_revision: 0 },
        'short',
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
  });

  it('authorizes read and write against the case owner; denial stops the write', async () => {
    const id = await draft();
    h.authorizer.denied.add('APPLICATION_WORKING_DATA_WRITE');
    await expect(
      h.service.putWorkingData(
        citizen(OTHER_CITIZEN),
        id,
        { form_version_id: FORM, data: DATA, expected_revision: 0 },
        key(),
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    expect(h.authorizer.inputs.at(-1)?.resource.owner_id).toBe(CITIZEN);
    expect(store.state.workingData.size).toBe(0);
    await expect(h.service.getWorkingData(citizen(), id)).rejects.toMatchObject({
      code: 'SF-SYS-002',
    });
    expect(h.authorizer.inputs.at(-1)?.action).toBe('APPLICATION_WORKING_DATA_READ');
  });

  it('another tenant cannot read or write the case (RLS-equivalent)', async () => {
    const id = await draft();
    await expect(h.service.getWorkingData(citizen(CITIZEN, T2), id)).rejects.toMatchObject({
      code: 'SF-SYS-002',
    });
    await expect(
      h.service.putWorkingData(
        citizen(CITIZEN, T2),
        id,
        { form_version_id: FORM, data: DATA, expected_revision: 0 },
        key(),
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-002' });
  });
});

describe('CCR-M10-001 HTTP routes', () => {
  it('routes list and working data through the neutral surface', async () => {
    const id = await draft();
    const routes = createApplicationCaseRoutes({
      service: h.service,
      resolveContext: async () => citizen(),
    });
    const find = (m: string, u: string) => {
      const r = routes.find((x) => x.method === m && x.url === u);
      if (!r) throw new Error(`${m} ${u}`);
      return r;
    };
    const put = await find('PUT', '/applications/:applicationId/working-data').handle({
      headers: { 'idempotency-key': key() },
      params: { applicationId: id },
      body: { form_version_id: FORM, data: DATA, expected_revision: 0 },
    });
    expect(put.status).toBe(200);
    const get = await find('GET', '/applications/:applicationId/working-data').handle({
      headers: {},
      params: { applicationId: id },
    });
    expect(get.status).toBe(200);
    const list = await find('GET', '/applications').handle({ headers: {}, query: {} });
    expect(ids(list)).toEqual([id]);
    const refused = await find('GET', '/applications').handle({
      headers: { 'x-tenant-id': T2 },
      query: {},
    });
    expect(refused.status).toBe(403);
  });
});
