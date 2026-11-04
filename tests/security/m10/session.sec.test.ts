import { describe, expect, it } from 'vitest';
import {
  API,
  bffCitizen,
  bffOfficer,
  call,
  citizenOnHost,
  CITIZEN_BFF,
  cookieToken,
  LAB_OFFICER,
  mint,
  OFFICER_BFF,
  officerOnHost,
  OTHER_TENANT,
  TENANT_A,
} from './lib/lab';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('SEC-SESSION portal cookies (ADR-0007 D-3, closes L-1)', () => {
  const forgedPayload = {
    citizen_id: '00000000-0000-4000-8000-000000000001',
    account_id: '00000000-0000-4000-8000-000000000001',
    display_name: 'SAMPLE Forged',
    assurance: 'OTP',
    exp: 9_999_999_999,
  };
  const forged: [string, string][] = [
    ['legacy lab cookie name (base64 JSON)', `sf_lab_session=${b64(forgedPayload)}`],
    ['base64 JSON in the portal cookie', `sf_citizen_session=${b64(forgedPayload)}`],
    ['base64url JSON in the portal cookie', `sf_citizen_session=${b64url(forgedPayload)}`],
    ['random 43-char token-shaped value', `sf_citizen_session=${'A'.repeat(43)}`],
    [
      'JWT-shaped alg=none',
      `sf_citizen_session=${b64url({ alg: 'none' })}.${b64url(forgedPayload)}.`,
    ],
    [
      'duplicate cookie, forged first',
      `sf_citizen_session=${'B'.repeat(43)}; sf_citizen_session=x`,
    ],
  ];

  for (const [name, cookie] of forged) {
    it(`citizen BFF treats ${name} as anonymous`, async () => {
      const s = await call(CITIZEN_BFF, 'GET', '/api/portal/session', { cookie });
      expect(s.status).toBe(200);
      expect(s.body['authenticated']).toBe(false);
      const list = await call(CITIZEN_BFF, 'GET', '/api/portal/applications', { cookie });
      expect(list.status).toBe(401);
    });
  }

  it('citizen session cookie is HttpOnly, SameSite=Lax, Path=/ and holds only an opaque token', async () => {
    const { setCookie, cookie } = await bffCitizen();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    const value = cookieToken(cookie);
    expect(value).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    for (const decoded of [
      Buffer.from(value, 'base64').toString('utf8'),
      Buffer.from(value, 'base64url').toString('utf8'),
    ]) {
      expect(decoded).not.toMatch(/citizen_id|subject|tenant|assurance|"exp"/);
    }
  });

  it('officer session cookie is HttpOnly, SameSite=Lax and holds only an opaque token', async () => {
    const { setCookie, cookie } = await bffOfficer();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(cookieToken(cookie)).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(Buffer.from(cookieToken(cookie), 'base64url').toString('utf8')).not.toMatch(
      /officer_id|tenant|roles/,
    );
  });

  it('citizen token placed in the officer cookie gets no officer session or queue', async () => {
    const { cookie } = await bffCitizen();
    const crossed = `sf_officer_session=${cookieToken(cookie)}`;
    const s = await call(OFFICER_BFF, 'GET', '/api/portal/session', { cookie: crossed });
    expect(s.body['authenticated']).toBe(false);
    const q = await call(OFFICER_BFF, 'GET', '/api/portal/applications', { cookie: crossed });
    expect(q.status).toBe(401);
  });

  it('officer token placed in the citizen cookie gets no citizen session or applications', async () => {
    const { cookie } = await bffOfficer();
    const crossed = `sf_citizen_session=${cookieToken(cookie)}`;
    const s = await call(CITIZEN_BFF, 'GET', '/api/portal/session', { cookie: crossed });
    expect(s.body['authenticated']).toBe(false);
    const list = await call(CITIZEN_BFF, 'GET', '/api/portal/applications', { cookie: crossed });
    expect(list.status).toBe(401);
  });

  it('a revoked citizen session (BFF sign-out) is unusable on the BFF and on the host', async () => {
    const { cookie } = await bffCitizen();
    expect((await call(CITIZEN_BFF, 'GET', '/api/portal/applications', { cookie })).status).toBe(
      200,
    );
    const out = await call(CITIZEN_BFF, 'DELETE', '/api/portal/session', { cookie });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie') ?? '').toMatch(/Max-Age=0/);
    expect((await call(CITIZEN_BFF, 'GET', '/api/portal/applications', { cookie })).status).toBe(
      401,
    );
    const token = cookieToken(cookie);
    expect((await call(API, 'GET', '/v1/identity/me', { token })).status).toBe(401);
    expect((await call(API, 'GET', '/v1/applications', { token })).status).toBe(401);
  });

  it('a revoked officer session is unusable', async () => {
    const { cookie } = await bffOfficer();
    expect((await call(OFFICER_BFF, 'GET', '/api/portal/applications', { cookie })).status).toBe(
      200,
    );
    expect((await call(OFFICER_BFF, 'DELETE', '/api/portal/session', { cookie })).status).toBe(204);
    expect((await call(OFFICER_BFF, 'GET', '/api/portal/applications', { cookie })).status).toBe(
      401,
    );
    expect(
      (await call(API, 'GET', '/v1/applications', { token: cookieToken(cookie) })).status,
    ).toBe(401);
  });

  it('host: missing, malformed and unknown bearer tokens are 401', async () => {
    for (const token of [null, 'x', 'A'.repeat(43), b64url({ sub: 'x' })]) {
      expect((await call(API, 'GET', '/v1/applications', { token })).status).toBe(401);
    }
    const basic = await call(API, 'GET', '/v1/applications', {
      headers: { authorization: 'Basic Y2k6Y2k=' },
    });
    expect(basic.status).toBe(401);
  });

  it('officer assertion for a tenant other than the placement tenant yields no session or context', async () => {
    const assertion = await mint({
      sub: 'sample-lab-foreign-officer',
      tenant_id: OTHER_TENANT,
      officer_id: '0d15ba00-0f02-4000-8000-0d15ba000f02',
      roles: [LAB_OFFICER.role],
      assurance: 'MFA',
    });
    const { res, token } = await officerOnHost(assertion);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(token).toBe('');
  });

  it('officer assertion with a forged signature, expired exp or tampered tenant is refused', async () => {
    const good = await mint({
      sub: LAB_OFFICER.subject,
      tenant_id: TENANT_A,
      officer_id: LAB_OFFICER.officer_id,
      roles: [LAB_OFFICER.role],
    });
    const [p, msg, sig] = good.split('.') as [string, string, string];
    const tamperedMsg = b64url({
      ...(JSON.parse(Buffer.from(msg, 'base64url').toString('utf8')) as object),
      tenant_id: OTHER_TENANT,
    });
    const expired = await mint({
      sub: LAB_OFFICER.subject,
      tenant_id: TENANT_A,
      officer_id: LAB_OFFICER.officer_id,
      roles: [LAB_OFFICER.role],
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    for (const a of [`${p}.${tamperedMsg}.${sig}`, `${p}.${msg}.${'0'.repeat(64)}`, expired, 'x']) {
      const { res, token } = await officerOnHost(a);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(token).toBe('');
    }
  });

  it('host: a citizen session from CMP-004 never resolves officer roles on CMP-015', async () => {
    const c = await citizenOnHost();
    const me = await call(API, 'GET', '/v1/identity/me', { token: c.token });
    expect(me.body['actor_type']).toBe('CITIZEN');
    expect(me.body['tenant_id']).toBeNull();
  });
});
