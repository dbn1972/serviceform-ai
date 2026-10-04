import { describe, expect, it } from 'vitest';
import { ALLOWED_NODE_TYPES, validateJdm } from '../../src/domain/jdm.js';
import { parseRulePack } from '../../src/domain/pack.js';
import { criteriaTable, expressionGraph, forbiddenNodeGraph } from '../fixtures/packs.js';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { details?: { code: string }[] }).details?.[0]?.code;
  }
  return undefined;
}

describe('JDM allow-list (deterministic metadata only)', () => {
  it('accepts the structural node kinds', () => {
    expect(ALLOWED_NODE_TYPES).toEqual([
      'inputNode',
      'outputNode',
      'decisionTableNode',
      'expressionNode',
      'switchNode',
    ]);
    expect(() => validateJdm(criteriaTable())).not.toThrow();
  });

  it.each(['functionNode', 'customNode', 'httpRequestNode', 'decisionNode', 'unknownNode'])(
    'refuses %s',
    (type) => {
      expect(code(() => validateJdm(forbiddenNodeGraph(type)))).toBe('JDM_NODE_TYPE_FORBIDDEN');
    },
  );

  it.each(['d()', 'date()', 'now()', 'today()', 'rand()', 'random( )', 'uuid()', 'time()', 'D ()'])(
    'refuses zero-argument clock/entropy call %s',
    (expr) => {
      expect(code(() => validateJdm(expressionGraph(expr)))).toBe('JDM_NON_DETERMINISTIC_FUNCTION');
    },
  );

  it('allows date functions that take an explicit input', () => {
    expect(() => validateJdm(expressionGraph('d(as_of)'))).not.toThrow();
  });

  it('refuses structural defects', () => {
    const g = criteriaTable();
    expect(code(() => validateJdm({ nodes: g.nodes }))).toBe('JDM_EDGES_INVALID');
    expect(code(() => validateJdm('x'))).toBe('JDM_NOT_OBJECT');
    expect(code(() => validateJdm({ nodes: [g.nodes[0]], edges: [] }))).toBe('JDM_NODES_INVALID');
    expect(code(() => validateJdm({ nodes: [g.nodes[1], g.nodes[2]], edges: [] }))).toBe(
      'JDM_INPUT_NODE_REQUIRED',
    );
    expect(code(() => validateJdm({ nodes: [g.nodes[0], g.nodes[1]], edges: [] }))).toBe(
      'JDM_OUTPUT_NODE_REQUIRED',
    );
    expect(code(() => validateJdm({ nodes: [...g.nodes, g.nodes[0]], edges: g.edges }))).toBe(
      'JDM_NODE_ID_DUPLICATE',
    );
    expect(
      code(() => validateJdm({ nodes: g.nodes, edges: [{ sourceId: 'in', targetId: 'ghost' }] })),
    ).toBe('JDM_EDGE_DANGLING');
    expect(
      code(() =>
        validateJdm({
          nodes: g.nodes,
          edges: [...g.edges, { sourceId: 'out', targetId: 't' }],
        }),
      ),
    ).toBe('JDM_CYCLE');
    expect(
      code(() =>
        validateJdm({ nodes: [{ ...g.nodes[0], id: 'bad id!' }, ...g.nodes.slice(1)], edges: [] }),
      ),
    ).toBe('JDM_NODE_ID_INVALID');
    const huge = criteriaTable();
    (huge.nodes[1] as { content: unknown }).content = { blob: 'x'.repeat(300_000) };
    expect(code(() => validateJdm(huge))).toBe('JDM_TOO_LARGE');
  });
});

describe('published RULES pack parsing', () => {
  const ok = { rule_pack_id: 'generic.pack', engine: 'GORULES', jdm: criteriaTable() };

  it('requires the GoRules engine and a matching pack id', () => {
    expect(parseRulePack(ok, 'generic.pack').outcomeField).toBeNull();
    expect(code(() => parseRulePack({ ...ok, engine: 'OTHER' }, 'generic.pack'))).toBe(
      'RULE_PACK_ENGINE_UNSUPPORTED',
    );
    expect(code(() => parseRulePack(ok, 'generic.other'))).toBe('RULE_PACK_KEY_MISMATCH');
    expect(code(() => parseRulePack(null, 'generic.pack'))).toBe('RULE_PACK_NOT_OBJECT');
    expect(code(() => parseRulePack({ ...ok, rule_pack_id: 'X' }, 'X'))).toBe(
      'RULE_PACK_ID_INVALID',
    );
    expect(code(() => parseRulePack({ ...ok, outcome_field: '1bad' }, 'generic.pack'))).toBe(
      'RULE_PACK_OUTCOME_FIELD_INVALID',
    );
    expect(code(() => parseRulePack({ ...ok, reason_codes_field: 3 }, 'generic.pack'))).toBe(
      'RULE_PACK_REASON_FIELD_INVALID',
    );
  });
});
