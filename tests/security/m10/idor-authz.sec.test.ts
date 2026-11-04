import { beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  BINDING_A,
  bffCitizen,
  bffOfficer,
  call,
  citizenOnHost,
  CITIZEN_BFF,
  cookieToken,
  OFFICER_BFF,
  officerOnHost,
  SAMPLE_FORM,
  submittedCase,
  TENANT_A,
  type CitizenSession,
} from './lib/lab';

type Case = Awaited<ReturnType<typeof submittedCase>>;

let a: CitizenSession;
let b: CitizenSession;
let caseA: Case;
let draftA: { application_id: string; state: string; aggregate_version: number; form: string };

beforeAll(async () => {
  a = await citizenOnHost();
  b = await citizenOnHost();
  caseA = await submittedCase(a);
  const d = await call(API, 'POST', '/v1/applications', {
    token: a.token,
    idem: true,
    body: { tenant_service_binding_id: BINDING_A },
  });
  const app = d.body['application'] as {
    application_id: string;
    state: string;
    aggregate_version: number;
    pins: { form_version_id: string };
  };
  draftA = { ...app, form: app.pins.form_version_id };
});

describe('SEC-IDOR host: citizen B against citizen A (same placement tenant)', () => {
  it('B cannot read A case, transitions or working data', async () => {
    const id = caseA.application_id;
    for (const path of [
      `/v1/applications/${id}`,
      `/v1/applications/${id}/transitions`,
      `/v1/applications/${id}/working-data`,
    ]) {
      const r = await call(API, 'GET', path, { token: b.token });
      expect([403, 404]).toContain(r.status);
      expect(r.text).not.toContain('SAMPLE Citizen Secverify');
      expect(r.text).not.toContain(a.citizen_id);
    }
  });

  it('B list never contains A applications; state filter does not widen it', async () => {
    for (const q of ['', '?state=SUBMITTED', '?limit=100']) {
      const r = await call(API, 'GET', `/v1/applications${q}`, { token: b.token });
      expect(r.status).toBe(200);
      const ids = (r.body['applications'] as { application_id: string }[]).map(
        (x) => x.application_id,
      );
      expect(ids).not.toContain(caseA.application_id);
      expect(ids).not.toContain(draftA.application_id);
    }
  });

  it('list rejects extra query keys that could carry owner/tenant overrides', async () => {
    for (const q of [
      `?applicant_id=${a.citizen_id}`,
      `?owner_id=${a.citizen_id}`,
      `?tenant_id=${TENANT_A}`,
    ]) {
      const r = await call(API, 'GET', `/v1/applications${q}`, { token: b.token });
      expect(r.status).toBe(400);
    }
  });

  it('B cannot write A working data or drive A commands', async () => {
    const wd = await call(API, 'PUT', `/v1/applications/${draftA.application_id}/working-data`, {
      token: b.token,
      idem: true,
      body: {
        form_version_id: draftA.form,
        data: { applicant_name: 'SAMPLE Attacker' },
        expected_revision: 0,
      },
    });
    expect([403, 404]).toContain(wd.status);
    for (const command of ['MARK_READY_TO_SUBMIT', 'RETURN_TO_DRAFT', 'SUBMIT']) {
      const r = await call(API, 'POST', `/v1/applications/${draftA.application_id}/commands`, {
        token: b.token,
        idem: true,
        body: { command, expected_state: draftA.state, expected_version: draftA.aggregate_version },
      });
      expect([403, 404]).toContain(r.status);
    }
    const own = await call(API, 'GET', `/v1/applications/${draftA.application_id}`, {
      token: a.token,
    });
    expect(own.body['application']).toMatchObject({
      state: 'DRAFT',
      aggregate_version: draftA.aggregate_version,
    });
    const ownWd = await call(API, 'GET', `/v1/applications/${draftA.application_id}/working-data`, {
      token: a.token,
    });
    expect(ownWd.status).toBe(404);
  });

  it('B cannot register requests on A case', async () => {
    const r = await call(API, 'POST', `/v1/applications/${caseA.application_id}/requests`, {
      token: b.token,
      idem: true,
      body: { kind: 'PAYMENT', request_id: '0d15ba00-dead-4000-8000-00000000dead' },
    });
    expect([400, 403, 404]).toContain(r.status);
  });

  it('F-09: host get-by-id answers another citizen case like a missing id', async () => {
    const other = await call(API, 'GET', `/v1/applications/${caseA.application_id}`, {
      token: b.token,
    });
    const absent = await call(API, 'GET', '/v1/applications/0d15ba00-0000-4000-8000-00000000abcd', {
      token: b.token,
    });
    expect(absent.status).toBe(404);
    expect
      .soft(other.status, 'existence oracle (other citizen case vs absent id)')
      .toBe(absent.status);
  });
});

describe('SEC-TEN tenant-identifying headers refused (SF-TEN-002)', () => {
  const headers: Record<string, string>[] = [
    { 'x-tenant-id': TENANT_A },
    { 'x-sf-tenant': TENANT_A },
    { 'tenant-id': TENANT_A },
    { 'x-roles': 'SAMPLE_LAB_CASE_OFFICER' },
    { 'x-actor-type': 'OFFICER' },
    { 'x-actor-id': '0d15ba00-0f01-4000-8000-0d15ba000f01' },
    { forwarded: `for=1.2.3.4;tenant=${TENANT_A}` },
  ];
  for (const h of headers) {
    it(`CMP-015 refuses ${Object.keys(h)[0]}`, async () => {
      const r = await call(API, 'GET', '/v1/applications', { token: a.token, headers: h });
      expect(r.status).toBe(403);
      expect(r.body['error_code']).toBe('SF-TEN-002');
    });
  }

  it('citizen BFF does not forward client tenant/role headers (list unchanged, no officer view)', async () => {
    const { cookie } = await bffCitizen();
    const r = await call(CITIZEN_BFF, 'GET', '/api/portal/applications', {
      cookie,
      headers: {
        'x-tenant-id': '0d15ba00-0001-4000-8000-0d15ba00ffff',
        'x-roles': 'SAMPLE_LAB_CASE_OFFICER',
      },
    });
    expect(r.status).toBe(200);
    expect(r.body['applications']).toEqual([]);
  });
});

describe('SEC-IDOR BFF: citizen B against citizen A', () => {
  it('BFF get-by-id for another citizen case is 404 with no PII', async () => {
    const { cookie } = await bffCitizen(b.mobile);
    const r = await call(CITIZEN_BFF, 'GET', `/api/portal/applications/${caseA.application_id}`, {
      cookie,
    });
    expect(r.status).toBe(404);
    expect(r.text).not.toContain('SAMPLE Citizen Secverify');
    const l = await call(CITIZEN_BFF, 'GET', '/api/portal/applications', { cookie });
    expect(JSON.stringify(l.body)).not.toContain(caseA.application_id);
  });

  it('BFF path traversal / non-UUID ids are refused before reaching the host', async () => {
    const { cookie } = await bffCitizen(b.mobile);
    for (const id of [
      '..%2F..%2Fv1%2Fapplications',
      `${caseA.application_id}%2Fworking-data`,
      'x',
    ]) {
      const r = await call(CITIZEN_BFF, 'GET', `/api/portal/applications/${id}`, { cookie });
      expect([404]).toContain(r.status);
    }
  });

  it('BFF responses with PII carry Cache-Control: no-store', async () => {
    const { cookie } = await bffCitizen(a.mobile);
    const r = await call(CITIZEN_BFF, 'GET', `/api/portal/applications/${caseA.application_id}`, {
      cookie,
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toMatch(/no-store/);
    const o = await bffOfficer();
    const q = await call(OFFICER_BFF, 'GET', `/api/portal/applications/${caseA.application_id}`, {
      cookie: o.cookie,
    });
    expect(q.status).toBe(200);
    expect(q.headers.get('cache-control')).toMatch(/no-store/);
  });
});

describe('SEC-AUTHZ officer commands and decision boundary', () => {
  const officerCommands = [
    'MARK_RECEIVED',
    'ENTER_SCRUTINY',
    'ENTER_DECISION_PENDING',
    'RAISE_DEFICIENCY',
    'RECORD_APPROVED',
    'RECORD_REJECTED',
    'CLOSE',
  ];
  for (const command of officerCommands) {
    it(`owning citizen cannot execute ${command} on own case`, async () => {
      const cur = await call(API, 'GET', `/v1/applications/${caseA.application_id}`, {
        token: a.token,
      });
      const app = cur.body['application'] as { state: string; aggregate_version: number };
      const r = await call(API, 'POST', `/v1/applications/${caseA.application_id}/commands`, {
        token: a.token,
        idem: true,
        body: {
          command,
          expected_state: app.state,
          expected_version: app.aggregate_version,
          ...(command.startsWith('RECORD_') ? { decision: { decision_maker: 'HUMAN' } } : {}),
          ...(command === 'RECORD_REJECTED' || command === 'RAISE_DEFICIENCY'
            ? { reason_code: 'X' }
            : {}),
        },
      });
      expect([400, 403, 409]).toContain(r.status);
      expect(r.status).not.toBe(200);
    });
  }

  it('officer decision without HUMAN attestation, or attested AI, is refused', async () => {
    const c = await citizenOnHost();
    const k = await submittedCase(c);
    const { token } = await officerOnHost();
    let app = { state: k.state, aggregate_version: k.aggregate_version };
    for (const command of ['MARK_RECEIVED', 'ENTER_SCRUTINY', 'ENTER_DECISION_PENDING']) {
      const r = await call(API, 'POST', `/v1/applications/${k.application_id}/commands`, {
        token,
        idem: true,
        body: { command, expected_state: app.state, expected_version: app.aggregate_version },
      });
      expect(r.status).toBe(200);
      app = r.body['application'] as typeof app;
    }
    const attempts: Record<string, unknown>[] = [
      {},
      { decision: { decision_maker: 'AI' } },
      { decision: { decision_maker: 'SYSTEM' } },
      { decision: { decision_maker: 'LLM' } },
      { decision: 'HUMAN' },
    ];
    for (const extra of attempts) {
      const r = await call(API, 'POST', `/v1/applications/${k.application_id}/commands`, {
        token,
        idem: true,
        body: {
          command: 'RECORD_APPROVED',
          expected_state: app.state,
          expected_version: app.aggregate_version,
          ...extra,
        },
      });
      expect(r.status, JSON.stringify(extra)).not.toBe(200);
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
    const ok = await call(API, 'POST', `/v1/applications/${k.application_id}/commands`, {
      token,
      idem: true,
      body: {
        command: 'RECORD_APPROVED',
        expected_state: app.state,
        expected_version: app.aggregate_version,
        decision: { decision_maker: 'HUMAN' },
      },
    });
    expect(ok.status).toBe(200);
  });

  it('officer can not write citizen working data (no WORKING_DATA_WRITE grant)', async () => {
    const { token } = await officerOnHost();
    const r = await call(API, 'PUT', `/v1/applications/${draftA.application_id}/working-data`, {
      token,
      idem: true,
      body: { form_version_id: draftA.form, data: SAMPLE_FORM, expected_revision: 0 },
    });
    expect(r.status).toBe(403);
  });

  it('officer cannot create a draft as a citizen (no APPLICATION_CREATE_DRAFT grant)', async () => {
    const { token } = await officerOnHost();
    const r = await call(API, 'POST', '/v1/applications', {
      token,
      idem: true,
      body: { tenant_service_binding_id: BINDING_A },
    });
    expect(r.status).toBe(403);
  });

  it('citizen BFF exposes no command/decision route; officer BFF decision route refuses citizens', async () => {
    const { cookie } = await bffCitizen(a.mobile);
    const post = await call(
      CITIZEN_BFF,
      'POST',
      `/api/portal/applications/${caseA.application_id}`,
      {
        cookie,
        body: { action: 'APPROVE' },
      },
    );
    expect([404, 405]).toContain(post.status);
    const crossed = `sf_officer_session=${cookieToken(cookie)}`;
    const dec = await call(
      OFFICER_BFF,
      'POST',
      `/api/portal/applications/${caseA.application_id}`,
      {
        cookie: crossed,
        body: { action: 'APPROVE' },
      },
    );
    expect(dec.status).toBe(401);
  });
});
