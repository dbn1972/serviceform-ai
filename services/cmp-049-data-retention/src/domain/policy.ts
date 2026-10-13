import { isEligibility, type Eligibility, type EligibilityTransition } from './eligibility.js';

export const CONTRACT_ID = 'SF-CON-RETENTION-POLICY';
export const POLICY_RESOURCE_TYPE = 'RetentionPolicy';
export const SUBJECT_RESOURCE_TYPE = 'RetentionSubject';

/** Same pattern as SF-CON-COMMON resourceType. */
export const RESOURCE_TYPE = /^[A-Z][A-Za-z0-9]{1,63}$/;
export const SCOPE_CODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
/** Opaque reference to an owner-approved policy input (e.g. a gazette or decision register id). */
export const PERIOD_REF = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
/**
 * A period ref must be a reference, never a value. Anything that reads as a day count or an
 * ISO 8601 duration is refused so a builder or operator cannot smuggle an invented period in.
 * Mirrored by a CHECK constraint in sf_retention.retention_policy.
 */
const COUNT_WITH_UNIT = /^\d+[._\s-]?([a-z]*)$/i;
const ISO_DURATION_BODY = /^p[\d.ymwdths]+$/i;
const DURATION_UNITS: ReadonlySet<string> = new Set([
  '',
  'd',
  'day',
  'days',
  'w',
  'wk',
  'wks',
  'week',
  'weeks',
  'm',
  'mo',
  'mos',
  'month',
  'months',
  'y',
  'yr',
  'yrs',
  'year',
  'years',
]);

export function looksLikeDuration(value: string): boolean {
  const count = COUNT_WITH_UNIT.exec(value);
  if (count) return DURATION_UNITS.has((count[1] ?? '').toLowerCase());
  return ISO_DURATION_BODY.test(value) && /\d/.test(value);
}
export const MAX_TRANSITIONS = 12;

export interface PolicyScope {
  resource_type: string;
  service_code?: string;
  jurisdiction_code?: string;
}

export interface RetentionPolicyRecord {
  tenant_id: string;
  policy_id: string;
  policy_version: number;
  scope: PolicyScope;
  owner_supplied_period_ref: string | null;
  eligibility_transitions: EligibilityTransition[];
  created_at: string;
  updated_at: string;
  created_by: string;
  last_correlation_id: string;
}

/** The FROZEN SF-CON-RETENTION-POLICY shape. Constant markers are fixed, never client-supplied. */
export interface RetentionPolicyContract {
  contract_id: typeof CONTRACT_ID;
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  tenant_id: string;
  policy_id: string;
  scope: PolicyScope;
  policy_neutral_shape: true;
  statutory_retention_policy_input_required: true;
  owner_supplied_period_ref: string | null;
  eligibility_transitions: EligibilityTransition[];
  invented_statutory_period_forbidden: true;
  correlation_id: string;
}

export function toContract(row: RetentionPolicyRecord): RetentionPolicyContract {
  const scope: PolicyScope = { resource_type: row.scope.resource_type };
  if (row.scope.service_code !== undefined) scope.service_code = row.scope.service_code;
  if (row.scope.jurisdiction_code !== undefined) {
    scope.jurisdiction_code = row.scope.jurisdiction_code;
  }
  return {
    contract_id: CONTRACT_ID,
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: row.tenant_id,
    policy_id: row.policy_id,
    scope,
    policy_neutral_shape: true,
    statutory_retention_policy_input_required: true,
    owner_supplied_period_ref: row.owner_supplied_period_ref,
    eligibility_transitions: row.eligibility_transitions.map((t) => ({
      from_eligibility: t.from_eligibility,
      to_eligibility: t.to_eligibility,
    })),
    invented_statutory_period_forbidden: true,
    correlation_id: row.last_correlation_id,
  };
}

export class PolicyRejected extends Error {
  constructor(
    readonly reason: string,
    readonly pointer: string,
  ) {
    super(reason);
    this.name = 'PolicyRejected';
  }
}

function reject(reason: string, pointer: string): never {
  throw new PolicyRejected(reason, pointer);
}

export function normalizePeriodRef(value: unknown, pointer: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !PERIOD_REF.test(value)) reject('PERIOD_REF_INVALID', pointer);
  if (looksLikeDuration(value)) reject('PERIOD_REF_LOOKS_LIKE_DURATION', pointer);
  return value;
}

export function normalizeScope(value: unknown): PolicyScope {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    reject('SCOPE_REQUIRED', '/scope');
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!['resource_type', 'service_code', 'jurisdiction_code'].includes(key)) {
      reject('UNKNOWN_FIELD', `/scope/${key}`);
    }
  }
  const resourceType = raw['resource_type'];
  if (typeof resourceType !== 'string' || !RESOURCE_TYPE.test(resourceType)) {
    reject('RESOURCE_TYPE_INVALID', '/scope/resource_type');
  }
  const scope: PolicyScope = { resource_type: resourceType };
  for (const key of ['service_code', 'jurisdiction_code'] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !SCOPE_CODE.test(v)) reject('SCOPE_CODE_INVALID', `/scope/${key}`);
    scope[key] = v;
  }
  return scope;
}

export function normalizeTransitions(value: unknown): EligibilityTransition[] {
  if (!Array.isArray(value) || value.length === 0) {
    reject('TRANSITIONS_REQUIRED', '/eligibility_transitions');
  }
  if (value.length > MAX_TRANSITIONS) reject('TRANSITIONS_TOO_MANY', '/eligibility_transitions');
  const seen = new Set<string>();
  return (value as unknown[]).map((item, i) => {
    const pointer = `/eligibility_transitions/${i}`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      reject('TRANSITION_NOT_OBJECT', pointer);
    }
    const t = item as Record<string, unknown>;
    for (const key of Object.keys(t)) {
      if (key !== 'from_eligibility' && key !== 'to_eligibility') {
        reject('UNKNOWN_FIELD', `${pointer}/${key}`);
      }
    }
    const from = t['from_eligibility'];
    const to = t['to_eligibility'];
    if (!isEligibility(from)) reject('ELIGIBILITY_INVALID', `${pointer}/from_eligibility`);
    if (!isEligibility(to)) reject('ELIGIBILITY_INVALID', `${pointer}/to_eligibility`);
    if (from === to) reject('TRANSITION_SELF_LOOP', pointer);
    const identity = `${from}>${to}`;
    if (seen.has(identity)) reject('TRANSITION_DUPLICATE', pointer);
    seen.add(identity);
    return { from_eligibility: from as Eligibility, to_eligibility: to as Eligibility };
  });
}
