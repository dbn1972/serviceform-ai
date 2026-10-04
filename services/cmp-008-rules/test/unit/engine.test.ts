import { describe, expect, it } from 'vitest';
import { ZenRuleEngine, ZEN_ENGINE_VERSION } from '../../src/domain/engine.js';
import { validateJdm } from '../../src/domain/jdm.js';
import { criteriaTable, expressionGraph, noMatchTable } from '../fixtures/packs.js';

const engine = new ZenRuleEngine();

describe('ZenRuleEngine (GoRules ZEN, deterministic)', () => {
  it('evaluates a published decision table and reports the matched rule id', async () => {
    const res = await engine.evaluate(validateJdm(criteriaTable()), { score: 70 }, 2000);
    expect(res.outputs['outcome']).toBe('MEETS_CRITERIA');
    expect(res.matchedRules).toEqual([{ node_id: 't', rule_id: 'rule-high' }]);
    const low = await engine.evaluate(validateJdm(criteriaTable()), { score: 10 }, 2000);
    expect(low.outputs['outcome']).toBe('DOES_NOT_MEET_CRITERIA');
    expect(low.matchedRules[0]?.rule_id).toBe('rule-low');
  });

  it('is repeatable: identical pinned graph and inputs give identical results', async () => {
    const jdm = validateJdm(criteriaTable());
    const runs = await Promise.all(
      Array.from({ length: 25 }, () => engine.evaluate(jdm, { score: 50 }, 2000)),
    );
    for (const r of runs) expect(r).toEqual(runs[0]);
  });

  it('does not mutate caller inputs', async () => {
    const inputs = { score: 60, nested: { a: [1, 2] } };
    const copy = structuredClone(inputs);
    await engine.evaluate(validateJdm(criteriaTable()), inputs, 2000);
    expect(inputs).toEqual(copy);
  });

  it('returns empty outputs (never a default decision) when no rule matches', async () => {
    const res = await engine.evaluate(validateJdm(noMatchTable()), { score: 1 }, 2000);
    expect(res.outputs).toEqual({});
    expect(res.matchedRules).toEqual([]);
  });

  it('evaluates expression nodes with caller-supplied as-of data only', async () => {
    const jdm = validateJdm(expressionGraph('score * 2'));
    const res = await engine.evaluate(jdm, { score: 21 }, 2000);
    expect(res.outputs).toEqual({ value: 42 });
  });

  it('fails safely (SF-RULE-001) when the graph cannot evaluate', async () => {
    const jdm = validateJdm(expressionGraph('score +'));
    await expect(engine.evaluate(jdm, { score: 1 }, 2000)).rejects.toMatchObject({
      code: 'SF-RULE-001',
      statusCode: 422,
    });
  });

  it('pins the engine version string to the dependency version', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['@gorules/zen-engine']).toBe(ZEN_ENGINE_VERSION);
    expect(engine.name).toBe('gorules-zen');
  });
});
