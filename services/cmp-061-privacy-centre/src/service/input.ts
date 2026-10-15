import {
  isOpaqueRef,
  isOwnerComponent,
  isRequestType,
  MAX_SCOPE_ITEMS,
  type RequestType,
  type ScopeItem,
  type TaskOutcome,
} from '../domain/request.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp061Error, detail } from '../errors.js';

export const CLIENT_TIME_KEYS: ReadonlySet<string> = new Set([
  'now',
  'clock_now',
  'current_time',
  'server_time',
  'timestamp',
  'occurred_at',
  'created_at',
  'updated_at',
  'decided_at',
  'due_at',
  'deadline',
]);

/** Server-derived or constant fields: a client may never set them. */
const SERVER_OWNED_KEYS: ReadonlySet<string> = new Set([
  'contract_id',
  'contract_status',
  'freeze_status',
  'request_id',
  'request_version',
  'lifecycle_status',
  'idempotency_key',
  'correlation_id',
  'subject_actor_id',
  'task_id',
  'task_status',
  'task_version',
  'scope_seq',
]);

/** Constant contract markers a client may echo but never flip. */
const CONSTANT_TRUE_MARKERS = [
  'invented_statutory_policy_forbidden',
  'cross_component_direct_mutation_forbidden',
  'owner_task_orchestration_only',
] as const;

function bad(pointer: string, code = 'INVALID_VALUE'): never {
  throw new Cmp061Error('SF-SYS-003', detail(code, pointer));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) bad('/', 'BODY_OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}

export function assertNoClientTime(source: Record<string, unknown>, where: 'body' | 'query'): void {
  for (const key of Object.keys(source)) {
    if (CLIENT_TIME_KEYS.has(key)) {
      throw new Cmp061Error(
        'SF-SYS-003',
        detail('CLIENT_TIME_NOT_AUTHORITATIVE', `/${where}/${key}`),
      );
    }
  }
}

function commonChecks(rec: Record<string, unknown>, allowed: readonly string[]): void {
  assertNoClientTime(rec, 'body');
  if ('tenant_id' in rec) throw new Cmp061Error('SF-TEN-002', detail('TENANT_ID_SERVER_DERIVED'));
  for (const marker of CONSTANT_TRUE_MARKERS) {
    if (marker in rec && rec[marker] !== true) bad(`/${marker}`, 'CONSTANT_MARKER_MUST_BE_TRUE');
  }
  for (const key of Object.keys(rec)) {
    if (SERVER_OWNED_KEYS.has(key)) bad(`/${key}`, 'SERVER_OWNED_FIELD');
    if (!allowed.includes(key) && !(CONSTANT_TRUE_MARKERS as readonly string[]).includes(key)) {
      bad(`/${key}`, 'UNKNOWN_FIELD');
    }
  }
}

function opaqueRef(value: unknown, pointer: string): string {
  if (value === undefined || value === null) bad(pointer, 'POLICY_INPUT_REQUIRED');
  if (!isOpaqueRef(value)) bad(pointer, 'OPAQUE_REF_INVALID');
  return value;
}

export function validateEmptyInput(body: unknown): void {
  commonChecks(asRecord(body), []);
}

export interface SubmitRequestInput {
  request_type: RequestType;
  scope: ScopeItem[];
}

/**
 * The citizen names what they ask for and which owning components hold the data. A legal basis
 * is never accepted from the requester: it is an owner/officer-supplied opaque reference.
 */
export function validateSubmitRequest(body: unknown): SubmitRequestInput {
  const rec = asRecord(body);
  if ('legal_basis_or_exception_ref' in rec) {
    bad('/legal_basis_or_exception_ref', 'OWNER_SUPPLIED_FIELD');
  }
  commonChecks(rec, ['request_type', 'scope']);
  const type = rec['request_type'];
  if (!isRequestType(type)) bad('/request_type', 'REQUEST_TYPE_INVALID');
  const scope = rec['scope'];
  if (!Array.isArray(scope) || scope.length === 0) bad('/scope', 'SCOPE_REQUIRED');
  if (scope.length > MAX_SCOPE_ITEMS) bad('/scope', 'SCOPE_TOO_LARGE');
  const seen = new Set<string>();
  const items = scope.map((raw: unknown, i): ScopeItem => {
    const pointer = `/scope/${i}`;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      bad(pointer, 'SCOPE_ITEM_OBJECT_REQUIRED');
    }
    const item = raw as Record<string, unknown>;
    for (const key of Object.keys(item)) {
      if (key !== 'owner_component' && key !== 'scope_ref') bad(`${pointer}/${key}`, 'UNKNOWN_FIELD');
    }
    const owner = item['owner_component'];
    if (owner === 'CMP-061') bad(`${pointer}/owner_component`, 'SELF_TASK_FORBIDDEN');
    if (!isOwnerComponent(owner)) bad(`${pointer}/owner_component`, 'OWNER_COMPONENT_INVALID');
    const ref = item['scope_ref'];
    if (!isOpaqueRef(ref)) bad(`${pointer}/scope_ref`, 'OPAQUE_REF_INVALID');
    const key = `${owner}|${ref}`;
    if (seen.has(key)) bad(pointer, 'SCOPE_DUPLICATE');
    seen.add(key);
    return { scope_seq: i + 1, owner_component: owner, scope_ref: ref };
  });
  return { request_type: type, scope: items };
}

export interface DenyInput {
  legal_basis_or_exception_ref: string;
  expected_version: number;
}

function expectedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    bad('/expected_version', 'EXPECTED_VERSION_REQUIRED');
  }
  return value;
}

export function validateDeny(body: unknown): DenyInput {
  const rec = asRecord(body);
  commonChecks(rec, ['legal_basis_or_exception_ref', 'expected_version']);
  return {
    legal_basis_or_exception_ref: opaqueRef(
      rec['legal_basis_or_exception_ref'],
      '/legal_basis_or_exception_ref',
    ),
    expected_version: expectedVersion(rec['expected_version']),
  };
}

export function validateVersioned(body: unknown): number {
  const rec = asRecord(body);
  commonChecks(rec, ['expected_version']);
  return expectedVersion(rec['expected_version']);
}

export interface TaskOutcomeInput {
  owner_component: string;
  outcome: TaskOutcome;
  evidence_ref: string | null;
  legal_basis_or_exception_ref: string | null;
  exception_authority_ref: string | null;
}

/**
 * COMPLETED carries the owner's fulfilment evidence ref. EXCEPTION_RECORDED (for example a
 * retention or legal-hold exception) carries the owner's opaque basis and authority refs.
 */
export function validateTaskOutcome(body: unknown): TaskOutcomeInput {
  const rec = asRecord(body);
  commonChecks(rec, [
    'owner_component',
    'outcome',
    'evidence_ref',
    'legal_basis_or_exception_ref',
    'exception_authority_ref',
  ]);
  const owner = rec['owner_component'];
  if (!isOwnerComponent(owner)) bad('/owner_component', 'OWNER_COMPONENT_INVALID');
  const outcome = rec['outcome'];
  if (outcome === 'COMPLETED') {
    if (rec['legal_basis_or_exception_ref'] !== undefined) {
      bad('/legal_basis_or_exception_ref', 'NOT_ALLOWED_FOR_OUTCOME');
    }
    if (rec['exception_authority_ref'] !== undefined) {
      bad('/exception_authority_ref', 'NOT_ALLOWED_FOR_OUTCOME');
    }
    return {
      owner_component: owner,
      outcome,
      evidence_ref: opaqueRef(rec['evidence_ref'], '/evidence_ref'),
      legal_basis_or_exception_ref: null,
      exception_authority_ref: null,
    };
  }
  if (outcome === 'EXCEPTION_RECORDED') {
    const evidence = rec['evidence_ref'];
    return {
      owner_component: owner,
      outcome,
      evidence_ref: evidence === undefined ? null : opaqueRef(evidence, '/evidence_ref'),
      legal_basis_or_exception_ref: opaqueRef(
        rec['legal_basis_or_exception_ref'],
        '/legal_basis_or_exception_ref',
      ),
      exception_authority_ref: opaqueRef(rec['exception_authority_ref'], '/exception_authority_ref'),
    };
  }
  return bad('/outcome', 'OUTCOME_INVALID');
}

export function validateId(value: string | undefined, pointer: string): string {
  if (value === undefined || !isUuid(value)) bad(pointer, 'UUID_REQUIRED');
  return value.toLowerCase();
}
