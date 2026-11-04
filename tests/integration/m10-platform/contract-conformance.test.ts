import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  check,
  citizenLogin,
  closeAdmin,
  cmp015,
  command,
  createDraft,
  ERROR_RESPONSE,
  FIXTURE_A,
  HOST_A,
  officerLogin,
  PLACEMENT,
  putWorkingData,
  readJson,
  ROOT,
  syntheticForm,
  syntheticMobile,
  TENANT_B_DIR,
  VERSION_PINNING,
  type App,
  type CitizenSession,
  type OfficerSession,
  TSB_A,
} from './support/platform.js';

const expectValid = (ref: string, data: unknown) => {
  const r = check(ref, data);
  expect(r.errors, `${ref}: ${JSON.stringify(r.errors)}`).toBeNull();
  expect(r.valid).toBe(true);
};

describe('CMP-004 contract surface on the platform host', () => {
  const openapi = readJson<{ paths: Record<string, Record<string, Record<string, unknown>>> }>(
    join(ROOT, 'services/cmp-004-identity-access/contracts/openapi.json'),
  );

  it('documents every route the host serves', () => {
    for (const p of [
      '/v1/identity/citizen/otp/challenges',
      '/v1/identity/citizen/otp/verify',
      '/v1/identity/citizen/sessions/revoke',
      '/v1/identity/me',
      '/v1/identity/officer/sessions',
      '/v1/identity/officer/sessions/revoke',
    ]) {
      expect(openapi.paths[p], p).toBeTruthy();
    }
  });

  // Known defect INT-F1 (owner CMP-004): response conformance cannot be machine-checked.
  it.fails('declares request/response schemas for every operation', () => {
    const ops = Object.values(openapi.paths).flatMap((o) => Object.values(o));
    for (const op of ops) expect('responses' in op, String(op['operationId'])).toBe(true);
  });

  let citizen: CitizenSession;
  let officer: OfficerSession;
  beforeAll(async () => {
    citizen = await citizenLogin(HOST_A(), syntheticMobile());
    officer = await officerLogin(HOST_A(), FIXTURE_A().officer.subject);
  });

  it('OTP challenge/verify/me shapes are stable and carry no OTP or channel', () => {
    expect(Object.keys(citizen.challenge.body).sort()).toEqual([
      'challenge_id',
      'expires_at',
      'simulation',
    ]);
    expect(Object.keys(citizen.verify.body).sort()).toEqual([
      'citizen_id',
      'expires_at',
      'session_token',
    ]);
    expect(JSON.stringify(citizen.challenge.body)).not.toMatch(/\+91|code/);
    expect(citizen.token).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
  });

  it('me returns a platform-global citizen (tenant_id null) and the OFFICER tenant for officers', async () => {
    const me = await call(HOST_A(), 'GET', '/v1/identity/me', { token: citizen.token });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      actor_type: 'CITIZEN',
      subject_id: citizen.citizen_id,
      tenant_id: null,
      assurance: 'OTP',
    });
    const om = await call(HOST_A(), 'GET', '/v1/identity/me', { token: officer.token });
    expect(om.status).toBe(200);
    expect(om.body).toMatchObject({
      actor_type: 'OFFICER',
      subject_id: officer.officer_id,
      tenant_id: FIXTURE_A().placement.tenant_id,
    });
    expect(Object.keys(officer.issue.body).sort()).toEqual([
      'expires_at',
      'officer_id',
      'session_token',
      'tenant_id',
    ]);
  });

  it('error bodies validate against error-response/v1', async () => {
    const unauth = await call(HOST_A(), 'GET', '/v1/identity/me', { token: 'x'.repeat(43) });
    expect(unauth.status).toBe(401);
    expectValid(ERROR_RESPONSE, unauth.body);
    const badOtp = await call(HOST_A(), 'POST', '/v1/identity/citizen/otp/verify', {
      body: { challenge_id: '00000000-0000-4000-8000-000000000000', code: '000000' },
      idem: false,
    });
    expect([400, 401, 404]).toContain(badOtp.status);
    expectValid(ERROR_RESPONSE, badOtp.body);
    const noAssertion = await call(HOST_A(), 'POST', '/v1/identity/officer/sessions', {
      body: { assertion: 'not-a-signed-assertion' },
    });
    expect([400, 401]).toContain(noAssertion.status);
    expectValid(ERROR_RESPONSE, noAssertion.body);
  });

  it('revoke invalidates citizen and officer sessions (INT-001 sign-out)', async () => {
    const c = await citizenLogin(HOST_A(), syntheticMobile());
    const r = await call(HOST_A(), 'POST', '/v1/identity/citizen/sessions/revoke', {
      token: c.token,
      body: {},
    });
    expect(r.status).toBeLessThan(300);
    const after = await call(HOST_A(), 'GET', '/v1/identity/me', { token: c.token });
    expect(after.status).toBe(401);
    expectValid(ERROR_RESPONSE, after.body);
    const apps = await call(HOST_A(), 'GET', '/v1/applications', { token: c.token });
    expect(apps.status).toBe(401);

    const o = await officerLogin(HOST_A(), FIXTURE_A().officer.subject);
    const ro = await call(HOST_A(), 'POST', '/v1/identity/officer/sessions/revoke', {
      token: o.token,
      body: {},
    });
    expect(ro.status).toBeLessThan(300);
    expect((await call(HOST_A(), 'GET', '/v1/identity/me', { token: o.token })).status).toBe(401);
  });

  it('wrong OTP issues no session', async () => {
    const ch = await call(HOST_A(), 'POST', '/v1/identity/citizen/otp/challenges', {
      body: { channel: syntheticMobile() },
    });
    const code = String(
      (await call(HOST_A(), 'GET', `/v1/simulated/otp-inbox/${String(ch.body['challenge_id'])}`))
        .body['code'],
    );
    const wrong = code === '000000' ? '111111' : '000000';
    const v = await call(HOST_A(), 'POST', '/v1/identity/citizen/otp/verify', {
      body: { challenge_id: ch.body['challenge_id'], code: wrong },
      idem: false,
    });
    expect(v.status).toBe(401);
    expect(v.body['session_token']).toBeUndefined();
    expectValid(ERROR_RESPONSE, v.body);
  });
});

describe('CMP-015 responses validate against the component OpenAPI schemas', () => {
  let citizen: CitizenSession;
  let officer: OfficerSession;
  let app: App;
  afterAll(closeAdmin);
  beforeAll(async () => {
    citizen = await citizenLogin(HOST_A(), syntheticMobile());
    officer = await officerLogin(HOST_A(), FIXTURE_A().officer.subject);
  });

  it('createApplicationDraft → CreateDraftResponse (+ version-pinning/v1)', async () => {
    const r = await createDraft(HOST_A(), citizen.token, TSB_A());
    expect(r.status).toBe(201);
    expectValid(cmp015('CreateDraftResponse'), r.body);
    expectValid(VERSION_PINNING, r.body['version_pinning']);
    app = r.body['application'] as App;
    expect(app.state).toBe('DRAFT');
  });

  it('put/get working data → WorkingDataResponse', async () => {
    const put = await putWorkingData(HOST_A(), citizen.token, app, syntheticForm(), 0);
    expect(put.status).toBe(200);
    expectValid(cmp015('WorkingDataResponse'), put.body);
    const get = await call(HOST_A(), 'GET', `/v1/applications/${app.application_id}/working-data`, {
      token: citizen.token,
    });
    expect(get.status).toBe(200);
    expectValid(cmp015('WorkingDataResponse'), get.body);
    expect((get.body['working_data'] as { data: unknown }).data).toEqual(syntheticForm());
  });

  it('commands → CommandResponse; get → ApplicationResponse; list → ApplicationListResponse; transitions → TransitionListResponse', async () => {
    for (const cmd of ['MARK_READY_TO_SUBMIT', 'SUBMIT']) {
      const r = await command(HOST_A(), citizen.token, app, cmd);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expectValid(cmp015('CommandResponse'), r.body);
      app = r.body['application'] as App;
    }
    const get = await call(HOST_A(), 'GET', `/v1/applications/${app.application_id}`, {
      token: citizen.token,
    });
    expect(get.status).toBe(200);
    expectValid(cmp015('ApplicationResponse'), get.body);

    const listC = await call(HOST_A(), 'GET', '/v1/applications?limit=10', {
      token: citizen.token,
    });
    expect(listC.status).toBe(200);
    expectValid(cmp015('ApplicationListResponse'), listC.body);
    const listO = await call(HOST_A(), 'GET', '/v1/applications?state=SUBMITTED&limit=100', {
      token: officer.token,
    });
    expect(listO.status).toBe(200);
    expectValid(cmp015('ApplicationListResponse'), listO.body);
    for (const a of listO.body['applications'] as App[]) expect(a.state).toBe('SUBMITTED');

    const tr = await call(HOST_A(), 'GET', `/v1/applications/${app.application_id}/transitions`, {
      token: officer.token,
    });
    expect(tr.status).toBe(200);
    expectValid(cmp015('TransitionListResponse'), tr.body);
  });

  it('CMP-015 error responses validate against error-response/v1', async () => {
    const stale = await call(HOST_A(), 'POST', `/v1/applications/${app.application_id}/commands`, {
      token: officer.token,
      body: { command: 'MARK_RECEIVED', expected_state: 'SUBMITTED', expected_version: 1 },
    });
    expect(stale.status).toBe(409);
    expectValid(ERROR_RESPONSE, stale.body);
    const bad = await call(HOST_A(), 'GET', '/v1/applications?limit=1000', {
      token: officer.token,
    });
    expect(bad.status).toBe(400);
    expectValid(ERROR_RESPONSE, bad.body);
    const missing = await call(
      HOST_A(),
      'GET',
      '/v1/applications/00000000-0000-4000-8000-000000000000',
      { token: officer.token },
    );
    expect(missing.status).toBe(404);
    expectValid(ERROR_RESPONSE, missing.body);
  });
});

describe('SF-CON-PORTAL-PLACEMENT', () => {
  it('both lab placements (tenant A fixture, tenant B derived) satisfy the contract', () => {
    expectValid(PLACEMENT, readJson(join(ROOT, 'fixtures/lab/platform/placement.citizen.json')));
    expectValid(PLACEMENT, readJson(join(TENANT_B_DIR(), 'placement.citizen.json')));
  });

  it('a client-supplied tenant header is refused (ADR-0007 D-1)', async () => {
    const c = await citizenLogin(HOST_A(), syntheticMobile());
    for (const h of ['x-tenant-id', 'x-sf-tenant-id']) {
      const r = await call(HOST_A(), 'GET', '/v1/applications', {
        token: c.token,
        headers: { [h]: '0d15ba00-0001-4000-8000-0d15ba0000b1' },
      });
      expect(r.status, h).toBeGreaterThanOrEqual(400);
      expect(r.body['applications']).toBeUndefined();
    }
  });
});
