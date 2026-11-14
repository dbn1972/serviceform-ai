import { contentHash } from '../hash';
import type { Condition, RuleDesign, RuleInput, RuleOutput, Scalar } from './model';

export interface JdmNode {
  id: string;
  type: 'inputNode' | 'decisionTableNode' | 'outputNode';
  name: string;
  position: { x: number; y: number };
  content?: unknown;
}

export interface Jdm {
  contentType: 'application/vnd.gorules.decision';
  nodes: JdmNode[];
  edges: { id: string; sourceId: string; targetId: string; type: 'edge' }[];
}

/** CMP-008 rule pack (CMP-033 RULES payload, executable part). */
export interface RulePackPayload {
  rule_pack_id: string;
  engine: 'GORULES';
  jdm: Jdm;
  outcome_field?: string;
  reason_codes_field?: string;
}

function literal(value: Scalar | undefined, input: RuleInput): string {
  if (input.type === 'number') return String(typeof value === 'number' ? value : Number(value));
  if (input.type === 'boolean') return value === true || value === 'true' ? 'true' : 'false';
  return JSON.stringify(String(value ?? ''));
}

/** ZEN unary test for one cell (verified against the CMP-008 engine in the CDC suite). */
export function unaryTest(condition: Condition | undefined, input: RuleInput): string {
  if (!condition || condition.op === 'any') return '';
  switch (condition.op) {
    case 'eq':
      return literal(condition.value, input);
    case 'ne':
      return `!= ${literal(condition.value, input)}`;
    case 'lt':
      return `< ${literal(condition.value, input)}`;
    case 'le':
      return `<= ${literal(condition.value, input)}`;
    case 'gt':
      return `> ${literal(condition.value, input)}`;
    case 'ge':
      return `>= ${literal(condition.value, input)}`;
    case 'between':
      return `[${literal(condition.value, input)}..${literal(condition.to, input)}]`;
    case 'in':
      return (condition.values ?? []).map((v) => JSON.stringify(v)).join(', ');
    default:
      return '';
  }
}

/** Output cell: outcome → string literal, reasons → list literal, value → raw ZEN expression. */
export function outputExpression(output: RuleOutput, value: string | string[] | undefined): string {
  if (output.kind === 'reasons') {
    const list = Array.isArray(value) ? value : value ? [value] : [];
    return `[${list.map((v) => JSON.stringify(v)).join(', ')}]`;
  }
  if (output.kind === 'outcome') {
    const code = Array.isArray(value) ? value[0] : value;
    return code ? JSON.stringify(code) : '';
  }
  return Array.isArray(value) ? value.join(', ') : (value ?? '');
}

export function compileJdm(design: RuleDesign): Jdm {
  const rules = design.rows.map((row) => {
    const rule: Record<string, string> = { _id: row.id };
    if (row.description) rule['_description'] = row.description;
    for (const input of design.inputs) rule[input.id] = unaryTest(row.when[input.id], input);
    for (const output of design.outputs)
      rule[output.id] = outputExpression(output, row.then[output.id]);
    return rule;
  });
  return {
    contentType: 'application/vnd.gorules.decision',
    nodes: [
      { id: 'request', type: 'inputNode', name: 'Request', position: { x: 80, y: 200 } },
      {
        id: 'decision_table',
        type: 'decisionTableNode',
        name: design.title || design.packKey,
        position: { x: 360, y: 200 },
        content: {
          hitPolicy: 'first',
          inputs: design.inputs.map((i) => ({ id: i.id, name: i.label, field: i.field })),
          outputs: design.outputs.map((o) => ({ id: o.id, name: o.label, field: o.field })),
          rules,
        },
      },
      { id: 'response', type: 'outputNode', name: 'Response', position: { x: 680, y: 200 } },
    ],
    edges: [
      { id: 'request_to_table', sourceId: 'request', targetId: 'decision_table', type: 'edge' },
      { id: 'table_to_response', sourceId: 'decision_table', targetId: 'response', type: 'edge' },
    ],
  };
}

export function compileRulePack(design: RuleDesign): RulePackPayload {
  const pack: RulePackPayload = {
    rule_pack_id: design.packKey,
    engine: 'GORULES',
    jdm: compileJdm(design),
  };
  const outcome = design.outputs.find((o) => o.kind === 'outcome');
  const reasons = design.outputs.find((o) => o.kind === 'reasons');
  if (outcome) pack.outcome_field = outcome.field;
  if (reasons) pack.reason_codes_field = reasons.field;
  return pack;
}

/** Content hash of the executable pack only (the pin); test cases and authoring are not hashed. */
export function rulePackHash(pack: RulePackPayload): Promise<string> {
  return contentHash(pack);
}

/** Test-case inputs as the nested object ZEN reads (`applicant.age` → `{applicant: {age}}`). */
export function caseInputs(
  design: RuleDesign,
  values: Record<string, Scalar | null>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const input of design.inputs) {
    const raw = values[input.field];
    if (raw === null || raw === undefined || raw === '') continue;
    const value =
      input.type === 'number'
        ? Number(raw)
        : input.type === 'boolean'
          ? raw === true || raw === 'true'
          : String(raw);
    const parts = input.field.split('.');
    let cur = out;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) cur[p] = value;
      else {
        const next = (cur[p] as Record<string, unknown> | undefined) ?? {};
        cur[p] = next;
        cur = next;
      }
    });
  }
  return out;
}
