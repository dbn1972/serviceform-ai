export const UUID_PARAM = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

export const UUID_PAIR_PARAM = {
  type: 'object',
  required: ['id', 'version'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    version: { type: 'integer', minimum: 1 },
  },
} as const;

export const CREATE_ELEMENT_BODY = {
  type: 'object',
  required: ['element_id', 'element_code', 'privacy_classification', 'idempotency_key'],
  additionalProperties: false,
  properties: {
    element_id: { type: 'string', format: 'uuid' },
    element_code: { type: 'string', minLength: 1, maxLength: 128 },
    privacy_classification: {
      type: 'string',
      enum: ['PUBLIC', 'INTERNAL', 'PII', 'SENSITIVE_PII'],
    },
    code_list_binding_ref: { type: 'string', minLength: 1, maxLength: 128, nullable: true },
    idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
  },
} as const;

export const PUBLISH_ELEMENT_BODY = {
  type: 'object',
  required: ['idempotency_key'],
  additionalProperties: false,
  properties: {
    idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
  },
} as const;

export const CREATE_BINDING_BODY = {
  type: 'object',
  required: [
    'binding_id',
    'offering_id',
    'field_path',
    'element_id',
    'element_version',
    'idempotency_key',
  ],
  additionalProperties: false,
  properties: {
    binding_id: { type: 'string', format: 'uuid' },
    offering_id: { type: 'string', format: 'uuid' },
    field_path: { type: 'string', minLength: 1, maxLength: 512 },
    element_id: { type: 'string', format: 'uuid' },
    element_version: { type: 'integer', minimum: 1 },
    idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
  },
} as const;

/** INT-016: validate opaque field→element mapping without inventing field meanings. */
export const VALIDATE_MAPPING_BODY = {
  type: 'object',
  required: ['element_id', 'element_version'],
  additionalProperties: false,
  properties: {
    element_id: { type: 'string', format: 'uuid' },
    element_version: { type: 'integer', minimum: 1 },
    field_path: { type: 'string', minLength: 1, maxLength: 512 },
  },
} as const;
