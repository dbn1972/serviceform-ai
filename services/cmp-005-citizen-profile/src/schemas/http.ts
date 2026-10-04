export const UUID_PARAM = {
  type: 'object',
  additionalProperties: false,
  required: ['subjectId'],
  properties: { subjectId: { type: 'string', format: 'uuid' } },
} as const;

export const PURPOSE_QUERY = {
  type: 'object',
  additionalProperties: false,
  required: ['purpose_code'],
  properties: {
    purpose_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
  },
} as const;

export const UPSERT_CLAIMS_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['purpose_code', 'claims'],
  properties: {
    purpose_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    claims: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section_code', 'claim_code', 'value_text'],
        properties: {
          section_code: {
            type: 'string',
            enum: ['IDENTITY', 'ADDRESS', 'FAMILY', 'OCCUPATION'],
          },
          claim_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
          value_text: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    },
  },
} as const;

export const IMPORT_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['purpose_code', 'scenario', 'test_run_id'],
  properties: {
    purpose_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    scenario: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,63}$' },
    test_run_id: { type: 'string', minLength: 1, maxLength: 64 },
  },
} as const;
