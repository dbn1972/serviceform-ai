import {
  CONTRACT_ID,
  CONTRACT_STATUS,
  isOpaqueToken,
  isRef,
  STATUS_SOURCE_CMP,
  TOKEN_PURPOSE,
} from '../domain/token.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp023Error, detail } from '../errors.js';

export const CLIENT_TIME_KEYS: ReadonlySet<string> = new Set([
  'now',
  'clock_now',
  'current_time',
  'server_time',
  'timestamp',
  'occurred_at',
  'created_at',
  'status_checked_at',
]);

/** Server-derived identifiers and facts taken from CMP-022 / CMP-024: a client never sets them. */
const SERVER_OWNED_KEYS: ReadonlySet<string> = new Set([
  'token_id',
  'opaque_token',
  'correlation_id',
  'actor_id',
  'actor_type',
  'issuer_ref',
  'issued_at',
  'signed_artifact_sha256',
]);

/** Registry status belongs to CMP-024; any attempt to supply it is refused outright. */
const STATUS_KEYS: ReadonlySet<string> = new Set([
  'registry_status',
  'current_status',
  'status',
  'public_view',
]);

const CONSTANT_MARKERS: Readonly<Record<string, unknown>> = {
  contract_id: CONTRACT_ID,
  contract_status: CONTRACT_STATUS,
  freeze_status: CONTRACT_STATUS,
  token_purpose: TOKEN_PURPOSE,
  status_source_cmp: STATUS_SOURCE_CMP,
  registry_status_read_only: true,
  status_write_forbidden: true,
  embedded_pii_forbidden: true,
};

const RFC3339_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const RFC3339_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/;

function bad(pointer: string, code = 'INVALID_VALUE'): never {
  throw new Cmp023Error('SF-SYS-003', detail(code, pointer));
}

function asRecord(value: unknown, pointer = '/'): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) bad(pointer, 'OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}

export function assertNoClientTime(source: Record<string, unknown>, where: 'body' | 'query'): void {
  for (const key of Object.keys(source)) {
    if (CLIENT_TIME_KEYS.has(key)) {
      throw new Cmp023Error(
        'SF-SYS-003',
        detail('CLIENT_TIME_NOT_AUTHORITATIVE', `/${where}/${key}`),
      );
    }
  }
}

function commonChecks(rec: Record<string, unknown>, allowed: readonly string[]): void {
  assertNoClientTime(rec, 'body');
  if ('tenant_id' in rec) throw new Cmp023Error('SF-TEN-002', detail('TENANT_ID_SERVER_DERIVED'));
  for (const key of Object.keys(rec)) {
    if (STATUS_KEYS.has(key)) bad(`/${key}`, 'STATUS_WRITE_FORBIDDEN');
    if (SERVER_OWNED_KEYS.has(key)) bad(`/${key}`, 'SERVER_OWNED_FIELD');
    if (!allowed.includes(key)) bad(`/${key}`, 'UNKNOWN_FIELD');
  }
}

export interface IssueTokenInput {
  credential_id: string;
  credential_type_ref: string;
  expires_at: string | null;
}

export function validateIssueToken(body: unknown): IssueTokenInput {
  const rec = asRecord(body);
  commonChecks(rec, [
    'credential_id',
    'credential_type_ref',
    'expires_at',
    ...Object.keys(CONSTANT_MARKERS),
  ]);
  for (const [marker, expected] of Object.entries(CONSTANT_MARKERS)) {
    if (marker in rec && rec[marker] !== expected) bad(`/${marker}`, 'CONSTANT_MARKER_MISMATCH');
  }
  const id = rec['credential_id'];
  if (typeof id !== 'string' || !isUuid(id)) bad('/credential_id', 'UUID_REQUIRED');
  const typeRef = rec['credential_type_ref'];
  if (!isRef(typeRef)) bad('/credential_type_ref', 'REF_INVALID');
  const expires = rec['expires_at'];
  if (
    expires !== undefined &&
    (typeof expires !== 'string' ||
      !RFC3339_PREFIX.test(expires) ||
      !RFC3339_ZONE.test(expires) ||
      Number.isNaN(Date.parse(expires)))
  ) {
    bad('/expires_at', 'TIMESTAMP_INVALID');
  }
  return {
    credential_id: id.toLowerCase(),
    credential_type_ref: typeRef,
    expires_at: typeof expires === 'string' ? new Date(expires).toISOString() : null,
  };
}

export function validateEmptyInput(body: unknown): void {
  commonChecks(asRecord(body), []);
}

export function validateId(value: string | undefined, pointer: string): string {
  if (value === undefined || !isUuid(value)) bad(pointer, 'UUID_REQUIRED');
  return value.toLowerCase();
}

export function validateOpaqueToken(value: string | undefined): string {
  if (!isOpaqueToken(value)) bad('/opaque_token', 'TOKEN_FORMAT_INVALID');
  return value;
}
