import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash } from '../src/hash';
import {
  addInput,
  addOutput,
  addRow,
  addTest,
  blankRules,
  buildRulesDocument,
  caseInputs,
  compileJdm,
  compileRulePack,
  lintRules,
  moveRow,
  removeColumn,
  removeRow,
  removeTest,
  residencePeriodRules,
  rowsUsingCode,
  rulesDocumentOf,
  rulesHaveErrors,
  setCondition,
  setResult,
  suggestBoundaryTests,
  unaryTest,
  updateInput,
  updateOutput,
  updateTest,
  type RuleDesign,
  type RuleInput,
} from '../src/rules';

const num: RuleInput = { id: 'i', label: 'N', field: 'n', type: 'number' };
const str: RuleInput = { id: 's', label: 'S', field: 's', type: 'string' };
const bool: RuleInput = { id: 'b', label: 'B', field: 'b', type: 'boolean' };

function codes(d: RuleDesign): string[] {
  return lintRules(d).map((i) => i.code);
}

// REQ: Phase C-3 — rules designer compiles GoRules JDM decision tables for CMP-008.
describe('rules designer: compile', () => {
  it('compiles plain-language conditions to ZEN unary tests', () => {
    expect(unaryTest(undefined, num)).toBe('');
    expect(unaryTest({ op: 'ge', value: 12 }, num)).toBe('>= 12');
    expect(unaryTest({ op: 'ne', value: 3 }, num)).toBe('!= 3');
    expect(unaryTest({ op: 'between', value: 1, to: 10 }, num)).toBe('[1..10]');
    expect(unaryTest({ op: 'eq', value: 'OD' }, str)).toBe('"OD"');
    expect(unaryTest({ op: 'ne', value: 'OD' }, str)).toBe('!= "OD"');
    expect(unaryTest({ op: 'in', values: ['A', 'B'] }, str)).toBe('"A", "B"');
    expect(unaryTest({ op: 'eq', value: true }, bool)).toBe('true');
  });

  it('builds a first-hit decision table pack with outcome and reason fields', async () => {
    const design = residencePeriodRules();
    const pack = compileRulePack(design);
    expect(pack).toMatchObject({
      rule_pack_id: 'lab.ind-soc-002.residence-period',
      engine: 'GORULES',
      outcome_field: 'outcome',
      reason_codes_field: 'reasons',
    });
    const table = pack.jdm.nodes[1]?.content as {
      hitPolicy: string;
      rules: Record<string, string>[];
    };
    expect(table.hitPolicy).toBe('first');
    expect(table.rules[0]).toEqual({
      _id: 'row_period_met',
      _description: 'Lived here 12 months or more',
      in_months: '>= 12',
      out_outcome: '"MEETS_SAMPLE_CRITERIA"',
      out_reasons: '["RESIDENCE_PERIOD_MET"]',
    });
    expect(table.rules[1]?.['in_months']).toBe('');
    const doc = await buildRulesDocument(design);
    expect(doc.documentKey).toBe('lab.ind-soc-002.residence-period.v1.0.0');
    expect(doc.contentHash).toBe(await contentHash(pack));
    expect(doc.payload.test_cases).toHaveLength(3);
    expect(rulesDocumentOf(doc.payload)?.design).toEqual(design);
    expect(rulesDocumentOf({ rule_pack_id: 'x' })).toBeNull();
    expect(canonicalJson(compileJdm(design))).toBe(canonicalJson(pack.jdm));
  });

  it('turns test inputs into the nested object ZEN reads', () => {
    const d = { ...blankRules(), inputs: [{ ...num, field: 'applicant.age' }, str, bool] };
    expect(caseInputs(d, { 'applicant.age': '40', s: 'OD', b: 'true' })).toEqual({
      applicant: { age: 40 },
      s: 'OD',
      b: true,
    });
    expect(caseInputs(d, { 'applicant.age': null, s: '' })).toEqual({});
  });
});

describe('rules designer: checks and assistance', () => {
  it('the residence sample has no errors and full outcome coverage', () => {
    expect(lintRules(residencePeriodRules()).filter((i) => i.severity === 'error')).toEqual([]);
    expect(codes(residencePeriodRules())).not.toContain('OUTCOME_UNTESTED');
  });

  it('flags decision-sounding outcomes, unreachable rows and undeclared codes', () => {
    let d = residencePeriodRules();
    d = { ...d, outcomes: [...d.outcomes, 'APPROVED'] };
    d = moveRow(d, 'row_otherwise', -1);
    d = setResult(d, 'row_period_met', 'out_outcome', 'UNKNOWN_CODE');
    const found = codes(d);
    expect(found).toEqual(
      expect.arrayContaining([
        'OUTCOME_READS_AS_DECISION',
        'ROW_UNREACHABLE',
        'ROW_OUTCOME_UNDECLARED',
        'OUTCOME_UNTESTED',
      ]),
    );
    expect(rulesHaveErrors(lintRules(d))).toBe(true);
  });

  it('flags invalid conditions and missing expectations', () => {
    let d = addInput(blankRules('Bad', ''), {
      label: 'Code',
      field: 'bad field',
      type: 'string',
    }).design;
    const row = addRow(d);
    d = row.design;
    d = setCondition(d, row.id, 'in_value', { op: 'between', value: 9, to: 1 });
    d = setCondition(d, row.id, d.inputs[1]?.id ?? '', { op: 'eq', value: 'x" or true' });
    d = { ...d, tests: [{ id: 't', name: '', inputs: {} }] };
    expect(codes(d)).toEqual(
      expect.arrayContaining([
        'PACK_KEY_INVALID',
        'TITLE_REQUIRED',
        'FIELD_INVALID',
        'CONDITION_RANGE_INVALID',
        'CONDITION_TEXT_INVALID',
        'TEST_NAME_REQUIRED',
        'TEST_EXPECTATION_REQUIRED',
      ]),
    );
  });

  it('suggests boundary inputs without choosing expected results', () => {
    const suggested = suggestBoundaryTests(residencePeriodRules());
    expect(suggested.map((t) => t.inputs['residence_duration_months'])).toEqual([11, 12, 13]);
    expect(suggested.every((t) => t.expectOutcome === undefined)).toBe(true);
  });

  it('keeps rows and tests consistent when columns are edited or removed', () => {
    const base = residencePeriodRules();
    const renamed = updateInput(base, 'in_months', { field: 'months_here' });
    expect(renamed.tests[0]?.inputs).toEqual({ months_here: 18 });
    expect(renamed.rows[0]?.when['in_months']).toEqual({ op: 'ge', value: 12 });
    const retyped = updateInput(base, 'in_months', { type: 'string' });
    expect(retyped.rows[0]?.when).toEqual({});
    expect(retyped.tests[0]?.inputs).toEqual({});
    const rekinded = updateOutput(base, 'out_reasons', { kind: 'value' });
    expect(rekinded.rows[0]?.then).toEqual({ out_outcome: 'MEETS_SAMPLE_CRITERIA' });
    const removed = removeColumn(base, 'in_months');
    expect(removed.inputs).toEqual([]);
    expect(removed.rows.every((r) => Object.keys(r.when).length === 0)).toBe(true);
    expect(removed.tests.every((t) => Object.keys(t.inputs).length === 0)).toBe(true);
    const added = addOutput(base, { label: 'Note', field: 'note', kind: 'value' });
    expect(added.design.outputs.map((o) => o.field)).toEqual(['outcome', 'reasons', 'note']);
    expect(rowsUsingCode(base, 'REFER_TO_OFFICER')).toEqual([2]);
    expect(rowsUsingCode(removeRow(base, 'row_otherwise'), 'REFER_TO_OFFICER')).toEqual([]);
  });

  it('edits test cases, dropping empty expectations', () => {
    const t = addTest(residencePeriodRules(), { inputs: { residence_duration_months: 3 } });
    expect(t.design.tests).toHaveLength(4);
    const edited = updateTest(t.design, t.id, {
      expectOutcome: 'REFER_TO_OFFICER',
      expectReasons: [],
    });
    expect(edited.tests[3]).toEqual({
      id: t.id,
      name: 'Test 4',
      inputs: { residence_duration_months: 3 },
      expectOutcome: 'REFER_TO_OFFICER',
    });
    expect(removeTest(edited, t.id).tests).toHaveLength(3);
  });
});
