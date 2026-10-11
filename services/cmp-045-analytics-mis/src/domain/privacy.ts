/**
 * Purpose-limitation and data-minimisation guards for analytics dimensions. CMP-045 stores
 * aggregates only (SF-CON-ANALYTICS-METRIC): a dimension is a low-cardinality category code, never
 * a person-level value. These rules are deterministic defence in depth; the database trigger
 * `guard_metric_point` repeats the value shape rules.
 */

/** Sentinel stored in place of any value that fails the category-code rules. The value is never stored. */
export const UNCLASSIFIED = 'UNCLASSIFIED';

export const IDENTIFYING_TOKENS: ReadonlySet<string> = new Set([
  'id',
  'uuid',
  'guid',
  'ref',
  'token',
  'secret',
  'password',
  'name',
  'fname',
  'lname',
  'firstname',
  'lastname',
  'fullname',
  'email',
  'mail',
  'phone',
  'mobile',
  'msisdn',
  'aadhaar',
  'aadhar',
  'address',
  'dob',
  'birth',
  'passport',
  'voter',
  'pan',
  'ssn',
  'account',
  'ifsc',
  'ip',
]);

const FIELD_NAME = /^[a-z][a-z0-9_]{1,63}$/;
export const CATEGORY_CODE_PATTERN = '^[A-Z0-9][A-Z0-9_.-]{0,63}$';
const CATEGORY_CODE = new RegExp(CATEGORY_CODE_PATTERN);
const LONG_DIGIT_RUN = /[0-9]{6,}/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidFieldName(name: string): boolean {
  return FIELD_NAME.test(name);
}

/** True when any underscore-separated token of a field name marks a personal or per-record identifier. */
export function isIdentifyingFieldName(name: string): boolean {
  return name
    .toLowerCase()
    .split('_')
    .some((token) => IDENTIFYING_TOKENS.has(token));
}

/** A category code is short, upper-case, and carries no identifier-shaped content. */
export function isCategoryCode(value: string): boolean {
  return CATEGORY_CODE.test(value) && !LONG_DIGIT_RUN.test(value) && !UUID_SHAPE.test(value);
}

export type DimensionValue = string | boolean;

/**
 * Returns the value to aggregate on, or `UNCLASSIFIED` when the source value is not a safe category.
 * `allowed` is the definition's closed vocabulary, when it declares one.
 */
export function safeDimensionValue(
  raw: unknown,
  allowed: readonly string[] | undefined,
): { value: DimensionValue; unclassified: boolean } {
  if (typeof raw === 'boolean') return { value: raw, unclassified: false };
  if (typeof raw !== 'string' || !isCategoryCode(raw)) {
    return { value: UNCLASSIFIED, unclassified: true };
  }
  if (allowed !== undefined && !allowed.includes(raw)) {
    return { value: UNCLASSIFIED, unclassified: true };
  }
  return { value: raw, unclassified: false };
}
