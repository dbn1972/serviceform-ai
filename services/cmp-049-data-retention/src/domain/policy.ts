import { isEligibility, type Eligibility, type EligibilityTransition } from './eligibility.js';

export const CONTRACT_ID = 'SF-CON-RETENTION-POLICY';
export const POLICY_RESOURCE_TYPE = 'RetentionPolicy';
export const SUBJECT_RESOURCE_TYPE = 'RetentionSubject';

/**
 * Linear character-class checks (njsscan regex_dos). Patterns documented beside each helper
 * mirror SF-CON-COMMON / PERIOD_REF CHECK shapes without quantifier regexes on user input.
 */
const isUpper = (c: number): boolean => c >= 65 && c <= 90;
const isLower = (c: number): boolean => c >= 97 && c <= 122;
const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isAlpha = (c: number): boolean => isUpper(c) || isLower(c);
const isAlnum = (c: number): boolean => isAlpha(c) || isDigit(c);

function every(value: string, from: number, ok: (c: number) => boolean): boolean {
  for (let i = from; i < value.length; i += 1) if (!ok(value.charCodeAt(i))) return false;
  return true;
}

/** ^[A-Z][A-Za-z0-9]{1,63}$ — SF-CON-COMMON resourceType. */
export function isResourceType(value: string): boolean {
  if (value.length < 2 || value.length > 64) return false;
  if (!isUpper(value.charCodeAt(0))) return false;
  return every(value, 1, isAlnum);
}

/** ^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$ */
export function isScopeCode(value: string): boolean {
  if (value.length < 1 || value.length > 64) return false;
  if (!isAlnum(value.charCodeAt(0))) return false;
  return every(value, 1, (c) => isAlnum(c) || c === 95 || c === 46 || c === 58 || c === 45);
}

/** ^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$ — opaque owner-approved period ref. */
export function isPeriodRef(value: string): boolean {
  if (value.length < 1 || value.length > 128) return false;
  if (!isAlnum(value.charCodeAt(0))) return false;
  return every(
    value,
    1,
    (c) => isAlnum(c) || c === 95 || c === 46 || c === 58 || c === 47 || c === 45,
  );
}

/**
 * A period ref must be a reference, never a value. Anything that reads as a day count or an
 * ISO 8601 duration is refused so a builder or operator cannot smuggle an invented period in.
 * Mirrored by a CHECK constraint in sf_retention.retention_policy.
 */
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

const ISO_DURATION_CHARS: ReadonlySet<number> = new Set(
  [...'0123456789.ymwdthsYMWDTHS'].map((ch) => ch.charCodeAt(0)),
);

export function looksLikeDuration(value: string): boolean {
  if (value.length === 0) return false;
  let i = 0;
  while (i < value.length && isDigit(value.charCodeAt(i))) i += 1;
  if (i > 0) {
    if (i < value.length) {
      const sep = value.charCodeAt(i);
      if (sep === 46 || sep === 95 || sep === 32 || sep === 45) i += 1;
    }
    const unit = value.slice(i).toLowerCase();
    if (DURATION_UNITS.has(unit) && every(unit, 0, isLower)) return true;
    if (unit.length === 0) return true;
  }
  // ISO-8601-ish duration body: P… with digits and duration letters only.
  const first = value.charCodeAt(0);
  if (first !== 80 && first !== 112) return false;
  let hasDigit = false;
  for (let j = 1; j < value.length; j += 1) {
    const c = value.charCodeAt(j);
    if (!ISO_DURATION_CHARS.has(c)) return false;
    if (isDigit(c)) hasDigit = true;
  }
  return hasDigit;
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
  if (typeof value !== 'string' || !isPeriodRef(value)) reject('PERIOD_REF_INVALID', pointer);
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
  if (typeof resourceType !== 'string' || !isResourceType(resourceType)) {
    reject('RESOURCE_TYPE_INVALID', '/scope/resource_type');
  }
  const scope: PolicyScope = { resource_type: resourceType };
  for (const key of ['service_code', 'jurisdiction_code'] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !isScopeCode(v)) reject('SCOPE_CODE_INVALID', `/scope/${key}`);
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
