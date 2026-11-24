import { describe, expect, it } from 'vitest';
import { listTemplates } from '../../packages/service-templates/src/index.js';
import * as designer from '../../packages/studio-designers/src/forms/index.js';
import {
  controlScopes,
  fieldIssue,
  getAt,
  isRequired,
  schemaAt,
  scopeToPointer,
  visibleScopes,
  withoutHidden,
  type FormData,
  type FormPackageView,
  type FormSchemaView,
  type FormUiView,
} from '../../packages/ui-ux4g/src/json-forms/form-model.js';
import { resolveUx4gRenderer } from '../../packages/ui-ux4g/src/json-forms/registry.js';
import { parseFormPackage } from '../../services/cmp-009-dynamic-forms/src/domain/pack.js';
import { runFormRuntime } from '../../services/cmp-009-dynamic-forms/src/domain/runtime.js';

/**
 * Consumer: the Studio forms designer preview, which renders compiled FORM packages with the
 * same `@serviceform/ui-ux4g` runtime mirror as the citizen wizard. Provider: the CMP-009 form
 * runtime that is authoritative on the citizen submit path. For every designer-compiled form and
 * every answer combination its logic can produce, both must agree on which controls are shown,
 * which are required, which UX4G renderer draws them and which answers are refused.
 */

type Form = designer.DesignerForm;

function controlsOf(ui: FormUiView): { scope: string; format?: string }[] {
  if (ui.type === 'Control') {
    return ui.scope
      ? [{ scope: ui.scope, ...(ui.options?.format ? { format: ui.options.format } : {}) }]
      : [];
  }
  return (ui.elements ?? []).flatMap(controlsOf);
}

function setPath(data: FormData, pointer: string, value: unknown): FormData {
  const [head, leaf] = pointer.slice(1).split('/') as [string, string | undefined];
  if (leaf === undefined) return { ...data, [head]: value };
  const child = data[head];
  const object = typeof child === 'object' && child !== null ? (child as FormData) : {};
  return { ...data, [head]: { ...object, [leaf]: value } };
}

function validSample(node: FormSchemaView): unknown {
  if (node.const !== undefined) return node.const;
  if (node.enum && node.enum.length > 0) return node.enum[0];
  if (node.type === 'boolean') return true;
  if (node.type === 'integer' || node.type === 'number') {
    return node.minimum ?? (node.maximum !== undefined ? Math.min(node.maximum, 1) : 1);
  }
  if (node.format === 'date') return '2000-01-01';
  if (node.format === 'email') return 'applicant@example.test';
  const min = node.minLength ?? 0;
  const max = node.maxLength ?? 64;
  if (node.pattern) return designer.examplePattern(node.pattern, min, max) ?? 'A';
  return 'S'.repeat(Math.min(Math.max(min, 6), max));
}

function invalidSample(node: FormSchemaView): unknown {
  if (node.const === true) return false;
  if (node.enum) return 'NOT_LISTED';
  if (node.type === 'boolean') return 'yes';
  if (node.type === 'integer') return node.minimum !== undefined ? node.minimum - 1 : 1.5;
  if (node.type === 'number') return node.maximum !== undefined ? node.maximum + 1 : 'ten';
  if (node.format === 'date') return '31-12-2000';
  if (node.format === 'email') return 'not-an-email';
  if (node.pattern) return '!';
  if (node.maxLength !== undefined) return 'x'.repeat(node.maxLength + 1);
  if (node.minLength !== undefined && node.minLength > 0) return 'x'.repeat(node.minLength - 1);
  return 42;
}

/** Fills every control except the scenario's driver answers, which stay as the scenario set them. */
function filled(pkg: FormPackageView, scenario: FormData, sample: (n: FormSchemaView) => unknown) {
  let data = scenario;
  for (const scope of controlScopes(pkg.ui_schema)) {
    const pointer = scopeToPointer(scope);
    if (getAt(scenario, pointer) !== undefined) continue;
    const node = schemaAt(pkg.json_schema, pointer);
    if (node) data = setPath(data, pointer, sample(node));
  }
  return data;
}

/** CMP-009 reports a missing grouped-data object once; the UX4G mirror reports its fields. */
function expandObjectIssues(
  pkg: FormPackageView,
  pointer: string,
  code: string,
  shown: Set<string>,
) {
  const node = schemaAt(pkg.json_schema, pointer);
  if (code !== 'REQUIRED' || node?.type !== 'object') return [pointer];
  return (node.required ?? [])
    .map((name) => `${pointer}/${name}`)
    .filter((p) => shown.has(`#/properties/${p.slice(1).split('/').join('/properties/')}`));
}

interface Tally {
  datasets: number;
  controls: number;
  refusals: number;
  accepted: number;
}

/** Issue code per refused pointer, as the citizen wizard (and the Studio preview) computes it. */
function clientIssues(pkg: FormPackageView, data: FormData, visible: Set<string>) {
  const out = new Map<string, string>();
  for (const scope of controlScopes(pkg.ui_schema)) {
    if (!visible.has(scope)) continue;
    const pointer = scopeToPointer(scope);
    const node = schemaAt(pkg.json_schema, pointer);
    if (!node) continue;
    const code = fieldIssue(node, getAt(data, pointer), isRequired(pkg.json_schema, pointer, data));
    if (code) out.set(pointer, code);
  }
  return out;
}

/** Codes per refused pointer from CMP-009 on what the citizen wizard submits. */
function providerIssues(pkg: FormPackageView, data: FormData, visible: Set<string>) {
  const parsed = parseFormPackage(pkg, pkg.form_id);
  // The citizen wizard drops hidden answers before CMP-015 hands the payload to CMP-009.
  const payload = withoutHidden(pkg.ui_schema, data, visible);
  const runtime = runFormRuntime(parsed.jsonSchema, parsed.uiSchema, payload, {});
  const out = new Map<string, Set<string>>();
  for (const issue of runtime.issues) {
    for (const pointer of expandObjectIssues(pkg, issue.pointer, issue.code, visible)) {
      out.set(pointer, (out.get(pointer) ?? new Set()).add(issue.code));
    }
  }
  return { out, valid: runtime.valid };
}

/**
 * Interpretation contract: on the same answers, the preview and citizen wizard show and require
 * exactly the controls CMP-009 `POST /v1/interpretations` reports, with the same UX4G renderer.
 */
function compareInterpretation(pkg: FormPackageView, data: FormData, tally: Tally): void {
  const parsed = parseFormPackage(pkg, pkg.form_id);
  const visible = visibleScopes(pkg.ui_schema, data);
  const runtime = runFormRuntime(parsed.jsonSchema, parsed.uiSchema, data, {});
  const label = `${pkg.form_id} ${JSON.stringify(data)}`;
  expect([...visible].sort(), `visible: ${label}`).toEqual(runtime.visibleScopes);
  const formats = new Map(controlsOf(pkg.ui_schema).map((c) => [c.scope, c.format]));
  for (const control of runtime.controls) {
    const pointer = scopeToPointer(control.scope);
    const node = schemaAt(pkg.json_schema, pointer) ?? {};
    const shown = visible.has(control.scope);
    expect(
      shown && isRequired(pkg.json_schema, pointer, data),
      `required ${pointer}: ${label}`,
    ).toBe(control.required);
    const format = formats.get(control.scope);
    expect(resolveUx4gRenderer(node, format ? { control: format } : undefined)).toBe(
      control.renderer_id,
    );
    tally.controls += 1;
  }
}

/**
 * Submission contract: the answers the wizard refuses before submit are exactly the ones CMP-009
 * refuses in the submitted payload, so a citizen is never blocked by a field they cannot see.
 */
function compareSubmission(pkg: FormPackageView, data: FormData, tally: Tally): void {
  const visible = visibleScopes(pkg.ui_schema, data);
  const client = clientIssues(pkg, data, visible);
  const provider = providerIssues(pkg, data, visible);
  const label = `${pkg.form_id} ${JSON.stringify(data)}`;
  expect([...client.keys()].sort(), `refused answers: ${label}`).toEqual(
    [...provider.out.keys()].sort(),
  );
  for (const [pointer, code] of client) {
    expect([...(provider.out.get(pointer) ?? [])], `issue code ${pointer}: ${label}`).toContain(
      code,
    );
  }
  expect(provider.valid, `valid: ${label} ${JSON.stringify([...provider.out])}`).toBe(
    client.size === 0,
  );
  tally.datasets += 1;
  tally.refusals += client.size;
  if (provider.valid) tally.accepted += 1;
}

/** Above the Studio matrix limit, so the suite covers every combination of every driver. */
const ALL_COMBINATIONS = 1024;

function datasets(form: Form): { pkg: FormPackageView; data: FormData[] } {
  const pkg = designer.compileForm(form) as unknown as FormPackageView;
  const set = designer.logicScenarios(form, ALL_COMBINATIONS);
  const scenarios = (
    set.scenarios.length > 0 ? set.scenarios.map((s) => s.data) : [{}]
  ) as FormData[];
  return {
    pkg,
    data: scenarios.flatMap((s) => [s, filled(pkg, s, validSample), filled(pkg, s, invalidSample)]),
  };
}

function check(form: Form): Tally {
  const issues = designer.lintForm(form).map((i) => i.code);
  expect(issues.filter((c) => c.startsWith('RULE_HIDDEN_SOURCE'))).toEqual([]);
  const { pkg, data } = datasets(form);
  const tally: Tally = { datasets: 0, controls: 0, refusals: 0, accepted: 0 };
  for (const d of data) {
    compareInterpretation(pkg, d, tally);
    compareSubmission(pkg, d, tally);
  }
  return tally;
}

function idOf(form: Form, path: string): string {
  const ref = designer.allFields(form).find((r) => r.path === path);
  if (!ref) throw new Error(path);
  return ref.field.id;
}

function paletteForm(): Form {
  let form = designer.emptyForm('lab.palette.application', 'Palette form');
  const section = form.steps[0]?.sections[0]?.id ?? '';
  for (const item of designer.FIELD_PALETTE) {
    form = designer.addField(form, section, item.create()).form;
  }
  for (const item of designer.SECTION_PALETTE) {
    if (item.id === 'blank_section') continue;
    form = designer.addSection(form, form.steps[0]?.id ?? '', item.create()).form;
  }
  return form;
}

/** Choice "is any of", number and boolean drivers, section and grouped-data rules together. */
function conditionalForm(): Form {
  let form = paletteForm();
  form = designer.updateField(form, idOf(form, 'dropdown'), {
    label: 'Business type',
    options: [
      { value: 'SHOP', label: 'Shop' },
      { value: 'WORKSHOP', label: 'Workshop' },
      { value: 'FACTORY', label: 'Factory' },
    ],
  });
  form = designer.updateField(form, idOf(form, 'short_text'), {
    pattern: '^[A-Z]{2}[0-9]{4}$',
    visibleWhen: { effect: 'SHOW', field: 'dropdown', oneOf: ['WORKSHOP', 'FACTORY'] },
  });
  form = designer.updateField(form, idOf(form, 'long_text'), {
    requiredWhen: { field: 'dropdown', oneOf: ['WORKSHOP', 'FACTORY'] },
  });
  form = designer.updateField(form, idOf(form, 'email'), {
    requiredWhen: { field: 'dropdown', oneOf: ['WORKSHOP', 'FACTORY'] },
    visibleWhen: { effect: 'HIDE', field: 'yes_no', equals: false },
  });
  form = designer.updateField(form, idOf(form, 'decimal_number'), {
    minimum: 0.5,
    maximum: 99.5,
    visibleWhen: { effect: 'SHOW', field: 'whole_number', equals: 3 },
  });
  // A section rule, and a rule that reads grouped data from inside a conditional section.
  const dates = designer.addSection(form, form.steps[0]?.id ?? '', { label: 'Dates', fields: [] });
  form = designer.updateSection(dates.form, dates.id, {
    visibleWhen: { effect: 'HIDE', field: 'radio', equals: 'OPTION_2' },
  });
  form = designer.moveField(form, idOf(form, 'date'), dates.id, 0);
  form = designer.updateField(form, idOf(form, 'date'), {
    required: true,
    visibleWhen: { effect: 'SHOW', field: 'postal_address/state_code', equals: 'OD' },
  });
  return form;
}

/** Business type is shown only for owners; a required licence number hides for shops. */
function hiddenAnswerChain(): Form {
  let form = designer.emptyForm('lab.chain.application', 'Chained rules');
  const section = form.steps[0]?.sections[0]?.id ?? '';
  form = designer.addField(form, section, {
    key: 'owns_business',
    kind: 'checkbox',
    label: 'Owns a business',
    required: false,
  }).form;
  form = designer.addField(form, section, {
    key: 'business_type',
    kind: 'select',
    label: 'Business type',
    required: false,
    options: [
      { value: 'SHOP', label: 'Shop' },
      { value: 'WORKSHOP', label: 'Workshop' },
    ],
    visibleWhen: { effect: 'SHOW', field: 'owns_business', equals: true },
  }).form;
  return designer.addField(form, section, {
    key: 'licence_number',
    kind: 'text',
    label: 'Licence number',
    required: true,
    visibleWhen: { effect: 'HIDE', field: 'business_type', equals: 'SHOP' },
  }).form;
}

const catalogue = listTemplates().flatMap((t) =>
  t.versions.map((v) => ({
    id: `${t.template_id}@${v.version}`,
    form: designer.importForm(v.form, v.version).form,
  })),
);

// REQ: World-class forms WS2 — Studio preview = citizen runtime. The designer preview and the
// citizen wizard share the UX4G runtime mirror; this proves the mirror matches CMP-009.
describe('Studio forms preview (UX4G runtime mirror) against the CMP-009 form runtime', () => {
  it('a conditional designer form agrees in every logic scenario, filled and refused', () => {
    const form = conditionalForm();
    expect(designer.hasErrors(designer.lintForm(form))).toBe(false);
    const set = designer.logicScenarios(form, ALL_COMBINATIONS);
    expect(set.complete).toBe(true);
    expect(set.scenarios).toHaveLength(3 * 4 * 3 * 3 * 3);
    expect(set.drivers.map((d) => d.path)).toEqual([
      'whole_number',
      'dropdown',
      'radio',
      'yes_no',
      'postal_address/state_code',
    ]);
    const tally = check(form);
    expect(tally.datasets).toBe(set.scenarios.length * 3);
    expect(tally.controls).toBe(tally.datasets * designer.allFields(form).length);
    expect(tally.accepted).toBeGreaterThan(0);
    expect(tally.refusals).toBeGreaterThan(tally.datasets);
  });

  it('a rule on an answer that can be hidden is refused by the designer, because CMP-009 would block it', () => {
    const form = hiddenAnswerChain();
    const blocking = designer.lintForm(form).filter((i) => i.code === 'RULE_HIDDEN_SOURCE_BLOCKS');
    expect(blocking).toHaveLength(1);
    const { pkg, data } = datasets(form);
    const tally: Tally = { datasets: 0, controls: 0, refusals: 0, accepted: 0 };
    for (const d of data) compareInterpretation(pkg, d, tally);
    // Owner picked Shop (licence hidden), then unticked "owns a business": the wizard accepts,
    // but the submission drops Business type, the licence number reappears and CMP-009 refuses.
    const answers = { owns_business: false, business_type: 'SHOP' };
    const visible = visibleScopes(pkg.ui_schema, answers);
    expect(clientIssues(pkg, answers, visible).size).toBe(0);
    const provider = providerIssues(pkg, answers, visible);
    expect(provider.valid).toBe(false);
    expect([...provider.out.keys()]).toEqual(['/licence_number']);
  });

  it('a hidden grouped-data section is refused by the designer, because CMP-009 would block it', () => {
    let form = paletteForm();
    const address = form.steps[0]?.sections.find((s) => s.object)?.id ?? '';
    form = designer.updateSection(form, address, {
      visibleWhen: { effect: 'SHOW', field: 'yes_no', equals: true },
    });
    const refused = designer.lintForm(form).filter((i) => i.code === 'OBJECT_SECTION_HIDDEN');
    expect(refused).toEqual([expect.objectContaining({ severity: 'error' })]);
    const pkg = designer.compileForm(form) as unknown as FormPackageView;
    const answers = filled(pkg, { yes_no: false }, validSample);
    const visible = visibleScopes(pkg.ui_schema, answers);
    expect(clientIssues(pkg, answers, visible).size).toBe(0);
    const provider = providerIssues(pkg, answers, visible);
    expect(provider.valid).toBe(false);
    expect(provider.out.size).toBe(0);
    // Switching grouped data off keeps the conditional section and agrees with CMP-009.
    form = designer.updateSection(form, address, { object: null });
    expect(designer.hasErrors(designer.lintForm(form))).toBe(false);
    const flat = designer.compileForm(form) as unknown as FormPackageView;
    const tally: Tally = { datasets: 0, controls: 0, refusals: 0, accepted: 0 };
    compareSubmission(flat, filled(flat, { yes_no: false }, validSample), tally);
    expect(tally.accepted).toBe(1);
  });

  it('every palette field and section agrees with no rules at all', () => {
    const tally = check(paletteForm());
    expect(tally).toMatchObject({ datasets: 3 });
    expect(tally.accepted).toBe(1);
  });

  it.each(catalogue.map((c) => [c.id, c.form] as const))(
    'catalogue form %s agrees in every logic scenario',
    (_id, form) => {
      const tally = check(form);
      expect(designer.logicScenarios(form, ALL_COMBINATIONS).complete).toBe(true);
      expect(tally.datasets).toBeGreaterThanOrEqual(3);
      expect(tally.controls).toBeGreaterThan(0);
    },
  );
});
