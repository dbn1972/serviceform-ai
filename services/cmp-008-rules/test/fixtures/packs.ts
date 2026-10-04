import { randomUUID } from 'node:crypto';
import { sha256Of } from '../../src/domain/canonical.js';
import type { Jdm } from '../../src/domain/jdm.js';

export const PACK_KEY = 'generic.criteria-check';

function graph(middle: Record<string, unknown>): Jdm {
  return {
    contentType: 'application/vnd.gorules.decision',
    nodes: [
      { id: 'in', type: 'inputNode', name: 'request' },
      middle as Jdm['nodes'][number],
      { id: 'out', type: 'outputNode', name: 'response' },
    ],
    edges: [
      { id: 'e1', sourceId: 'in', targetId: String(middle['id']), type: 'edge' },
      { id: 'e2', sourceId: String(middle['id']), targetId: 'out', type: 'edge' },
    ],
  };
}

/** Generic threshold table. Field names and codes are neutral test metadata, not legislation. */
export function criteriaTable(): Jdm {
  return graph({
    id: 't',
    type: 'decisionTableNode',
    name: 'criteria',
    content: {
      hitPolicy: 'first',
      inputs: [{ id: 'i1', name: 'Score', field: 'score' }],
      outputs: [
        { id: 'o1', name: 'Outcome', field: 'outcome' },
        { id: 'o2', name: 'Reasons', field: 'reasons' },
      ],
      rules: [
        {
          _id: 'rule-high',
          i1: '>= 50',
          o1: '"MEETS_CRITERIA"',
          o2: '["ZETA_THRESHOLD_MET", "ALPHA_THRESHOLD_MET", "ZETA_THRESHOLD_MET"]',
        },
        { _id: 'rule-low', i1: '< 50', o1: '"DOES_NOT_MEET_CRITERIA"', o2: '["BELOW_THRESHOLD"]' },
      ],
    },
  });
}

export function noMatchTable(): Jdm {
  const g = criteriaTable();
  const t = g.nodes[1] as unknown as { content: { rules: unknown[] } };
  t.content.rules = [{ _id: 'only-high', i1: '>= 50', o1: '"MEETS_CRITERIA"', o2: '["X_CODE"]' }];
  return g;
}

export function expressionGraph(expression: string): Jdm {
  return graph({
    id: 'x',
    type: 'expressionNode',
    name: 'expr',
    content: { expressions: [{ id: 'a', key: 'value', value: expression }] },
  });
}

export function forbiddenNodeGraph(type: string): Jdm {
  return graph({
    id: 'f',
    type,
    name: 'forbidden',
    content: { source: 'export const handler = async (i) => i;' },
  });
}

export interface PackFixture {
  tenant_id: string;
  pack_key: string;
  version_id: string;
  content_hash: string;
  payload: unknown;
}

export function packFixture(
  tenantId: string,
  jdm: Jdm = criteriaTable(),
  extra: Record<string, unknown> = {},
  packKey = PACK_KEY,
): PackFixture {
  const payload = {
    rule_pack_id: packKey,
    engine: 'GORULES',
    outcome_field: 'outcome',
    reason_codes_field: 'reasons',
    jdm,
    ...extra,
  };
  return {
    tenant_id: tenantId,
    pack_key: packKey,
    version_id: randomUUID(),
    content_hash: sha256Of({ payload, v: randomUUID() }),
    payload,
  };
}

export function pinOf(p: PackFixture) {
  return { pack_key: p.pack_key, version_id: p.version_id, content_hash: p.content_hash };
}
