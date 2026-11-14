import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RulesPage from '../app/rules/page';
import { StudioNav } from '../components/StudioNav';
import { DecisionTable } from '../components/rules/DecisionTable';
import { RulesDesigner } from '../components/rules/RulesDesigner';
import { tally, testCases, verdictOf } from '../lib/rule-runs';
import { RuleTests } from '../components/rules/RuleTests';
import { assertPlatformPath } from '../lib/bff';
import { rulesSource } from '../lib/designer-source';
import { residencePeriodRules } from '@serviceform/studio-designers/rules';

const DOC = '0d15ba00-00c1-4000-8000-0d15ba0000c1';
const noop = () => undefined;

// REQ: Phase C-3 Studio rules designer (UX4G, GoRules JDM on CMP-008, advisory only).
describe('Studio rules designer', () => {
  it('offers blank, saved-draft and template starting points', () => {
    const html = renderToStaticMarkup(<RulesPage />);
    expect(html).toContain('>Rules designer</h1>');
    expect(html).toContain('href="/rules/designer"');
    expect(html).toContain('href="/rules/designer?template=residence-period"');
    expect(html).toContain('action="/rules/designer"');
    expect(html).toContain('GoRules JDM · ZEN engine · advisory only');
    expect(html).toContain('Rules never approve or reject an application');
    expect(renderToStaticMarkup(<StudioNav />)).toContain('href="/rules"');
  });

  it('renders the template as a plain-language decision table with an inspector', () => {
    const html = renderToStaticMarkup(
      <RulesDesigner source={{ kind: 'template', id: 'residence-period' }} />,
    );
    expect(html).toContain('>Residence period indicative check</h1>');
    expect(html).toContain('2 rows · 3 tests');
    expect(html).toContain('Advisory · never a decision');
    expect(html).toContain('NOT SAVED');
    expect(html).toContain('First matching row wins');
    expect(html).toContain('aria-label="Edit row 1: Lived here 12 months or more"');
    expect(html).toContain('aria-label="Edit input column Months at current address"');
    expect(html).toContain('>at least 12<');
    expect(html).toContain('>any value<');
    expect(html).toContain('>MEETS_SAMPLE_CRITERIA<');
    expect(html).toContain('Constitution §20');
  });

  it('marks rows reached by the last CMP-008 run and shows results per test', () => {
    const design = residencePeriodRules();
    const run = {
      key: 'k',
      body: {
        pack_key: design.packKey,
        content_hash: `sha256:${'a'.repeat(64)}`,
        engine: { name: 'gorules-zen', version: '0.0.0' },
        advisory: true as const,
        passed: 2,
        failed: 1,
        results: [
          {
            id: 'test_18',
            pass: true,
            outcome: 'MEETS_SAMPLE_CRITERIA',
            reason_codes: ['RESIDENCE_PERIOD_MET'],
            matched_rules: ['row_period_met'],
          },
          {
            id: 'test_12',
            pass: true,
            outcome: 'MEETS_SAMPLE_CRITERIA',
            reason_codes: [],
            matched_rules: ['row_period_met'],
          },
          {
            id: 'test_6',
            pass: false,
            outcome: 'REFER_TO_OFFICER',
            reason_codes: [],
            matched_rules: ['row_otherwise'],
          },
        ],
      },
    };
    const table = renderToStaticMarkup(
      <DecisionTable
        design={design}
        issues={[]}
        selection={{ kind: 'row', id: 'row_otherwise' }}
        readOnly={false}
        run={run}
        apply={noop}
        select={noop}
      />,
    );
    expect(table).toContain('Matched by 2 tests');
    expect(table).toContain('Matched by 1 test<');
    expect(table).toMatch(/<tr aria-current="true"[^>]*>.*Edit row 2/);
    const tests = renderToStaticMarkup(
      <RuleTests
        design={design}
        issues={[]}
        selection={{ kind: 'test', id: 'test_6' }}
        readOnly={false}
        run={run}
        fresh
        running={false}
        runError=""
        contentHash={run.body.content_hash}
        onRun={noop}
        apply={noop}
        select={noop}
      />,
    );
    expect(tests).toContain('1 of 3 tests failed');
    expect(tally(design, run.body)).toEqual({ total: 3, passed: 2, failed: 1, unchecked: 0 });
    const unexpected = {
      ...design,
      tests: design.tests.map(({ expectOutcome: _o, expectReasons: _r, ...t }) => t),
    };
    expect(tally(unexpected, run.body)).toEqual({ total: 3, passed: 0, failed: 0, unchecked: 3 });
    const t = { id: 't', name: 't', inputs: {} };
    const hit = { id: 't', pass: true, outcome: 'A_B', reason_codes: ['X', 'Y'] };
    expect(verdictOf({ ...t, expectOutcome: 'A_B', expectReasons: ['Y', 'X'] }, hit)).toBe(
      'passed',
    );
    expect(verdictOf({ ...t, expectReasons: ['X'] }, hit)).toBe('failed');
    expect(
      verdictOf({ ...t, expectOutcome: 'A_B' }, { ...hit, error: 'RULE_EVALUATION_FAILED' }),
    ).toBe('failed');
    expect(verdictOf(t, undefined)).toBeNull();
    expect(tests).toContain('matches the designer');
    expect(tests).toContain('Run 3 on CMP-008');
    expect(tests).toContain('Use this result as expected');
    expect(tests).toContain('Never paste real applicant data');
    const stale = renderToStaticMarkup(
      <RuleTests
        design={design}
        issues={[]}
        selection={{ kind: 'pack' }}
        readOnly={false}
        run={run}
        fresh={false}
        running={false}
        runError=""
        contentHash={null}
        onRun={noop}
        apply={noop}
        select={noop}
      />,
    );
    expect(stale).toContain('Results are out of date');
    expect(stale).not.toContain('Use this result as expected');
  });

  it('sends ZEN-shaped inputs and only the declared expectations to the test bench', () => {
    const design = {
      ...residencePeriodRules(),
      inputs: [
        ...residencePeriodRules().inputs,
        { id: 'in_age', label: 'Age', field: 'applicant.age', type: 'number' as const },
      ],
    };
    design.tests = [
      {
        id: 't',
        name: 'x',
        inputs: { residence_duration_months: '7', 'applicant.age': 30 },
        expectOutcome: 'REFER_TO_OFFICER',
      },
    ];
    expect(testCases(design)).toEqual([
      {
        id: 't',
        inputs: { residence_duration_months: 7, applicant: { age: 30 } },
        expect_outcome: 'REFER_TO_OFFICER',
      },
    ]);
  });

  it('resolves rule sources and allowlists only the CMP-008 test bench', () => {
    expect(rulesSource({ document: DOC })).toEqual({ kind: 'document', id: DOC });
    expect(rulesSource({ template: 'residence-period' })).toEqual({
      kind: 'template',
      id: 'residence-period',
    });
    expect(rulesSource({ template: '../x' })).toEqual({ kind: 'blank' });
    expect(assertPlatformPath('rule-packs/test')).toBe('/v1/rule-packs/test');
    expect(() => assertPlatformPath('evaluations')).toThrow('SF-AUTH-002');
    expect(() => assertPlatformPath('rule-packs/other')).toThrow('SF-AUTH-002');
  });
});
