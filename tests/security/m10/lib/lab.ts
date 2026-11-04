import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as PgModule from 'pg';
import type { Client as PgClient } from 'pg';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const API = process.env['SF_SEC_API'] ?? 'http://127.0.0.1:4100';
export const CITIZEN_BFF = process.env['SF_SEC_CITIZEN_BFF'] ?? 'http://127.0.0.1:3100';
export const OFFICER_BFF = process.env['SF_SEC_OFFICER_BFF'] ?? 'http://127.0.0.1:3101';
export const OPA = process.env['SF_SEC_OPA'] ?? 'http://127.0.0.1:8281';
export const ADMIN_DB = process.env['SF_SEC_ADMIN_DB'] ?? '';

export const PLACEMENT = JSON.parse(
  readFileSync(join(ROOT, 'fixtures/lab/platform/placement.citizen.json'), 'utf8'),
) as { tenant_id: string; offerings: { tenant_service_binding_id: string }[] };
export const TENANT_A = PLACEMENT.tenant_id;
export const BINDING_A = PLACEMENT.offerings[0]?.tenant_service_binding_id as string;
export const OTHER_TENANT = '0d15ba00-0001-4000-8000-0d15ba00ffff';
export const LAB_OFFICER = {
  subject: 'sample-lab-case-officer-1',
  officer_id: '0d15ba00-0f01-4000-8000-0d15ba000f01',
  role: 'SAMPLE_LAB_CASE_OFFICER',
};

/** Reads the gitignored lab env (pepper, runtime DB URLs). Values are never logged. */
export function labEnv(): Record<string, string> {
  const file = join(ROOT, '.platform-lab/env');
  if (!existsSync(file)) throw new Error('platform lab is not bootstrapped (.platform-lab/env)');
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}

const pgRequire = createRequire(join(ROOT, 'apps/api/package.json'));
const pg = pgRequire('pg') as typeof PgModule;

export async function db(url: string): Promise<PgClient> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

export interface Res {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
  text: string;
}

export async function call(
  base: string,
  method: string,
  path: string,
  opts: {
    token?: string | null;
    cookie?: string;
    body?: unknown;
    headers?: Record<string, string>;
    idem?: boolean;
  } = {},
): Promise<Res> {
  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['content-type'] ??= 'application/json';
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  if (opts.cookie) headers['cookie'] = opts.cookie;
  if (opts.idem) headers['idempotency-key'] = `sec-${randomUUID()}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    redirect: 'manual',
    ...(opts.body !== undefined
      ? { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) }
      : {}),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, headers: res.headers, body, text };
}

/** Synthetic lab mobile (starts with 9, never a real allocation range claim). */
export function syntheticMobile(): string {
  return `9${String(randomInt(0, 1_000_000_000)).padStart(9, '0')}`;
}

export async function otpChallenge(mobile: string): Promise<{ challenge_id: string; res: Res }> {
  const res = await call(API, 'POST', '/v1/identity/citizen/otp/challenges', {
    body: { channel: `+91${mobile}` },
    idem: true,
  });
  return { challenge_id: String(res.body['challenge_id']), res };
}

export async function inboxCode(challengeId: string): Promise<string> {
  const res = await call(API, 'GET', `/v1/simulated/otp-inbox/${challengeId}`);
  if (res.status !== 200) throw new Error(`inbox ${res.status}`);
  return String(res.body['code']);
}

export interface CitizenSession {
  token: string;
  citizen_id: string;
  mobile: string;
}

/** Citizen sign-in directly on the API host (CMP-004 OTP). */
export async function citizenOnHost(mobile = syntheticMobile()): Promise<CitizenSession> {
  const { challenge_id } = await otpChallenge(mobile);
  const code = await inboxCode(challenge_id);
  const res = await call(API, 'POST', '/v1/identity/citizen/otp/verify', {
    body: { challenge_id, code },
  });
  if (res.status !== 200) throw new Error(`verify ${res.status}`);
  return {
    token: String(res.body['session_token']),
    citizen_id: String(res.body['citizen_id']),
    mobile,
  };
}

export async function officerOnHost(assertion?: string): Promise<{ token: string; res: Res }> {
  let a = assertion;
  if (!a) {
    const minted = await call(API, 'POST', '/v1/simulated/idp/assertions', {
      body: { subject: LAB_OFFICER.subject },
    });
    a = String(minted.body['assertion']);
  }
  const res = await call(API, 'POST', '/v1/identity/officer/sessions', {
    body: { assertion: a },
    idem: true,
  });
  return { token: String(res.body['session_token'] ?? ''), res };
}

type MintFn = (
  pepper: string,
  claims: {
    sub: string;
    tenant_id: string;
    officer_id: string;
    roles: string[];
    assurance?: 'MFA' | 'PASSWORD';
    exp?: number;
  },
) => string;

export async function mint(claims: Parameters<MintFn>[1]): Promise<string> {
  const mod =
    (await import('../../../../services/cmp-004-identity-access/src/adapters/idp.js')) as unknown as {
      mintSimulatedIdpAssertion: MintFn;
    };
  const pepper = labEnv()['SF_CMP004_PEPPER'];
  if (!pepper) throw new Error('pepper missing');
  return mod.mintSimulatedIdpAssertion(pepper, claims);
}

export const SAMPLE_FORM = {
  applicant_name: 'SAMPLE Citizen Secverify',
  applicant_dob: '1990-01-01',
  applicant_gender: 'OTHER',
  residence_address: {
    house_no_or_name: 'SAMPLE House 1',
    locality: 'SAMPLE Locality',
    district: 'SAMPLE District',
    state_code: 'XX',
    pincode: '999999',
  },
  residence_duration_months: 24,
  purpose_of_certificate: 'SAMPLE purpose',
  evidence_type: 'SAMPLE_EVIDENCE',
};

/** Creates a draft, writes working data and submits it on the host as the citizen. */
export async function submittedCase(c: CitizenSession): Promise<{
  application_id: string;
  state: string;
  aggregate_version: number;
  form_version_id: string;
}> {
  const draft = await call(API, 'POST', '/v1/applications', {
    token: c.token,
    idem: true,
    body: { tenant_service_binding_id: BINDING_A },
  });
  if (draft.status !== 201) throw new Error(`draft ${draft.status} ${draft.text}`);
  let app = draft.body['application'] as {
    application_id: string;
    state: string;
    aggregate_version: number;
    pins: { form_version_id: string };
  };
  const wd = await call(API, 'PUT', `/v1/applications/${app.application_id}/working-data`, {
    token: c.token,
    idem: true,
    body: { form_version_id: app.pins.form_version_id, data: SAMPLE_FORM, expected_revision: 0 },
  });
  if (wd.status !== 200) throw new Error(`wd ${wd.status} ${wd.text}`);
  for (const command of ['MARK_READY_TO_SUBMIT', 'SUBMIT']) {
    const r = await call(API, 'POST', `/v1/applications/${app.application_id}/commands`, {
      token: c.token,
      idem: true,
      body: { command, expected_state: app.state, expected_version: app.aggregate_version },
    });
    if (r.status !== 200) throw new Error(`${command} ${r.status} ${r.text}`);
    app = r.body['application'] as typeof app;
  }
  return {
    application_id: app.application_id,
    state: app.state,
    aggregate_version: app.aggregate_version,
    form_version_id: app.pins.form_version_id,
  };
}

export async function bffCitizen(
  mobile = syntheticMobile(),
): Promise<{ cookie: string; setCookie: string }> {
  const ch = await call(CITIZEN_BFF, 'POST', '/api/portal/otp/challenges', { body: { mobile } });
  if (ch.status !== 201) throw new Error(`bff challenge ${ch.status} ${ch.text}`);
  const sms = ch.body['simulated_sms'] as { code: string } | undefined;
  if (!sms) throw new Error('no simulated sms');
  const s = await call(CITIZEN_BFF, 'POST', '/api/portal/session', {
    body: { challenge_id: ch.body['challenge_id'], code: sms.code },
  });
  const setCookie = s.headers.get('set-cookie') ?? '';
  if (s.status !== 201 || !setCookie) throw new Error(`bff session ${s.status}`);
  return { cookie: setCookie.split(';')[0] as string, setCookie };
}

export async function bffOfficer(): Promise<{ cookie: string; setCookie: string }> {
  const s = await call(OFFICER_BFF, 'POST', '/api/portal/session', {
    body: { subject: LAB_OFFICER.subject },
  });
  const setCookie = s.headers.get('set-cookie') ?? '';
  if (s.status !== 201 || !setCookie) throw new Error(`bff officer ${s.status}`);
  return { cookie: setCookie.split(';')[0] as string, setCookie };
}

export function cookieToken(cookie: string): string {
  return cookie.slice(cookie.indexOf('=') + 1);
}
