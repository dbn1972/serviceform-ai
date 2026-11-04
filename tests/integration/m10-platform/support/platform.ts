import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/** SF-M10-B-INT harness: live SAMPLE_LAB hosts (run.sh), admin DB inspection, contract validators. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set; run tests/integration/m10-platform/run.sh`);
  return v;
}

export const HOST_A = (): string => env('SF_INT_HOST_A');
export const HOST_B = (): string => env('SF_INT_HOST_B');
export const TENANT_B_DIR = (): string => env('SF_INT_TENANT_B_DIR');
export const LAB_ENV_FILE = (): string => env('SF_INT_LAB_ENV_FILE');

export function readJson<T = Record<string, unknown>>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export interface Placement {
  portal_id: string;
  tenant_id: string;
  cell_id: string;
  offerings: { catalogue_id: string; tenant_service_binding_id: string }[];
}

export interface PublishedBinding {
  tenant_id: string;
  tenant_service_binding_id: string;
  service_id: string;
  pins: Record<string, string>;
}

export function labFixture(dir: string) {
  return {
    placement: readJson<Placement>(join(dir, 'placement.citizen.json')),
    binding: readJson<{ bindings: PublishedBinding[] }>(join(dir, 'published-bindings.json'))
      .bindings[0] as PublishedBinding,
    officer: readJson<{ officers: { subject: string; officer_id: string; tenant_id: string }[] }>(
      join(dir, 'officers.json'),
    ).officers[0] as { subject: string; officer_id: string; tenant_id: string },
  };
}

export const FIXTURE_A = () => labFixture(join(ROOT, 'fixtures/lab/platform'));
export const FIXTURE_B = () => labFixture(TENANT_B_DIR());

export function must<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}

export const TSB_A = (): string =>
  must(FIXTURE_A().placement.offerings[0], 'tenant A offering').tenant_service_binding_id;
export const TSB_B = (): string =>
  must(FIXTURE_B().placement.offerings[0], 'tenant B offering').tenant_service_binding_id;

let pool: pg.Pool | null = null;
/** Admin connection for inspection only (bypasses RLS as the cluster superuser). */
export function admin(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: env('SF_INT_ADMIN_URL'), max: 4 });
  return pool;
}
export async function closeAdmin(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
}

export interface Res {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

export async function call(
  host: string,
  method: string,
  path: string,
  opts: {
    token?: string | null;
    body?: unknown;
    idem?: string | false;
    headers?: Record<string, string>;
  } = {},
): Promise<Res> {
  const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  if (opts.idem !== false && method !== 'GET') headers['idempotency-key'] = opts.idem ?? key();
  const res = await fetch(`${host}${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { _raw: text };
  }
  return { status: res.status, headers: res.headers, body };
}

export const key = (): string => `int-${randomUUID()}`;

let mobileSeq = 0;
/** Synthetic Indian mobile in the 90000xxxxx block, unique per run. */
export function syntheticMobile(): string {
  mobileSeq += 1;
  const n = (Date.now() % 100000) * 10 + (mobileSeq % 10);
  return `+9190${String(n).padStart(8, '0').slice(-8)}`;
}

export interface CitizenSession {
  token: string;
  citizen_id: string;
  challenge: Res;
  verify: Res;
}

export async function citizenLogin(host: string, mobile: string): Promise<CitizenSession> {
  const challenge = await call(host, 'POST', '/v1/identity/citizen/otp/challenges', {
    body: { channel: mobile },
  });
  if (challenge.status !== 200) throw new Error(`challenge ${challenge.status}`);
  const challengeId = String(challenge.body['challenge_id']);
  const inbox = await call(host, 'GET', `/v1/simulated/otp-inbox/${challengeId}`);
  const verify = await call(host, 'POST', '/v1/identity/citizen/otp/verify', {
    body: { challenge_id: challengeId, code: inbox.body['code'] },
    idem: false,
  });
  if (verify.status !== 200) throw new Error(`verify ${verify.status}`);
  return {
    token: String(verify.body['session_token']),
    citizen_id: String(verify.body['citizen_id']),
    challenge,
    verify,
  };
}

export interface OfficerSession {
  token: string;
  officer_id: string;
  tenant_id: string;
  issue: Res;
}

export async function officerLogin(host: string, subject: string): Promise<OfficerSession> {
  const assertion = await call(host, 'POST', '/v1/simulated/idp/assertions', {
    body: { subject },
    idem: false,
  });
  if (assertion.status !== 200) throw new Error(`assertion ${assertion.status}`);
  const issue = await call(host, 'POST', '/v1/identity/officer/sessions', {
    body: { assertion: assertion.body['assertion'] },
  });
  if (issue.status !== 200) throw new Error(`officer session ${issue.status}`);
  return {
    token: String(issue.body['session_token']),
    officer_id: String(issue.body['officer_id']),
    tenant_id: String(issue.body['tenant_id']),
    issue,
  };
}

export interface App {
  application_id: string;
  state: string;
  aggregate_version: number;
  pins: Record<string, string>;
  [k: string]: unknown;
}

export async function createDraft(host: string, token: string, tsb: string): Promise<Res> {
  return call(host, 'POST', '/v1/applications', {
    token,
    body: { tenant_service_binding_id: tsb },
  });
}

export async function command(
  host: string,
  token: string,
  app: App,
  cmd: string,
  extra: Record<string, unknown> = {},
  idem?: string,
): Promise<Res> {
  return call(host, 'POST', `/v1/applications/${app.application_id}/commands`, {
    token,
    idem: idem ?? key(),
    body: {
      command: cmd,
      expected_state: app.state,
      expected_version: app.aggregate_version,
      ...extra,
    },
  });
}

export async function putWorkingData(
  host: string,
  token: string,
  app: App,
  data: Record<string, unknown>,
  expectedRevision: number,
): Promise<Res> {
  return call(host, 'PUT', `/v1/applications/${app.application_id}/working-data`, {
    token,
    body: {
      form_version_id: app.pins['form_version_id'],
      data,
      expected_revision: expectedRevision,
    },
  });
}

/** Synthetic SAMPLE_LAB residence form (no real person). */
export function syntheticForm(): Record<string, unknown> {
  return {
    applicant_name: 'SAMPLE Applicant Synthetic',
    applicant_dob: '1990-01-01',
    applicant_gender: 'OTHER',
    residence_address: {
      house_no_or_name: 'Lab House 1',
      locality: 'Synthetic Locality',
      district: 'Sample District',
      state_code: 'XX',
      pincode: '999999',
    },
    residence_duration_months: 36,
    purpose_of_certificate: 'SAMPLE_LAB_TEST',
    evidence_type: 'SAMPLE_LAB_DOC',
  };
}

// ---- Contract validators (Ajv from @serviceform/contracts, as CMP-015's contract tests do) ----

interface Validate {
  (data: unknown): boolean;
  errors?: unknown[] | null;
}
interface AjvLike {
  addSchema(schema: object): AjvLike;
  getSchema(id: string): Validate | undefined;
  compile(schema: object): Validate;
}

const fromContracts = createRequire(join(ROOT, 'packages/contracts/package.json'));
const { Ajv2020 } = fromContracts('ajv/dist/2020.js') as {
  Ajv2020: new (opts: object) => AjvLike;
};
const formatsMod = fromContracts('ajv-formats') as
  ((a: AjvLike) => void) | { default: (a: AjvLike) => void };
const addFormats = typeof formatsMod === 'function' ? formatsMod : formatsMod.default;

const CMP015_ID = 'https://int.serviceform.test/cmp-015/openapi-components';
let ajv: AjvLike | null = null;

function instance(): AjvLike {
  if (ajv) return ajv;
  // strict:false — OpenAPI 3.1 component schemas carry annotation-only keywords.
  const a = new Ajv2020({ allErrors: true, strict: false });
  addFormats(a);
  for (const dir of [
    'contracts/shared/schemas',
    'contracts/m05/schemas',
    'contracts/m10/schemas',
  ]) {
    for (const f of readdirSync(join(ROOT, dir)).filter((n) => n.endsWith('.schema.json'))) {
      a.addSchema(readJson(join(ROOT, dir, f)));
    }
  }
  const openapi = readJson<{ components: { schemas: Record<string, unknown> } }>(
    join(ROOT, 'services/cmp-015-application-case/contracts/openapi.json'),
  );
  const defs = JSON.parse(
    JSON.stringify(openapi.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'),
  ) as Record<string, unknown>;
  a.addSchema({ $id: CMP015_ID, $defs: defs });
  ajv = a;
  return a;
}

export function check(schemaRef: string, data: unknown): { valid: boolean; errors: unknown } {
  const fn = instance().getSchema(schemaRef);
  if (!fn) throw new Error(`schema ${schemaRef} not registered`);
  const valid = fn(data);
  return { valid, errors: fn.errors ?? null };
}

export const cmp015 = (name: string): string => `${CMP015_ID}#/$defs/${name}`;
export const ERROR_RESPONSE = 'https://contracts.serviceform.ai/error-response/v1';
export const PLACEMENT = 'https://contracts.serviceform.ai/m10/portal-placement/v1';
export const PORTAL_SESSION = 'https://contracts.serviceform.ai/m10/portal-session/v1';
export const VERSION_PINNING = 'https://contracts.serviceform.ai/m05/version-pinning/v1';
export const EVENT_ENVELOPE = 'https://contracts.serviceform.ai/event-envelope/v1';
export const AUDIT_EVENT = 'https://contracts.serviceform.ai/audit-event/v1';

/** All outbox rows for one aggregate, oldest first (admin; bypasses RLS). */
export async function outboxFor(aggregateId: string) {
  const r = await admin().query<{
    seq: string;
    topic: string;
    event_type: string;
    aggregate_version: string;
    tenant_id: string;
    envelope: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT seq, topic, event_type, aggregate_version, tenant_id, envelope, created_at
       FROM sf_application_case.outbox_event
      WHERE aggregate_id = $1 OR envelope->'data'->>'resource_id' = $2
         OR envelope->'data'->>'application_id' = $2
      ORDER BY seq`,
    [aggregateId, aggregateId],
  );
  return r.rows;
}
