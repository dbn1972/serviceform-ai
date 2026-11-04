import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  check,
  citizenLogin,
  closeAdmin,
  command,
  createDraft,
  FIXTURE_A,
  HOST_A,
  PORTAL_SESSION,
  putWorkingData,
  readJson,
  ROOT,
  syntheticForm,
  syntheticMobile,
  type App,
  must,
  TSB_A,
} from './support/platform.js';

/**
 * BFF seam: the citizen and officer Next.js route handlers (apps/web-citizen|web-officer, app/api/portal) invoked
 * in-process against live host A — the same code `next start` serves, without the browser.
 */

type Handler = (req: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
type RouteModule = Record<'GET' | 'POST' | 'DELETE', Handler>;

const CASE_STATES = readJson<{ components: { schemas: { CaseState: { enum: string[] } } } }>(
  join(ROOT, 'services/cmp-015-application-case/contracts/openapi.json'),
).components.schemas.CaseState.enum;

const citizenRoutes = {
  otp: () =>
    import('../../../apps/web-citizen/app/api/portal/otp/challenges/route') as Promise<RouteModule>,
  session: () =>
    import('../../../apps/web-citizen/app/api/portal/session/route') as Promise<RouteModule>,
  apps: () =>
    import('../../../apps/web-citizen/app/api/portal/applications/route') as Promise<RouteModule>,
  app: () =>
    import('../../../apps/web-citizen/app/api/portal/applications/[id]/route') as Promise<RouteModule>,
};
const officerRoutes = {
  session: () =>
    import('../../../apps/web-officer/app/api/portal/session/route') as Promise<RouteModule>,
  apps: () =>
    import('../../../apps/web-officer/app/api/portal/applications/route') as Promise<RouteModule>,
  app: () =>
    import('../../../apps/web-officer/app/api/portal/applications/[id]/route') as Promise<RouteModule>,
};

const req = (url: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  new Request(`http://bff.test${url}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function parseSetCookie(header: string | null) {
  const parts = (header ?? '').split(';').map((p) => p.trim());
  const [nv, ...attrs] = parts;
  const eq = (nv ?? '').indexOf('=');
  const flags = Object.fromEntries(
    attrs.map((a) => {
      const i = a.indexOf('=');
      return i < 0 ? [a.toLowerCase(), true] : [a.slice(0, i).toLowerCase(), a.slice(i + 1)];
    }),
  );
  return { name: (nv ?? '').slice(0, eq), value: (nv ?? '').slice(eq + 1), flags };
}

describe('citizen BFF on the platform path', () => {
  let cookie = '';
  let token = '';
  let submittedId = '';

  beforeAll(() => {
    process.env['SF_API_BASE_URL'] = HOST_A();
    process.env['SF_ENVIRONMENT'] = 'LOCAL';
    process.env['SF_PORTAL_PLACEMENT_FILE'] = join(
      ROOT,
      'fixtures/lab/platform/placement.citizen.json',
    );
  });
  afterAll(closeAdmin);

  it('OTP sign-in sets a cookie holding only the CMP-004 opaque token (SF-CON-PORTAL-SESSION)', async () => {
    const otp = await (
      await citizenRoutes.otp()
    ).POST(
      req('/api/portal/otp/challenges', {
        method: 'POST',
        body: { mobile: syntheticMobile().slice(3) },
      }),
    );
    expect(otp.status).toBe(201);
    const ch = (await otp.json()) as {
      challenge_id: string;
      simulated_sms: { code: string };
      simulation: unknown;
    };
    expect(ch.simulation).toMatchObject({ simulation: true });
    const s = await (
      await citizenRoutes.session()
    ).POST(
      req('/api/portal/session', {
        method: 'POST',
        body: { challenge_id: ch.challenge_id, code: ch.simulated_sms.code },
      }),
    );
    expect(s.status).toBe(201);
    const c = parseSetCookie(s.headers.get('set-cookie'));
    expect(c.name).toBe('sf_citizen_session');
    expect(c.value).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(() => JSON.parse(Buffer.from(c.value, 'base64').toString('utf8'))).toThrow();
    const me = await call(HOST_A(), 'GET', '/v1/identity/me', { token: c.value });
    expect(me.body['actor_type']).toBe('CITIZEN');
    const maxAge = Number(c.flags['max-age']);
    const descriptor = {
      surface: 'CITIZEN_PORTAL',
      cookie_name: c.name,
      cookie_value: 'CMP004_OPAQUE_SESSION_TOKEN',
      claims_in_cookie: false,
      token_issuer: 'CMP-004',
      identity_derivation: 'CMP004_IDENTITY_ME_PER_REQUEST',
      platform_credential: 'AUTHORIZATION_BEARER',
      attributes: {
        http_only: c.flags['httponly'] === true,
        same_site: c.flags['samesite'],
        path: c.flags['path'],
        secure: c.flags['secure'] === true ? 'ALWAYS' : 'WHEN_NOT_LOCAL_HTTP',
      },
      max_age_seconds: maxAge,
      revocation: 'CMP004_SESSIONS_REVOKE',
    };
    const r = check(PORTAL_SESSION, descriptor);
    expect(r.valid, JSON.stringify(r.errors)).toBe(true);
    token = c.value;
    cookie = `sf_citizen_session=${token}`;
  });

  it('a forged or unknown cookie is never decoded for identity', async () => {
    const forged = Buffer.from(
      JSON.stringify({
        citizen_id: '00000000-0000-4000-8000-000000000001',
        tenant_id: FIXTURE_A().placement.tenant_id,
      }),
    ).toString('base64url');
    for (const value of [forged, 'A'.repeat(43)]) {
      const s = await (
        await citizenRoutes.session()
      ).GET(req('/api/portal/session', { cookie: `sf_citizen_session=${value}` }));
      expect(((await s.json()) as { authenticated: boolean }).authenticated).toBe(false);
      const l = await (
        await citizenRoutes.apps()
      ).GET(req('/api/portal/applications', { cookie: `sf_citizen_session=${value}` }));
      expect(l.status).toBe(401);
    }
  });

  it('apply drives CMP-015 draft → working data → ready → submitted and the view mirrors CMP-015', async () => {
    const r = await (
      await citizenRoutes.apps()
    ).POST(req('/api/portal/applications', { method: 'POST', cookie, body: syntheticForm() }));
    expect(r.status).toBe(201);
    const body = (await r.json()) as { application: Record<string, unknown> };
    expect(body.application).toMatchObject({
      status: 'SUBMITTED',
      platform_state: 'SUBMITTED',
      source: 'PLATFORM',
    });
    submittedId = String(body.application['id']);
    const platformApp = await call(HOST_A(), 'GET', `/v1/applications/${submittedId}`, { token });
    expect((platformApp.body['application'] as App).state).toBe('SUBMITTED');
    expect((platformApp.body['application'] as App).pins).toEqual(FIXTURE_A().binding.pins);

    const list = await (
      await citizenRoutes.apps()
    ).GET(req('/api/portal/applications', { cookie }));
    const ids = ((await list.json()) as { applications: { id: string }[] }).applications.map(
      (a) => a.id,
    );
    expect(ids).toContain(submittedId);
    const one = await (
      await citizenRoutes.app()
    ).GET(req(`/api/portal/applications/${submittedId}`, { cookie }), params(submittedId));
    expect(one.status).toBe(200);
    expect(
      ((await one.json()) as { application: { applicant_name: string } }).application
        .applicant_name,
    ).toBe(syntheticForm()['applicant_name']);
  });

  it("another citizen's application is a uniform 404 through the BFF (no existence disclosure)", async () => {
    const other = await citizenLogin(HOST_A(), syntheticMobile());
    const r = await (
      await citizenRoutes.app()
    ).GET(
      req(`/api/portal/applications/${submittedId}`, {
        cookie: `sf_citizen_session=${other.token}`,
      }),
      params(submittedId),
    );
    expect(r.status).toBe(404);
    const missing = '00000000-0000-4000-8000-000000000000';
    const r2 = await (
      await citizenRoutes.app()
    ).GET(
      req(`/api/portal/applications/${missing}`, { cookie: `sf_citizen_session=${other.token}` }),
      params(missing),
    );
    expect(r2.status).toBe(404);
    expect(await r.json()).toEqual(await r2.json());
  });

  it('observed: the BFF apply is not idempotent — a repeated submit creates a second SUBMITTED case (INT-F5)', async () => {
    const make = async () =>
      (
        (await (
          await (
            await citizenRoutes.apps()
          ).POST(req('/api/portal/applications', { method: 'POST', cookie, body: syntheticForm() }))
        ).json()) as { application: { id: string; status: string } }
      ).application;
    const [a, b] = [await make(), await make()];
    expect(a.status).toBe('SUBMITTED');
    expect(b.status).toBe('SUBMITTED');
    expect(a.id).not.toBe(b.id);
  });

  it('sign-out revokes the CMP-004 session', async () => {
    const out = await (
      await citizenRoutes.session()
    ).DELETE(req('/api/portal/session', { method: 'DELETE', cookie }));
    expect(out.status).toBe(204);
    expect(parseSetCookie(out.headers.get('set-cookie')).flags['max-age']).toBe('0');
    expect((await call(HOST_A(), 'GET', '/v1/identity/me', { token })).status).toBe(401);
  });
});

describe('citizen view maps every CMP-015 state', () => {
  const ALLOWED = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ISSUED', 'CLOSED'];

  it('every CaseState maps to a defined portal status and platform_state is passed through unchanged', async () => {
    const { portalStatus, toPortalApplication } =
      await import('../../../apps/web-citizen/lib/portal/applications');
    for (const state of CASE_STATES) {
      expect(ALLOWED, state).toContain(portalStatus(state as never));
      const view = toPortalApplication(
        {
          application_id: '00000000-0000-4000-8000-000000000001',
          state: state as never,
          aggregate_version: 1,
          created_at: 'x',
          updated_at: 'x',
          submitted_at: null,
          pins: { form_version_id: 'f', tenant_service_binding_id: 't' },
        },
        { status: 'APPROVED', platform_state: 'ISSUED', id: 'spoof' },
      );
      expect(view.platform_state).toBe(state);
      expect(view.id).toBe('00000000-0000-4000-8000-000000000001');
      expect(view.status).toBe(portalStatus(state as never));
    }
  });

  // Known defect INT-F4 (owner web-citizen BFF): lossy mapping misstates the case to the citizen.
  it.fails(
    'withdrawn/cancelled cases are not shown as REJECTED, and DEFICIENCY_RAISED is not shown as plain SUBMITTED',
    async () => {
      const { portalStatus } = await import('../../../apps/web-citizen/lib/portal/applications');
      expect(portalStatus('WITHDRAWN')).not.toBe('REJECTED');
      expect(portalStatus('CANCELLED')).not.toBe('REJECTED');
      expect(portalStatus('DEFICIENCY_RAISED')).not.toBe('SUBMITTED');
    },
  );
});

describe('officer BFF decide() drives only legal transitions', () => {
  let officerCookie = '';
  let officerToken = '';
  let citizenToken = '';
  const tsb = () => TSB_A();

  async function submitted(): Promise<App> {
    let app = (await createDraft(HOST_A(), citizenToken, tsb())).body['application'] as App;
    await putWorkingData(HOST_A(), citizenToken, app, syntheticForm(), 0);
    for (const cmd of ['MARK_READY_TO_SUBMIT', 'SUBMIT']) {
      app = (await command(HOST_A(), citizenToken, app, cmd)).body['application'] as App;
    }
    return app;
  }

  async function transitionKeys(id: string): Promise<(string | null)[]> {
    const tr = await call(HOST_A(), 'GET', `/v1/applications/${id}/transitions`, {
      token: officerToken,
    });
    return (tr.body['transitions'] as { transition_key: string | null }[]).map(
      (t) => t.transition_key,
    );
  }

  beforeAll(async () => {
    process.env['SF_API_BASE_URL'] = HOST_A();
    process.env['SF_ENVIRONMENT'] = 'LOCAL';
    citizenToken = (await citizenLogin(HOST_A(), syntheticMobile())).token;
    const s = await (
      await officerRoutes.session()
    ).POST(
      req('/api/portal/session', {
        method: 'POST',
        body: { subject: FIXTURE_A().officer.subject },
      }),
    );
    expect(s.status).toBe(201);
    const c = parseSetCookie(s.headers.get('set-cookie'));
    expect(c.name).toBe('sf_officer_session');
    expect(c.flags['httponly']).toBe(true);
    officerToken = c.value;
    officerCookie = `sf_officer_session=${officerToken}`;
  });

  it('APPROVE from SUBMITTED walks received → scrutiny → decision_pending → approved', async () => {
    const app = await submitted();
    const queue = await (
      await officerRoutes.apps()
    ).GET(req('/api/portal/applications', { cookie: officerCookie }));
    const items = (
      (await queue.json()) as { applications: { id: string; platform_state: string }[] }
    ).applications;
    expect(items.map((a) => a.id)).toContain(app.application_id);
    for (const a of items) expect(['DRAFT', 'READY_TO_SUBMIT']).not.toContain(a.platform_state);

    const r = await (
      await officerRoutes.app()
    ).POST(
      req(`/api/portal/applications/${app.application_id}`, {
        method: 'POST',
        cookie: officerCookie,
        body: { action: 'APPROVE' },
      }),
      params(app.application_id),
    );
    expect(r.status).toBe(200);
    expect(
      ((await r.json()) as { application: { platform_state: string } }).application.platform_state,
    ).toBe('APPROVED');
    expect(await transitionKeys(app.application_id)).toEqual([
      null,
      'DRAFT>READY_TO_SUBMIT',
      'READY_TO_SUBMIT>SUBMITTED',
      'SUBMITTED>RECEIVED',
      'RECEIVED>UNDER_SCRUTINY',
      'UNDER_SCRUTINY>DECISION_PENDING',
      'DECISION_PENDING>APPROVED',
    ]);
    const tr = await call(HOST_A(), 'GET', `/v1/applications/${app.application_id}/transitions`, {
      token: officerToken,
    });
    const last = must((tr.body['transitions'] as Record<string, unknown>[]).at(-1));
    expect(last['actor_type']).toBe('OFFICER');
  });

  it('REJECT records a HUMAN rejection with a reason code', async () => {
    const app = await submitted();
    const r = await (
      await officerRoutes.app()
    ).POST(
      req(`/api/portal/applications/${app.application_id}`, {
        method: 'POST',
        cookie: officerCookie,
        body: { action: 'REJECT' },
      }),
      params(app.application_id),
    );
    expect(r.status).toBe(200);
    const tr = await call(HOST_A(), 'GET', `/v1/applications/${app.application_id}/transitions`, {
      token: officerToken,
    });
    const last = must((tr.body['transitions'] as Record<string, unknown>[]).at(-1));
    expect(last['transition_key']).toBe('DECISION_PENDING>REJECTED');
    expect(last['reason_code']).toBe('OFFICER_REJECTED');
  });

  it('decide() issues no command on decided, draft, deficiency or citizen-response cases', async () => {
    const decided = await submitted();
    await (
      await officerRoutes.app()
    ).POST(
      req(`/api/portal/applications/${decided.application_id}`, {
        method: 'POST',
        cookie: officerCookie,
        body: { action: 'APPROVE' },
      }),
      params(decided.application_id),
    );
    const draft = (await createDraft(HOST_A(), citizenToken, tsb())).body['application'] as App;
    let deficient = await submitted();
    for (const [cmd, extra] of [
      ['MARK_RECEIVED', {}],
      ['ENTER_SCRUTINY', {}],
      ['RAISE_DEFICIENCY', { reason_code: 'SAMPLE_LAB_DEFICIENCY' }],
    ] as const) {
      deficient = (await command(HOST_A(), officerToken, deficient, cmd, extra)).body[
        'application'
      ] as App;
    }
    let responded = await submitted();
    for (const [cmd, tok, extra] of [
      ['MARK_RECEIVED', officerToken, {}],
      ['ENTER_SCRUTINY', officerToken, {}],
      ['RAISE_DEFICIENCY', officerToken, { reason_code: 'SAMPLE_LAB_DEFICIENCY' }],
      ['RECORD_CITIZEN_RESPONSE', citizenToken, {}],
    ] as const) {
      responded = (await command(HOST_A(), tok, responded, cmd, extra)).body['application'] as App;
    }
    expect(responded.state).toBe('CITIZEN_RESPONSE');

    for (const app of [decided, draft, deficient, responded]) {
      const before = await transitionKeys(app.application_id);
      const r = await (
        await officerRoutes.app()
      ).POST(
        req(`/api/portal/applications/${app.application_id}`, {
          method: 'POST',
          cookie: officerCookie,
          body: { action: 'REJECT' },
        }),
        params(app.application_id),
      );
      expect(r.status, app.application_id).toBe(409);
      expect(await transitionKeys(app.application_id)).toEqual(before);
    }
  });

  it('bad actions and citizen cookies are refused by the officer BFF', async () => {
    const app = await submitted();
    const bad = await (
      await officerRoutes.app()
    ).POST(
      req(`/api/portal/applications/${app.application_id}`, {
        method: 'POST',
        cookie: officerCookie,
        body: { action: 'ISSUE' },
      }),
      params(app.application_id),
    );
    expect(bad.status).toBe(400);
    const asCitizen = await (
      await officerRoutes.app()
    ).POST(
      req(`/api/portal/applications/${app.application_id}`, {
        method: 'POST',
        cookie: `sf_officer_session=${citizenToken}`,
        body: { action: 'APPROVE' },
      }),
      params(app.application_id),
    );
    expect(asCitizen.status).toBe(401);
  });

  it('every CaseState maps to a workbench status without inventing states', async () => {
    const { workbenchStatus } = await import('../../../apps/web-officer/lib/portal/cases');
    for (const s of CASE_STATES) {
      expect(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ISSUED', 'CLOSED']).toContain(
        workbenchStatus(s),
      );
    }
  });
});
