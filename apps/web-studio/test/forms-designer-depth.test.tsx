import { templateById } from '@serviceform/service-templates';
import {
  addField,
  compileForm,
  emptyForm,
  importForm,
  lintForm,
  type DesignerField,
  type DesignerForm,
} from '@serviceform/studio-designers/forms';
import type { FormPackageView } from '@serviceform/ui-ux4g';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DesignerCanvas } from '../components/forms/DesignerCanvas';
import { DesignerInspector } from '../components/forms/DesignerInspector';
import { DesignerLogic } from '../components/forms/DesignerLogic';
import { DesignerPalette, paletteMatches } from '../components/forms/DesignerPalette';
import { DesignerPreview } from '../components/forms/DesignerPreview';
import { DesignerReadiness } from '../components/forms/DesignerReadiness';
import { FormDesigner } from '../components/forms/FormDesigner';
import { RuleBuilder } from '../components/forms/RuleBuilder';
import { catalogueSectionLibrary } from '../lib/form-library';
import { formReadiness } from '../lib/form-readiness';

const pkg = (form: DesignerForm) => compileForm(form) as unknown as FormPackageView;
const noop = () => undefined;

function idOf(form: DesignerForm, key: string): string {
  for (const step of form.steps) {
    for (const section of step.sections) {
      const f = section.fields.find((x) => x.key === key);
      if (f) return f.id;
    }
  }
  throw new Error(key);
}

/** Aadhaar holder? · last 4 digits (required when) · reason (required unless) · email · updates. */
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

const inspectorHandlers = {
  patchForm: noop,
  patchStep: noop,
  moveStep: noop,
  removeStep: noop,
  patchSection: noop,
  patchField: noop,
  changeKind: noop,
  moveToSection: noop,
  select: noop,
};

const canvasHandlers = {
  select: noop,
  drop: noop,
  dropOnStep: noop,
  moveField: noop,
  duplicateField: noop,
  addStep: noop,
  moveSection: noop,
  duplicateSection: noop,
  removeSection: noop,
  removeField: noop,
};

function inspect(form: DesignerForm, key: string): string {
  return renderToStaticMarkup(
    <DesignerInspector
      form={form}
      selection={{ kind: 'field', id: idOf(form, key) }}
      issues={lintForm(form)}
      readOnly={false}
      handlers={inspectorHandlers}
    />,
  );
}

// REQ: P8-3 Studio designer depth — conditions, validation UX, field library and preview = runtime
// authoring surfaces. Interaction is covered by tests/e2e/studio-forms-designer.spec.ts.
describe('Studio forms designer depth: conditions', () => {
  it('offers "required unless" and "has any answer" in the inspector', () => {
    const form = identityForm();
    const reason = inspect(form, 'no_aadhaar_reason');
    expect(reason).toContain('Required unless…');
    expect(reason).toContain('Unless the answer to');
    expect(reason).toContain('Shares its condition with 1 other field');
    const updates = inspect(form, 'email_updates');
    expect(updates).toContain('<option value="answered" selected="">has any answer</option>');
    expect(updates).not.toMatch(/for="[^"]*-value">Is</);
  });

  it('points a diverging requirement at the shared root condition', () => {
    let form = identityForm();
    const id = idOf(form, 'no_aadhaar_reason');
    form = {
      ...form,
      steps: form.steps.map((s) => ({
        ...s,
        sections: s.sections.map((sec) => ({
          ...sec,
          fields: sec.fields.map((f) =>
            f.id === id
              ? { ...f, requiredWhen: { field: 'email', equals: 'x@example.test', unless: true } }
              : f,
          ),
        })),
      })),
    };
    expect(inspect(form, 'no_aadhaar_reason')).toContain('Use that condition');
  });

  it('lists every rule with Edit and Remove, and a builder, unless frozen', () => {
    const form = identityForm();
    const html = renderToStaticMarkup(
      <DesignerLogic
        form={form}
        formPackage={pkg(form)}
        issues={lintForm(form)}
        onSelect={noop}
        onTry={noop}
        onChange={noop}
      />,
    );
    expect(html).toContain('3 rules');
    expect(html).toContain('Add or change a rule');
    expect(html).toContain('aria-label="Remove the rule on Why you have no Aadhaar"');
    expect(html).toContain(
      'Require “Why you have no Aadhaar” unless “I have an Aadhaar number” is Yes (ticked); then it is optional.',
    );
    expect(html).toContain('Show “Send me updates by email” only when “Email” has an answer.');
    const frozen = renderToStaticMarkup(
      <DesignerLogic
        form={form}
        formPackage={pkg(form)}
        issues={[]}
        readOnly
        onSelect={noop}
        onTry={noop}
        onChange={noop}
      />,
    );
    expect(frozen).not.toContain('Add or change a rule');
    expect(frozen).not.toContain('Remove the rule');
  });

  it('starts the rule builder empty, with every field and named section as a target', () => {
    const html = renderToStaticMarkup(<RuleBuilder form={identityForm()} onSave={noop} />);
    expect(html).toContain('Choose a field or section');
    expect(html).toContain('Step 1 · section “Details”');
    expect(html).toContain('Step 1 · “Send me updates by email”');
    expect(html).toContain('<option value="REQUIRE_UNLESS">Require unless</option>');
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Add rule<\/button>/);
  });

  it('tags "required unless" and validation on the canvas and offers section duplication', () => {
    const form = identityForm();
    const html = renderToStaticMarkup(
      <DesignerCanvas
        form={form}
        stepIndex={0}
        onStepIndex={noop}
        selection={{ kind: 'form' }}
        issues={lintForm(form)}
        readOnly={false}
        handlers={canvasHandlers}
      />,
    );
    expect(html).toContain('Required unless “I have an Aadhaar number” is Yes (ticked)');
    expect(html).toContain('Shown when “Email” has an answer');
    expect(html).toContain('Digits only, 4 characters');
    expect(html).toContain('aria-label="Duplicate section Details"');
  });
});

describe('Studio forms designer depth: validation UX', () => {
  it('summarises validation and runs edge cases through the citizen runtime mirror', () => {
    const html = inspect(identityForm(), 'aadhaar_last4');
    expect(html).toContain('Required · Digits only, 4 characters');
    expect(html).toContain('data-testid="field-cases"');
    expect(html).toContain('Pattern example');
    expect(html).toContain('<code class="sf-hash">0000</code>');
    expect(html).toContain('>Accepted<');
    expect(html).toContain('Check aadhaar last 4 digits');
    expect(html).toContain('Enter aadhaar last 4 digits');
  });

  it('lists only the error messages a field can produce, and flags unused ones', () => {
    const form = identityForm();
    expect(inspect(form, 'email')).not.toContain('When the pattern does not match');
    expect(inspect(form, 'email')).toContain('When too long');
    const id = idOf(form, 'email');
    const withCopy: DesignerForm = {
      ...form,
      steps: form.steps.map((s) => ({
        ...s,
        sections: s.sections.map((sec) => ({
          ...sec,
          fields: sec.fields.map((f) =>
            f.id === id ? { ...f, errorMessages: { PATTERN: 'Use the format' } } : f,
          ),
        })),
      })),
    };
    expect(inspect(withCopy, 'email')).toContain(
      'Applicants never see this message with the current rules.',
    );
  });

  it('explains that the citizen number box stores whole numbers only', () => {
    let form = emptyForm();
    form = addField(form, form.steps[0]?.sections[0]?.id ?? '', {
      key: 'area',
      kind: 'number',
      label: 'Plot area',
      required: true,
      minimum: 0.5,
    }).form;
    const html = inspect(form, 'area');
    expect(html).toContain('stores whole numbers only');
    expect(html).toContain('Enter a whole number');
  });
});

describe('Studio forms designer depth: field library', () => {
  it('searches fields and offers catalogue sections, most reused first', () => {
    expect(paletteMatches('lgd address', 'Address with LGD codes')).toBe(true);
    expect(paletteMatches('father', 'Mother', 'SF-SEM-PERSON-MOTHER-NAME')).toBe(false);
    expect(paletteMatches('', 'anything')).toBe(true);
    const library = catalogueSectionLibrary();
    expect(catalogueSectionLibrary()).toBe(library);
    const html = renderToStaticMarkup(
      <DesignerPalette disabled={false} library={library} onAddField={noop} onAddSection={noop} />,
    );
    expect(html).toContain('Sections from the catalogue');
    expect(html).toContain(`Show all ${library.length}`);
    expect(html).toContain(`Reuse section ${library[0]?.label} from ${library[0]?.source}`);
    expect(html).toContain('aria-label="Add Address with LGD codes"');
    expect(html).toContain('aria-label="Add Parent or guardian&#x27;s name"');
  });

  it('passes the library from the page into the designer palette', () => {
    const library = catalogueSectionLibrary();
    const html = renderToStaticMarkup(
      <FormDesigner source={{ kind: 'blank' }} library={library} />,
    );
    expect(html).toContain('id="palette-search"');
    expect(html).toContain('data-testid="palette-library"');
  });
});

describe('Studio forms designer depth: preview and readiness', () => {
  it('offers synthetic sample answers in the preview', () => {
    const form = identityForm();
    const html = renderToStaticMarkup(
      <DesignerPreview form={pkg(form)} sampleData={{ email: 'applicant@example.test' }} />,
    );
    expect(html).toContain('Fill with sample answers');
    expect(renderToStaticMarkup(<DesignerPreview form={pkg(form)} />)).not.toContain(
      'Fill with sample answers',
    );
  });

  it('checks a catalogue form ready, and flags a blank one', () => {
    const v = templateById('ind-soc-002.residence-certificate')?.versions[0];
    if (!v) throw new Error('residence');
    const residence = importForm(v.form, v.version).form;
    const items = formReadiness(residence, pkg(residence), lintForm(residence));
    expect(Object.fromEntries(items.map((i) => [i.id, i.state]))).toEqual({
      checks: 'ready',
      sample: 'ready',
      logic: 'ready',
      review: 'ready',
      declaration: 'ready',
      semantic: 'ready',
      messages: 'ready',
    });
    const blank = emptyForm();
    const flagged = formReadiness(blank, pkg(blank), lintForm(blank));
    expect(flagged.find((i) => i.id === 'checks')?.state).toBe('fix');
    expect(flagged.find((i) => i.id === 'review')?.state).toBe('advice');
    const html = renderToStaticMarkup(<DesignerReadiness items={flagged} />);
    expect(html).toContain('Ready to publish?');
    expect(html).toContain('data-testid="designer-readiness"');
    expect(html).toContain('ux4g-tag-tonal-error');
  });

  it('flags sample answers the citizen checks refuse', () => {
    let form = emptyForm();
    form = addField(form, form.steps[0]?.sections[0]?.id ?? '', {
      key: 'members',
      kind: 'integer',
      label: 'Members',
      required: true,
      minimum: 0.2,
      maximum: 0.8,
    }).form;
    const sample = formReadiness(form, pkg(form), lintForm(form)).find((i) => i.id === 'sample');
    expect(sample).toMatchObject({ state: 'fix' });
    expect(sample?.detail).toContain('Enter members');
  });
});
