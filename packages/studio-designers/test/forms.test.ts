import { listTemplates } from '@serviceform/service-templates';
import { formContentHash } from '@serviceform/service-templates/integrity';
import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash } from '../src/hash';
import {
  addField,
  addSection,
  addStep,
  allFields,
  buildFormDocument,
  buildPattern,
  changeKind,
  compileForm,
  describePattern,
  documentKey,
  duplicateField,
  emptyForm,
  FIELD_PALETTE,
  findField,
  formPackageOf,
  hasErrors,
  importForm,
  isSupportedPattern,
  lintForm,
  matchesPattern,
  moveField,
  moveFieldBy,
  moveStep,
  removeField,
  SECTION_PALETTE,
  slugKey,
  updateField,
  updateSection,
  type DesignerForm,
} from '../src/forms';

const versions = listTemplates().flatMap((t) =>
  t.versions.map((v) => ({ id: `${t.template_id}@${v.version}`, v })),
);

function residence(): DesignerForm {
  const v = listTemplates()[0]?.versions[0];
  if (!v) throw new Error('missing residence');
  return importForm(v.form, v.version).form;
}

function codes(form: DesignerForm): string[] {
  return lintForm(form).map((i) => i.code);
}

// REQ: Phase C-1 forms designer compiles to CMP-009 FORM packages pinned by content hash.
describe('forms designer: catalogue round trip', () => {
  it.each(versions.map((x) => [x.id, x.v] as const))(
    '%s imports and recompiles to the same content hash',
    async (_id, v) => {
      const { form, warnings } = importForm(v.form, v.version);
      expect(warnings).toEqual([]);
      const pkg = compileForm(form);
      expect(canonicalJson(pkg)).toBe(canonicalJson(v.form));
      expect(await contentHash(pkg)).toBe(v.content_hash);
      expect(formContentHash(pkg)).toBe(v.content_hash);
      expect(lintForm(form).filter((i) => i.severity === 'error')).toEqual([]);
    },
  );

  it('reads steps, grouped objects and conditional rules from the Residence form', () => {
    const form = residence();
    expect(form.steps.map((s) => [s.key, s.label, s.review])).toEqual([
      ['applicant', 'Applicant', false],
      ['residence', 'Residence', false],
      ['evidence', 'Evidence', false],
      ['preview', 'Preview', true],
    ]);
    const address = form.steps[1]?.sections[0];
    expect(address?.object).toMatchObject({ key: 'residence_address', title: 'Residence address' });
    expect(address?.fields.map((f) => [f.key, f.required])).toContainEqual(['post_office', false]);
    const email = allFields(form).find((r) => r.path === 'applicant_email')?.field;
    expect(email?.requiredWhen).toEqual({ field: 'notify_by_email', equals: true });
    expect(email?.visibleWhen).toEqual({ effect: 'SHOW', field: 'notify_by_email', equals: true });
    expect(allFields(form).find((r) => r.path === 'applicant_gender')?.field.kind).toBe('radio');
  });
});

describe('forms designer: editing', () => {
  it('builds a valid form from the palette and keeps keys unique', async () => {
    let form = emptyForm('lab.trade-licence', 'Trade licence application');
    const sectionId = form.steps[0]?.sections[0]?.id ?? '';
    for (const id of ['sem_full_name', 'sem_dob', 'short_text', 'short_text', 'dropdown']) {
      const item = FIELD_PALETTE.find((p) => p.id === id);
      if (!item) throw new Error(id);
      form = addField(form, sectionId, item.create()).form;
    }
    const keys = allFields(form).map((r) => r.path);
    expect(keys).toEqual([
      'applicant_name',
      'applicant_dob',
      'short_text',
      'short_text_2',
      'dropdown',
    ]);
    const address = SECTION_PALETTE.find((p) => p.id === 'postal_address')?.create();
    if (!address) throw new Error('address');
    form = addSection(form, form.steps[0]?.id ?? '', address).form;
    const added = addStep(form, 'Declaration');
    form = added.form;
    const declSection = form.steps[1]?.sections[0]?.id ?? '';
    const decl = FIELD_PALETTE.find((p) => p.id === 'sem_declaration');
    form = addField(form, declSection, decl?.create() ?? ({} as never)).form;
    expect(lintForm(form).filter((i) => i.severity === 'error')).toEqual([]);
    const doc = await buildFormDocument(form, 'blank');
    expect(doc.documentKey).toBe('lab.trade-licence.v1.0.0');
    expect(doc.payload.pages.map((p) => p.id)).toEqual(['applicant', 'declaration']);
    expect(doc.payload.pages[0]?.fields.map((f) => f.id)).toContain('postal_address.pincode');
    expect(doc.payload.content_hash).toBe(formContentHash(doc.formPackage));
    expect(doc.formPackage.json_schema.required).toEqual([
      'applicant_name',
      'applicant_dob',
      'postal_address',
      'declaration_accepted',
    ]);
    expect(formPackageOf(doc.payload)?.contentHash).toBe(doc.contentHash);
    expect(formPackageOf({ pages: [] })).toBeNull();
  });

  it('renaming a key rewrites the rules that refer to it', () => {
    let form = residence();
    const notify = allFields(form).find((r) => r.path === 'notify_by_email')?.field;
    form = updateField(form, notify?.id ?? '', { key: 'email_updates' });
    const email = allFields(form).find((r) => r.path === 'applicant_email')?.field;
    expect(email?.visibleWhen?.field).toBe('email_updates');
    expect(email?.requiredWhen?.field).toBe('email_updates');
    expect(compileForm(form).json_schema.if).toEqual({
      properties: { email_updates: { const: true } },
    });
    expect(hasErrors(lintForm(form))).toBe(false);
  });

  it('removing a referenced field is reported, not silently compiled', () => {
    let form = residence();
    const notify = allFields(form).find((r) => r.path === 'notify_by_email')?.field;
    form = removeField(form, notify?.id ?? '');
    expect(codes(form)).toContain('RULE_TARGET_MISSING');
    expect(hasErrors(lintForm(form))).toBe(true);
  });

  it('moves fields within and across sections and steps', () => {
    let form = residence();
    const mobile = allFields(form).find((r) => r.path === 'applicant_mobile');
    form = moveFieldBy(form, mobile?.field.id ?? '', -1);
    expect(findField(form, mobile?.field.id ?? '')?.fieldIndex).toBe((mobile?.fieldIndex ?? 0) - 1);
    const address = form.steps[1]?.sections[0];
    const purpose = allFields(form).find((r) => r.path === 'purpose_of_certificate');
    form = moveField(form, purpose?.field.id ?? '', address?.id ?? '', 0);
    expect(findField(form, purpose?.field.id ?? '')?.path).toBe(
      'residence_address/purpose_of_certificate',
    );
    form = moveStep(form, form.steps[3]?.id ?? '', -3);
    expect(form.steps[0]?.review).toBe(true);
    expect(codes(form)).toContain('REVIEW_STEP_NOT_LAST');
  });

  it('duplicates and changes field kinds safely', () => {
    let form = residence();
    const name = allFields(form).find((r) => r.path === 'applicant_name');
    const dup = duplicateField(form, name?.field.id ?? '');
    form = dup.form;
    expect(findField(form, dup.id)?.field.key).toBe('applicant_name_2');
    form = changeKind(form, dup.id, 'select');
    expect(findField(form, dup.id)?.field.options).toHaveLength(2);
    expect(findField(form, dup.id)?.field.pattern).toBeUndefined();
    form = changeKind(form, dup.id, 'text');
    expect(findField(form, dup.id)?.field.options).toBeUndefined();
  });

  it('renaming a grouped object rewrites nested rule references', () => {
    let form = residence();
    const address = form.steps[1]?.sections[0];
    const pin = address?.fields.find((f) => f.key === 'pincode');
    const duration = allFields(form).find((r) => r.path === 'residence_duration_months');
    form = updateField(form, duration?.field.id ?? '', {
      visibleWhen: { effect: 'SHOW', field: 'residence_address/state_code', equals: 'OD' },
    });
    form = updateSection(form, address?.id ?? '', {
      object: { key: 'home_address', title: 'Home address' },
    });
    expect(findField(form, pin?.id ?? '')?.path).toBe('home_address/pincode');
    expect(findField(form, duration?.field.id ?? '')?.field.visibleWhen?.field).toBe(
      'home_address/state_code',
    );
  });
});

describe('forms designer: checks mirror CMP-033 and CMP-009 refusals', () => {
  it('flags invalid keys, duplicates, options, ranges and patterns', () => {
    let form = emptyForm('Bad Key', '');
    form = { ...form, version: '1.0' };
    const sectionId = form.steps[0]?.sections[0]?.id ?? '';
    const text = addField(form, sectionId, {
      key: 'Name',
      kind: 'text',
      label: '',
      required: true,
      minLength: 5,
      maxLength: 2,
      pattern: '^(a|b)$',
    });
    form = text.form;
    form = addField(form, sectionId, {
      key: 'choice',
      kind: 'select',
      label: 'Pick',
      required: false,
      options: [],
    }).form;
    form = addField(form, sectionId, {
      key: 'n',
      kind: 'integer',
      label: 'N',
      required: false,
      minimum: 3,
      maximum: 1,
    }).form;
    expect(codes(form)).toEqual(
      expect.arrayContaining([
        'FORM_ID_INVALID',
        'TITLE_REQUIRED',
        'VERSION_INVALID',
        'FIELD_KEY_INVALID',
        'FIELD_LABEL_REQUIRED',
        'LENGTH_RANGE',
        'PATTERN_UNSUPPORTED',
        'OPTIONS_REQUIRED',
        'NUMBER_RANGE',
      ]),
    );
  });

  it('allows only one shared "required when" condition and top-level targets', () => {
    let form = residence();
    const mobile = allFields(form).find((r) => r.path === 'applicant_mobile')?.field;
    form = updateField(form, mobile?.id ?? '', {
      requiredWhen: { field: 'applicant_gender', equals: 'FEMALE' },
    });
    expect(codes(form)).toContain('CONDITIONAL_MULTIPLE');
    const pin = form.steps[1]?.sections[0]?.fields.find((f) => f.key === 'pincode');
    form = updateField(form, pin?.id ?? '', {
      requiredWhen: { field: 'residence_address/state_code', equals: 'OD' },
    });
    expect(codes(form)).toEqual(
      expect.arrayContaining(['CONDITIONAL_NESTED', 'CONDITION_NESTED_TARGET']),
    );
  });

  it('flags empty steps and too many layout nodes', () => {
    let form = emptyForm('lab.big', 'Big');
    expect(codes(form)).toEqual(expect.arrayContaining(['NO_FIELDS', 'STEP_EMPTY']));
    const sectionId = form.steps[0]?.sections[0]?.id ?? '';
    for (let i = 0; i < 260; i += 1) {
      form = addField(form, sectionId, {
        key: 'f',
        kind: 'text',
        label: 'F',
        required: false,
      }).form;
    }
    expect(codes(form)).toContain('UI_TOO_LARGE');
    expect(documentKey(form)).toBe('lab.big.v1.0.0');
  });
});

describe('forms designer: keys', () => {
  it('slugs labels into keys in linear time', () => {
    expect(slugKey('  Applicant  details!! ', 'x')).toBe('applicant_details');
    expect(slugKey('2nd step', 'step_2')).toBe('nd_step');
    expect(slugKey('!', 'step_1')).toBe('step_1');
    const started = Date.now();
    expect(slugKey(`a${'_'.repeat(100_000)}!`, 'x')).toBe('x');
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('forms designer: pattern subset', () => {
  it('accepts and matches the bounded subset only', () => {
    expect(isSupportedPattern('^[0-9]{6}$')).toBe(true);
    expect(isSupportedPattern('^\\d{4}-\\d{2}$')).toBe(true);
    expect(isSupportedPattern('^[A-Z]{2}[0-9]{1,4}-?$')).toBe(true);
    for (const bad of [
      '[0-9]{6}',
      '^(a|b)$',
      '^a+$',
      '^.*$',
      '^[^0-9]$',
      '^[0-9]{65}$',
      '^a{1,4}?$',
    ]) {
      expect(isSupportedPattern(bad)).toBe(false);
    }
    expect(matchesPattern('^[0-9]{6}$', '751001')).toBe(true);
    expect(matchesPattern('^[0-9]{6}$', '75100')).toBe(false);
    expect(matchesPattern('^(a)$', 'a')).toBe(false);
  });

  it('builds patterns from plain-language presets and reads them back', () => {
    const p = buildPattern('digits', 10, 10);
    expect(p).toBe('^[0-9]{10}$');
    expect(describePattern(p ?? '')).toEqual({ preset: 'digits', min: 10, max: 10 });
    expect(buildPattern('letters_spaces', 2, 40)).toBe('^[A-Za-z ]{2,40}$');
    expect(buildPattern('digits', 5, 2)).toBeNull();
    expect(buildPattern('digits', 1, 99)).toBeNull();
    expect(describePattern('^\\d{3}$')).toBeNull();
  });
});
