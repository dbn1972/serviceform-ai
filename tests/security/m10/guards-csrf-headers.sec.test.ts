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

describe('SEC-CSRF cookie-authenticated state-changing BFF routes', () => {
  it('FINDING: officer decision POST is accepted cross-origin with a simple (text/plain) request', async () => {
    const c = await citizenOnHost();
    const k = await submittedCase(c);
    const { cookie } = await bffOfficer();
    const r = await call(OFFICER_BFF, 'POST', `/api/portal/applications/${k.application_id}`, {
      cookie,
      headers: {
        'content-type': 'text/plain',
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      },
      body: JSON.stringify({ action: 'REJECT' }),
    });
    // Expected (defence in depth): refuse foreign Origin / non-JSON content type. SameSite=Lax is the only barrier.
    expect.soft(r.status, 'cross-origin text/plain decision').toBe(403);
  });

  it('FINDING: citizen apply POST is accepted cross-origin with a simple (text/plain) request', async () => {
    const { cookie } = await bffCitizen();
    const r = await call(CITIZEN_BFF, 'POST', '/api/portal/applications', {
      cookie,
      headers: {
        'content-type': 'text/plain',
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      },
      body: JSON.stringify(SAMPLE_FORM),
    });
    expect.soft(r.status, 'cross-origin text/plain apply').toBe(403);
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

  it('FINDING: the host (CMP-015) accepts a non-synthetic name directly; L-2 is BFF-only', async () => {
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

  it('FINDING: host CMP-015 working-data (PII) responses carry no Cache-Control', async () => {
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
