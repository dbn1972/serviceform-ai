import { contentHash } from '../hash';
import { compileRulePack, rulePackHash, type RulePackPayload } from './compile';
import { rulesDocumentKey } from './lint';
import type {
  Condition,
  RuleDesign,
  RuleInput,
  RuleOutput,
  RuleRow,
  RuleTestCase,
  Scalar,
} from './model';

let counter = 0;

export function ruleId(prefix: string): string {
  counter += 1;
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${(uuid ?? counter.toString(36)).replace(/-/g, '').slice(0, 10)}`;
}

export function blankRules(
  packKey = 'lab.new-service.indicative-check',
  title = 'New indicative check',
): RuleDesign {
  return {
    packKey,
    title,
    version: '1.0.0',
    inputs: [{ id: 'in_value', label: 'Value', field: 'value', type: 'number' }],
    outputs: [
      { id: 'out_outcome', label: 'Outcome', field: 'outcome', kind: 'outcome' },
      { id: 'out_reasons', label: 'Reasons', field: 'reasons', kind: 'reasons' },
    ],
    outcomes: ['MEETS_CRITERIA', 'REFER_TO_OFFICER'],
    reasonCodes: [],
    rows: [],
    tests: [],
  };
}

/**
 * SAMPLE_LAB indicative check built from the Residence template's public sample policy
 * ("12+ months at your address", fixtures/golden/ind-soc-002). Advisory only: it routes to an
 * officer and never approves or rejects.
 */
export function residencePeriodRules(): RuleDesign {
  return {
    packKey: 'lab.ind-soc-002.residence-period',
    title: 'Residence period indicative check',
    version: '1.0.0',
    inputs: [
      {
        id: 'in_months',
        label: 'Months at current address',
        field: 'residence_duration_months',
        type: 'number',
      },
    ],
    outputs: [
      { id: 'out_outcome', label: 'Outcome', field: 'outcome', kind: 'outcome' },
      { id: 'out_reasons', label: 'Reasons', field: 'reasons', kind: 'reasons' },
    ],
    outcomes: ['MEETS_SAMPLE_CRITERIA', 'REFER_TO_OFFICER'],
    reasonCodes: ['RESIDENCE_PERIOD_MET', 'RESIDENCE_PERIOD_SHORT'],
    rows: [
      {
        id: 'row_period_met',
        description: 'Lived here 12 months or more',
        when: { in_months: { op: 'ge', value: 12 } },
        then: { out_outcome: 'MEETS_SAMPLE_CRITERIA', out_reasons: ['RESIDENCE_PERIOD_MET'] },
      },
      {
        id: 'row_otherwise',
        description: 'Otherwise an officer reviews',
        when: {},
        then: { out_outcome: 'REFER_TO_OFFICER', out_reasons: ['RESIDENCE_PERIOD_SHORT'] },
      },
    ],
    tests: [
      {
        id: 'test_18',
        name: '18 months meets the sample criteria',
        inputs: { residence_duration_months: 18 },
        expectOutcome: 'MEETS_SAMPLE_CRITERIA',
        expectReasons: ['RESIDENCE_PERIOD_MET'],
      },
      {
        id: 'test_12',
        name: 'Exactly 12 months (boundary)',
        inputs: { residence_duration_months: 12 },
        expectOutcome: 'MEETS_SAMPLE_CRITERIA',
      },
      {
        id: 'test_6',
        name: '6 months goes to an officer',
        inputs: { residence_duration_months: 6 },
        expectOutcome: 'REFER_TO_OFFICER',
        expectReasons: ['RESIDENCE_PERIOD_SHORT'],
      },
    ],
  };
}

export const RULE_TEMPLATES = [
  {
    id: 'residence-period',
    title: 'Residence period indicative check',
    description:
      'From the public sample policy: 12+ months at the address, otherwise refer to an officer.',
    create: residencePeriodRules,
  },
] as const;

export function moveRow(design: RuleDesign, id: string, delta: number): RuleDesign {
  const i = design.rows.findIndex((r) => r.id === id);
  if (i < 0) return design;
  const rows = [...design.rows];
  const [row] = rows.splice(i, 1);
  if (!row) return design;
  rows.splice(Math.max(0, Math.min(rows.length, i + delta)), 0, row);
  return { ...design, rows };
}

export function updateRow(design: RuleDesign, id: string, patch: Partial<RuleRow>): RuleDesign {
  return { ...design, rows: design.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
}

export function setCondition(
  design: RuleDesign,
  rowId: string,
  inputId: string,
  c: Condition,
): RuleDesign {
  return {
    ...design,
    rows: design.rows.map((r) =>
      r.id === rowId ? { ...r, when: { ...r.when, [inputId]: c } } : r,
    ),
  };
}

export function setResult(
  design: RuleDesign,
  rowId: string,
  outputId: string,
  value: string | string[],
): RuleDesign {
  return {
    ...design,
    rows: design.rows.map((r) =>
      r.id === rowId ? { ...r, then: { ...r.then, [outputId]: value } } : r,
    ),
  };
}

export function addRow(design: RuleDesign): { design: RuleDesign; id: string } {
  const id = ruleId('row');
  const row: RuleRow = { id, description: '', when: {}, then: {} };
  return { design: { ...design, rows: [...design.rows, row] }, id };
}

export function removeRow(design: RuleDesign, id: string): RuleDesign {
  return { ...design, rows: design.rows.filter((r) => r.id !== id) };
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

export function addInput(
  design: RuleDesign,
  input: Omit<RuleInput, 'id'>,
): { design: RuleDesign; id: string } {
  const id = ruleId('in');
  return { design: { ...design, inputs: [...design.inputs, { ...input, id }] }, id };
}

export function addOutput(
  design: RuleDesign,
  output: Omit<RuleOutput, 'id'>,
): { design: RuleDesign; id: string } {
  const id = ruleId('out');
  return { design: { ...design, outputs: [...design.outputs, { ...output, id }] }, id };
}

/**
 * Edits an input column. Test values follow a renamed field; a type change clears the column's
 * conditions and test values, which no longer mean the same thing.
 */
export function updateInput(
  design: RuleDesign,
  id: string,
  patch: Partial<Omit<RuleInput, 'id'>>,
): RuleDesign {
  const before = design.inputs.find((i) => i.id === id);
  if (!before) return design;
  const after = { ...before, ...patch };
  const retyped = after.type !== before.type;
  const renamed = after.field !== before.field;
  return {
    ...design,
    inputs: design.inputs.map((i) => (i.id === id ? after : i)),
    rows: retyped ? design.rows.map((r) => ({ ...r, when: omit(r.when, id) })) : design.rows,
    tests:
      retyped || renamed
        ? design.tests.map((t) => {
            const value = t.inputs[before.field];
            const rest = omit(t.inputs, before.field);
            return {
              ...t,
              inputs: retyped || value === undefined ? rest : { ...rest, [after.field]: value },
            };
          })
        : design.tests,
  };
}

/** Edits a result column; a kind change clears its cells. */
export function updateOutput(
  design: RuleDesign,
  id: string,
  patch: Partial<Omit<RuleOutput, 'id'>>,
): RuleDesign {
  const before = design.outputs.find((o) => o.id === id);
  if (!before) return design;
  const after = { ...before, ...patch };
  return {
    ...design,
    outputs: design.outputs.map((o) => (o.id === id ? after : o)),
    rows:
      after.kind !== before.kind
        ? design.rows.map((r) => ({ ...r, then: omit(r.then, id) }))
        : design.rows,
  };
}

/** Removes a column with every cell and test value that belonged to it. */
export function removeColumn(design: RuleDesign, id: string): RuleDesign {
  const input = design.inputs.find((i) => i.id === id);
  return {
    ...design,
    inputs: design.inputs.filter((i) => i.id !== id),
    outputs: design.outputs.filter((o) => o.id !== id),
    rows: design.rows.map((r) => ({ ...r, when: omit(r.when, id), then: omit(r.then, id) })),
    tests: input
      ? design.tests.map((t) => ({ ...t, inputs: omit(t.inputs, input.field) }))
      : design.tests,
  };
}

/** Rows that use an outcome or reason code (a used code cannot be removed). */
export function rowsUsingCode(design: RuleDesign, code: string): number[] {
  const out: number[] = [];
  design.rows.forEach((row, index) => {
    const used = Object.values(row.then).some((v) =>
      Array.isArray(v) ? v.includes(code) : v === code,
    );
    if (used) out.push(index + 1);
  });
  return out;
}

export function addTest(
  design: RuleDesign,
  test: Partial<Omit<RuleTestCase, 'id'>> = {},
): { design: RuleDesign; id: string } {
  const id = ruleId('test');
  const next: RuleTestCase = {
    id,
    name: test.name ?? `Test ${design.tests.length + 1}`,
    inputs: test.inputs ?? {},
    ...(test.expectOutcome ? { expectOutcome: test.expectOutcome } : {}),
    ...(test.expectReasons ? { expectReasons: test.expectReasons } : {}),
  };
  return { design: { ...design, tests: [...design.tests, next] }, id };
}

/** Test edit; an empty or undefined expectation removes it. */
export type RuleTestPatch = {
  [K in keyof Omit<RuleTestCase, 'id'>]?: RuleTestCase[K] | undefined;
};

export function updateTest(design: RuleDesign, id: string, patch: RuleTestPatch): RuleDesign {
  return {
    ...design,
    tests: design.tests.map((t) => {
      if (t.id !== id) return t;
      const next = { ...t, ...patch } as RuleTestCase;
      if (!next.expectOutcome) delete next.expectOutcome;
      if (!next.expectReasons?.length) delete next.expectReasons;
      return next;
    }),
  };
}

export function removeTest(design: RuleDesign, id: string): RuleDesign {
  return { ...design, tests: design.tests.filter((t) => t.id !== id) };
}

/**
 * Deterministic test suggestions (not AI): each numeric threshold yields the value just below,
 * at and just above it. Expected results are left empty — the author decides them.
 */
export function suggestBoundaryTests(design: RuleDesign): RuleTestCase[] {
  const out: RuleTestCase[] = [];
  const seen = new Set<string>();
  for (const input of design.inputs.filter((i) => i.type === 'number')) {
    for (const row of design.rows) {
      const c = row.when[input.id];
      if (!c || c.op === 'any' || typeof c.value !== 'number') continue;
      const points = [c.value - 1, c.value, c.value + 1];
      if (c.op === 'between' && typeof c.to === 'number') points.push(c.to, c.to + 1);
      for (const p of points) {
        const key = `${input.field}=${p}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          id: ruleId('test'),
          name: `${input.label} = ${p} (suggested)`,
          inputs: { [input.field]: p },
        });
      }
    }
  }
  return out;
}

export const RULES_DESIGNER_TOOL = 'SF_STUDIO_RULES_DESIGNER';

/**
 * CMP-033 RULES payload: the executable pack (`rule_pack_id`, `engine`, `jdm`, outcome/reason
 * fields), its `content_hash` (re-checked by CMP-033 on validate), the authored test cases and
 * the designer source so the draft reopens exactly.
 */
export interface RulesDocumentPayload extends RulePackPayload {
  content_hash: string;
  test_cases: {
    name: string;
    inputs: Record<string, Scalar | null>;
    expect_outcome?: string;
    expect_reasons?: string[];
  }[];
  authoring: {
    tool: typeof RULES_DESIGNER_TOOL;
    model_version: 1;
    version: string;
    title: string;
    design: RuleDesign;
  };
}

export interface CompiledRules {
  documentKey: string;
  pack: RulePackPayload;
  contentHash: string;
  designHash: string;
  payload: RulesDocumentPayload;
}

export async function buildRulesDocument(design: RuleDesign): Promise<CompiledRules> {
  const pack = compileRulePack(design);
  const hash = await rulePackHash(pack);
  return {
    documentKey: rulesDocumentKey(design),
    pack,
    contentHash: hash,
    designHash: await contentHash(design),
    payload: {
      ...pack,
      content_hash: hash,
      test_cases: design.tests.map((t) => ({
        name: t.name,
        inputs: t.inputs,
        ...(t.expectOutcome ? { expect_outcome: t.expectOutcome } : {}),
        ...(t.expectReasons?.length ? { expect_reasons: t.expectReasons } : {}),
      })),
      authoring: {
        tool: RULES_DESIGNER_TOOL,
        model_version: 1,
        version: design.version,
        title: design.title,
        design,
      },
    },
  };
}

/** Reads a designer rule pack back out of a CMP-033 payload; null when it is not one. */
export function rulesDocumentOf(
  payload: unknown,
): { design: RuleDesign; contentHash: string } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Partial<RulesDocumentPayload>;
  const design = p.authoring?.design;
  if (!design || typeof p.content_hash !== 'string' || !Array.isArray(design.rows)) return null;
  return { design, contentHash: p.content_hash };
}
