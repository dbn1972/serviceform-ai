import { listTemplates } from '@serviceform/service-templates';
import { describe, expect, it } from 'vitest';
import {
  addField,
  addSection,
  addStep,
  allFields,
  compileForm,
  conditionText,
  emptyForm,
  examplePattern,
  findField,
  findSection,
  hasErrors,
  importForm,
  lintForm,
  logicDrivers,
  logicRules,
  logicScenarios,
  matchesPattern,
  moveField,
  moveFieldToStep,
  moveSectionTo,
  optionsFromText,
  SECTION_PALETTE,
  sectionTargets,
  stepDropSection,
  updateField,
  updateSection,
  valueLabel,
  type DesignerForm,
} from '../src/forms';

function residence(): DesignerForm {
  const v = listTemplates()[0]?.versions[0];
  if (!v) throw new Error('missing residence');
  return importForm(v.form, v.version).form;
}

function codes(form: DesignerForm): string[] {
  return lintForm(form).map((i) => i.code);
}

function idOf(form: DesignerForm, path: string): string {
  const ref = allFields(form).find((r) => r.path === path);
  if (!ref) throw new Error(path);
  return ref.field.id;
}

/** Business type (choice) drives a licence number (SHOW) and a workshop address (required). */
function tradeForm(): DesignerForm {
  let form = emptyForm('lab.trade-licence.application', 'Trade licence application');
  const section = form.steps[0]?.sections[0]?.id ?? '';
  form = addField(form, section, {
    key: 'business_type',
    kind: 'select',
    label: 'Business type',
    required: true,
    options: [
      { value: 'SHOP', label: 'Shop' },
      { value: 'WORKSHOP', label: 'Workshop' },
      { value: 'FACTORY', label: 'Factory' },
    ],
  }).form;
  form = addField(form, section, {
    key: 'licence_number',
    kind: 'text',
    label: 'Licence number',
    required: true,
    visibleWhen: { effect: 'SHOW', field: 'business_type', oneOf: ['WORKSHOP', 'FACTORY'] },
  }).form;
  form = addField(form, section, {
    key: 'workshop_address',
    kind: 'textarea',
    label: 'Workshop address',
    required: false,
    requiredWhen: { field: 'business_type', oneOf: ['WORKSHOP', 'FACTORY'] },
  }).form;
  form = addField(form, section, {
    key: 'staff_count',
    kind: 'integer',
    label: 'Staff count',
    required: false,
  }).form;
  form = addField(form, section, {
    key: 'large_unit_note',
    kind: 'text',
    label: 'Large unit note',
    required: false,
    visibleWhen: { effect: 'SHOW', field: 'staff_count', equals: 20 },
  }).form;
  return form;
}

// REQ: World-class forms WS2 — Studio designer conditional logic is authorable in plain language,
// "is any of" conditions compile to CMP-009 `enum`, and unreachable rule loops are refused.
describe('forms designer: logic in plain language', () => {
  it('describes every visibility and requirement rule of the Residence form', () => {
    const form = residence();
    const rules = logicRules(form);
    expect(rules.map((r) => r.sentence)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Show “.+” only when “.+” is Yes \(ticked\)\.$/),
        expect.stringMatching(
          /^Require “.+” when “.+” is Yes \(ticked\); otherwise it is optional\.$/,
        ),
      ]),
    );
    expect(rules.every((r) => !r.sourceMissing)).toBe(true);
    expect(logicDrivers(form).map((d) => d.path)).toContain('notify_by_email');
  });

  it('labels values the way authors read them', () => {
    const form = tradeForm();
    const type = findField(form, idOf(form, 'business_type'))?.field;
    expect(valueLabel(type, 'WORKSHOP')).toBe('Workshop');
    expect(valueLabel(type, undefined)).toBe('Not answered');
    expect(valueLabel(undefined, false)).toBe('No (not ticked)');
    expect(valueLabel(undefined, 'x')).toBe('“x”');
    expect(valueLabel(undefined, 3)).toBe('3');
    expect(conditionText(form, { field: 'business_type', oneOf: ['WORKSHOP', 'FACTORY'] })).toBe(
      '“Business type” is any of Workshop or Factory',
    );
    expect(conditionText(form, { field: 'gone', equals: true })).toBe('“gone” is Yes (ticked)');
    expect(conditionText(form, { field: 'business_type' })).toBe('“Business type” is …');
  });

  it('lists section rules and flags rules whose answer was removed', () => {
    let form = residence();
    const address = form.steps[1]?.sections[0]?.id ?? '';
    form = updateSection(form, address, {
      visibleWhen: { effect: 'HIDE', field: 'notify_by_email', equals: false },
    });
    const sectionRule = logicRules(form).find((r) => r.target.kind === 'section');
    expect(sectionRule?.sentence).toMatch(/^Hide the section “Postal address” when “.+” is No/);
    form = updateField(form, idOf(form, 'applicant_email'), {
      visibleWhen: { effect: 'SHOW', field: 'removed_field', equals: true },
    });
    expect(logicRules(form).find((r) => r.source === 'removed_field')?.sourceMissing).toBe(true);
    expect(logicDrivers(form).map((d) => d.path)).not.toContain('removed_field');
  });

  it('drives choice, number and boolean answers with every outcome-changing value', () => {
    const form = tradeForm();
    const drivers = logicDrivers(form);
    expect(drivers.map((d) => [d.path, d.values.map((v) => v.value)])).toEqual([
      ['business_type', ['SHOP', 'WORKSHOP', 'FACTORY', undefined]],
      ['staff_count', [20, 21, undefined]],
    ]);
    const set = logicScenarios(form);
    expect(set.complete).toBe(true);
    expect(set.scenarios).toHaveLength(12);
    expect(set.scenarios[0]?.data).toEqual({ business_type: 'SHOP', staff_count: 20 });
    expect(set.scenarios[set.scenarios.length - 1]?.data).toEqual({});
    expect(new Set(set.scenarios.map((s) => s.id)).size).toBe(12);
  });

  it('falls back to one driver at a time when combinations exceed the limit', () => {
    const form = tradeForm();
    const set = logicScenarios(form, 5);
    expect(set.complete).toBe(false);
    expect(set.scenarios[0]?.data).toEqual({});
    expect(set.scenarios.map((s) => s.data)).toEqual([
      {},
      { business_type: 'SHOP' },
      { business_type: 'WORKSHOP' },
      { business_type: 'FACTORY' },
      { staff_count: 20 },
    ]);
    expect(logicScenarios(emptyForm())).toEqual({ drivers: [], scenarios: [], complete: true });
  });

  it('nests grouped-data answers and uses a distinct "other" text value', () => {
    let form = residence();
    form = updateField(form, idOf(form, 'residence_duration_months'), {
      visibleWhen: {
        effect: 'SHOW',
        field: 'residence_address/district',
        equals: 'something else',
      },
    });
    const driver = logicDrivers(form).find((d) => d.path === 'residence_address/district');
    expect(driver?.values.map((v) => v.value)).toEqual([
      'something else',
      'something else!',
      undefined,
    ]);
    const nested = logicScenarios(form).scenarios.find(
      (s) => s.answers.find((a) => a.path === 'residence_address/district')?.value !== undefined,
    );
    expect(nested?.data['residence_address']).toEqual({ district: 'something else' });
  });
});

describe('forms designer: "is any of" conditions', () => {
  it('compiles visibility and requirement to CMP-009 enum conditions and imports them back', () => {
    const form = tradeForm();
    expect(hasErrors(lintForm(form))).toBe(false);
    const pkg = compileForm(form);
    expect(pkg.json_schema.if).toEqual({
      properties: { business_type: { enum: ['WORKSHOP', 'FACTORY'] } },
    });
    expect(pkg.json_schema.then).toEqual({ required: ['workshop_address'] });
    const back = importForm(pkg, '1.0.0');
    expect(back.warnings).toEqual([]);
    const address = allFields(back.form).find((r) => r.path === 'workshop_address')?.field;
    expect(address?.requiredWhen).toEqual({
      field: 'business_type',
      oneOf: ['WORKSHOP', 'FACTORY'],
    });
    const licence = allFields(back.form).find((r) => r.path === 'licence_number')?.field;
    expect(licence?.visibleWhen).toEqual({
      effect: 'SHOW',
      field: 'business_type',
      oneOf: ['WORKSHOP', 'FACTORY'],
    });
    expect(compileForm(back.form)).toEqual(pkg);
  });

  it('requires every "required when" to share the same values, not just the same field', () => {
    let form = tradeForm();
    form = updateField(form, idOf(form, 'staff_count'), {
      requiredWhen: { field: 'business_type', oneOf: ['WORKSHOP'] },
    });
    expect(codes(form)).toContain('CONDITIONAL_MULTIPLE');
    form = updateField(form, idOf(form, 'staff_count'), {
      requiredWhen: { field: 'business_type', equals: 'WORKSHOP' },
    });
    expect(codes(form)).toContain('CONDITIONAL_MULTIPLE');
    form = updateField(form, idOf(form, 'staff_count'), {
      requiredWhen: { field: 'business_type', oneOf: ['WORKSHOP', 'FACTORY'] },
    });
    expect(codes(form)).not.toContain('CONDITIONAL_MULTIPLE');
  });

  it('flags "is any of" values that are not offered and empty value lists', () => {
    let form = tradeForm();
    form = updateField(form, idOf(form, 'licence_number'), {
      visibleWhen: { effect: 'SHOW', field: 'business_type', oneOf: ['WORKSHOP', 'MINE'] },
    });
    expect(codes(form)).toContain('RULE_VALUE_TYPE');
    form = updateField(form, idOf(form, 'licence_number'), {
      visibleWhen: { effect: 'SHOW', field: 'business_type', oneOf: [] },
    });
    expect(codes(form)).toContain('RULE_VALUE_MISSING');
  });
});

describe('forms designer: visibility loops', () => {
  it('refuses fields that only show once each other is answered', () => {
    let form = tradeForm();
    form = updateField(form, idOf(form, 'staff_count'), {
      visibleWhen: { effect: 'SHOW', field: 'large_unit_note', equals: 'yes' },
    });
    const issue = lintForm(form).find((i) => i.code === 'RULE_UNREACHABLE');
    expect(issue).toMatchObject({ severity: 'error', target: { kind: 'field' } });
    expect(issue?.message).toContain('"Staff count" and "Large unit note" each wait');
    expect(lintForm(form).filter((i) => i.code === 'RULE_UNREACHABLE')).toHaveLength(1);
  });

  it('refuses a section that waits for a field inside itself', () => {
    let form = residence();
    const address = form.steps[1]?.sections[0]?.id ?? '';
    form = updateSection(form, address, {
      visibleWhen: { effect: 'SHOW', field: 'residence_address/district', equals: 'X' },
    });
    const issue = lintForm(form).find((i) => i.code === 'RULE_UNREACHABLE');
    expect(issue?.message).toContain('its section is shown only once');
  });

  it('only advises when a loop involves a HIDE rule', () => {
    let form = tradeForm();
    form = updateField(form, idOf(form, 'staff_count'), {
      visibleWhen: { effect: 'HIDE', field: 'large_unit_note', equals: 'yes' },
    });
    expect(codes(form)).toContain('RULE_CYCLE');
    expect(codes(form)).not.toContain('RULE_UNREACHABLE');
    expect(hasErrors(lintForm(form))).toBe(false);
  });

  it('keeps every catalogue template free of loops and hidden-answer chains', () => {
    const logic = new Set([
      'RULE_UNREACHABLE',
      'RULE_CYCLE',
      'RULE_HIDDEN_SOURCE',
      'RULE_HIDDEN_SOURCE_BLOCKS',
    ]);
    for (const t of listTemplates()) {
      for (const v of t.versions) {
        const form = importForm(v.form, v.version).form;
        expect(codes(form).filter((c) => logic.has(c))).toEqual([]);
      }
    }
  });
});

describe('forms designer: rules that read answers which can be hidden', () => {
  /** Owns a business? → Business type (shown when yes) → Licence number (depends on type). */
  function chained(effect: 'SHOW' | 'HIDE', required: boolean): DesignerForm {
    let form = tradeForm();
    const section = form.steps[0]?.sections[0]?.id ?? '';
    form = addField(
      form,
      section,
      { key: 'owns_business', kind: 'checkbox', label: 'Owns a business', required: false },
      0,
    ).form;
    form = updateField(form, idOf(form, 'business_type'), {
      visibleWhen: { effect: 'SHOW', field: 'owns_business', equals: true },
    });
    return updateField(form, idOf(form, 'licence_number'), {
      required,
      visibleWhen:
        effect === 'SHOW'
          ? { effect, field: 'business_type', oneOf: ['WORKSHOP', 'FACTORY'] }
          : { effect, field: 'business_type', equals: 'SHOP' },
    });
  }

  it('advises when a SHOW rule or a requirement reads a conditionally shown answer', () => {
    const issues = lintForm(chained('SHOW', true));
    const found = issues.filter((i) => i.code === 'RULE_HIDDEN_SOURCE');
    expect(found.map((i) => i.severity)).toEqual(['warning', 'warning']);
    expect(found[0]?.message).toContain('"Business type", which is only shown sometimes');
    expect(issues.some((i) => i.code === 'RULE_HIDDEN_SOURCE_BLOCKS')).toBe(false);
  });

  it('refuses a HIDE rule on such an answer when it would block a required field', () => {
    const blocking = lintForm(chained('HIDE', true)).filter(
      (i) => i.code === 'RULE_HIDDEN_SOURCE_BLOCKS',
    );
    expect(blocking).toHaveLength(1);
    expect(blocking[0]).toMatchObject({ severity: 'error', target: { kind: 'field' } });
    expect(codes(chained('HIDE', false))).not.toContain('RULE_HIDDEN_SOURCE_BLOCKS');
  });

  it('accepts the chain once the dependent field shares the hiding rule', () => {
    let form = chained('HIDE', true);
    const section = form.steps[0]?.sections[0]?.id ?? '';
    const moved = addSection(form, form.steps[0]?.id ?? '', { label: 'Business', fields: [] });
    form = updateSection(moved.form, moved.id, {
      visibleWhen: { effect: 'SHOW', field: 'owns_business', equals: true },
    });
    form = updateField(form, idOf(form, 'business_type'), { visibleWhen: null });
    for (const key of ['business_type', 'licence_number', 'workshop_address']) {
      const ref = allFields(form).find((r) => r.path === key);
      const dest = findSection(form, moved.id);
      form = moveField(form, ref?.field.id ?? '', moved.id, dest?.section.fields.length ?? 0);
    }
    expect(section).not.toBe(moved.id);
    const hidden = codes(form).filter((c) => c.startsWith('RULE_HIDDEN_SOURCE'));
    expect(hidden).toEqual([]);
    expect(hasErrors(lintForm(form))).toBe(false);
  });

  it('refuses hideable grouped data with required answers and advises on field-by-field hiding', () => {
    let form = residence();
    const address = form.steps[1]?.sections[0];
    form = updateSection(form, address?.id ?? '', {
      visibleWhen: { effect: 'SHOW', field: 'notify_by_email', equals: true },
    });
    expect(lintForm(form).find((i) => i.code === 'OBJECT_SECTION_HIDDEN')).toMatchObject({
      severity: 'error',
      target: { kind: 'section', id: address?.id },
    });
    form = updateSection(form, address?.id ?? '', { visibleWhen: null });
    for (const f of address?.fields.filter((x) => x.required) ?? []) {
      form = updateField(form, f.id, {
        visibleWhen: { effect: 'SHOW', field: 'notify_by_email', equals: true },
      });
    }
    expect(lintForm(form).find((i) => i.code === 'OBJECT_FIELDS_HIDDEN')?.severity).toBe('warning');
    expect(codes(form)).not.toContain('OBJECT_SECTION_HIDDEN');
  });

  it('checks section rules that read a conditionally shown answer', () => {
    let form = chained('SHOW', false);
    const extra = addSection(form, form.steps[0]?.id ?? '', { label: 'Workshop', fields: [] });
    form = addField(extra.form, extra.id, {
      key: 'workshop_area',
      kind: 'integer',
      label: 'Workshop area',
      required: true,
    }).form;
    form = updateSection(form, extra.id, {
      visibleWhen: { effect: 'HIDE', field: 'business_type', equals: 'SHOP' },
    });
    const blocking = lintForm(form).find((i) => i.code === 'RULE_HIDDEN_SOURCE_BLOCKS');
    expect(blocking?.target).toEqual({ kind: 'section', id: extra.id });
  });
});

describe('forms designer: moving between steps and sections', () => {
  it('moves a section across steps, before another section or to the end', () => {
    let form = residence();
    const address = form.steps[1]?.sections[0]?.id ?? '';
    const applicantStep = form.steps[0]?.id ?? '';
    const first = form.steps[0]?.sections[0]?.id ?? '';
    form = moveSectionTo(form, address, applicantStep, first);
    expect(form.steps[0]?.sections[0]?.id).toBe(address);
    expect(form.steps[1]?.sections.some((s) => s.id === address)).toBe(false);
    form = moveSectionTo(form, address, applicantStep);
    const sections = form.steps[0]?.sections ?? [];
    expect(sections[sections.length - 1]?.id).toBe(address);
    expect(findField(form, idOf(form, 'residence_address/pincode'))?.stepIndex).toBe(0);
    expect(moveSectionTo(form, 'missing', applicantStep)).toBe(form);
    expect(moveSectionTo(form, address, 'missing')).toBe(form);
    expect(moveSectionTo(form, address, applicantStep, address)).toBe(form);
    expect(hasErrors(lintForm(form))).toBe(false);
  });

  it('drops a field on a step into a plain section, creating one beside grouped data', () => {
    let form = residence();
    const residenceStep = form.steps[1];
    expect(residenceStep?.sections.every((s) => s.object)).toBe(false);
    let only = emptyForm('lab.only-object', 'Only object');
    const address = SECTION_PALETTE.find((p) => p.id === 'postal_address')?.create();
    if (!address) throw new Error('address');
    const first = only.steps[0];
    if (!first) throw new Error('step');
    const step = first.id;
    only = { ...only, steps: [{ ...first, sections: [] }] };
    only = addSection(only, step, address).form;
    const target = stepDropSection(only, step);
    expect(target?.sectionId).not.toBe(only.steps[0]?.sections[0]?.id);
    expect(findSection(target?.form ?? only, target?.sectionId ?? '')?.section.label).toBe(
      'Details',
    );
    expect(stepDropSection(only, 'missing')).toBeNull();

    const name = idOf(form, 'applicant_name');
    const declaration = addStep(form, 'Declaration');
    form = moveFieldToStep(declaration.form, name, declaration.id);
    const moved = findField(form, name);
    expect(moved?.step.id).toBe(declaration.id);
    expect(moved?.path).toBe('applicant_name');
    expect(moveFieldToStep(form, name, declaration.id)).toBe(form);
    expect(moveFieldToStep(form, 'missing', declaration.id)).toBe(form);
    expect(moveFieldToStep(form, name, 'missing')).toBe(form);
  });

  it('lists move targets as "Step › Section" in applicant order', () => {
    const targets = sectionTargets(residence());
    expect(targets[0]?.label).toMatch(/^1\. Applicant › /);
    expect(targets.some((t) => t.label === '2. Residence › Postal address')).toBe(true);
  });
});

describe('forms designer: pattern examples', () => {
  it('builds an accepted example within the length bounds when it can', () => {
    expect(examplePattern('^[0-9]{6}$')).toBe('000000');
    expect(examplePattern('^[A-Z]{2}[0-9]{1,4}-?$')).toBe('AA0');
    expect(examplePattern('^[A-Z]{2}[0-9]{1,4}-?$', 5)).toBe('AA0000-');
    expect(examplePattern('^[A-Z]{2}[0-9]{1,4}-?$', 9)).toBe('AA0');
    expect(examplePattern('^(a|b)$')).toBeNull();
    for (const src of ['^[0-9]{6}$', '^\\d{4}-\\d{2}$', '^[A-Za-z ]{2,40}$']) {
      expect(matchesPattern(src, examplePattern(src) ?? '')).toBe(true);
    }
  });
});

describe('forms designer: pasted options', () => {
  it('turns lines into unique, stable stored values', () => {
    expect(
      optionsFromText('Shop\n\n  Small workshop \nWORK | Workshop\nShop\n| Blank value\n!!!'),
    ).toEqual([
      { value: 'SHOP', label: 'Shop' },
      { value: 'SMALL_WORKSHOP', label: 'Small workshop' },
      { value: 'WORK', label: 'Workshop' },
      { value: 'SHOP_2', label: 'Shop' },
      { value: 'OPTION_5', label: 'Blank value' },
      { value: 'OPTION_6', label: '!!!' },
    ]);
    expect(optionsFromText('A |')).toEqual([{ value: 'A', label: 'A' }]);
    expect(optionsFromText(Array.from({ length: 300 }, (_, i) => `O${i}`).join('\n'))).toHaveLength(
      200,
    );
  });
});
