/**
 * Studio rules designer model: a GoRules (ZEN) decision table authored in plain language and
 * compiled to JDM that CMP-008 executes. Rule results are advisory inputs to officers and the
 * workflow; no rule approves or rejects an application (Constitution §20).
 */

export type InputType = 'number' | 'string' | 'boolean';
export type OutputKind = 'outcome' | 'reasons' | 'value';
export type Operator = 'any' | 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'between' | 'in';
export type Scalar = string | number | boolean;

export interface RuleInput {
  id: string;
  label: string;
  /** Input path read by ZEN (`residence_duration_months` or `applicant.age`). */
  field: string;
  type: InputType;
}

export interface RuleOutput {
  id: string;
  label: string;
  field: string;
  kind: OutputKind;
}

export interface Condition {
  op: Operator;
  value?: Scalar;
  /** Upper bound for `between`. */
  to?: number;
  /** Members for `in`. */
  values?: string[];
}

export interface RuleRow {
  id: string;
  description: string;
  /** Condition per input id; missing means "any". */
  when: Record<string, Condition>;
  /** Outcome code, reason codes or raw ZEN expression per output id. */
  then: Record<string, string | string[]>;
}

export interface RuleTestCase {
  id: string;
  name: string;
  /** Input values keyed by input field. */
  inputs: Record<string, Scalar | null>;
  expectOutcome?: string;
  expectReasons?: string[];
}

export interface RuleDesign {
  /** CMP-008 rule pack key (CMP-033 `rule_pack_id`). */
  packKey: string;
  title: string;
  version: string;
  inputs: RuleInput[];
  outputs: RuleOutput[];
  /** Declared advisory outcome codes and reason codes offered in the table. */
  outcomes: string[];
  reasonCodes: string[];
  rows: RuleRow[];
  tests: RuleTestCase[];
}

export const PACK_KEY_RE = /^[a-z][a-z0-9._-]{1,127}$/;
export const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SEGMENT_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Dotted input path of up to five safe segments. */
export function isFieldPath(value: string): boolean {
  const parts = value.split('.');
  return parts.length >= 1 && parts.length <= 5 && parts.every((p) => SEGMENT_RE.test(p));
}

export const OPERATOR_LABEL: Record<Operator, string> = {
  any: 'any value',
  eq: 'is',
  ne: 'is not',
  lt: 'less than',
  le: 'at most',
  gt: 'more than',
  ge: 'at least',
  between: 'between',
  in: 'one of',
};

/** Plain-language cell text ("at least 12", "any value"). */
export function describeCondition(c: Condition | undefined): string {
  if (!c || c.op === 'any') return OPERATOR_LABEL.any;
  if (c.op === 'between') return `between ${c.value ?? '?'} and ${c.to ?? '?'}`;
  if (c.op === 'in') return `one of ${(c.values ?? []).join(', ') || '?'}`;
  return `${OPERATOR_LABEL[c.op]} ${c.value === undefined || c.value === '' ? '?' : String(c.value)}`;
}

export function operatorsFor(type: InputType): Operator[] {
  if (type === 'number') return ['any', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'between'];
  if (type === 'boolean') return ['any', 'eq'];
  return ['any', 'eq', 'ne', 'in'];
}

/** Codes that read as a final statutory decision; rules should produce advisory codes instead. */
export const DECISION_WORDS =
  /(?:^|_)(APPROVE|APPROVED|REJECT|REJECTED|GRANT|GRANTED|DENY|DENIED|REFUSE|REFUSED|ISSUE|ISSUED|SANCTION|SANCTIONED)(?:_|$)/;
