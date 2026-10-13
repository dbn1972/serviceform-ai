import { isEligibility, type Eligibility } from '../domain/eligibility.js';
import {
  isResourceType,
  normalizePeriodRef,
  normalizeScope,
  normalizeTransitions,
  PolicyRejected,
  type PolicyScope,
} from '../domain/policy.js';
import type { EligibilityTransition } from '../domain/eligibility.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp049Error, detail } from '../errors.js';

export const CLIENT_TIME_KEYS: ReadonlySet<string> = new Set([
  'now',
  'clock_now',
  'current_time',
  'server_time',
  'timestamp',
  'occurred_at',
  'created_at',
  'updated_at',
  'transitioned_at',
]);

/** Server-derived or constant fields: a client may never set them. */
const SERVER_OWNED_KEYS: ReadonlySet<string> = new Set([
  'contract_id',
  'contract_status',
  'freeze_status',
  'policy_id',
  'policy_version',
  'correlation_id',
  'subject_id',
  'subject_version',
  'eligibility',
]);

/** Constant contract markers a client may echo but never flip. */
const CONSTANT_TRUE_MARKERS = [
  'policy_neutral_shape',
  'statutory_retention_policy_input_required',
  'invented_statutory_period_forbidden',
] as const;

const REASON_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

function bad(pointer: string, code = 'INVALID_VALUE'): never {
  throw new Cmp049Error('SF-SYS-003', detail(code, pointer));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) bad('/', 'BODY_OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}

export function assertNoClientTime(source: Record<string, unknown>, where: 'body' | 'query'): void {
  for (const key of Object.keys(source)) {
    if (CLIENT_TIME_KEYS.has(key)) {
      throw new Cmp049Error(
        'SF-SYS-003',
        detail('CLIENT_TIME_NOT_AUTHORITATIVE', `/${where}/${key}`),
      );
    }
  }
}

function commonChecks(rec: Record<string, unknown>, allowed: readonly string[]): void {
  assertNoClientTime(rec, 'body');
  if ('tenant_id' in rec) throw new Cmp049Error('SF-TEN-002', detail('TENANT_ID_SERVER_DERIVED'));
  for (const key of Object.keys(rec)) {
    if (SERVER_OWNED_KEYS.has(key)) bad(`/${key}`, 'SERVER_OWNED_FIELD');
    if (!allowed.includes(key)) bad(`/${key}`, 'UNKNOWN_FIELD');
  }
}

function wrapPolicy<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof PolicyRejected) bad(err.pointer, err.reason);
    throw err;
  }
}

export function validateEmptyInput(body: unknown): void {
  const rec = asRecord(body);
  commonChecks(rec, []);
}

export interface RegisterPolicyInput {
  scope: PolicyScope;
  owner_supplied_period_ref: string | null;
  eligibility_transitions: EligibilityTransition[];
}

export function validateRegisterPolicy(body: unknown): RegisterPolicyInput {
  const rec = asRecord(body);
  commonChecks(rec, [
    'scope',
    'owner_supplied_period_ref',
    'eligibility_transitions',
    ...CONSTANT_TRUE_MARKERS,
  ]);
  for (const marker of CONSTANT_TRUE_MARKERS) {
    if (marker in rec && rec[marker] !== true) bad(`/${marker}`, 'CONSTANT_MARKER_MUST_BE_TRUE');
  }
  return wrapPolicy(() => ({
    scope: normalizeScope(rec['scope']),
    owner_supplied_period_ref: normalizePeriodRef(
      rec['owner_supplied_period_ref'],
      '/owner_supplied_period_ref',
    ),
    eligibility_transitions: normalizeTransitions(rec['eligibility_transitions']),
  }));
}

export function validateBindPeriodRef(body: unknown): string {
  const rec = asRecord(body);
  commonChecks(rec, ['owner_supplied_period_ref']);
  const ref = wrapPolicy(() =>
    normalizePeriodRef(rec['owner_supplied_period_ref'], '/owner_supplied_period_ref'),
  );
  if (ref === null) bad('/owner_supplied_period_ref', 'POLICY_INPUT_REQUIRED');
  return ref;
}

export interface EnrollSubjectInput {
  policy_id: string;
  resource_type: string;
  resource_id: string;
}

export function validateEnrollSubject(body: unknown): EnrollSubjectInput {
  const { policy_id: policyId, ...rec } = asRecord(body);
  commonChecks(rec, ['resource_type', 'resource_id']);
  if (typeof policyId !== 'string' || !isUuid(policyId)) bad('/policy_id', 'UUID_REQUIRED');
  const resourceType = rec['resource_type'];
  if (typeof resourceType !== 'string' || !isResourceType(resourceType)) {
    bad('/resource_type', 'RESOURCE_TYPE_INVALID');
  }
  const resourceId = rec['resource_id'];
  if (typeof resourceId !== 'string' || !isUuid(resourceId)) bad('/resource_id', 'UUID_REQUIRED');
  return {
    policy_id: policyId.toLowerCase(),
    resource_type: resourceType,
    resource_id: resourceId.toLowerCase(),
  };
}

export interface TransitionInput {
  to_eligibility: Eligibility;
  expected_version: number;
  reason_code: string | null;
}

export function validateTransition(body: unknown): TransitionInput {
  const rec = asRecord(body);
  commonChecks(rec, ['to_eligibility', 'expected_version', 'reason_code']);
  const to = rec['to_eligibility'];
  if (!isEligibility(to)) bad('/to_eligibility', 'ELIGIBILITY_INVALID');
  const expected = rec['expected_version'];
  if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1) {
    bad('/expected_version', 'EXPECTED_VERSION_REQUIRED');
  }
  const reason = rec['reason_code'];
  if (reason !== undefined && (typeof reason !== 'string' || !REASON_CODE.test(reason))) {
    bad('/reason_code', 'REASON_CODE_INVALID');
  }
  return {
    to_eligibility: to,
    expected_version: expected,
    reason_code: typeof reason === 'string' ? reason : null,
  };
}

export function validateId(value: string | undefined, pointer: string): string {
  if (value === undefined || !isUuid(value)) bad(pointer, 'UUID_REQUIRED');
  return value.toLowerCase();
}
