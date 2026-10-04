export const UUID_PARAM = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

export const JURISDICTION_QUERY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    as_of: { type: 'string', format: 'date-time' },
    parent_id: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'RETIRED'] },
    cursor: { type: 'string', minLength: 1, maxLength: 512 },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
  },
} as const;

export const CREATE_TYPE_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['type_code', 'display_label'],
  properties: {
    type_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    display_label: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

export const CREATE_JURISDICTION_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'name', 'jurisdiction_type_id'],
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 64 },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    jurisdiction_type_id: { type: 'string', format: 'uuid' },
    parent_id: { type: 'string', format: 'uuid' },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const PUBLISH_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const RELATION_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['parent_id', 'relation_type_code'],
  properties: {
    parent_id: { type: ['string', 'null'], format: 'uuid' },
    relation_type_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const BINDING_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['jurisdiction_id', 'target_type', 'target_ref'],
  properties: {
    jurisdiction_id: { type: 'string', format: 'uuid' },
    target_type: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    target_ref: { type: 'string', minLength: 1, maxLength: 200 },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const RESOLVE_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'value'],
  properties: {
    mode: { type: 'string', enum: ['BY_ID', 'BY_CODE', 'BY_ADDRESS_KEY'] },
    value: { type: 'string', minLength: 1, maxLength: 200 },
    as_of: { type: 'string', format: 'date-time' },
  },
} as const;
