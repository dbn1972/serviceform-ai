import { HANDOFF_TOKEN } from '../domain/handoff.js';
import { isChannel, isOpaqueRef, type Channel } from '../domain/session.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp057Error, detail } from '../errors.js';

export const CLIENT_TIME_KEYS: ReadonlySet<string> = new Set([
  'now',
  'clock_now',
  'current_time',
  'server_time',
  'timestamp',
  'occurred_at',
  'created_at',
  'updated_at',
  'started_at',
  'verified_at',
  'captured_at',
  'acted_at',
]);

/**
 * Server-owned: the operator identity (applied_by) is the authenticated actor and never a body
 * field; lifecycle, versions and contract constants are derived by CMP-057.
 */
const SERVER_OWNED_KEYS: ReadonlySet<string> = new Set([
  'contract_id',
  'contract_status',
  'freeze_status',
  'invented_statutory_policy_forbidden',
  'applied_by_actor_id',
  'applied_by',
  'applied_by_distinct_from_applied_for',
  'lifecycle_status',
  'status',
  'session_id',
  'session_version',
  'idempotency_key',
  'actor',
  'correlation_id',
  'handoff_token_hash',
  'closure_reason',
]);

function bad(pointer: string, code = 'INVALID_VALUE'): never {
  throw new Cmp057Error('SF-SYS-003', detail(code, pointer));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) bad('/', 'BODY_OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}

export function assertNoClientTime(source: Record<string, unknown>, where: 'body' | 'query'): void {
  for (const key of Object.keys(source)) {
    if (CLIENT_TIME_KEYS.has(key)) {
      throw new Cmp057Error(
        'SF-SYS-003',
        detail('CLIENT_TIME_NOT_AUTHORITATIVE', `/${where}/${key}`),
      );
    }
  }
}

function commonChecks(rec: Record<string, unknown>, allowed: readonly string[]): void {
  assertNoClientTime(rec, 'body');
  if ('tenant_id' in rec) throw new Cmp057Error('SF-TEN-002', detail('TENANT_ID_SERVER_DERIVED'));
  for (const key of Object.keys(rec)) {
    if (SERVER_OWNED_KEYS.has(key)) bad(`/${key}`, 'SERVER_OWNED_FIELD');
    if (!allowed.includes(key)) bad(`/${key}`, 'UNKNOWN_FIELD');
  }
}

function expectedVersion(rec: Record<string, unknown>): number {
  const v = rec['expected_version'];
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) {
    bad('/expected_version', 'EXPECTED_VERSION_REQUIRED');
  }
  return v;
}

function uuidField(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  if (typeof v !== 'string' || !isUuid(v)) bad(`/${key}`, 'UUID_REQUIRED');
  return v.toLowerCase();
}

function refField(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  if (!isOpaqueRef(v)) bad(`/${key}`, 'OPAQUE_REF_REQUIRED');
  return v;
}

export function validateReadRequest(
  body: unknown,
  query: Readonly<Record<string, string | string[] | undefined>>,
): void {
  if (body !== undefined && body !== null) {
    const rec = asRecord(body);
    if (Object.keys(rec).length > 0) bad('/', 'READ_PORT_ACCEPTS_NO_BODY');
  }
  const keys = Object.keys(query);
  if (keys.length > 0) bad(`/query/${keys[0] ?? ''}`, 'READ_PORT_ACCEPTS_NO_QUERY');
}

export interface StartInput {
  channel: Channel;
  applied_for_citizen_id: string;
}

export function validateStart(body: unknown): StartInput {
  const rec = asRecord(body);
  commonChecks(rec, ['channel', 'applied_for_citizen_id']);
  if (!isChannel(rec['channel'])) bad('/channel', 'CHANNEL_INVALID');
  return {
    channel: rec['channel'],
    applied_for_citizen_id: uuidField(rec, 'applied_for_citizen_id'),
  };
}

export interface BindApplicantInput {
  expected_version: number;
  applicant_assurance_ref: string;
}

export function validateBindApplicant(body: unknown): BindApplicantInput {
  const rec = asRecord(body);
  commonChecks(rec, ['expected_version', 'applicant_assurance_ref']);
  return {
    expected_version: expectedVersion(rec),
    applicant_assurance_ref: refField(rec, 'applicant_assurance_ref'),
  };
}

export interface RepresentationInput {
  expected_version: number;
  representation_authority_ref: string | null;
  representation_valid_until: string | null;
  consent_ref: string;
}

/** The validity instant belongs to the referenced evidence; CMP-057 never computes a period. */
export function validateRepresentation(body: unknown): RepresentationInput {
  const rec = asRecord(body);
  commonChecks(rec, [
    'expected_version',
    'representation_authority_ref',
    'representation_valid_until',
    'consent_ref',
    'read_back_acknowledged',
  ]);
  const ref = rec['representation_authority_ref'];
  if (ref !== undefined && ref !== null && !isOpaqueRef(ref)) {
    bad('/representation_authority_ref', 'OPAQUE_REF_REQUIRED');
  }
  const until = rec['representation_valid_until'];
  let validUntil: string | null = null;
  if (until !== undefined && until !== null) {
    if (
      typeof until !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(until)
    ) {
      bad('/representation_valid_until', 'DATE_TIME_REQUIRED');
    }
    const ms = Date.parse(until);
    if (Number.isNaN(ms)) bad('/representation_valid_until', 'DATE_TIME_REQUIRED');
    validUntil = new Date(ms).toISOString();
  }
  if (rec['read_back_acknowledged'] !== true) {
    bad('/read_back_acknowledged', 'READ_BACK_ACKNOWLEDGEMENT_REQUIRED');
  }
  return {
    expected_version: expectedVersion(rec),
    representation_authority_ref: typeof ref === 'string' ? ref : null,
    representation_valid_until: validUntil,
    consent_ref: refField(rec, 'consent_ref'),
  };
}

export interface ApplicationLinkInput {
  expected_version: number;
  application_id: string;
}

export function validateApplicationLink(body: unknown): ApplicationLinkInput {
  const rec = asRecord(body);
  commonChecks(rec, ['expected_version', 'application_id']);
  return {
    expected_version: expectedVersion(rec),
    application_id: uuidField(rec, 'application_id'),
  };
}

export interface CloseInput {
  expected_version: number;
}

export function validateClose(body: unknown): CloseInput {
  const rec = asRecord(body);
  commonChecks(rec, ['expected_version']);
  return { expected_version: expectedVersion(rec) };
}

export interface ResumeInput {
  handoff_token: string;
}

export function validateResume(body: unknown): ResumeInput {
  const rec = asRecord(body);
  commonChecks(rec, ['handoff_token']);
  const t = rec['handoff_token'];
  if (typeof t !== 'string' || !HANDOFF_TOKEN.test(t))
    bad('/handoff_token', 'HANDOFF_TOKEN_REQUIRED');
  return { handoff_token: t };
}

export function validateId(value: string | undefined, pointer: string): string {
  if (value === undefined || !isUuid(value)) bad(pointer, 'UUID_REQUIRED');
  return value.toLowerCase();
}
