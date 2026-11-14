import { describe, expect, it } from 'vitest';
import * as designer from '../../packages/studio-designers/src/rules/index.js';
import { sha256Of } from '../../services/cmp-008-rules/src/domain/canonical.js';
import { ZenRuleEngine } from '../../services/cmp-008-rules/src/domain/engine.js';
import { parseRulePack } from '../../services/cmp-008-rules/src/domain/pack.js';
import { createStudioRulesApi } from '../../services/cmp-008-rules/src/http/studio-api.js';

const caller = {
  tenant_id: '11111111-1111-4111-8111-111111111111',
  actor: { type: 'OFFICER', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  roles: ['STUDIO_DESIGNER'],
  correlation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};
const bench = createStudioRulesApi({ authorize: async () => true, engine: new ZenRuleEngine() });

async function run(
  design: designer.RuleDesign,
  cases: { inputs: Record<string, unknown>; expect: string }[],
) {
  const pack = designer.compileRulePack(design);
  const res = await bench.test(caller, {
    pack,
    cases: cases.map((c, i) => ({ id: String(i), inputs: c.inputs, expect_outcome: c.expect })),
  });
  return res.body as {
    failed: number;
    content_hash: string;
    results: { outcome: string | null }[];
  };
}

// REQ: Phase C-3 consumer-driven contract — the Studio rules designer (consumer) emits packs the
// CMP-008 parser accepts, with the content hash CMP-008 computes, and every operator the
// designer offers means on the ZEN engine what the designer says it means.
describe('Studio rules designer against CMP-008 (ZEN)', () => {
  it('the residence sample parses, hashes identically and passes its own tests', async () => {
    const design = designer.residencePeriodRules();
    const doc = await designer.buildRulesDocument(design);
    const parsed = parseRulePack(doc.payload, design.packKey);
    expect(parsed).toMatchObject({ outcomeField: 'outcome', reasonCodesField: 'reasons' });
    expect(doc.contentHash).toBe(sha256Of(doc.pack));
    const res = await bench.test(caller, {
      pack: doc.payload,
      cases: design.tests.map((t) => ({
        id: t.id,
        inputs: designer.caseInputs(design, t.inputs),
        ...(t.expectOutcome ? { expect_outcome: t.expectOutcome } : {}),
        ...(t.expectReasons ? { expect_reasons: t.expectReasons } : {}),
      })),
    });
    expect(res.body).toMatchObject({ passed: 3, failed: 0, content_hash: doc.contentHash });
  });

  it.each([
    [
      'ge',
      { op: 'ge', value: 12 },
      [
        [12, 'HIT'],
        [11, 'MISS'],
      ],
    ],
    [
      'gt',
      { op: 'gt', value: 12 },
      [
        [13, 'HIT'],
        [12, 'MISS'],
      ],
    ],
    [
      'le',
      { op: 'le', value: 5 },
      [
        [5, 'HIT'],
        [6, 'MISS'],
      ],
    ],
    [
      'lt',
      { op: 'lt', value: 5 },
      [
        [4, 'HIT'],
        [5, 'MISS'],
      ],
    ],
    [
      'eq',
      { op: 'eq', value: 7 },
      [
        [7, 'HIT'],
        [8, 'MISS'],
      ],
    ],
    [
      'ne',
      { op: 'ne', value: 7 },
      [
        [8, 'HIT'],
        [7, 'MISS'],
      ],
    ],
    [
      'between',
      { op: 'between', value: 1, to: 10 },
      [
        [10, 'HIT'],
        [11, 'MISS'],
      ],
    ],
  ] as const)('numeric %s means the same on ZEN', async (_n, condition, points) => {
    const d = numberDesign(condition as designer.Condition);
    const body = await run(
      d,
      points.map(([v, e]) => ({ inputs: { n: v }, expect: e })),
    );
    expect(body.failed).toBe(0);
  });

  it('text "is", "is not", "one of" and boolean "is" mean the same on ZEN', async () => {
    const text = (c: designer.Condition) => ({
      ...numberDesign(c),
      inputs: [{ id: 'in_n', label: 'Code', field: 'n', type: 'string' as const }],
    });
    expect(
      (
        await run(text({ op: 'eq', value: 'OD' }), [
          { inputs: { n: 'OD' }, expect: 'HIT' },
          { inputs: { n: 'XX' }, expect: 'MISS' },
        ])
      ).failed,
    ).toBe(0);
    expect(
      (
        await run(text({ op: 'ne', value: 'OD' }), [
          { inputs: { n: 'XX' }, expect: 'HIT' },
          { inputs: { n: 'OD' }, expect: 'MISS' },
        ])
      ).failed,
    ).toBe(0);
    expect(
      (
        await run(text({ op: 'in', values: ['A', 'B'] }), [
          { inputs: { n: 'B' }, expect: 'HIT' },
          { inputs: { n: 'C' }, expect: 'MISS' },
        ])
      ).failed,
    ).toBe(0);
    const flag = {
      ...numberDesign({ op: 'eq', value: true }),
      inputs: [{ id: 'in_n', label: 'Flag', field: 'n', type: 'boolean' as const }],
    };
    expect(
      (
        await run(flag, [
          { inputs: { n: true }, expect: 'HIT' },
          { inputs: { n: false }, expect: 'MISS' },
        ])
      ).failed,
    ).toBe(0);
  });
});

function numberDesign(condition: designer.Condition): designer.RuleDesign {
  return {
    ...designer.blankRules('lab.cdc.operator', 'Operator check'),
    inputs: [{ id: 'in_n', label: 'N', field: 'n', type: 'number' }],
    outputs: [{ id: 'out_o', label: 'Outcome', field: 'outcome', kind: 'outcome' }],
    outcomes: ['HIT', 'MISS'],
    rows: [
      { id: 'r_hit', description: 'hit', when: { in_n: condition }, then: { out_o: 'HIT' } },
      { id: 'r_miss', description: 'miss', when: {}, then: { out_o: 'MISS' } },
    ],
  };
}
