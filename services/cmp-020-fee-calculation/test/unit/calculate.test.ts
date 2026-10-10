import { describe, expect, it } from 'vitest';
import {
  calculate,
  calculationHash,
  factsHash,
  MAX_POLICY_LINES,
  validateEvaluation,
  validatePolicy,
} from '../../src/domain/calculate.js';
import { Cmp020Error } from '../../src/errors.js';
import type { ApplicationFeePins } from '../../src/ports/application-pins-port.js';
import type { PublishedFeePolicy } from '../../src/ports/fee-policy-port.js';
import type { FeeRulesEvaluation } from '../../src/ports/fee-rules-port.js';
import {
  APPLICATION_ID,
  FEE_POLICY_FIXED,
  FEE_POLICY_RULES,
  fixedPolicy,
  HASH_RULES,
  OTHER_RULE_VERSION,
  RULE_VERSION,
  rulesPolicy,
  TENANT_A,
  TENANT_B,
  TSB_ID,
} from '../doubles/fixtures.js';

const pins = (
  feePolicy = FEE_POLICY_FIXED,
): ApplicationFeePins & { fee_policy_version_id: string } => ({
  application_id: APPLICATION_ID,
  tenant_service_binding_id: TSB_ID,
  rule_version_id: RULE_VERSION,
  fee_policy_version_id: feePolicy,
});

function evaluation(overrides: Partial<FeeRulesEvaluation> = {}): FeeRulesEvaluation {
  return {
    evaluation_id: '12121212-1212-4212-8212-121212121212',
    rule_pack: { version_id: RULE_VERSION, content_hash: HASH_RULES },
    result_code: 'RULE_OUTPUT_PRODUCED',
    outputs: { line_amount_minor: 2500 },
    decision_basis: 'DETERMINISTIC_RULES',
    ...overrides,
  };
}

function errorOf(fn: () => unknown): Cmp020Error {
  try {
    fn();
  } catch (e) {
    if (e instanceof Cmp020Error) return e;
    throw e;
  }
  throw new Error('expected Cmp020Error');
}

describe('validatePolicy: governed pins and published metadata only', () => {
  it('accepts the pinned published version', () => {
    const v = validatePolicy(TENANT_A, pins(), fixedPolicy());
    expect(v.needs_rules).toBe(false);
    expect(v.lines.map((l) => l.code)).toEqual(['SYNTHETIC_LINE_A', 'SYNTHETIC_LINE_B']);
  });

  it('refuses a policy owned by another tenant as cross-tenant', () => {
    expect(errorOf(() => validatePolicy(TENANT_B, pins(), fixedPolicy())).code).toBe('SF-TEN-002');
  });

  const cases: [string, Partial<PublishedFeePolicy>, string, string][] = [
    [
      'unpinned version',
      { fee_policy_version_id: FEE_POLICY_RULES },
      'SF-FORM-001',
      'FEE_POLICY_VERSION_PIN_MISMATCH',
    ],
    ['draft version', { publication_status: 'DRAFT' }, 'SF-FORM-001', 'FEE_POLICY_NOT_PUBLISHED'],
    [
      'other binding',
      { tenant_service_binding_id: '88888888-8888-4888-8888-888888888889' },
      'SF-FORM-001',
      'FEE_POLICY_BINDING_MISMATCH',
    ],
    ['bad content hash', { content_hash: 'md5:abc' }, 'SF-FORM-001', 'FEE_POLICY_INVALID'],
    ['bad currency', { currency: 'rupee' }, 'SF-FORM-001', 'FEE_POLICY_INVALID'],
    [
      'unpinned rule version',
      { rule_version_id: OTHER_RULE_VERSION },
      'SF-FORM-001',
      'RULE_VERSION_PIN_MISMATCH',
    ],
    ['malformed rule version', { rule_version_id: 'v1' }, 'SF-FORM-001', 'FEE_POLICY_INVALID'],
    ['no lines', { lines: [] }, 'SF-FORM-001', 'FEE_POLICY_LINES_INVALID'],
    [
      'too many lines',
      {
        lines: Array.from({ length: MAX_POLICY_LINES + 1 }, (_, i) => ({
          code: `L${i}`,
          basis: 'FIXED_AMOUNT' as const,
          amount_minor: 1,
        })),
      },
      'SF-FORM-001',
      'FEE_POLICY_LINES_INVALID',
    ],
    [
      'duplicate line code',
      {
        lines: [
          { code: 'DUP', basis: 'FIXED_AMOUNT', amount_minor: 1 },
          { code: 'DUP', basis: 'FIXED_AMOUNT', amount_minor: 2 },
        ],
      },
      'SF-FORM-001',
      'FEE_POLICY_DUPLICATE_LINE',
    ],
    [
      'fractional fixed amount',
      { lines: [{ code: 'A', basis: 'FIXED_AMOUNT', amount_minor: 10.5 }] },
      'SF-FORM-001',
      'FEE_POLICY_AMOUNT_NOT_INTEGER_MINOR',
    ],
    [
      'decimal string amount',
      { lines: [{ code: 'A', basis: 'FIXED_AMOUNT', amount_minor: '10.50' }] },
      'SF-FORM-001',
      'FEE_POLICY_AMOUNT_NOT_INTEGER_MINOR',
    ],
    [
      'negative fixed amount',
      { lines: [{ code: 'A', basis: 'FIXED_AMOUNT', amount_minor: -1 }] },
      'SF-FORM-001',
      'FEE_POLICY_AMOUNT_NOT_INTEGER_MINOR',
    ],
    [
      'missing fixed amount',
      { lines: [{ code: 'A', basis: 'FIXED_AMOUNT' }] },
      'SF-FORM-001',
      'FEE_POLICY_AMOUNT_NOT_INTEGER_MINOR',
    ],
    [
      'fixed line with rule key',
      { lines: [{ code: 'A', basis: 'FIXED_AMOUNT', amount_minor: 1, rule_output_key: 'x' }] },
      'SF-FORM-001',
      'FEE_POLICY_INVALID',
    ],
    [
      'rule line with amount',
      { lines: [{ code: 'A', basis: 'RULE_OUTPUT', rule_output_key: 'x', amount_minor: 1 }] },
      'SF-FORM-001',
      'FEE_POLICY_INVALID',
    ],
    [
      'rule line without key',
      { lines: [{ code: 'A', basis: 'RULE_OUTPUT' }] },
      'SF-FORM-001',
      'FEE_POLICY_INVALID',
    ],
    [
      'client basis',
      { lines: [{ code: 'A', basis: 'CLIENT_SUPPLIED' as 'FIXED_AMOUNT', amount_minor: 1 }] },
      'SF-FORM-001',
      'FEE_POLICY_INVALID',
    ],
    [
      'lowercase code',
      { lines: [{ code: 'base', basis: 'FIXED_AMOUNT', amount_minor: 1 }] },
      'SF-FORM-001',
      'FEE_POLICY_INVALID',
    ],
    [
      'oversized waiver ref',
      { waiver_policy_ref: 'w'.repeat(129) },
      'SF-FORM-001',
      'FEE_POLICY_INVALID',
    ],
  ];
  it.each(cases)('refuses %s', (_label, override, code, detailCode) => {
    const e = errorOf(() => validatePolicy(TENANT_A, pins(), fixedPolicy(override)));
    expect(e.code).toBe(code);
    expect(e.details?.[0]?.code).toBe(detailCode);
  });
});

describe('validateEvaluation: pinned deterministic rules only', () => {
  it.each([
    [
      'non-deterministic basis',
      { decision_basis: 'LLM' as 'DETERMINISTIC_RULES' },
      'RULE_EVALUATION_NOT_DETERMINISTIC',
    ],
    [
      'other rule version',
      { rule_pack: { version_id: OTHER_RULE_VERSION, content_hash: HASH_RULES } },
      'RULE_VERSION_MISMATCH',
    ],
    [
      'bad rule hash',
      { rule_pack: { version_id: RULE_VERSION, content_hash: 'x' } },
      'RULE_EVALUATION_INVALID',
    ],
    ['bad evaluation id', { evaluation_id: 'nope' }, 'RULE_EVALUATION_INVALID'],
    ['no output', { result_code: 'NO_RULE_OUTPUT' as const }, 'NO_RULE_OUTPUT'],
    [
      'array outputs',
      { outputs: [] as unknown as Record<string, unknown> },
      'RULE_EVALUATION_INVALID',
    ],
  ])('refuses %s', (_label, override, detailCode) => {
    const e = errorOf(() => validateEvaluation(evaluation(override), RULE_VERSION));
    expect(e.code).toBe('SF-RULE-001');
    expect(e.details?.[0]?.code).toBe(detailCode);
  });
});

describe('calculate: deterministic, exact, policy-ordered', () => {
  it('fixed-only policy sums lines exactly from metadata', () => {
    const calc = calculate(validatePolicy(TENANT_A, pins(), fixedPolicy()), null);
    expect(calc.amount_source).toBe('FEE_POLICY_METADATA');
    expect(calc.total_amount_minor).toBe(13023n);
    expect(calc.lines.map((l) => [l.code, l.amount_minor, l.calculation_basis])).toEqual([
      ['SYNTHETIC_LINE_A', 12345n, 'FEE_POLICY_LINE'],
      ['SYNTHETIC_LINE_B', 678n, 'FEE_POLICY_LINE'],
    ]);
  });

  it('rule lines take amounts from the pinned evaluation output', () => {
    const policy = validatePolicy(TENANT_A, pins(FEE_POLICY_RULES), rulesPolicy());
    const calc = calculate(policy, evaluation());
    expect(calc.amount_source).toBe('RULES_ENGINE');
    expect(calc.total_amount_minor).toBe(3000n);
    expect(calc.lines[1]).toMatchObject({
      calculation_basis: 'RULES_ENGINE_LINE',
      amount_minor: 2500n,
    });
  });

  it('a zero rule output is kept as an explicit zero line (waiver computed by rules, not CMP-020)', () => {
    const policy = validatePolicy(TENANT_A, pins(FEE_POLICY_RULES), rulesPolicy());
    const calc = calculate(policy, evaluation({ outputs: { line_amount_minor: 0 } }));
    expect(calc.lines).toHaveLength(2);
    expect(calc.total_amount_minor).toBe(500n);
  });

  it.each([
    ['missing output', {}, 'RULE_OUTPUT_MISSING'],
    ['fractional output', { line_amount_minor: 25.5 }, 'RULE_OUTPUT_NOT_INTEGER_MINOR'],
    ['decimal string output', { line_amount_minor: '25.00' }, 'RULE_OUTPUT_NOT_INTEGER_MINOR'],
    ['negative output', { line_amount_minor: -10 }, 'RULE_OUTPUT_NOT_INTEGER_MINOR'],
    [
      'inherited output',
      Object.create({ line_amount_minor: 1 }) as Record<string, unknown>,
      'RULE_OUTPUT_MISSING',
    ],
  ])('refuses %s from rules', (_label, outputs, detailCode) => {
    const policy = validatePolicy(TENANT_A, pins(FEE_POLICY_RULES), rulesPolicy());
    const e = errorOf(() => calculate(policy, evaluation({ outputs })));
    expect(e.code).toBe('SF-RULE-001');
    expect(e.details?.[0]?.code).toBe(detailCode);
  });

  it('refuses a calculation that needs rules without an evaluation', () => {
    const policy = validatePolicy(TENANT_A, pins(FEE_POLICY_RULES), rulesPolicy());
    expect(errorOf(() => calculate(policy, null)).details?.[0]?.code).toBe(
      'RULE_EVALUATION_REQUIRED',
    );
  });

  it('refuses totals beyond the exact contract integer range', () => {
    const policy = validatePolicy(
      TENANT_A,
      pins(),
      fixedPolicy({
        lines: [
          { code: 'A', basis: 'FIXED_AMOUNT', amount_minor: Number.MAX_SAFE_INTEGER },
          { code: 'B', basis: 'FIXED_AMOUNT', amount_minor: 1 },
        ],
      }),
    );
    expect(errorOf(() => calculate(policy, null)).details?.[0]?.code).toBe(
      'FEE_TOTAL_OUT_OF_RANGE',
    );
  });

  it('is deterministic over repeated runs', () => {
    const policy = validatePolicy(TENANT_A, pins(FEE_POLICY_RULES), rulesPolicy());
    const first = JSON.stringify(calculate(policy, evaluation()), (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    for (let i = 0; i < 200; i += 1) {
      const again = JSON.stringify(calculate(policy, evaluation()), (_k, v: unknown) =>
        typeof v === 'bigint' ? v.toString() : v,
      );
      expect(again).toBe(first);
    }
  });
});

describe('calculationHash', () => {
  const base = {
    tenantId: TENANT_A,
    applicationId: APPLICATION_ID,
    pins: pins(FEE_POLICY_RULES),
    policyContentHash: `sha256:${'b'.repeat(64)}`,
    ruleContentHash: HASH_RULES,
    factsHash: factsHash({ category_code: 'X', count: 2 }),
  };

  it('is stable and independent of fact key order', () => {
    expect(calculationHash(base)).toBe(calculationHash({ ...base }));
    expect(factsHash({ a: 1, b: 2 })).toBe(factsHash({ b: 2, a: 1 }));
  });

  it.each([
    ['tenant', { tenantId: TENANT_B }],
    ['application', { applicationId: '33333333-3333-4333-8333-333333333399' }],
    ['policy content', { policyContentHash: `sha256:${'d'.repeat(64)}` }],
    ['rule content', { ruleContentHash: `sha256:${'e'.repeat(64)}` }],
    ['facts', { factsHash: factsHash({ category_code: 'Y' }) }],
    ['pins', { pins: { ...pins(FEE_POLICY_RULES), rule_version_id: OTHER_RULE_VERSION } }],
  ])('changes when %s changes', (_label, override) => {
    expect(calculationHash({ ...base, ...override })).not.toBe(calculationHash(base));
  });
});
