import { Cmp020Error, detail } from '../errors.js';
import type { ApplicationFeePins } from '../ports/application-pins-port.js';
import type { PublishedFeePolicy } from '../ports/fee-policy-port.js';
import type { FeeRulesEvaluation } from '../ports/fee-rules-port.js';
import { canonicalJson, sha256Prefixed, SHA256_PREFIXED } from './fingerprint.js';
import { isWithinContractRange, parseMinor, sumMinor } from './money.js';
import { isUuid } from './uuid.js';

export const LINE_CODE = /^[A-Z0-9_.-]{1,64}$/;
export const CURRENCY = /^[A-Z]{3}$/;
export const RULE_OUTPUT_KEY = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;
export const MAX_POLICY_LINES = 64;

export type CalculationBasis = 'FEE_POLICY_LINE' | 'RULES_ENGINE_LINE';
export type AmountSource = 'RULES_ENGINE' | 'FEE_POLICY_METADATA';

export type ValidatedLine =
  | { code: string; basis: 'FIXED_AMOUNT'; amount_minor: bigint; description_code: string | null }
  | {
      code: string;
      basis: 'RULE_OUTPUT';
      rule_output_key: string;
      description_code: string | null;
    };

export interface ValidatedPolicy {
  fee_policy_version_id: string;
  tenant_service_binding_id: string;
  content_hash: string;
  currency: string;
  rule_version_id: string | null;
  waiver_policy_ref: string | null;
  lines: ValidatedLine[];
  needs_rules: boolean;
}

export interface CalculatedLine {
  code: string;
  amount_minor: bigint;
  calculation_basis: CalculationBasis;
  description_code: string | null;
  rule_output_key: string | null;
}

export interface Calculation {
  currency: string;
  lines: CalculatedLine[];
  total_amount_minor: bigint;
  amount_source: AmountSource;
}

function policyInvalid(code: string, pointer?: string): never {
  throw new Cmp020Error('SF-FORM-001', detail(code, pointer));
}

function ruleUnsafe(code: string, pointer?: string): never {
  throw new Cmp020Error('SF-RULE-001', detail(code, pointer));
}

function optionalShortString(value: unknown, max: number, pointer: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    policyInvalid('FEE_POLICY_INVALID', pointer);
  }
  return value;
}

/**
 * Validates the resolved published fee-policy version against the application's governed pins.
 * The policy is never trusted structurally: an adapter returning a draft, a different binding,
 * fractional amounts or an unpinned rule version is refused rather than coerced.
 */
export function validatePolicy(
  tenantId: string,
  pins: ApplicationFeePins & { fee_policy_version_id: string },
  policy: PublishedFeePolicy,
): ValidatedPolicy {
  if (typeof policy !== 'object' || policy === null) policyInvalid('FEE_POLICY_INVALID');
  if (policy.tenant_id !== tenantId) throw new Cmp020Error('SF-TEN-002');
  if (policy.fee_policy_version_id !== pins.fee_policy_version_id) {
    policyInvalid('FEE_POLICY_VERSION_PIN_MISMATCH', '/fee_policy_version_id');
  }
  if (policy.publication_status !== 'PUBLISHED') policyInvalid('FEE_POLICY_NOT_PUBLISHED');
  if (policy.tenant_service_binding_id !== pins.tenant_service_binding_id) {
    policyInvalid('FEE_POLICY_BINDING_MISMATCH', '/tenant_service_binding_id');
  }
  if (typeof policy.content_hash !== 'string' || !SHA256_PREFIXED.test(policy.content_hash)) {
    policyInvalid('FEE_POLICY_INVALID', '/content_hash');
  }
  if (typeof policy.currency !== 'string' || !CURRENCY.test(policy.currency)) {
    policyInvalid('FEE_POLICY_INVALID', '/currency');
  }
  const ruleVersion = policy.rule_version_id ?? null;
  if (ruleVersion !== null && (typeof ruleVersion !== 'string' || !isUuid(ruleVersion))) {
    policyInvalid('FEE_POLICY_INVALID', '/rule_version_id');
  }
  if (ruleVersion !== null && ruleVersion !== pins.rule_version_id) {
    policyInvalid('RULE_VERSION_PIN_MISMATCH', '/rule_version_id');
  }
  const waiver = optionalShortString(policy.waiver_policy_ref, 128, '/waiver_policy_ref');
  if (
    !Array.isArray(policy.lines) ||
    policy.lines.length < 1 ||
    policy.lines.length > MAX_POLICY_LINES
  ) {
    policyInvalid('FEE_POLICY_LINES_INVALID', '/lines');
  }
  const seen = new Set<string>();
  const lines: ValidatedLine[] = policy.lines.map((line, i) => {
    const at = `/lines/${i}`;
    if (typeof line !== 'object' || line === null) policyInvalid('FEE_POLICY_INVALID', at);
    if (typeof line.code !== 'string' || !LINE_CODE.test(line.code)) {
      policyInvalid('FEE_POLICY_INVALID', `${at}/code`);
    }
    if (seen.has(line.code)) policyInvalid('FEE_POLICY_DUPLICATE_LINE', `${at}/code`);
    seen.add(line.code);
    const description = optionalShortString(line.description_code, 64, `${at}/description_code`);
    if (line.basis === 'FIXED_AMOUNT') {
      if (line.rule_output_key !== undefined) policyInvalid('FEE_POLICY_INVALID', at);
      const amount = parseMinor(line.amount_minor);
      if (amount === null)
        policyInvalid('FEE_POLICY_AMOUNT_NOT_INTEGER_MINOR', `${at}/amount_minor`);
      return {
        code: line.code,
        basis: 'FIXED_AMOUNT',
        amount_minor: amount,
        description_code: description,
      };
    }
    if (line.basis === 'RULE_OUTPUT') {
      if (line.amount_minor !== undefined) policyInvalid('FEE_POLICY_INVALID', at);
      if (typeof line.rule_output_key !== 'string' || !RULE_OUTPUT_KEY.test(line.rule_output_key)) {
        policyInvalid('FEE_POLICY_INVALID', `${at}/rule_output_key`);
      }
      return {
        code: line.code,
        basis: 'RULE_OUTPUT',
        rule_output_key: line.rule_output_key,
        description_code: description,
      };
    }
    return policyInvalid('FEE_POLICY_INVALID', `${at}/basis`);
  });
  return {
    fee_policy_version_id: policy.fee_policy_version_id,
    tenant_service_binding_id: policy.tenant_service_binding_id,
    content_hash: policy.content_hash,
    currency: policy.currency,
    rule_version_id: ruleVersion,
    waiver_policy_ref: waiver,
    lines,
    needs_rules: lines.some((l) => l.basis === 'RULE_OUTPUT'),
  };
}

export function validateEvaluation(
  evaluation: FeeRulesEvaluation,
  pinnedRuleVersionId: string,
): FeeRulesEvaluation {
  if (typeof evaluation !== 'object' || evaluation === null) ruleUnsafe('RULE_EVALUATION_INVALID');
  if (evaluation.decision_basis !== 'DETERMINISTIC_RULES') {
    ruleUnsafe('RULE_EVALUATION_NOT_DETERMINISTIC');
  }
  if (evaluation.rule_pack?.version_id !== pinnedRuleVersionId) {
    ruleUnsafe('RULE_VERSION_MISMATCH');
  }
  if (
    typeof evaluation.rule_pack.content_hash !== 'string' ||
    !SHA256_PREFIXED.test(evaluation.rule_pack.content_hash)
  ) {
    ruleUnsafe('RULE_EVALUATION_INVALID', '/rule_pack/content_hash');
  }
  if (typeof evaluation.evaluation_id !== 'string' || !isUuid(evaluation.evaluation_id)) {
    ruleUnsafe('RULE_EVALUATION_INVALID', '/evaluation_id');
  }
  if (evaluation.result_code !== 'RULE_OUTPUT_PRODUCED') ruleUnsafe('NO_RULE_OUTPUT');
  if (
    typeof evaluation.outputs !== 'object' ||
    evaluation.outputs === null ||
    Array.isArray(evaluation.outputs)
  ) {
    ruleUnsafe('RULE_EVALUATION_INVALID', '/outputs');
  }
  return evaluation;
}

/**
 * Pure, deterministic fee calculation. Line order follows the published policy; amounts are exact
 * integers in minor units; there is no rounding step because no fractional value is admitted.
 */
export function calculate(
  policy: ValidatedPolicy,
  evaluation: FeeRulesEvaluation | null,
): Calculation {
  if (policy.needs_rules && evaluation === null) ruleUnsafe('RULE_EVALUATION_REQUIRED');
  const lines: CalculatedLine[] = policy.lines.map((line) => {
    if (line.basis === 'FIXED_AMOUNT') {
      return {
        code: line.code,
        amount_minor: line.amount_minor,
        calculation_basis: 'FEE_POLICY_LINE',
        description_code: line.description_code,
        rule_output_key: null,
      };
    }
    const outputs = (evaluation as FeeRulesEvaluation).outputs;
    if (!Object.hasOwn(outputs, line.rule_output_key)) {
      ruleUnsafe('RULE_OUTPUT_MISSING', `/outputs/${line.rule_output_key}`);
    }
    const amount = parseMinor(outputs[line.rule_output_key]);
    if (amount === null)
      ruleUnsafe('RULE_OUTPUT_NOT_INTEGER_MINOR', `/outputs/${line.rule_output_key}`);
    return {
      code: line.code,
      amount_minor: amount,
      calculation_basis: 'RULES_ENGINE_LINE',
      description_code: line.description_code,
      rule_output_key: line.rule_output_key,
    };
  });
  const total = sumMinor(lines.map((l) => l.amount_minor));
  if (!isWithinContractRange(total)) ruleUnsafe('FEE_TOTAL_OUT_OF_RANGE');
  return {
    currency: policy.currency,
    lines,
    total_amount_minor: total,
    amount_source: policy.needs_rules ? 'RULES_ENGINE' : 'FEE_POLICY_METADATA',
  };
}

export function factsHash(facts: Record<string, unknown>): string {
  return sha256Prefixed(canonicalJson(facts));
}

/** Identity of a calculation: identical governed inputs always yield the same quote. */
export function calculationHash(p: {
  tenantId: string;
  applicationId: string;
  pins: ApplicationFeePins;
  policyContentHash: string;
  ruleContentHash: string | null;
  factsHash: string;
}): string {
  return sha256Prefixed(
    canonicalJson({
      v: 1,
      tenant_id: p.tenantId,
      application_id: p.applicationId,
      tenant_service_binding_id: p.pins.tenant_service_binding_id,
      fee_policy_version_id: p.pins.fee_policy_version_id,
      rule_version_id: p.pins.rule_version_id,
      fee_policy_content_hash: p.policyContentHash,
      rule_content_hash: p.ruleContentHash,
      facts_hash: p.factsHash,
    }),
  );
}
