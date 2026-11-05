import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  getAt,
  isRequired,
  issuesToErrors,
  matchesPattern,
  ruleConditionScopes,
  setAt,
  stepErrors,
  stepOfPointer,
  Ux4gFormLayout,
  Ux4gFormReview,
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
    expect(html).toContain('<h3 class="ux4g-heading-s-strong">Identity</h3>');
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

  it('announces errors on the field', () => {
    const html = render({}, { '/name': 'Enter full name', '/kind': 'Select kind' });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="name-error"');
    expect(html).toContain('Enter full name');
    expect(html).toContain('aria-describedby="kind-message"');
    expect(html).toContain('ux4g-radio-error');
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
});
