import { templateById } from '@serviceform/service-templates';
import {
  addField,
  compileForm,
  emptyForm,
  importForm,
  lintForm,
  logicScenarios,
  type DesignerForm,
} from '@serviceform/studio-designers/forms';
import type { FormPackageView } from '@serviceform/ui-ux4g';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DesignerLogic } from '../components/forms/DesignerLogic';
import { DesignerPreview } from '../components/forms/DesignerPreview';
import { affectedFields, logicMatrix } from '../lib/form-logic';

function residence(): DesignerForm {
  const v = templateById('ind-soc-002.residence-certificate')?.versions[0];
  if (!v) throw new Error('missing residence');
  return importForm(v.form, v.version).form;
}

function tradeForm(): DesignerForm {
  let form = emptyForm('lab.trade-licence.application', 'Trade licence application');
  const section = form.steps[0]?.sections[0]?.id ?? '';
  form = addField(form, section, {
    key: 'business_type',
    kind: 'radio',
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
  return addField(form, section, {
    key: 'workshop_address',
    kind: 'textarea',
    label: 'Workshop address',
    required: false,
    requiredWhen: { field: 'business_type', equals: 'FACTORY' },
  }).form;
}

const pkg = (form: DesignerForm) => compileForm(form) as unknown as FormPackageView;

// REQ: World-class forms WS2 — the Studio Logic view lists every rule in plain language and shows
// what applicants see for each answer combination, using the citizen UX4G runtime mirror.
describe('forms designer logic view', () => {
  it('evaluates each answer combination with the citizen runtime mirror', () => {
    const form = tradeForm();
    const set = logicScenarios(form);
    const matrix = logicMatrix(form, pkg(form), set);
    expect(matrix.columns.map((c) => c.path)).toEqual(['licence_number', 'workshop_address']);
    const byAnswer = Object.fromEntries(
      matrix.rows.map((r) => [String(r.scenario.answers[0]?.value), r.cells]),
    );
    expect(byAnswer['SHOP']).toEqual([
      { shown: false, required: false },
      { shown: true, required: false },
    ]);
    expect(byAnswer['WORKSHOP']).toEqual([
      { shown: true, required: true },
      { shown: true, required: false },
    ]);
    expect(byAnswer['FACTORY']).toEqual([
      { shown: true, required: true },
      { shown: true, required: true },
    ]);
    expect(byAnswer['undefined']?.[0]).toEqual({ shown: false, required: false });
    expect(affectedFields(residence()).map((c) => c.path)).toContain('applicant_email');
  });

  it('renders rules, logic checks and the matrix with a "try in preview" action', () => {
    const form = tradeForm();
    const html = renderToStaticMarkup(
      <DesignerLogic
        form={form}
        formPackage={pkg(form)}
        issues={lintForm(form)}
        onSelect={() => undefined}
        onTry={() => undefined}
      />,
    );
    expect(html).toContain('2 rules');
    expect(html).toContain(
      'Show “Licence number” only when “Business type” is any of Workshop or Factory.',
    );
    expect(html).toContain('Require “Workshop address” when “Business type” is Factory');
    expect(html).toContain('data-testid="logic-matrix"');
    expect(html).toContain('Shown · required');
    expect(html).toContain('aria-label="Try Business type: Workshop in the preview"');
  });

  it('explains an empty logic view', () => {
    const form = emptyForm();
    const html = renderToStaticMarkup(
      <DesignerLogic
        form={form}
        formPackage={pkg(form)}
        issues={[]}
        onSelect={() => undefined}
        onTry={() => undefined}
      />,
    );
    expect(html).toContain('No conditional rules yet');
    expect(html).not.toContain('logic-matrix');
  });
});

describe('forms designer preview matches the citizen wizard', () => {
  it('uses the citizen stepper, card and provenance with preview answers', () => {
    const form = tradeForm();
    const html = renderToStaticMarkup(
      <DesignerPreview
        form={pkg(form)}
        version="1.0.0"
        contentHash={`sha256:${'a'.repeat(64)}`}
        data={{ business_type: 'WORKSHOP' }}
      />,
    );
    expect(html).toContain('class="sf-wizard"');
    expect(html).toContain('class="sf-stepper" aria-label="Preview steps"');
    expect(html).toContain('sf-stepper-item sf-stepper-current');
    expect(html).toContain('class="ux4g-card-title">1. Applicant details</h2>');
    expect(html).toContain('for="designer-preview-licence_number"');
    expect(html).toContain('Form lab.trade-licence.application · v1.0.0 · draft');
    expect(html).toContain('Check whole form');
    expect(html).toContain('Runtime details');
  });

  it('hides conditional fields until their answer is given', () => {
    const html = renderToStaticMarkup(<DesignerPreview form={pkg(tradeForm())} />);
    expect(html).not.toContain('designer-preview-licence_number');
    expect(html).toContain('designer-preview-workshop_address');
  });

  it('renders the review step like the citizen wizard (summary, then declaration)', () => {
    const form = residence();
    const view = pkg(form);
    const html = renderToStaticMarkup(<DesignerPreview form={view} />);
    expect(html).toContain('sf-stepper-btn');
    expect(html.match(/sf-stepper-item/g)?.length).toBe(form.steps.length);
  });
});
