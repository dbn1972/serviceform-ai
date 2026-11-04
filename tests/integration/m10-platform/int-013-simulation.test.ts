import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  call,
  check,
  citizenLogin,
  closeAdmin,
  FIXTURE_A,
  HOST_A,
  LAB_ENV_FILE,
  officerLogin,
  ROOT,
  syntheticMobile,
  type CitizenSession,
  type OfficerSession,
} from './support/platform.js';

/** Loopback liveness probe via node:http (no fetch('http://...') for SAST); null when refused. */
function probeLoopback(port: number, path: string): Promise<number | null> {
  return new Promise((resolve) => {
    const req = request(
      { hostname: '127.0.0.1', port, path, method: 'GET', timeout: 2000 },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? null);
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

const SIM_MARKER = 'https://contracts.serviceform.ai/simulation-marker/v1';

function labEnv(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(LAB_ENV_FILE(), 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}

/** Runs a process to completion (or kills it after `ms`); output is kept in memory only. */
function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; ms: number },
): Promise<{ code: number | null; out: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.ms);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out, timedOut });
    });
  });
}

describe('INT-013 SIMULATED connectors are labelled', () => {
  let citizen: CitizenSession;
  let officer: OfficerSession;
  beforeAll(async () => {
    citizen = await citizenLogin(HOST_A(), syntheticMobile());
    officer = await officerLogin(HOST_A(), FIXTURE_A().officer.subject);
  });
  afterAll(closeAdmin);

  it('the CMP-004 OTP challenge carries a simulation-marker/v1 for the LOCAL environment', () => {
    const marker = citizen.challenge.body['simulation'];
    const r = check(SIM_MARKER, marker);
    expect(r.valid, JSON.stringify(r.errors)).toBe(true);
    expect(marker).toMatchObject({
      simulation: true,
      environment: 'LOCAL',
      scenario: 'otp_challenge',
    });
  });

  it('lab simulator endpoints label every response', async () => {
    const officers = await call(HOST_A(), 'GET', '/v1/simulated/idp/officers');
    expect(officers.body['simulation']).toBe(true);
    const assertion = await call(HOST_A(), 'POST', '/v1/simulated/idp/assertions', {
      body: { subject: FIXTURE_A().officer.subject },
      idem: false,
    });
    expect(assertion.body['simulation']).toBe(true);
    expect(assertion.headers.get('cache-control')).toBe('no-store');
  });

  // Known defect INT-F2 (owner CMP-004): Eng v1.4 s10.4 — every simulated transaction is marked.
  it.fails(
    'sessions minted from SIMULATED OTP/IdP carry a simulation marker in the HTTP response',
    () => {
      expect(check(SIM_MARKER, citizen.verify.body['simulation']).valid).toBe(true);
      expect(check(SIM_MARKER, officer.issue.body['simulation']).valid).toBe(true);
    },
  );

  it('observed: CMP-004 domain events — OfficerSessionIssued and CitizenOtpChallengeCreated are marked; CitizenSessionIssued is not', async () => {
    const r = await admin().query<{ event_type: string; marked: boolean }>(
      `SELECT event_type, bool_and(coalesce((envelope->'data'->>'simulation')::boolean, false)) AS marked
         FROM (SELECT event_type, envelope FROM sf_identity.outbox_event
               UNION ALL SELECT event_type, envelope FROM sf_identity.outbox_event_platform) e
        WHERE event_type <> 'AuditEventSubmitted' GROUP BY event_type`,
    );
    const marked = Object.fromEntries(r.rows.map((x) => [x.event_type, x.marked]));
    expect(marked['OfficerSessionIssued']).toBe(true);
    expect(marked['CitizenOtpChallengeCreated']).toBe(true);
    expect(marked['CitizenSessionIssued']).toBe(false);
  });

  it('the OTP inbox returns 404 for unknown or malformed challenge ids', async () => {
    expect((await call(HOST_A(), 'GET', '/v1/simulated/otp-inbox/not-a-uuid')).status).toBe(404);
    expect(
      (await call(HOST_A(), 'GET', '/v1/simulated/otp-inbox/00000000-0000-4000-8000-000000000000'))
        .status,
    ).toBe(404);
  });
});

describe('INT-013 / ADR-0007 D-4: the SAMPLE_LAB host refuses non-LOCAL/CI environments', () => {
  const api = join(ROOT, 'apps/api');

  for (const environment of ['DEVELOPMENT', 'SIT', 'UAT', 'PREPROD', 'PRODUCTION']) {
    it(`lab-server exits without listening when SF_ENVIRONMENT=${environment}`, async () => {
      const env = labEnv();
      const port = '4209';
      const res = await run('pnpm', ['exec', 'tsx', 'src/platform/lab-server.ts'], {
        cwd: api,
        ms: 45_000,
        env: {
          ...env,
          SF_ENVIRONMENT: environment,
          DATABASE_URL: env['DATABASE_URL_CMP015'] ?? '',
          HOST: '127.0.0.1',
          PORT: port,
          LOG_LEVEL: 'warn',
        },
      });
      expect(res.timedOut, 'host kept running').toBe(false);
      expect(res.code).not.toBe(0);
      expect(res.out).toMatch(
        /SIMULATED lab simulators are refused|not accepted for production|does not match SF_ENVIRONMENT/,
      );
      const probe = await probeLoopback(port, '/health/ready');
      expect(probe).toBeNull();
    });
  }

  it('the bootstrap refuses UAT before touching the database', async () => {
    const res = await run('node', ['scripts/platform-lab-bootstrap.mjs'], {
      cwd: api,
      ms: 20_000,
      env: {
        SF_ENVIRONMENT: 'UAT',
        DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
        SF_PLATFORM_LAB_ENV_FILE: '/tmp/sf-int-should-not-exist.env',
      },
    });
    expect(res.code).toBe(1);
    expect(res.out).toContain('refused in UAT');
  });

  it('a CI runtime refuses a LOCAL placement (placement environment must match)', async () => {
    const env = labEnv();
    const res = await run('pnpm', ['exec', 'tsx', 'src/platform/lab-server.ts'], {
      cwd: api,
      ms: 45_000,
      env: { ...env, SF_ENVIRONMENT: 'CI', HOST: '127.0.0.1', PORT: '4209', LOG_LEVEL: 'warn' },
    });
    expect(res.timedOut).toBe(false);
    expect(res.code).not.toBe(0);
    expect(res.out).toContain('does not match SF_ENVIRONMENT');
  });
});
