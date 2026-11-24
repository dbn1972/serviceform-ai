/**
 * UX4G forms gallery: deterministic static scenes of the shared JSON Forms renderer
 * (`Ux4gFormLayout` / `Ux4gFormReview`) and the UX4G form primitives, rendered with the governed
 * stylesheet. It is the visual-regression and accessibility fixture for every forms surface:
 * the citizen apply wizard and the Studio designer preview both render through these components,
 * so a scene here is the markup those surfaces ship. Fixture values are synthetic (no PII).
 * tests/ux4g/forms renders scenes under Vitest and drives them with Playwright.
 */
import { readFileSync } from 'node:fs';
import { createElement as h, type FunctionComponent, type Key, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell } from '../src/AppShell';
import { Button, type ButtonSize, type ButtonVariant } from '../src/components/Button';
import { Checkbox } from '../src/components/Checkbox';
import { Alert, Card, RadioGroup, Switch, TextLink } from '../src/components/Feedback';
import { OtpInput, type OtpState } from '../src/components/OtpInput';
import { Select } from '../src/components/Select';
import { TextInput, type FieldState, type InputSize } from '../src/components/TextInput';
import { Ux4gFormLayout, Ux4gFormReview, type FieldNote } from '../src/json-forms/Ux4gForm';
import {
  isRequired,
  visibleScopes,
  wizardSteps,
  type FieldErrors,
  type FormData,
  type FormSchemaView,
  type FormUiView,
} from '../src/json-forms/form-model';
import { GALLERY_SCENE_META, type GallerySceneMeta } from './scenes';

/** createElement for components whose props require `children`, passed positionally. */
function c<P extends { children?: ReactNode }>(
  type: (props: P) => ReactNode,
  props: Omit<P, 'children'> & { key?: Key },
  ...children: ReactNode[]
): ReactNode {
  return h(type as FunctionComponent<P>, props as P, ...children);
}

export const STYLESHEET_PATH = new URL('../src/styles.css', import.meta.url);

export type GalleryScene = GallerySceneMeta & { body: () => ReactNode };

const schema: FormSchemaView = {
  type: 'object',
  required: ['full_name', 'dob', 'gender', 'address', 'declaration'],
  properties: {
    full_name: {
      type: 'string',
      title: 'Full name (as per official record)',
      maxLength: 80,
      'x-ux4g': { autocomplete: 'name', hint: 'Enter the name exactly as it appears on your ID' },
    },
    dob: { type: 'string', format: 'date', title: 'Date of birth' },
    gender: {
      type: 'string',
      title: 'Gender',
      enum: ['F', 'M', 'X'],
      'x-ux4g': { enum_labels: { F: 'Female', M: 'Male', X: 'Transgender / other' } },
    },
    years: { type: 'integer', title: 'Years at this address', minimum: 0 },
    email: {
      type: 'string',
      format: 'email',
      title: 'Email address',
      'x-ux4g': { autocomplete: 'email' },
    },
    address: {
      type: 'object',
      required: ['line1', 'district', 'pincode'],
      properties: {
        line1: { type: 'string', title: 'House and street', 'x-ux4g': { span: 2 } },
        district: {
          type: 'string',
          title: 'District',
          enum: ['D1', 'D2', 'D3'],
          'x-ux4g': {
            enum_labels: { D1: 'Sample district one', D2: 'Sample district two', D3: 'Other' },
          },
        },
        pincode: {
          type: 'string',
          title: 'PIN code',
          pattern: '^[0-9]{6}$',
          'x-ux4g': { inputMode: 'numeric', hint: '6 digits' },
        },
      },
    },
    remarks: { type: 'string', title: 'Anything else the office should know', maxLength: 500 },
    declaration: {
      type: 'boolean',
      title: 'I declare that the information given in this application is true',
      const: true,
    },
  },
};

const ui: FormUiView = {
  type: 'Categorization',
  elements: [
    {
      type: 'Category',
      label: 'Applicant',
      elements: [
        {
          type: 'Group',
          label: 'Identity',
          elements: [
            { type: 'Control', scope: '#/properties/full_name' },
            { type: 'Control', scope: '#/properties/dob' },
            { type: 'Control', scope: '#/properties/gender', options: { format: 'radio' } },
            { type: 'Control', scope: '#/properties/years' },
            { type: 'Control', scope: '#/properties/email' },
          ],
        },
      ],
    },
    {
      type: 'Category',
      label: 'Address',
      elements: [
        {
          type: 'Group',
          label: 'Current address',
          elements: [
            { type: 'Control', scope: '#/properties/address/properties/line1' },
            { type: 'Control', scope: '#/properties/address/properties/district' },
            { type: 'Control', scope: '#/properties/address/properties/pincode' },
            {
              type: 'Control',
              scope: '#/properties/remarks',
              options: { format: 'textarea' },
            },
          ],
        },
      ],
    },
    {
      type: 'Category',
      label: 'Preview',
      options: { review: true },
      elements: [{ type: 'Control', scope: '#/properties/declaration' }],
    },
  ],
};

const filled: FormData = {
  full_name: 'SAMPLE APPLICANT',
  dob: '1990-01-01',
  gender: 'F',
  years: 4,
  email: 'applicant@example.invalid',
  address: { line1: '12 Sample Street, Ward 3', district: 'D1', pincode: '751001' },
  remarks: 'Synthetic fixture text for the UX4G forms gallery.',
  declaration: true,
};

const allErrors: FieldErrors = {
  '/full_name': 'Enter your full name as it appears on your ID',
  '/dob': 'Enter a valid date of birth',
  '/gender': 'Select a gender',
  '/years': 'Enter a whole number of years',
  '/email': 'Enter an email address in the format name@example.com',
  '/address/line1': 'Enter your house and street',
  '/address/district': 'Select your district',
  '/address/pincode': 'PIN code must be 6 digits',
  '/remarks': 'Remarks must be 500 characters or fewer',
  '/declaration': 'Confirm the declaration to submit',
};

const verified: Record<string, FieldNote> = {
  '/full_name': { state: 'success', hint: 'Verified at sign-in' },
};

const steps = wizardSteps(ui);

type LayoutOptions = {
  data?: FormData;
  errors?: FieldErrors;
  notes?: Record<string, FieldNote>;
  labels?: Record<string, string>;
  readOnly?: boolean;
  idPrefix?: string;
  ui?: FormUiView;
};

function step(index: number, opts: LayoutOptions = {}): ReactNode {
  const node = wizardSteps(opts.ui ?? ui)[index]?.node;
  if (!node) throw new Error(`gallery: no wizard step ${index}`);
  const data = opts.data ?? {};
  return h(Ux4gFormLayout, {
    node,
    schema,
    data,
    visible: visibleScopes(opts.ui ?? ui, data),
    isRequired: (p: string) => isRequired(schema, p, data),
    onChange: () => undefined,
    ...(opts.errors ? { errors: opts.errors } : {}),
    ...(opts.notes ? { notes: opts.notes } : {}),
    ...(opts.labels ? { labels: opts.labels } : {}),
    ...(opts.readOnly ? { readOnly: true } : {}),
    ...(opts.idPrefix ? { idPrefix: opts.idPrefix } : {}),
  });
}

/** Citizen runtime frame: one UX4G Card per wizard step (MetadataApplyForm). */
function citizenSteps(opts: LayoutOptions = {}, title = 'Apply for a certificate'): ReactNode {
  const local = wizardSteps(opts.ui ?? ui);
  return h(
    'div',
    { className: 'sf-form-stack' },
    h('h1', { className: 'ux4g-heading-xl-strong' }, title),
    ...[0, 1].map((i) =>
      c(Card, { key: i, title: `${i + 1}. ${local[i]?.label ?? ''}` }, step(i, opts)),
    ),
  );
}

/** Studio designer preview frame (DesignerPreview): same renderer inside the device card. */
function studioPreview(device: 'desktop' | 'mobile', opts: LayoutOptions = {}): ReactNode {
  return h(
    'div',
    { className: 'sf-designer-stack' },
    h('h1', { className: 'ux4g-heading-xl-strong' }, 'Form designer preview'),
    h(
      'div',
      { className: 'sf-designer-preview' },
      h(
        'div',
        { className: `sf-designer-device sf-designer-device-${device}` },
        ...[0, 1].map((i) =>
          h(
            'section',
            {
              key: i,
              className: 'sf-designer-preview-card',
              'aria-labelledby': `preview-step-${i}`,
            },
            h(
              'h3',
              { id: `preview-step-${i}`, className: 'ux4g-heading-s-strong' },
              steps[i]?.title ?? '',
            ),
            step(i, { ...opts, idPrefix: `designer-preview-${i}-` }),
          ),
        ),
      ),
    ),
  );
}

function review(): ReactNode {
  const data = filled;
  return h(
    'div',
    { className: 'sf-form-stack' },
    h('h1', { className: 'ux4g-heading-xl-strong' }, 'Check your answers'),
    c(
      Card,
      { title: '3. Preview', subtitle: 'Review every answer before you submit' },
      h(Ux4gFormReview, {
        schema,
        ui,
        data,
        visible: visibleScopes(ui, data),
        onEdit: () => undefined,
      }),
      h(
        'div',
        { className: 'sf-form-section' },
        h('h3', { className: 'ux4g-heading-s-strong' }, 'Declaration'),
        step(2, {
          data: { ...data, declaration: false },
          errors: { '/declaration': allErrors['/declaration'] ?? '' },
        }),
      ),
      h(
        'div',
        { className: 'sf-actions' },
        c(Button, { variant: 'outline-neutral' }, 'Back'),
        c(Button, { variant: 'primary', type: 'submit' }, 'Submit application'),
      ),
    ),
  );
}

const FIELD_STATES: readonly FieldState[] = ['default', 'success', 'warning', 'error'];
const INPUT_SIZES: readonly InputSize[] = ['s', 'm', 'l', 'xl'];
const OTP_STATES: readonly OtpState[] = ['default', 'error', 'success', 'locked'];
const BUTTON_VARIANTS: readonly ButtonVariant[] = [
  'primary',
  'outline-primary',
  'tonal-primary',
  'text-primary',
  'danger',
  'outline-danger',
  'text-danger',
  'outline-neutral',
  'text-neutral',
];
const BUTTON_SIZES: readonly ButtonSize[] = ['xs', 's', 'm', 'l', 'xl'];

function controls(): ReactNode {
  const stateHint: Record<FieldState, string> = {
    default: 'Helper text',
    success: 'Looks good',
    warning: 'Check this value',
    error: 'Enter a valid value',
  };
  return h(
    'div',
    { className: 'sf-form-stack' },
    h('h1', { className: 'ux4g-heading-xl-strong' }, 'UX4G form controls'),
    c(
      Card,
      { title: 'Text input states' },
      h(
        'div',
        { className: 'sf-form-grid' },
        ...FIELD_STATES.map((s) =>
          h(TextInput, {
            key: s,
            id: `state-${s}`,
            label: `State: ${s}`,
            defaultValue: 'Sample value',
            state: s,
            ...(s === 'error' ? { error: stateHint[s] } : { hint: stateHint[s] }),
          }),
        ),
        h(TextInput, {
          id: 'state-disabled',
          label: 'State: disabled',
          defaultValue: 'Not editable',
          disabled: true,
        }),
        h(TextInput, {
          id: 'state-prefix',
          label: 'Mobile number',
          prefix: '+91',
          inputMode: 'numeric',
          autoComplete: 'tel-national',
          hint: '10 digits',
          optional: true,
        }),
      ),
    ),
    c(
      Card,
      { title: 'Text input sizes' },
      h(
        'div',
        { className: 'sf-form-grid' },
        ...INPUT_SIZES.map((s) =>
          h(TextInput, {
            key: s,
            id: `size-${s}`,
            label: `Size ${s}`,
            size: s,
            defaultValue: 'Aa',
          }),
        ),
      ),
    ),
    c(
      Card,
      { title: 'Choice controls' },
      h(
        'div',
        { className: 'sf-form-grid' },
        h(Select, {
          id: 'select-default',
          label: 'Select',
          placeholder: 'Select',
          hint: 'Choose one option',
          options: [
            { value: 'a', label: 'Option A' },
            { value: 'b', label: 'Option B' },
          ],
          defaultValue: '',
        }),
        h(Select, {
          id: 'select-error',
          label: 'Select with error',
          placeholder: 'Select',
          error: 'Select an option',
          options: [{ value: 'a', label: 'Option A' }],
          defaultValue: '',
        }),
        h(
          'div',
          { className: 'sf-span-2' },
          h(RadioGroup, {
            name: 'radio-default',
            legend: 'Radio group',
            value: 'b',
            options: [
              { value: 'a', label: 'First choice' },
              { value: 'b', label: 'Second choice' },
              { value: 'c', label: 'Third choice' },
            ],
          }),
        ),
        h(
          'div',
          { className: 'sf-span-2' },
          h(RadioGroup, {
            name: 'radio-error',
            legend: 'Radio group with error',
            error: true,
            message: 'Select one choice',
            options: [
              { value: 'a', label: 'Yes' },
              { value: 'b', label: 'No' },
            ],
          }),
        ),
        h(Checkbox, { id: 'check-on', label: 'Checked checkbox', defaultChecked: true }),
        h(Checkbox, { id: 'check-off', label: 'Unchecked checkbox' }),
        h(
          'div',
          { className: 'sf-form-check' },
          h(Checkbox, {
            id: 'check-error',
            label: 'Checkbox with error',
            error: true,
            'aria-describedby': 'check-error-error',
          }),
          h(
            'p',
            {
              id: 'check-error-error',
              className: 'ux4g-input-helper ux4g-input-helper-text sf-form-error',
            },
            'Tick this box to continue',
          ),
        ),
        h(Checkbox, { id: 'check-disabled', label: 'Disabled checkbox', disabled: true }),
        h(Switch, {
          id: 'switch-on',
          label: 'Switch on',
          checked: true,
          onChange: () => undefined,
        }),
        h(Switch, {
          id: 'switch-off',
          label: 'Switch off',
          checked: false,
          onChange: () => undefined,
        }),
      ),
    ),
    c(
      Card,
      { title: 'One-time password' },
      h(
        'div',
        { className: 'sf-form-stack' },
        ...OTP_STATES.map((s) =>
          h(OtpInput, {
            key: s,
            id: `otp-${s}`,
            label: `OTP: ${s}`,
            value: s === 'default' ? '12' : '123456',
            onChange: () => undefined,
            state: s,
            ...(s === 'default'
              ? {}
              : {
                  status:
                    s === 'error'
                      ? 'That code is not right. 2 attempts left.'
                      : s === 'success'
                        ? 'Code verified'
                        : 'Too many attempts. Try again in 10 minutes.',
                }),
          }),
        ),
      ),
    ),
    c(
      Card,
      { title: 'Feedback' },
      h(
        'div',
        { className: 'sf-form-stack' },
        c(
          Alert,
          { variant: 'info', title: 'Information' },
          'Your progress is saved on this device.',
        ),
        c(Alert, { variant: 'success', title: 'Saved' }, 'Step saved.'),
        c(
          Alert,
          { variant: 'warning', title: 'Check' },
          'Indicative check not met. This is not a decision.',
        ),
        c(Alert, { variant: 'error', title: 'Cannot continue' }, 'Fix 2 fields to continue.'),
        h(
          'p',
          { className: 'ux4g-body-m-default' },
          'Read the ',
          c(TextLink, { href: '#guidance' }, 'guidance for applicants'),
          '.',
        ),
      ),
    ),
    c(
      Card,
      { title: 'Buttons' },
      h(
        'div',
        { className: 'sf-form-stack' },
        ...BUTTON_VARIANTS.map((v) =>
          h(
            'div',
            { key: v, className: 'sf-actions' },
            ...BUTTON_SIZES.map((s) => c(Button, { key: s, variant: v, size: s }, `${v} ${s}`)),
            c(Button, { variant: v, disabled: true }, `${v} disabled`),
          ),
        ),
      ),
    ),
  );
}

/** CMP-009 interpretation labels keyed by scope (localisation path), here in Hindi. */
const hindiLabels: Record<string, string> = {
  '#/properties/full_name': 'पूरा नाम (आधिकारिक अभिलेख के अनुसार)',
  '#/properties/dob': 'जन्म तिथि',
  '#/properties/gender': 'लिंग',
  '#/properties/years': 'इस पते पर कितने वर्ष से रह रहे हैं',
  '#/properties/email': 'ईमेल पता',
  '#/properties/address/properties/line1': 'मकान और गली',
  '#/properties/address/properties/district': 'ज़िला',
  '#/properties/address/properties/pincode': 'पिन कोड',
  '#/properties/remarks': 'कार्यालय को और कुछ बताना हो तो लिखें',
};

const hindiUi: FormUiView = {
  ...ui,
  elements: (ui.elements ?? []).map((c, i) => ({
    ...c,
    label: ['आवेदक', 'पता', 'पूर्वावलोकन'][i] ?? '',
    elements: (c.elements ?? []).map((g) =>
      g.type === 'Group' ? { ...g, label: i === 0 ? 'पहचान' : 'वर्तमान पता' } : g,
    ),
  })),
};

function multilingual(): ReactNode {
  const longLabel =
    'Name of the head of household as recorded in the most recent survey register maintained by the local body';
  return h(
    'div',
    { className: 'sf-form-stack', lang: 'hi' },
    citizenSteps(
      {
        ui: hindiUi,
        labels: hindiLabels,
        errors: {
          '/full_name': 'पूरा नाम दर्ज करें',
          '/address/pincode': 'पिन कोड 6 अंकों का होना चाहिए',
        },
      },
      'प्रमाण पत्र के लिए आवेदन करें',
    ),
    h(
      'div',
      { lang: 'en' },
      c(
        Card,
        { title: 'Long labels and values' },
        h(
          'div',
          { className: 'sf-form-grid' },
          h(TextInput, {
            id: 'long-label',
            label: longLabel,
            defaultValue: 'Averyveryverylongunbrokenvaluewithoutspaces1234567890abcdefghij',
            hint: 'Long helper text that should wrap onto several lines on a narrow screen without being clipped or overlapping the next field.',
          }),
          h(Select, {
            id: 'long-select',
            label: 'Office that will process the application',
            options: [
              {
                value: 'x',
                label:
                  'Office of the Sub-Divisional Magistrate, Revenue Department, Sample Sub-Division',
              },
            ],
            defaultValue: 'x',
          }),
        ),
      ),
    ),
  );
}

const BODIES: Record<string, () => ReactNode> = {
  'form-empty': () => citizenSteps(),
  'form-filled': () => citizenSteps({ data: filled, notes: verified }),
  'form-errors': () => citizenSteps({ errors: allErrors }),
  'form-readonly': () => citizenSteps({ data: filled, readOnly: true }, 'Application details'),
  'form-review': () => review(),
  'studio-preview': () =>
    studioPreview('desktop', { errors: { '/full_name': allErrors['/full_name'] ?? '' } }),
  controls: () => controls(),
  multilingual: () => multilingual(),
};

export const GALLERY_SCENES: readonly GalleryScene[] = GALLERY_SCENE_META.map((meta) => {
  const body = BODIES[meta.id];
  if (!body) throw new Error(`gallery: scene ${meta.id} has no body`);
  return { ...meta, body };
});

export function sceneById(id: string): GalleryScene {
  const scene = GALLERY_SCENES.find((s) => s.id === id);
  if (!scene) throw new Error(`gallery: unknown scene ${id}`);
  return scene;
}

/** Full HTML document for a scene with the governed stylesheet inlined. */
export function renderScene(
  id: string,
  stylesheet = readFileSync(STYLESHEET_PATH, 'utf8'),
): string {
  const scene = sceneById(id);
  const markup = renderToStaticMarkup(
    c(AppShell, { surface: scene.surface, title: scene.title }, scene.body()),
  );
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>UX4G forms gallery - ${scene.title}</title>`,
    `<style>${stylesheet}</style></head>`,
    `<body>${markup}</body></html>`,
  ].join('');
}

export const GALLERY_FIXTURE = { schema, ui, filled, allErrors, steps } as const;
