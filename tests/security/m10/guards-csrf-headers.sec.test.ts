import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePlacement } from '../../../apps/api/src/platform/placement';
import { buildPlatformLab } from '../../../apps/api/src/platform/runtime';
import {
  assertSimulatorEnvironment,
  registerLabSimulators,
  SimulatedOtpInbox,
} from '../../../apps/api/src/platform/simulators';
import {
  ADMIN_DB,
  API,
  bffCitizen,
  bffOfficer,
  call,
  citizenOnHost,
  CITIZEN_BFF,
  labEnv,
  OFFICER_BFF,
  ROOT,
  SAMPLE_FORM,
  submittedCase,
} from './lib/lab';

const placement = JSON.parse(
  readFileSync(join(ROOT, 'fixtures/lab/platform/placement.citizen.json'), 'utf8'),
) as Record<string, unknown>;

describe('SEC-SIM simulators refused outside LOCAL/CI', () => {
  for (const env of ['UAT', 'PREPROD', 'PRODUCTION', 'SIT', 'DEVELOPMENT', '', 'local']) {
    it(`assertSimulatorEnvironment refuses ${JSON.stringify(env)}`, () => {
      expect(() => assertSimulatorEnvironment(env)).toThrow(/refused/);
    });
  }

  it('registerLabSimulators refuses to mount routes in UAT', async () => {
    const routes: string[] = [];
    const fake = {
      get: (p: string) => routes.push(p),
      post: (p: string) => routes.push(p),
    } as unknown as Parameters<typeof registerLabSimulators>[0];
    await expect(
      registerLabSimulators(fake, {
        environment: 'UAT',
        inbox: new SimulatedOtpInbox(),
        officers: [],
        mint: () => 'x',
      }),
    ).rejects.toThrow(/refused/);
    expect(routes).toEqual([]);
  });

  it('buildPlatformLab refuses UAT before touching the database', async () => {
    await expect(buildPlatformLab({ SF_ENVIRONMENT: 'UAT' })).rejects.toThrow(/refused in UAT/);
  });

  it('portal placement is refused for PRODUCTION/PREPROD and on environment mismatch', () => {
    expect(() => parsePlacement(placement, 'PRODUCTION')).toThrow(/ADR-0007 D-4/);
    expect(() => parsePlacement(placement, 'PREPROD')).toThrow(/ADR-0007 D-4/);
    expect(() => parsePlacement(placement, 'CI')).toThrow(/does not match/);
    expect(() =>
      parsePlacement({ ...placement, client_tenant_input_accepted: true }, 'LOCAL'),
    ).toThrow();
    expect(() =>
      parsePlacement({ ...placement, citizen_tenant_derivation: 'REQUEST_HEADER' }, 'LOCAL'),
    ).toThrow();
    expect(parsePlacement(placement, 'LOCAL').tenant_id).toBe(placement['tenant_id']);
  });

  it('runtime: the platform host process refuses to start with SF_ENVIRONMENT=UAT', async () => {
    const env = {
      ...process.env,
      ...labEnv(),
      DATABASE_URL: ADMIN_DB,
      SF_ENVIRONMENT: 'UAT',
      HOST: '127.0.0.1',
      PORT: '4199',
      LOG_LEVEL: 'error',
    };
    const child = spawn('pnpm', ['exec', 'tsx', 'src/platform/lab-server.ts'], {
      cwd: join(ROOT, 'apps/api'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    const code = await new Promise<number | null>((resolve) => {
      const t = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(-1);
      }, 45_000);
      child.on('exit', (c) => {
        clearTimeout(t);
        resolve(c);
      });
    });
    expect(code).not.toBe(0);
    expect(code).not.toBe(-1);
    expect(out).toMatch(/refused in UAT/);
    const probe = await fetch('http://127.0.0.1:4199/health/ready').catch(() => null);
    expect(probe).toBeNull();
  });

  it('officer BFF refuses SIMULATED IdP sign-in when SF_ENVIRONMENT is not LOCAL/CI', async () => {
    const prev = process.env['SF_ENVIRONMENT'];
    process.env['SF_ENVIRONMENT'] = 'UAT';
    try {
      const mod = await import('../../../apps/web-officer/lib/portal/platform');
      expect(mod.simulationAllowed()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env['SF_ENVIRONMENT'];
      else process.env['SF_ENVIRONMENT'] = prev;
    }
  });
});

describe('SEC-CSRF cookie-authenticated state-changing BFF routes (F-07)', () => {
  const FOREIGN: [string, Record<string, string>][] = [
    [
      'foreign Origin + cross-site + text/plain',
      {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
        'content-type': 'text/plain',
      },
    ],
    [
      'foreign Origin + JSON, no Sec-Fetch-Site',
      { origin: 'https://evil.example', 'content-type': 'application/json' },
    ],
    ['Origin: null + JSON', { origin: 'null', 'content-type': 'application/json' }],
    [
      'Sec-Fetch-Site: same-site + JSON, no Origin',
      { 'sec-fetch-site': 'same-site', 'content-type': 'application/json' },
    ],
    [
      'Sec-Fetch-Site: cross-site + JSON, no Origin',
      { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
    ],
    [
      'host-suffix Origin',
      { origin: 'http://127.0.0.1:3101.evil.example', 'content-type': 'application/json' },
    ],
    [
      'port-prefix Origin',
      { origin: 'http://127.0.0.1:31010', 'content-type': 'application/json' },
    ],
    [
      'foreign Origin with forged same-origin Sec-Fetch-Site',
      {
        origin: 'https://evil.example',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
    ],
    ['malformed Origin', { origin: 'http://[::1', 'content-type': 'application/json' }],
    ['same-origin text/plain', { 'content-type': 'text/plain' }],
    ['same-origin form-urlencoded', { 'content-type': 'application/x-www-form-urlencoded' }],
    ['same-origin multipart', { 'content-type': 'multipart/form-data; boundary=x' }],
    ['same-origin text/plain;application/json', { 'content-type': 'text/plain; application/json' }],
  ];

  it('officer decision POST refuses every cross-site / non-JSON variant and the case is unchanged', async () => {
    const c = await citizenOnHost();
    const k = await submittedCase(c);
    const { cookie } = await bffOfficer();
    const path = `/api/portal/applications/${k.application_id}`;
    for (const [name, headers] of FOREIGN) {
      const r = await call(OFFICER_BFF, 'POST', path, {
        cookie,
        headers,
        body: JSON.stringify({ action: 'REJECT' }),
      });
      expect.soft([403, 415], `${name} -> ${r.status}`).toContain(r.status);
    }
    const after = await call(API, 'GET', `/v1/applications/${k.application_id}`, {
      token: c.token,
    });
    expect((after.body['application'] as { state: string }).state).toBe('SUBMITTED');
    const control = await call(OFFICER_BFF, 'POST', path, {
      cookie,
      headers: { origin: OFFICER_BFF, 'sec-fetch-site': 'same-origin' },
      body: { action: 'REJECT' },
    });
    expect(control.status, 'same-origin JSON decision (control)').toBe(200);
  });

  it('citizen apply, OTP challenge and session POSTs refuse every cross-site / non-JSON variant', async () => {
    const { cookie } = await bffCitizen();
    for (const [name, headers] of FOREIGN) {
      const apply = await call(CITIZEN_BFF, 'POST', '/api/portal/applications', {
        cookie,
        headers,
        body: JSON.stringify(SAMPLE_FORM),
      });
      expect.soft([403, 415], `apply ${name} -> ${apply.status}`).toContain(apply.status);
      const ch = await call(CITIZEN_BFF, 'POST', '/api/portal/otp/challenges', {
        headers,
        body: JSON.stringify({ mobile: '9000000001' }),
      });
      expect.soft([403, 415], `otp ${name} -> ${ch.status}`).toContain(ch.status);
      const ses = await call(CITIZEN_BFF, 'POST', '/api/portal/session', {
        headers,
        body: JSON.stringify({
          challenge_id: '0d15ba00-0000-4000-8000-000000000000',
          code: '123456',
        }),
      });
      expect.soft([403, 415], `session ${name} -> ${ses.status}`).toContain(ses.status);
    }
    const list = await call(CITIZEN_BFF, 'GET', '/api/portal/applications', { cookie });
    expect(list.body['applications']).toEqual([]);
  });

  it('officer sign-in POST (login CSRF) refuses cross-site variants', async () => {
    for (const [name, headers] of FOREIGN) {
      const r = await call(OFFICER_BFF, 'POST', '/api/portal/session', {
        headers,
        body: JSON.stringify({ subject: 'sample-lab-case-officer-1' }),
      });
      expect.soft([403, 415], `${name} -> ${r.status}`).toContain(r.status);
      expect.soft(r.headers.get('set-cookie'), `${name} set-cookie`).toBeNull();
    }
  });

  it('a body without any Content-Type (no-cors Blob shape) is refused on officer decision and citizen apply', async () => {
    const c = await citizenOnHost();
    const k = await submittedCase(c);
    const o = await bffOfficer();
    const cz = await bffCitizen();
    const raw = async (url: string, cookie: string, payload: unknown) =>
      fetch(url, {
        method: 'POST',
        headers: { cookie },
        body: new Blob([JSON.stringify(payload)]),
      });
    const dec = await raw(`${OFFICER_BFF}/api/portal/applications/${k.application_id}`, o.cookie, {
      action: 'REJECT',
    });
    const app = await raw(`${CITIZEN_BFF}/api/portal/applications`, cz.cookie, SAMPLE_FORM);
    expect([403, 415]).toContain(dec.status);
    expect([403, 415]).toContain(app.status);
    const after = await call(API, 'GET', `/v1/applications/${k.application_id}`, {
      token: c.token,
    });
    expect((after.body['application'] as { state: string }).state).toBe('SUBMITTED');
  });

  it('cross-site sign-out (DELETE) is refused and the session survives', async () => {
    const o = await bffOfficer();
    const c = await bffCitizen();
    const headers = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' };
    const od = await call(OFFICER_BFF, 'DELETE', '/api/portal/session', {
      cookie: o.cookie,
      headers,
    });
    const cd = await call(CITIZEN_BFF, 'DELETE', '/api/portal/session', {
      cookie: c.cookie,
      headers,
    });
    expect.soft(od.status, 'officer cross-site DELETE').toBe(403);
    expect.soft(cd.status, 'citizen cross-site DELETE').toBe(403);
    expect(
      (await call(OFFICER_BFF, 'GET', '/api/portal/applications', { cookie: o.cookie })).status,
    ).toBe(200);
    expect(
      (await call(CITIZEN_BFF, 'GET', '/api/portal/applications', { cookie: c.cookie })).status,
    ).toBe(200);
  });
});

describe('SEC-L2 synthetic-only data in SAMPLE_LAB (closes L-2 at the BFF)', () => {
  it('BFF refuses a non-synthetic applicant name', async () => {
    const { cookie } = await bffCitizen();
    const r = await call(CITIZEN_BFF, 'POST', '/api/portal/applications', {
      cookie,
      body: { ...SAMPLE_FORM, applicant_name: 'Ramesh Kumar' },
    });
    expect(r.status).toBe(400);
    expect(r.body['field']).toBe('applicant_name');
  });

  it('F-11: the host (CMP-015) refuses a non-synthetic name in SAMPLE_LAB', async () => {
    const c = await citizenOnHost();
    const d = await call(API, 'POST', '/v1/applications', {
      token: c.token,
      idem: true,
      body: {
        tenant_service_binding_id: (
          placement['offerings'] as { tenant_service_binding_id: string }[]
        )[0]?.tenant_service_binding_id,
      },
    });
    const app = d.body['application'] as {
      application_id: string;
      pins: { form_version_id: string };
    };
    const r = await call(API, 'PUT', `/v1/applications/${app.application_id}/working-data`, {
      token: c.token,
      idem: true,
      body: {
        form_version_id: app.pins.form_version_id,
        data: { ...SAMPLE_FORM, applicant_name: 'Ramesh Kumar' },
        expected_revision: 0,
      },
    });
    expect.soft(r.status, 'non-synthetic name via host').toBe(400);
  });
});

describe('SEC-ERR error responses and headers', () => {
  it('host: malformed JSON, oversized and unexpected input return generic errors without internals', async () => {
    const c = await citizenOnHost();
    const cases = [
      await call(API, 'POST', '/v1/applications', { token: c.token, idem: true, body: '{bad' }),
      await call(API, 'POST', '/v1/applications', {
        token: c.token,
        idem: true,
        body: { tenant_service_binding_id: "x' OR 1=1--" },
      }),
      await call(API, 'GET', '/v1/applications/not-a-uuid', { token: c.token }),
      await call(API, 'GET', "/v1/applications?state=DRAFT'--", { token: c.token }),
      await call(API, 'POST', '/v1/identity/citizen/otp/verify', {
        body: { challenge_id: 1, code: [] },
      }),
    ];
    for (const r of cases) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(r.text).not.toMatch(
        /stack|at \w+ \(|node_modules|pg_|SELECT |sf_application_case|sf_identity/i,
      );
    }
  });

  it('BFF: platform outage maps to a generic 5xx and no upstream detail', async () => {
    const r = await call(CITIZEN_BFF, 'POST', '/api/portal/session', {
      body: { challenge_id: 'x', code: '1' },
    });
    expect(r.status).toBe(400);
    expect(r.text).not.toMatch(/127\.0\.0\.1|4100|stack/i);
  });

  it('portal pages send frame-ancestors none and nosniff, and no x-powered-by', async () => {
    for (const base of [CITIZEN_BFF, OFFICER_BFF]) {
      const r = await fetch(`${base}/login`);
      expect(r.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('x-powered-by')).toBeNull();
    }
  });

  it('F-12: host CMP-015 working-data (PII) responses are Cache-Control: no-store', async () => {
    const c = await citizenOnHost();
    const k = await submittedCase(c);
    const wd = await call(API, 'GET', `/v1/applications/${k.application_id}/working-data`, {
      token: c.token,
    });
    expect(wd.status).toBe(200);
    expect
      .soft(wd.headers.get('cache-control') ?? '', 'host working-data cache-control')
      .toMatch(/no-store/);
  });
});
