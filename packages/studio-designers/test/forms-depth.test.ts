import { listTemplates } from '@serviceform/service-templates';
import { describe, expect, it } from 'vitest';
import {
  addField,
  addSection,
  allFields,
  citizenValue,
  compileForm,
  conditionText,
  describeValidation,
  duplicateSection,
  emptyForm,
  FIELD_PALETTE,
  findSection,
  hasErrors,
  importForm,
  lintForm,
  logicDrivers,
  logicRules,
  logicScenarios,
  matchesPattern,
  outsidePattern,
  patternLength,
  reachableCodes,
  removeLogicRule,
  sameCondition,
  sampleAnswers,
  sampleValue,
  SECTION_PALETTE,
  sectionLibrary,
  sectionTemplate,
  setRequirementRule,
  setVisibilityRule,
  sharedRequirement,
  updateField,
  updateSection,
  validationCases,
  type DesignerField,
  type DesignerForm,
} from '../src/forms';

function codes(form: DesignerForm): string[] {
  return lintForm(form).map((i) => i.code);
}

function idOf(form: DesignerForm, path: string): string {
  const ref = allFields(form).find((r) => r.path === path);
  if (!ref) throw new Error(path);
  return ref.field.id;
}

function fieldAt(form: DesignerForm, path: string): DesignerField {
  const ref = allFields(form).find((r) => r.path === path);
  if (!ref) throw new Error(path);
  return ref.field;
}

/** Aadhaar holder? (tick) · Aadhaar number · Reason without Aadhaar · Email · Email updates. */
function identityForm(): DesignerForm {
  let form = emptyForm('lab.identity.application', 'Identity details');
  const section = form.steps[0]?.sections[0]?.id ?? '';
  const add = (f: Omit<DesignerField, 'id'>) => {
    form = addField(form, section, f).form;
  };
  add({ key: 'has_aadhaar', kind: 'checkbox', label: 'I have an Aadhaar number', required: false });
  add({
    key: 'aadhaar_last4',
    kind: 'text',
    label: 'Aadhaar last 4 digits',
    required: false,
    pattern: '^[0-9]{4}$',
    requiredWhen: { field: 'has_aadhaar', equals: true },
  });
  add({
    key: 'no_aadhaar_reason',
    kind: 'textarea',
    label: 'Why you have no Aadhaar',
    required: false,
    requiredWhen: { field: 'has_aadhaar', equals: true, unless: true },
  });
  add({ key: 'email', kind: 'email', label: 'Email', required: false, maxLength: 254 });
  add({
    key: 'email_updates',
    kind: 'checkbox',
    label: 'Send me updates by email',
    required: false,
    visibleWhen: { effect: 'SHOW', field: 'email', answered: true },
  });
  return form;
}

// REQ: P8-3 Studio designer depth — conditions use every CMP-009 rule shape the runtime mirror
// agrees on: "has any answer" (empty rule schema) and the root `else` branch ("required unless").
describe('forms designer depth: "has any answer" and "required unless"', () => {
  it('compiles both to CMP-009 schema shapes and imports them back unchanged', () => {
    const form = identityForm();
    expect(lintForm(form).filter((i) => i.severity === 'error')).toEqual([]);
    const pkg = compileForm(form);
    expect(pkg.json_schema.if).toEqual({ properties: { has_aadhaar: { const: true } } });
    expect(pkg.json_schema.then).toEqual({ required: ['aadhaar_last4'] });
    expect(pkg.json_schema.else).toEqual({ required: ['no_aadhaar_reason'] });
    const updates = pkg.ui_schema.elements[0];
    expect(JSON.stringify(updates)).toContain(
      '"rule":{"effect":"SHOW","condition":{"scope":"#/properties/email","schema":{}}}',
    );
    const back = importForm(pkg, '1.0.0');
    expect(back.warnings).toEqual([]);
    expect(fieldAt(back.form, 'no_aadhaar_reason').requiredWhen).toEqual({
      field: 'has_aadhaar',
      equals: true,
      unless: true,
    });
    expect(fieldAt(back.form, 'email_updates').visibleWhen).toEqual({
      effect: 'SHOW',
      field: 'email',
      answered: true,
    });
    expect(compileForm(back.form)).toEqual(pkg);
  });

  it('compiles a form with only "required unless" to `if` + `else`', () => {
    let form = identityForm();
    form = updateField(form, idOf(form, 'aadhaar_last4'), { requiredWhen: null });
    const pkg = compileForm(form);
    expect(pkg.json_schema.then).toBeUndefined();
    expect(pkg.json_schema.else).toEqual({ required: ['no_aadhaar_reason'] });
    expect(compileForm(importForm(pkg, '1.0.0').form)).toEqual(pkg);
  });

  it('reads both in plain language and drives them in the logic matrix', () => {
    const form = identityForm();
    const sentences = logicRules(form).map((r) => r.sentence);
    expect(sentences).toContain(
      'Require “Why you have no Aadhaar” unless “I have an Aadhaar number” is Yes (ticked); then it is optional.',
    );
    expect(sentences).toContain('Show “Send me updates by email” only when “Email” has an answer.');
    expect(
      logicRules(form).find((r) => r.target.id === idOf(form, 'no_aadhaar_reason'))?.unless,
    ).toBe(true);
    expect(logicDrivers(form).map((d) => [d.path, d.values.map((v) => v.value)])).toEqual([
      ['has_aadhaar', [true, false, undefined]],
      ['email', ['applicant@example.test', undefined]],
    ]);
    expect(logicScenarios(form).scenarios).toHaveLength(6);
    expect(conditionText(form, { field: 'email', answered: true })).toBe('“Email” has an answer');
  });

  it('refuses "has any answer" on requirements and advises against it on tick boxes', () => {
    let form = identityForm();
    form = updateField(form, idOf(form, 'aadhaar_last4'), {
      requiredWhen: { field: 'email', answered: true },
    });
    expect(codes(form)).toContain('CONDITION_ANSWERED_REQUIREMENT');
    form = identityForm();
    form = updateField(form, idOf(form, 'email_updates'), {
      visibleWhen: { effect: 'SHOW', field: 'has_aadhaar', answered: true },
    });
    const advice = lintForm(form).find((i) => i.code === 'RULE_ANSWERED_BOOLEAN');
    expect(advice?.severity).toBe('warning');
    expect(codes(form)).not.toContain('RULE_VALUE_MISSING');
  });

  it('shares one root condition between "when" and "unless", and compares "answered"', () => {
    const when = { field: 'has_aadhaar', equals: true } as const;
    expect(sameCondition(when, { ...when, unless: true } as never)).toBe(true);
    expect(sameCondition({ field: 'a', answered: true }, { field: 'a' })).toBe(false);
    let form = identityForm();
    form = updateField(form, idOf(form, 'no_aadhaar_reason'), {
      requiredWhen: { field: 'has_aadhaar', equals: false, unless: true },
    });
    expect(codes(form)).toContain('CONDITIONAL_MULTIPLE');
  });

  it('refuses "required unless" on an answer that can be hidden, because CMP-009 would block it', () => {
    let form = identityForm();
    form = updateField(form, idOf(form, 'has_aadhaar'), {
      visibleWhen: { effect: 'SHOW', field: 'email', answered: true },
    });
    const blocking = lintForm(form).filter((i) => i.code === 'RULE_HIDDEN_SOURCE_BLOCKS');
    expect(blocking).toHaveLength(1);
    expect(blocking[0]?.message).toContain('"Why you have no Aadhaar" is required unless');
    // A plain "required when" on the same hidden answer is only advice (the client is stricter).
    expect(lintForm(form).filter((i) => i.code === 'RULE_HIDDEN_SOURCE')).toHaveLength(1);
  });
});

describe('forms designer depth: rule operations for the Logic builder', () => {
  it('sets, replaces and removes visibility and requirement rules by Logic id', () => {
    let form = identityForm();
    const email = idOf(form, 'email');
    form = setVisibilityRule(
      form,
      { kind: 'field', id: email },
      {
        effect: 'HIDE',
        field: 'has_aadhaar',
        equals: false,
      },
    );
    expect(fieldAt(form, 'email').visibleWhen?.effect).toBe('HIDE');
    form = setRequirementRule(form, email, { field: 'has_aadhaar', equals: true });
    expect(fieldAt(form, 'email')).toMatchObject({
      required: false,
      requiredWhen: { equals: true },
    });
    form = removeLogicRule(form, `required:${email}`);
    expect(fieldAt(form, 'email').requiredWhen).toBeUndefined();
    form = removeLogicRule(form, `visible:${email}`);
    expect(fieldAt(form, 'email').visibleWhen).toBeUndefined();
    const section = form.steps[0]?.sections[0]?.id ?? '';
    form = setVisibilityRule(
      form,
      { kind: 'section', id: section },
      {
        effect: 'SHOW',
        field: 'has_aadhaar',
        equals: true,
      },
    );
    expect(findSection(form, section)?.section.visibleWhen).toBeDefined();
    form = removeLogicRule(form, `visible:${section}`);
    expect(findSection(form, section)?.section.visibleWhen).toBeUndefined();
    expect(removeLogicRule(form, 'unknown:x')).toBe(form);
  });

  it('offers the shared root condition to new requirement rules', () => {
    const form = identityForm();
    expect(sharedRequirement(form)).toEqual({ field: 'has_aadhaar', equals: true });
    expect(sharedRequirement(emptyForm())).toBeNull();
    const only = idOf(form, 'aadhaar_last4');
    const without = setRequirementRule(
      setRequirementRule(form, idOf(form, 'no_aadhaar_reason'), null),
      only,
      { field: 'has_aadhaar', equals: true },
    );
    expect(sharedRequirement(without, only)).toBeNull();
  });
});

describe('forms designer depth: section reuse', () => {
  it('duplicates a section after itself with unique keys and its inner rules remapped', () => {
    let form = identityForm();
    const section = form.steps[0]?.sections[0]?.id ?? '';
    const res = duplicateSection(form, section);
    form = res.form;
    expect(form.steps[0]?.sections.map((s) => s.id)).toEqual([section, res.id]);
    const copy = findSection(form, res.id)?.section;
    expect(copy?.label).toBe('Details (copy)');
    expect(copy?.fields.map((f) => f.key)).toEqual([
      'has_aadhaar_2',
      'aadhaar_last4_2',
      'no_aadhaar_reason_2',
      'email_2',
      'email_updates_2',
    ]);
    expect(fieldAt(form, 'email_updates_2').visibleWhen).toEqual({
      effect: 'SHOW',
      field: 'email_2',
      answered: true,
    });
    // Requirement rules on its own answers would open a second root condition, so they stay behind.
    expect(res.dropped).toBe(2);
    expect(fieldAt(form, 'aadhaar_last4_2').requiredWhen).toBeUndefined();
    expect(hasErrors(lintForm(form))).toBe(false);
  });

  it('duplicates grouped data under a new object key and keeps rules on outside answers', () => {
    let form = identityForm();
    const address = SECTION_PALETTE.find((p) => p.id === 'postal_address')?.create();
    if (!address) throw new Error('postal_address');
    const added = addSection(form, form.steps[0]?.id ?? '', {
      ...address,
      visibleWhen: { effect: 'SHOW', field: 'has_aadhaar', equals: true },
    });
    form = updateField(added.form, idOf(added.form, 'postal_address/pincode'), {
      visibleWhen: { effect: 'HIDE', field: 'postal_address/state_code', equals: 'XX' },
    });
    const res = duplicateSection(form, added.id);
    const copy = findSection(res.form, res.id)?.section;
    expect(copy?.object).toMatchObject({ key: 'postal_address_2', title: 'Postal address (copy)' });
    expect(copy?.visibleWhen).toEqual({ effect: 'SHOW', field: 'has_aadhaar', equals: true });
    expect(fieldAt(res.form, 'postal_address_2/pincode').visibleWhen?.field).toBe(
      'postal_address_2/state_code',
    );
    expect(res.dropped).toBe(0);
  });

  it('leaves rules on outside answers behind when a section travels to another form', () => {
    const form = identityForm();
    const section = form.steps[0]?.sections[0]?.id ?? '';
    const moved = updateSection(form, section, {
      visibleWhen: { effect: 'SHOW', field: 'gone', equals: true },
    });
    const copy = sectionTemplate(moved, section);
    expect(copy?.template.visibleWhen).toBeUndefined();
    expect(copy?.dropped).toBe(3);
    expect(sectionTemplate(form, 'missing')).toBeNull();
    const target = emptyForm();
    const placed = addSection(target, target.steps[0]?.id ?? '', copy?.template, 0);
    expect(placed.form.steps[0]?.sections[0]?.id).toBe(placed.id);
    expect(fieldAt(placed.form, 'email_updates').visibleWhen?.field).toBe('email');
  });

  it('builds a deduplicated library of catalogue sections that lint clean in a blank form', () => {
    const sources = listTemplates().flatMap((t) =>
      t.versions.map((v) => ({
        source: `${t.name} v${v.version}`,
        form: importForm(v.form, v.version).form,
      })),
    );
    const library = sectionLibrary(sources);
    expect(library.length).toBeGreaterThan(3);
    expect(new Set(library.map((s) => s.id)).size).toBe(library.length);
    expect(library[0]?.uses).toBeGreaterThanOrEqual(library[library.length - 1]?.uses ?? 0);
    expect(sectionLibrary(sources).map((s) => s.id)).toEqual(library.map((s) => s.id));
    const total = sources.reduce(
      (n, s) => n + s.form.steps.flatMap((st) => st.sections).filter((x) => x.fields.length).length,
      0,
    );
    expect(library.reduce((n, s) => n + s.uses, 0)).toBe(total);
    for (const item of library) {
      const blank = emptyForm('lab.reuse.application', 'Reuse');
      const placed = addSection(blank, blank.steps[0]?.id ?? '', item.template);
      const errors = lintForm(placed.form).filter(
        (i) => i.severity === 'error' && i.code !== 'STEP_EMPTY',
      );
      expect(errors, item.source).toEqual([]);
    }
  });
});

describe('forms designer depth: validation in plain language', () => {
  const text = (extra: Partial<DesignerField>): DesignerField => ({
    id: 'f',
    key: 'ref_no',
    kind: 'text',
    label: 'Reference',
    required: true,
    ...extra,
  });

  it('describes what each field accepts', () => {
    expect(describeValidation(text({ pattern: '^[0-9]{6}$' }))).toEqual([
      'Digits only, 6 characters',
    ]);
    expect(describeValidation(text({ minLength: 1, maxLength: 80 }))).toEqual([
      'Up to 80 characters',
    ]);
    expect(describeValidation(text({ minLength: 2, maxLength: 80 }))).toEqual(['2–80 characters']);
    expect(describeValidation(text({ pattern: '^[A-Z]{2}[0-9]{4}$' }))).toEqual(['Custom pattern']);
    expect(describeValidation(text({ kind: 'integer', minimum: 0, maximum: 120 }))).toEqual([
      'Whole number',
      'From 0 to 120',
    ]);
    expect(describeValidation(text({ kind: 'number', minimum: 0.5 }))).toEqual([
      'Number',
      '0.5 or more',
    ]);
    expect(describeValidation(text({ kind: 'email', maxLength: 254 }))).toEqual([
      'Up to 254 characters',
      'Email address',
    ]);
    expect(describeValidation(text({ kind: 'declaration' }))).toEqual(['Must be ticked']);
    expect(
      describeValidation(text({ kind: 'select', options: [{ value: 'A', label: 'A' }] })),
    ).toEqual(['1 option']);
  });

  it('generates edge cases at every boundary, labelled by input, not outcome', () => {
    const pin = validationCases(text({ pattern: '^[0-9]{6}$' }));
    expect(pin.map((c) => [c.label, c.input])).toEqual([
      ['Left empty', ''],
      ['Pattern example', '000000'],
      ['Wrong first character', '#00000'],
      ['5 characters', '00000'],
      ['7 characters', '0000000'],
    ]);
    const age = validationCases(text({ kind: 'integer', minimum: 18, maximum: 60 }));
    expect(age.map((c) => c.input)).toEqual(['', '17', '18', '60', '61', '2.5', 'ten']);
    const name = validationCases(text({ minLength: 2, maxLength: 5 }));
    expect(name.map((c) => c.input)).toEqual(['', 'A', 'AA', 'AAAAA', 'AAAAAA']);
    expect(validationCases(text({})).map((c) => c.input)).toEqual(['', 'Sample answer']);
    expect(validationCases(text({ kind: 'date' })).map((c) => c.input)).toEqual([
      '',
      '2000-01-31',
      '31-01-2000',
    ]);
    expect(
      validationCases(text({ kind: 'email', maxLength: 20 })).map((c) => c.input.length),
    ).toEqual([0, 22, 22, 21]);
    expect(validationCases(text({ kind: 'select', options: [] }))).toEqual([]);
    expect(validationCases(text({ kind: 'textarea', maxLength: 600 })).map((c) => c.id)).toEqual([
      'empty',
      'max',
      'max-above',
    ]);
    expect(validationCases(text({ kind: 'textarea', maxLength: 5000 })).map((c) => c.id)).toEqual([
      'empty',
      'text',
    ]);
  });

  it('stores typed input the way the citizen renderer does', () => {
    expect(citizenValue('integer', ' 42 ')).toBe(42);
    expect(citizenValue('number', '2.5')).toBe('2.5');
    expect(citizenValue('number', '  ')).toBeUndefined();
    expect(citizenValue('text', '')).toBeUndefined();
    expect(citizenValue('text', ' a ')).toBe(' a ');
  });

  it('knows which problems a field can produce and flags copy that can never show', () => {
    expect([...reachableCodes(text({ minLength: 1, maxLength: 80 }))]).toEqual([
      'REQUIRED',
      'MAX_LENGTH',
    ]);
    expect([...reachableCodes(text({ kind: 'declaration' }))]).toEqual([
      'REQUIRED',
      'CONST_MISMATCH',
    ]);
    let form = identityForm();
    form = updateField(form, idOf(form, 'email'), {
      errorMessages: {
        PATTERN: 'Use the reference format',
        FORMAT_EMAIL: 'Enter an email address',
      },
    });
    const unused = lintForm(form).filter((i) => i.code === 'ERROR_MESSAGE_UNUSED');
    expect(unused).toHaveLength(1);
    expect(unused[0]?.message).toContain('custom message for pattern');
  });

  it('refuses validation no answer can pass', () => {
    let form = identityForm();
    form = updateField(form, idOf(form, 'aadhaar_last4'), { maxLength: 3 });
    expect(lintForm(form).find((i) => i.code === 'PATTERN_LENGTH_CONFLICT')?.severity).toBe(
      'error',
    );
    form = updateField(form, idOf(form, 'aadhaar_last4'), { maxLength: null, minLength: 5 });
    expect(codes(form)).toContain('PATTERN_LENGTH_CONFLICT');
    form = updateField(form, idOf(form, 'aadhaar_last4'), { minLength: 4 });
    expect(codes(form)).not.toContain('PATTERN_LENGTH_CONFLICT');
    const count = addField(form, form.steps[0]?.sections[0]?.id ?? '', {
      key: 'members',
      kind: 'integer',
      label: 'Members',
      required: true,
      minimum: 0.2,
      maximum: 0.8,
    });
    expect(codes(count.form)).toContain('NUMBER_RANGE_EMPTY');
    expect(patternLength('^[A-Z]{2}[0-9]{3,4}$')).toEqual({ min: 5, max: 6 });
    expect(patternLength('nope')).toBeNull();
    expect(outsidePattern('^[#*@~!]{1}$')).toBeNull();
    expect(outsidePattern('^[0-9]{2}$')).toBe('#');
  });
});

describe('forms designer depth: sample answers', () => {
  it('fills every field with a synthetic answer its own rules accept', () => {
    let form = emptyForm('lab.palette.application', 'Palette');
    const section = form.steps[0]?.sections[0]?.id ?? '';
    for (const item of FIELD_PALETTE) form = addField(form, section, item.create()).form;
    const lgd = SECTION_PALETTE.find((p) => p.id === 'lgd_postal_address')?.create();
    if (!lgd) throw new Error('lgd');
    form = addSection(form, form.steps[0]?.id ?? '', lgd).form;
    const data = sampleAnswers(form);
    for (const ref of allFields(form)) {
      const [head, leaf] = ref.path.split('/') as [string, string | undefined];
      const value = leaf ? (data[head] as Record<string, unknown> | undefined)?.[leaf] : data[head];
      expect(value, ref.path).toBeDefined();
      if (typeof value === 'string' && ref.field.pattern) {
        expect(matchesPattern(ref.field.pattern, value), ref.path).toBe(true);
      }
    }
    expect((data['address'] as Record<string, unknown>)['district']).toMatch(/^[A-Z0-9]/);
  });

  it('respects ranges and admits when no answer can pass', () => {
    const f = (extra: Partial<DesignerField>): DesignerField => ({
      id: 'f',
      key: 'k',
      kind: 'integer',
      label: 'K',
      required: true,
      ...extra,
    });
    expect(sampleValue(f({ minimum: 18 }))).toBe(18);
    expect(sampleValue(f({ maximum: -3 }))).toBe(-3);
    expect(sampleValue(f({ minimum: 0.2, maximum: 0.8 }))).toBeUndefined();
    expect(sampleValue(f({ kind: 'number', minimum: 0.2, maximum: 0.8 }))).toBe(0.2);
    expect(sampleValue(f({ kind: 'text', maxLength: 4 }))).toBe('Samp');
    expect(sampleValue(f({ kind: 'text', minLength: 20 }))).toBe('Sample answerxxxxxxx');
    expect(sampleValue(f({ kind: 'text', maxLength: 0 }))).toBeUndefined();
    expect(sampleValue(f({ kind: 'radio', options: [{ value: 'A', label: 'A' }] }))).toBe('A');
  });
});

describe('forms designer depth: field library', () => {
  it('offers parent and guardian names bound to their canonical elements', () => {
    const ids = Object.fromEntries(
      FIELD_PALETTE.filter((p) => p.group === 'semantic').map((p) => [
        p.id,
        p.create().semanticElementId,
      ]),
    );
    expect(ids).toMatchObject({
      sem_father_name: 'SF-SEM-PERSON-FATHER-NAME',
      sem_mother_name: 'SF-SEM-PERSON-MOTHER-NAME',
      sem_guardian_name: 'SF-SEM-PERSON-GUARDIAN-NAME',
    });
  });

  it('offers the tenant-scoped LGD address as grouped data', () => {
    const lgd = SECTION_PALETTE.find((p) => p.id === 'lgd_postal_address')?.create();
    expect(lgd?.object?.key).toBe('address');
    expect(lgd?.fields.map((f) => f.semanticElementId)).toContain('SF-SEM-ADDR-MUNICIPALITY');
  });
});
