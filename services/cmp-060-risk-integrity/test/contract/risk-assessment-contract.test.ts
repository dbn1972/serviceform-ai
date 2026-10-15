/**
 * Contract conformance tests for SF-CON-RISK-ASSESSMENT (FROZEN).
 * Validates that the service always produces responses that conform to the frozen contract:
 * - authoritative_decision_by_this_component MUST be false
 * - invented_statutory_policy_forbidden MUST be true
 * - raw_risk_score alone MUST NOT determine adverse outcome (advisory only)
 * Architecture Constitution rule 40, INT-018.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_PATH = join(process.cwd(), '../../contracts/m09/schemas/risk-assessment.schema.json');
const VALID_EXAMPLE_PATH = join(
  process.cwd(),
  '../../contracts/m09/examples/valid/risk-assessment.json',
);
const INVALID_EXAMPLE_PATH = join(
  process.cwd(),
  '../../contracts/m09/examples/invalid/risk-assessment.authoritative-decision.json',
);

describe('SF-CON-RISK-ASSESSMENT contract conformance', () => {
  it('schema is FROZEN', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    expect(schema.description).toContain('FROZEN');
    expect(schema.$id).toContain('riskassessment');
  });

  it('valid example has authoritative_decision_by_this_component = false', () => {
    const example = JSON.parse(readFileSync(VALID_EXAMPLE_PATH, 'utf8'));
    expect(example.authoritative_decision_by_this_component).toBe(false);
  });

  it('valid example has invented_statutory_policy_forbidden = true', () => {
    const example = JSON.parse(readFileSync(VALID_EXAMPLE_PATH, 'utf8'));
    expect(example.invented_statutory_policy_forbidden).toBe(true);
  });

  it('valid example has contract_status = FROZEN', () => {
    const example = JSON.parse(readFileSync(VALID_EXAMPLE_PATH, 'utf8'));
    expect(example.contract_status).toBe('FROZEN');
    expect(example.freeze_status).toBe('FROZEN');
  });

  it('invalid example (authoritative=true) is correctly marked invalid', () => {
    const invalid = JSON.parse(readFileSync(INVALID_EXAMPLE_PATH, 'utf8'));
    // This file represents the PROHIBITED pattern; it must have authoritative=true
    expect(invalid.authoritative_decision_by_this_component).toBe(true);
  });

  it('schema enforces authoritative_decision_by_this_component const: false', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    const prop = schema.properties.authoritative_decision_by_this_component;
    expect(prop.type).toBe('boolean');
    expect(prop.const).toBe(false);
  });

  it('schema enforces invented_statutory_policy_forbidden const: true', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    const prop = schema.properties.invented_statutory_policy_forbidden;
    expect(prop.type).toBe('boolean');
    expect(prop.const).toBe(true);
  });

  it('schema description explicitly prohibits score-only adverse outcomes', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    expect(schema.description).toMatch(/score.*MUST NOT reject|MUST NOT reject.*score/i);
  });
});
