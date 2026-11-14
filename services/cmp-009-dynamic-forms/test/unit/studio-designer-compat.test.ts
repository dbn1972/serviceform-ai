import { describe, expect, it } from 'vitest';
import { sha256Of } from '../../src/domain/canonical.js';
import { parseFormPackage } from '../../src/domain/pack.js';
import { isSupportedPattern } from '../../src/domain/pattern.js';
import { runFormRuntime } from '../../src/domain/runtime.js';

interface DesignerFormsModule {
  emptyForm(formId?: string, title?: string): unknown;
  addField(form: unknown, sectionId: string, template: unknown): { form: unknown; id: string };
  addSection(form: unknown, stepId: string, template: unknown): { form: unknown; id: string };
  addStep(form: unknown, label?: string): { form: unknown; id: string };
  updateField(form: unknown, fieldId: string, patch: unknown): unknown;
  buildFormDocument(
    form: unknown,
  ): Promise<{ formPackage: { form_id: string }; contentHash: string }>;
  lintForm(form: unknown): { severity: string }[];
  isSupportedPattern(src: string): boolean;
  FIELD_PALETTE: { id: string; create(): unknown }[];
  SECTION_PALETTE: { id: string; create(): unknown }[];
}

// Bundler-resolved workspace source; a non-literal specifier keeps it out of this program.
const DESIGNER = '@serviceform/studio-designers/forms';
const designer = (await import(DESIGNER)) as DesignerFormsModule;

type Form = { steps: { id: string; sections: { id: string }[] }[] };

function paletteForm(): Form {
  let form = designer.emptyForm('lab.palette.application', 'Palette form') as Form;
  const section = form.steps[0]?.sections[0]?.id ?? '';
  for (const item of designer.FIELD_PALETTE) {
    form = designer.addField(form, section, item.create()).form as Form;
  }
  for (const item of designer.SECTION_PALETTE) {
    if (item.id === 'blank_section') continue;
    form = designer.addSection(form, form.steps[0]?.id ?? '', item.create()).form as Form;
  }
  return form;
}

// REQ: Phase C-1 — Studio forms designer output is a CMP-009 FORM package (authoritative parse),
// its content hash is CMP-009's sha256Of, and author-time pattern checks agree with CMP-009.
describe('Studio forms designer against the CMP-009 runtime', () => {
  it('every palette field and section compiles to a parseable, renderable FORM package', async () => {
    const form = paletteForm();
    expect(designer.lintForm(form).filter((i) => i.severity === 'error')).toEqual([]);
    const doc = await designer.buildFormDocument(form);
    const pack = parseFormPackage(doc.formPackage, doc.formPackage.form_id);
    expect(doc.contentHash).toBe(sha256Of(doc.formPackage));
    const result = runFormRuntime(pack.jsonSchema, pack.uiSchema, {}, {});
    expect(result.rendererIds).not.toContain('Ux4gUnsupported');
    expect(result.rendererIds).toEqual(
      expect.arrayContaining([
        'Ux4gTextInput',
        'Ux4gTextarea',
        'Ux4gNumberInput',
        'Ux4gDateInput',
        'Ux4gSelect',
        'Ux4gRadioGroup',
        'Ux4gCheckbox',
      ]),
    );
    expect(result.valid).toBe(false);
  });

  it('a designer "required when" condition is enforced by the CMP-009 runtime', async () => {
    let form = designer.emptyForm('lab.conditional.application', 'Conditional') as Form;
    const section = form.steps[0]?.sections[0]?.id ?? '';
    const yesNo = designer.FIELD_PALETTE.find((p) => p.id === 'yes_no');
    const email = designer.FIELD_PALETTE.find((p) => p.id === 'email');
    const toggle = designer.addField(form, section, yesNo?.create());
    form = toggle.form as Form;
    const target = designer.addField(form, section, email?.create());
    form = designer.updateField(target.form, target.id, {
      requiredWhen: { field: 'yes_no', equals: true },
      visibleWhen: { effect: 'SHOW', field: 'yes_no', equals: true },
    }) as Form;
    const doc = await designer.buildFormDocument(form);
    const pack = parseFormPackage(doc.formPackage, doc.formPackage.form_id);
    const off = runFormRuntime(pack.jsonSchema, pack.uiSchema, { yes_no: false }, {});
    expect(off.requiredFields).not.toContain('email');
    expect(off.valid).toBe(true);
    const on = runFormRuntime(pack.jsonSchema, pack.uiSchema, { yes_no: true }, {});
    expect(on.requiredFields).toContain('email');
    expect(on.issues.map((i) => i.pointer)).toContain('/email');
  });

  it.each([
    '^[0-9]{6}$',
    '^\\d{4}-\\d{2}$',
    '^[A-Z]{2}[0-9]{1,4}-?$',
    '^[A-Za-z ]{2,40}$',
    '^[a-z0-9._-]{1,64}$',
    '[0-9]{6}',
    '^(a|b)$',
    '^a+$',
    '^.*$',
    '^[^0-9]$',
    '^[0-9]{65}$',
    '^a{1,4}?$',
    '^[z-a]$',
    '^\\w$',
    '^$',
  ])('designer and CMP-009 agree on pattern %s', (src) => {
    expect(designer.isSupportedPattern(src)).toBe(isSupportedPattern(src));
  });
});
