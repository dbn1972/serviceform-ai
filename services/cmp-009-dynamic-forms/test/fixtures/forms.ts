import { randomUUID } from 'node:crypto';
import { sha256Of } from '../../src/domain/canonical.js';
import type { PublishedFormDefinition } from '../../src/ports/form-definition.js';

export const FORM_KEY = 'generic.intake-form';

export function formPayload(): Record<string, unknown> {
  return {
    form_id: FORM_KEY,
    json_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        given_name: { type: 'string', minLength: 1, maxLength: 80, title: 'Given name' },
        family_name: { type: 'string', minLength: 1, maxLength: 80, title: 'Family name' },
        has_prior: { type: 'boolean', title: 'Has prior record' },
        prior_ref: { type: 'string', minLength: 2, maxLength: 40, title: 'Prior reference' },
        category: { type: 'string', enum: ['ALPHA', 'BETA'], title: 'Category' },
        notes: { type: 'string', maxLength: 200, title: 'Notes' },
      },
      required: ['given_name', 'family_name', 'has_prior', 'category'],
      if: {
        properties: { has_prior: { const: true } },
      },
      then: { required: ['prior_ref'] },
    },
    ui_schema: {
      type: 'VerticalLayout',
      elements: [
        {
          type: 'Control',
          scope: '#/properties/given_name',
          i18n: 'form.field.given_name',
        },
        {
          type: 'Control',
          scope: '#/properties/family_name',
          i18n: 'form.field.family_name',
        },
        { type: 'Control', scope: '#/properties/has_prior' },
        {
          type: 'Control',
          scope: '#/properties/prior_ref',
          rule: {
            effect: 'SHOW',
            condition: { scope: '#/properties/has_prior', schema: { const: true } },
          },
        },
        { type: 'Control', scope: '#/properties/category' },
        {
          type: 'Control',
          scope: '#/properties/notes',
          options: { format: 'textarea' },
        },
      ],
    },
    message_keys: ['form.field.given_name', 'form.field.family_name'],
  };
}

export function formFixture(tenantId: string): PublishedFormDefinition {
  const payload = formPayload();
  return {
    tenant_id: tenantId,
    form_key: FORM_KEY,
    version_id: randomUUID(),
    content_hash: sha256Of(payload),
    status: 'PUBLISHED',
    payload,
  };
}

export function pinOf(form: PublishedFormDefinition) {
  return {
    form_key: form.form_key,
    version_id: form.version_id,
    content_hash: form.content_hash,
  };
}

export function validData() {
  return {
    given_name: 'Ada',
    family_name: 'Lovelace',
    has_prior: false,
    category: 'ALPHA',
  };
}
