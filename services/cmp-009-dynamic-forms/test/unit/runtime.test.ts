import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFormPackage } from '../../src/domain/pack.js';
import { parseJsonSchema, validateAgainstSchema } from '../../src/domain/schema.js';
import { evaluateVisibility, parseUiSchema } from '../../src/domain/ui-schema.js';
import {
  resolveUx4gRenderer,
  UX4G_JSON_FORMS_RENDERERS,
  type Ux4gRendererId,
} from '../../src/domain/ux4g.js';
import { runFormRuntime } from '../../src/domain/runtime.js';
import { Cmp009Error } from '../../src/errors.js';
import { FORM_KEY, formPayload, validData } from '../fixtures/forms.js';

const ux4gRegistry = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/ui-ux4g/src/json-forms/registry.ts',
);
const ux4gControl = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/ui-ux4g/src/json-forms/Ux4gControl.tsx',
);
const textInput = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/ui-ux4g/src/components/TextInput.tsx',
);

describe('JSON Schema runtime', () => {
  it('accepts a valid object schema and rejects invalid schemas', () => {
    const schema = parseJsonSchema({
      type: 'object',
      properties: { alpha: { type: 'string' } },
      required: ['alpha'],
    });
    expect(schema.type).toBe('object');
    expect(() => parseJsonSchema({ $ref: 'https://example.invalid/schema' })).toThrow(Cmp009Error);
    expect(() => parseJsonSchema('not-an-object')).toThrow(Cmp009Error);
    expect(() => parseJsonSchema({ type: 'function' })).toThrow(Cmp009Error);
  });

  it('validates instance data without echoing values', () => {
    const schema = parseJsonSchema({
      type: 'object',
      properties: { alpha: { type: 'string', minLength: 2 } },
      required: ['alpha'],
      additionalProperties: false,
    });
    const issues = validateAgainstSchema(schema, { alpha: 'a' });
    expect(issues[0]?.code).toBe('MIN_LENGTH');
    expect(JSON.stringify(issues)).not.toContain('"a"');
  });

  it('validates email format with a linear scan (no backtracking regex)', () => {
    const schema = parseJsonSchema({
      type: 'object',
      properties: { contact: { type: 'string', format: 'email' } },
      required: ['contact'],
    });
    expect(validateAgainstSchema(schema, { contact: 'user@example.test' })).toEqual([]);
    expect(validateAgainstSchema(schema, { contact: 'not-an-email' })[0]?.code).toBe(
      'FORMAT_EMAIL',
    );
    const attack = `!@!${'!'.repeat(200)}.`;
    expect(validateAgainstSchema(schema, { contact: attack })[0]?.code).toBe('FORMAT_EMAIL');
  });
});

describe('UI schema + conditional visibility + required fields', () => {
  it('interprets controls and hides prior_ref unless has_prior is true', () => {
    const pack = parseFormPackage(formPayload(), FORM_KEY);
    const hidden = evaluateVisibility(pack.uiSchema, { has_prior: false });
    expect(hidden.visible.has('#/properties/prior_ref')).toBe(false);
    const shown = evaluateVisibility(pack.uiSchema, { has_prior: true });
    expect(shown.visible.has('#/properties/prior_ref')).toBe(true);

    const without = runFormRuntime(pack.jsonSchema, pack.uiSchema, validData(), {});
    expect(without.requiredFields).not.toContain('prior_ref');
    expect(without.valid).toBe(true);

    const missing = runFormRuntime(
      pack.jsonSchema,
      pack.uiSchema,
      { ...validData(), has_prior: true },
      {},
    );
    expect(missing.requiredFields).toContain('prior_ref');
    expect(missing.issues.some((i) => i.code === 'REQUIRED' && i.pointer === '/prior_ref')).toBe(
      true,
    );
  });

  it('rejects malformed UI schema', () => {
    expect(() => parseUiSchema({ type: 'Wizard' })).toThrow(Cmp009Error);
    expect(() => parseUiSchema({ type: 'Control', scope: 'given_name' })).toThrow(Cmp009Error);
  });
});

describe('UX4G renderer compatibility (CMP-054, no fork)', () => {
  it('matches frozen UX4G renderer ids and classes', () => {
    const source = readFileSync(ux4gRegistry, 'utf8');
    for (const id of Object.keys(UX4G_JSON_FORMS_RENDERERS) as Ux4gRendererId[]) {
      expect(source).toContain(`'${id}'`);
      expect(source).toContain(UX4G_JSON_FORMS_RENDERERS[id].ux4gClass);
    }
    expect(resolveUx4gRenderer({ type: 'string' })).toBe('Ux4gTextInput');
    expect(resolveUx4gRenderer({ type: 'string' }, { options: { format: 'textarea' } })).toBe(
      'Ux4gTextarea',
    );
    expect(resolveUx4gRenderer({ type: 'string', enum: ['A'] })).toBe('Ux4gSelect');
    expect(resolveUx4gRenderer({ type: 'boolean' })).toBe('Ux4gCheckbox');
  });

  it('emits accessibility contract semantics used by UX4G primitives', () => {
    const controlSrc = readFileSync(ux4gControl, 'utf8');
    const inputSrc = readFileSync(textInput, 'utf8');
    expect(inputSrc).toContain('htmlFor');
    expect(inputSrc).toContain('aria-invalid');
    expect(controlSrc).toContain('required');
    const pack = parseFormPackage(formPayload(), FORM_KEY);
    const runtime = runFormRuntime(pack.jsonSchema, pack.uiSchema, validData(), {
      'form.field.given_name': 'Given name (en)',
    });
    const given = runtime.controls.find((c) => c.field === 'given_name');
    expect(given?.accessibility.label_association).toBe('htmlFor');
    expect(given?.accessibility.keyboard).toBe('tab');
    expect(given?.accessibility.aria_invalid_on_error).toBe(true);
    expect(given?.accessibility.required_announced).toBe(true);
    expect(given?.label).toBe('Given name (en)');
    expect(given?.renderer_id).toBe('Ux4gTextInput');
  });
});
