import { describe, expect, it } from 'vitest';
import { ZenRuleEngine } from '../../src/domain/engine.js';
import { sha256Of } from '../../src/domain/canonical.js';
import { createStudioRulesApi, rulePackContentHash } from '../../src/http/studio-api.js';
import { criteriaTable, expressionGraph, forbiddenNodeGraph, PACK_KEY } from '../fixtures/packs.js';

const caller = {
  tenant_id: '11111111-1111-4111-8111-111111111111',
  actor: { type: 'OFFICER', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  roles: ['STUDIO_DESIGNER'],
  correlation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

function api(allow = true) {
  return createStudioRulesApi({
    authorize: async (c) => allow && c.roles.includes('STUDIO_DESIGNER'),
    engine: new ZenRuleEngine(),
  });
}

const pack = {
  rule_pack_id: PACK_KEY,
  engine: 'GORULES',
  jdm: criteriaTable(),
  outcome_field: 'outcome',
  reason_codes_field: 'reasons',
};

// REQ: Phase C-3 — Studio test cases run on the CMP-008 parser and ZEN engine; nothing persists.
describe('CMP-008 Studio test bench', () => {
  it('runs cases on the ZEN engine and reports pass/fail per case with matched rules', async () => {
    const res = await api().test(caller, {
      pack,
      cases: [
        {
          id: 'high',
          inputs: { score: 70 },
          expect_outcome: 'MEETS_CRITERIA',
          expect_reasons: ['ALPHA_THRESHOLD_MET', 'ZETA_THRESHOLD_MET'],
        },
        { id: 'low', inputs: { score: 10 }, expect_outcome: 'MEETS_CRITERIA' },
      ],
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      content_hash: string;
      advisory: boolean;
      passed: number;
      failed: number;
      results: { id: string; pass: boolean; outcome: string; matched_rules: string[] }[];
    };
    expect(body).toMatchObject({ advisory: true, passed: 1, failed: 1 });
    expect(body.results[0]).toMatchObject({ id: 'high', pass: true, matched_rules: ['rule-high'] });
    expect(body.results[1]).toMatchObject({
      id: 'low',
      pass: false,
      outcome: 'DOES_NOT_MEET_CRITERIA',
    });
    expect(body.content_hash).toBe(sha256Of(pack));
    expect(rulePackContentHash({ ...pack, test_cases: [], authoring: {} })).toBe(sha256Of(pack));
  });

  it('refuses packs CMP-008 would refuse to publish, and bad outcome values per case', async () => {
    const forbidden = await api().test(caller, {
      pack: { ...pack, jdm: forbiddenNodeGraph('functionNode') },
      cases: [],
    });
    expect(forbidden.status).toBe(422);
    expect(JSON.stringify(forbidden.body)).toContain('JDM_NODE_TYPE_FORBIDDEN');
    const clock = await api().test(caller, {
      pack: { ...pack, jdm: expressionGraph('now()') },
      cases: [],
    });
    expect(JSON.stringify(clock.body)).toContain('JDM_NON_DETERMINISTIC_FUNCTION');
    const lower = await api().test(caller, {
      pack: { ...pack, jdm: expressionGraph('"lower"'), outcome_field: 'value' },
      cases: [{ id: 'x', inputs: {} }],
    });
    expect((lower.body as { results: { error: string }[] }).results[0]?.error).toBe(
      'OUTCOME_VALUE_INVALID',
    );
  });

  it('is deny-by-default and validates the request shape', async () => {
    expect((await api(false).test(caller, { pack, cases: [] })).status).toBe(403);
    expect((await api().test(caller, { cases: [] })).status).toBe(400);
    expect(
      (
        await api().test(caller, {
          pack,
          cases: Array.from({ length: 51 }, () => ({ inputs: {} })),
        })
      ).status,
    ).toBe(400);
    expect((await api().test(caller, { pack, cases: [{ inputs: 'x' }] })).status).toBe(400);
  });
});
