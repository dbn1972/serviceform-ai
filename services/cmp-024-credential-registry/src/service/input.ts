import { isOpaqueRef, type RegistryCommand } from '../domain/status.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp024Error, detail } from '../errors.js';

export const CLIENT_TIME_KEYS: ReadonlySet<string> = new Set([
  'now',
  'clock_now',
  'current_time',
  'server_time',
  'timestamp',
  'occurred_at',
  'created_at',
  'updated_at',
  'registered_at',
  'changed_at',
]);

/** Registry-owned fields: status and history are derived by CMP-024, never supplied. */
const SERVER_OWNED_KEYS: ReadonlySet<string> = new Set([
  'contract_id',
  'contract_status',
  'freeze_status',
  'status_authority_cmp',
  'current_status',
  'status',
  'to_status',
  'from_status',
  'history',
  'history_append_only',
  'invented_statutory_policy_forbidden',
  'status_version',
  'entry_id',
  'sequence',
  'immutable',
  'actor',
  'correlation_id',
]);

function bad(pointer: string, code = 'INVALID_VALUE'): never {
  throw new Cmp024Error('SF-SYS-003', detail(code, pointer));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) bad('/', 'BODY_OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}

export function assertNoClientTime(source: Record<string, unknown>, where: 'body' | 'query'): void {
  for (const key of Object.keys(source)) {
    if (CLIENT_TIME_KEYS.has(key)) {
      throw new Cmp024Error(
        'SF-SYS-003',
        detail('CLIENT_TIME_NOT_AUTHORITATIVE', `/${where}/${key}`),
      );
    }
  }
}

function commonChecks(rec: Record<string, unknown>, allowed: readonly string[]): void {
  assertNoClientTime(rec, 'body');
  if ('tenant_id' in rec) throw new Cmp024Error('SF-TEN-002', detail('TENANT_ID_SERVER_DERIVED'));
  for (const key of Object.keys(rec)) {
    if (SERVER_OWNED_KEYS.has(key)) bad(`/${key}`, 'SERVER_OWNED_FIELD');
    if (!allowed.includes(key)) bad(`/${key}`, 'UNKNOWN_FIELD');
  }
}

/**
 * Read ports accept no input beyond the path: no body and no query parameters, so nothing on a
 * status read can be interpreted as a status change.
 */
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

export interface RegisterInput {
  credential_id: string;
  issuer_ref: string;
}

export function validateRegister(body: unknown): RegisterInput {
  const { credential_id: credentialId, ...rec } = asRecord(body);
  commonChecks(rec, ['issuer_ref']);
  if (typeof credentialId !== 'string' || !isUuid(credentialId)) {
    bad('/credential_id', 'UUID_REQUIRED');
  }
  if (!isOpaqueRef(rec['issuer_ref'])) bad('/issuer_ref', 'OPAQUE_REF_REQUIRED');
  return { credential_id: credentialId.toLowerCase(), issuer_ref: rec['issuer_ref'] };
}

export interface TransitionInput {
  expected_version: number;
  reason_code_ref: string | null;
  superseded_by_credential_id: string | null;
}

const REASON_MANDATORY: ReadonlySet<RegistryCommand> = new Set(['SUSPEND', 'REVOKE']);

export function validateTransition(command: RegistryCommand, body: unknown): TransitionInput {
  const rec = asRecord(body);
  const allowed = ['expected_version', 'reason_code_ref'];
  if (command === 'REISSUE') allowed.push('superseded_by_credential_id');
  commonChecks(rec, allowed);
  const expected = rec['expected_version'];
  if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1) {
    bad('/expected_version', 'EXPECTED_VERSION_REQUIRED');
  }
  const reason = rec['reason_code_ref'];
  if (reason === undefined || reason === null) {
    if (REASON_MANDATORY.has(command)) bad('/reason_code_ref', 'REASON_CODE_REF_REQUIRED');
  } else if (!isOpaqueRef(reason)) {
    bad('/reason_code_ref', 'REASON_CODE_REF_INVALID');
  }
  let successor: string | null = null;
  if (command === 'REISSUE') {
    const s = rec['superseded_by_credential_id'];
    if (typeof s !== 'string' || !isUuid(s)) bad('/superseded_by_credential_id', 'UUID_REQUIRED');
    successor = s.toLowerCase();
  }
  return {
    expected_version: expected,
    reason_code_ref: typeof reason === 'string' ? reason : null,
    superseded_by_credential_id: successor,
  };
}

export function validateId(value: string | undefined, pointer: string): string {
  if (value === undefined || !isUuid(value)) bad(pointer, 'UUID_REQUIRED');
  return value.toLowerCase();
}
