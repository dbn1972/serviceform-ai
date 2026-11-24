import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  fieldError,
  formProgress,
  getAt,
  isRequired,
  issuesToErrors,
  matchesPattern,
  resumeStepIndex,
  ruleConditionScopes,
  setAt,
  stepErrors,
  stepOfPointer,
  stepsWithErrors,
  Ux4gFormLayout,
  Ux4gFormReview,
  Ux4gFormStepper,
  visibleScopes,
  wizardSteps,
  withoutHidden,
  type FormSchemaView,
  type FormUiView,
} from '../src/index';

const schema: FormSchemaView = {
  type: 'object',
  required: ['name', 'address', 'consent'],
  properties: {
    name: { type: 'string', title: 'Full name', minLength: 1, maxLength: 80 },
    kind: {
      type: 'string',
      title: 'Kind',
      enum: ['A', 'B'],
      'x-ux4g': { enum_labels: { A: 'Alpha', B: 'Beta' } },
    },
    months: { type: 'integer', title: 'Months', minimum: 0 },
    email_updates: { type: 'boolean', title: 'Email updates' },
    email: { type: 'string', title: 'Email', format: 'email' },
    address: {
      type: 'object',
      required: ['pincode'],
      properties: {
        pincode: {
          type: 'string',
          title: 'PIN code',
          pattern: '^[0-9]{6}$',
          'x-ux4g': { error_messages: { PATTERN: 'PIN code must be 6 digits' } },
        },
        post_office: { type: 'string', title: 'Post office' },
      },
    },
    consent: { type: 'boolean', title: 'I agree', const: true },
  },
  if: { properties: { email_updates: { const: true } } },
  then: { required: ['email'] },
};

const ui: FormUiView = {
  type: 'Categorization',
  elements: [
    {
      type: 'Category',
      label: 'About you',
      options: { hint: 'Identity' },
      elements: [
        {
          type: 'Group',
          label: 'Identity',
          elements: [
            { type: 'Control', scope: '#/properties/name' },
            { type: 'Control', scope: '#/properties/kind', options: { format: 'radio' } },
            { type: 'Control', scope: '#/properties/months' },
            { type: 'Control', scope: '#/properties/email_updates' },
            {
              type: 'Control',
              scope: '#/properties/email',
              rule: {
                effect: 'SHOW',
                condition: { scope: '#/properties/email_updates', schema: { const: true } },
              },
            },
          ],
        },
      ],
    },
    {
      type: 'Category',
      label: 'Address',
      elements: [
        { type: 'Control', scope: '#/properties/address/properties/pincode' },
        { type: 'Control', scope: '#/properties/address/properties/post_office' },
      ],
    },
    {
      type: 'Category',
      label: 'Preview',
      options: { review: true },
      elements: [{ type: 'Control', scope: '#/properties/consent' }],
    },
  ],
};

// REQ: DESIGN-SYSTEM.md rules 1-3 (JSON Forms is schema/runtime only; UX4G renderers).
describe('form model', () => {
  it('derives wizard steps, rule scopes and visibility from metadata', () => {
    expect(wizardSteps(ui).map((s) => [s.label, s.review])).toEqual([
      ['About you', false],
      ['Address', false],
      ['Preview', true],
    ]);
    expect(ruleConditionScopes(ui)).toEqual(['#/properties/email_updates']);
    expect(visibleScopes(ui, {}).has('#/properties/email')).toBe(false);
    expect(visibleScopes(ui, { email_updates: true }).has('#/properties/email')).toBe(true);
  });

  it('reads and writes nested values immutably and refuses unsafe pointers', () => {
    const data = setAt({}, '/address/pincode', '751001');
    expect(getAt(data, '/address/pincode')).toBe('751001');
    expect(setAt(data, '/address/pincode', undefined)).toEqual({});
    expect(setAt({}, '/__proto__/x', 1)).toEqual({});
    expect(getAt({ a: 1 }, '/constructor')).toBeUndefined();
  });

  it('applies required along the schema path and the conditional branch', () => {
    expect(isRequired(schema, '/address/pincode', {})).toBe(true);
    expect(isRequired(schema, '/address/post_office', {})).toBe(false);
    expect(isRequired(schema, '/email', {})).toBe(false);
    expect(isRequired(schema, '/email', { email_updates: true })).toBe(true);
  });

  it('mirrors CMP-009 issue codes per step with metadata copy', () => {
    const [about, address] = wizardSteps(ui);
    if (!about || !address) throw new Error('steps');
    const shown = visibleScopes(ui, { email_updates: true });
    expect(stepErrors(schema, about.node, { email_updates: true }, shown)).toEqual({
      '/name': 'Enter full name',
      '/email': 'Enter email',
    });
    expect(
      stepErrors(schema, address.node, { address: { pincode: '12' } }, visibleScopes(ui, {})),
    ).toEqual({ '/address/pincode': 'PIN code must be 6 digits' });
    expect(
      stepErrors(schema, about.node, { name: 'A', months: 'x' }, visibleScopes(ui, {})),
    ).toEqual({ '/months': 'Enter a whole number' });
  });

  it('maps authoritative issues back to fields and their step', () => {
    const errors = issuesToErrors(schema, [
      { code: 'PATTERN', pointer: '/address/pincode' },
      { code: 'CONST_MISMATCH', pointer: '/consent' },
    ]);
    expect(errors['/address/pincode']).toBe('PIN code must be 6 digits');
    expect(stepOfPointer(wizardSteps(ui), Object.keys(errors))).toBe(1);
  });

  it('drops hidden values before submit', () => {
    const data = { email_updates: false, email: 'x@example.invalid', name: 'SAMPLE' };
    expect(withoutHidden(ui, data, visibleScopes(ui, data))).toEqual({
      email_updates: false,
      name: 'SAMPLE',
    });
  });

  it('matches the CMP-009 bounded pattern subset', () => {
    expect(matchesPattern('^[0-9]{6}$', '751001')).toBe(true);
    expect(matchesPattern('^[0-9]{6}$', '75100')).toBe(false);
    expect(matchesPattern('^[0-9]{4}-[0-9]{2}$', '2025-26')).toBe(true);
  });
});

describe('Ux4gFormLayout renders UX4G controls only', () => {
  const steps = wizardSteps(ui);
  const render = (data: Record<string, unknown>, errors = {}) =>
    renderToStaticMarkup(
      <Ux4gFormLayout
        node={steps[0]?.node ?? ui}
        schema={schema}
        data={data}
        visible={visibleScopes(ui, data)}
        isRequired={(p) => isRequired(schema, p, data)}
        errors={errors}
        notes={{ '/name': { state: 'success', hint: 'Verified by OTP at sign-in' } }}
      />,
    );

  it('renders groups, labelled UX4G inputs, radio enum labels and hides rule-hidden controls', () => {
    const html = render({ name: 'SAMPLE' });
    expect(html).toContain('<h3 class="ux4g-heading-xs-strong">Identity</h3>');
    expect(html).toContain('class="sf-form-grid"');
    expect(html).toMatch(/<label class="ux4g-label-m-default" for="name">Full name/);
    expect(html).toContain('Verified by OTP at sign-in');
    expect(html).toContain('ux4g-input-success');
    expect(html).toContain('class="ux4g-radio"');
    expect(html).toContain('Alpha');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('ux4g-checkbox');
    expect(html).not.toContain('for="email"');
    expect(html).not.toMatch(/MuiInput|form-control|json-forms-default/);
    expect(render({ email_updates: true })).toContain('for="email"');
  });

  it('announces errors on the field, with a hidden "Error:" for screen readers', () => {
    const html = render({}, { '/name': 'Enter full name', '/kind': 'Select kind' });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="name-error"');
    expect(html).toContain('<span class="ux4g-sr-only">Error: </span>Enter full name');
    expect(html).toContain('aria-describedby="kind-message"');
    expect(html).toContain('<span class="ux4g-sr-only">Error: </span>Select kind');
    expect(html).toContain('ux4g-radio-error');
  });

  it('lets the host own a control: a slot replaces it and null leaves it out', () => {
    const [, address] = wizardSteps(ui);
    const html = renderToStaticMarkup(
      <Ux4gFormLayout
        node={address?.node ?? ui}
        schema={schema}
        data={{}}
        visible={visibleScopes(ui, {})}
        isRequired={(p) => isRequired(schema, p, {})}
        slots={{
          '/address/pincode': <p data-slot="pin">Host PIN widget</p>,
          '/address/post_office': null,
        }}
      />,
    );
    expect(html).toContain('<div class="sf-span-2"><p data-slot="pin">Host PIN widget</p></div>');
    expect(html).not.toContain('for="address__pincode"');
    expect(html).not.toContain('Post office');
  });

  it('counts characters against maxLength and wires blur for validate-after-answer', () => {
    const notes: FormSchemaView = {
      type: 'object',
      properties: { note: { type: 'string', title: 'Note', maxLength: 50 } },
    };
    const noteUi: FormUiView = {
      type: 'VerticalLayout',
      elements: [{ type: 'Control', scope: '#/properties/note', options: { format: 'textarea' } }],
    };
    const html = renderToStaticMarkup(
      <Ux4gFormLayout
        node={noteUi}
        schema={notes}
        data={{ note: 'SAMPLE' }}
        visible={visibleScopes(noteUi, {})}
        isRequired={() => false}
        onBlur={() => undefined}
      />,
    );
    expect(html).toContain('6 of 50 characters');
    expect(html).toContain('aria-describedby="note-count"');
  });

  it('renders a review of the non-review steps with display labels', () => {
    const data = { name: 'SAMPLE', kind: 'B', address: { pincode: '751001' }, consent: true };
    const html = renderToStaticMarkup(
      <Ux4gFormReview
        schema={schema}
        ui={ui}
        data={data}
        visible={visibleScopes(ui, data)}
        onEdit={() => undefined}
      />,
    );
    expect(html).toContain('<dt>Kind</dt><dd>Beta</dd>');
    expect(html).toContain('<dt>PIN code</dt><dd>751001</dd>');
    expect(html).toContain('<dt>Post office</dt><dd>—</dd>');
    expect(html).toContain('aria-label="Change address details"');
    expect(html).not.toContain('I agree');
  });

  it('shows host display text for host-owned values and drops rows set to null', () => {
    const data = { name: 'SAMPLE', address: { pincode: '751001', post_office: 'X' } };
    const html = renderToStaticMarkup(
      <Ux4gFormReview
        schema={schema}
        ui={ui}
        data={data}
        visible={visibleScopes(ui, data)}
        display={{ '/address/pincode': 'Shown by host', '/address/post_office': null }}
      />,
    );
    expect(html).toContain('<dt>PIN code</dt><dd>Shown by host</dd>');
    expect(html).not.toContain('Post office');
  });
});

describe('resume and per-field validation', () => {
  const steps = wizardSteps(ui);

  it('reports one field against the current data (required, pattern, conditional)', () => {
    expect(fieldError(schema, '/name', {})).toBe('Enter full name');
    expect(fieldError(schema, '/name', { name: 'SAMPLE' })).toBeUndefined();
    expect(fieldError(schema, '/address/pincode', { address: { pincode: '12' } })).toBe(
      'PIN code must be 6 digits',
    );
    expect(fieldError(schema, '/email', {})).toBeUndefined();
    expect(fieldError(schema, '/email', { email_updates: true })).toBe('Enter email');
    expect(fieldError(schema, '/not_a_field', {})).toBeUndefined();
  });

  it('resumes on the first step that still needs an answer, else on the review step', () => {
    const data = { name: 'SAMPLE' };
    expect(resumeStepIndex(schema, steps, data, visibleScopes(ui, data))).toBe(1);
    const done = { name: 'SAMPLE', address: { pincode: '751001' } };
    expect(resumeStepIndex(schema, steps, done, visibleScopes(ui, done))).toBe(2);
    expect(resumeStepIndex(schema, steps, {}, visibleScopes(ui, {}))).toBe(0);
    const noReview = steps.filter((s) => !s.review);
    expect(resumeStepIndex(schema, noReview, done, visibleScopes(ui, done))).toBe(1);
  });
});

describe('Ux4gFormStepper', () => {
  const steps = [
    { label: 'Applicant', hint: 'Identity' },
    { label: 'Residence' },
    { label: 'Evidence' },
    { label: 'Preview' },
  ];

  it('marks done, current and not-started steps for sight and for assistive technology', () => {
    const html = renderToStaticMarkup(
      <Ux4gFormStepper steps={steps} current={1} reachable={2} onSelect={() => undefined} />,
    );
    expect(html).toContain('<nav class="sf-stepper" aria-label="Application steps">');
    expect(html).toContain('sf-stepper-item sf-stepper-done');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain(', step 1 of 4, Completed');
    expect(html).toContain(', step 2 of 4, Current step');
    expect(html).toContain(', step 4 of 4, Not started');
    expect(html.match(/disabled=""/g)?.length).toBe(1);
    expect(html).not.toMatch(/style=/);
  });

  it('lets a returning applicant reopen any step up to the furthest reached', () => {
    const html = renderToStaticMarkup(<Ux4gFormStepper steps={steps} current={0} reachable={3} />);
    expect(html).not.toContain('disabled=""');
    expect(html).toContain(', step 3 of 4, Completed');
  });

  it('shows answer progress as text and a native progress element (no inline style)', () => {
    const html = renderToStaticMarkup(
      <Ux4gFormStepper
        steps={steps}
        current={1}
        reachable={1}
        progress={{ answered: 3, total: 8, percent: 37 }}
      />,
    );
    expect(html).toContain('37% complete');
    expect(html).toContain('3 of 8 required answers');
    expect(html).toContain(
      '<progress class="sf-form-progress-bar" max="8" value="3" aria-label="Required answers given">',
    );
    expect(html).not.toMatch(/style=/);
    expect(renderToStaticMarkup(<Ux4gFormStepper steps={steps} current={0} reachable={0} />)).not.toContain(
      '<progress',
    );
  });

  it('a form with no required answer reads as complete, not as an empty bar', () => {
    const html = renderToStaticMarkup(
      <Ux4gFormStepper
        steps={steps}
        current={0}
        reachable={0}
        progress={{ answered: 0, total: 0, percent: 100 }}
      />,
    );
    expect(html).toContain('100% complete');
    expect(html).toContain('max="1" value="1"');
  });

  it('flags steps that need attention by text, icon and state, but never the current step', () => {
    const html = renderToStaticMarkup(
      <Ux4gFormStepper steps={steps} current={3} reachable={3} attention={[0, 3]} />,
    );
    expect(html).toContain('sf-stepper-item sf-stepper-done sf-stepper-attention');
    expect(html).toContain('<span class="ux4g-body-s-default sf-stepper-flag">Needs attention</span>');
    expect(html).toContain(', step 1 of 4</span>');
    expect(html).not.toContain(', step 1 of 4, Completed');
    expect(html).toContain(', step 4 of 4, Current step');
    expect(html.match(/sf-stepper-attention/g)?.length).toBe(1);
  });
});

describe('answer progress and error steps', () => {
  const steps = wizardSteps(ui);

  it('counts required, visible questions on answer steps that pass their checks', () => {
    expect(formProgress(schema, steps, {}, visibleScopes(ui, {}))).toEqual({
      answered: 0,
      total: 2,
      percent: 0,
    });
    const half = { name: 'SAMPLE', address: { pincode: '12' } };
    expect(formProgress(schema, steps, half, visibleScopes(ui, half))).toEqual({
      answered: 1,
      total: 2,
      percent: 50,
    });
    const done = { name: 'SAMPLE', address: { pincode: '751001' } };
    expect(formProgress(schema, steps, done, visibleScopes(ui, done)).percent).toBe(100);
  });

  it('follows conditional requirement and visibility; optional and review answers do not count', () => {
    const withEmail = { name: 'SAMPLE', email_updates: true, address: { pincode: '751001' } };
    expect(formProgress(schema, steps, withEmail, visibleScopes(ui, withEmail))).toEqual({
      answered: 2,
      total: 3,
      percent: 66,
    });
    const hidden = { ...withEmail, email_updates: false };
    expect(formProgress(schema, steps, hidden, visibleScopes(ui, hidden)).total).toBe(2);
    const noForm = formProgress(schema, steps.filter((s) => s.review), {}, new Set());
    expect(noForm).toEqual({ answered: 0, total: 0, percent: 100 });
  });

  it('lists every step that holds one of the error pointers', () => {
    expect(stepsWithErrors(steps, ['/name', '/address/pincode'])).toEqual([0, 1]);
    expect(stepsWithErrors(steps, ['/consent'])).toEqual([2]);
    expect(stepsWithErrors(steps, ['/unknown'])).toEqual([]);
  });
});
