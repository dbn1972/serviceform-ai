export const UUID_PARAM = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

export const VERSION_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'version_no'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    version_no: { type: 'string', pattern: '^[1-9][0-9]{0,8}$' },
  },
} as const;

export const CREATE_LOCALE_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['locale_tag'],
  properties: {
    locale_tag: { type: 'string', minLength: 2, maxLength: 32 },
    fallback_tag: { type: ['string', 'null'], minLength: 2, maxLength: 32 },
    is_default: { type: 'boolean' },
  },
} as const;

export const FORMAT_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['date_skeleton', 'time_skeleton', 'decimal_separator', 'group_separator'],
  properties: {
    date_skeleton: { type: 'string', minLength: 1, maxLength: 32 },
    time_skeleton: { type: 'string', minLength: 1, maxLength: 32 },
    decimal_separator: { type: 'string', minLength: 1, maxLength: 1 },
    group_separator: { type: 'string', minLength: 1, maxLength: 2 },
  },
} as const;

export const CREATE_CATALOG_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['catalog_code'],
  properties: {
    catalog_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
  },
} as const;

export const UPSERT_MESSAGES_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['locale_tag', 'messages'],
  properties: {
    locale_tag: { type: 'string', minLength: 2, maxLength: 32 },
    messages: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'text'],
        properties: {
          key: { type: 'string', minLength: 1, maxLength: 199 },
          text: { type: 'string', minLength: 1, maxLength: 4000 },
        },
      },
    },
  },
} as const;

export const PUBLISH_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const RESOLVE_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['locale_tag', 'catalog_code', 'keys'],
  properties: {
    locale_tag: { type: 'string', minLength: 2, maxLength: 32 },
    catalog_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    version_no: { type: 'integer', minimum: 1 },
    keys: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: { type: 'string', minLength: 1, maxLength: 199 },
    },
  },
} as const;

export const FORMAT_RESOLVE_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['locale_tag'],
  properties: {
    locale_tag: { type: 'string', minLength: 2, maxLength: 32 },
    iso_date: { type: 'string', minLength: 10, maxLength: 10 },
    number: { type: 'string', minLength: 1, maxLength: 40 },
  },
} as const;

export const ASSIST_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['source_locale_tag', 'target_locale_tag', 'message_key', 'source_text'],
  properties: {
    source_locale_tag: { type: 'string', minLength: 2, maxLength: 32 },
    target_locale_tag: { type: 'string', minLength: 2, maxLength: 32 },
    message_key: { type: 'string', minLength: 1, maxLength: 199 },
    source_text: { type: 'string', minLength: 1, maxLength: 4000 },
    test_run_id: { type: 'string', minLength: 1, maxLength: 80 },
  },
} as const;
