export const UUID_PARAM = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

export const VERSION_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'version'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    version: { type: 'string', pattern: '^[1-9][0-9]{0,8}$' },
  },
} as const;

export const LIST_QUERY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string', minLength: 1, maxLength: 512 },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
  },
} as const;

export const RESOLVE_QUERY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    as_of: { type: 'string', format: 'date-time' },
    value_code: { type: 'string', minLength: 1, maxLength: 64 },
  },
} as const;

export const CREATE_SET_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['set_code', 'localization_key'],
  properties: {
    set_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    localization_key: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

export const CREATE_VERSION_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    jurisdiction_ref: { type: 'string', minLength: 1, maxLength: 200 },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const VALUE_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['value_code', 'localization_key', 'sort_order'],
  properties: {
    value_code: { type: 'string', pattern: '^[A-Z0-9][A-Z0-9._-]{0,63}$' },
    localization_key: { type: 'string', minLength: 1, maxLength: 200 },
    sort_order: { type: 'integer', minimum: 0 },
    parent_value_code: { type: 'string', pattern: '^[A-Z0-9][A-Z0-9._-]{0,63}$' },
  },
} as const;

export const ADD_VALUES_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: { type: 'array', minItems: 1, maxItems: 500, items: VALUE_ITEM },
  },
} as const;

export const IMPORT_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: { type: 'array', minItems: 1, maxItems: 500, items: VALUE_ITEM },
    connector_binding: { type: 'object' },
    scenario: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,63}$' },
    test_run_id: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;

export const PUBLISH_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const BINDING_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['code_set_id', 'pinned_version_no', 'target_type', 'target_ref'],
  properties: {
    code_set_id: { type: 'string', format: 'uuid' },
    pinned_version_no: { type: 'integer', minimum: 1 },
    target_type: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    target_ref: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;
