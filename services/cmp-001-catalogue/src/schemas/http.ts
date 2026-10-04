export const UUID_PARAM = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

export const CREATE_CATEGORY_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['category_code', 'display_label'],
  properties: {
    category_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    display_label: { type: 'string', minLength: 1, maxLength: 200 },
    parent_category_id: { type: 'string', format: 'uuid' },
  },
} as const;

export const CREATE_CANONICAL_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['service_code', 'category_id', 'title', 'summary'],
  properties: {
    service_code: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,62}$' },
    category_id: { type: 'string', format: 'uuid' },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    summary: { type: 'string', minLength: 1, maxLength: 2000 },
    tags: {
      type: 'array',
      maxItems: 32,
      items: { type: 'string', pattern: '^[a-z0-9-]{1,64}$' },
    },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const CANONICAL_VERSION_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    summary: { type: 'string', minLength: 1, maxLength: 2000 },
    tags: {
      type: 'array',
      maxItems: 32,
      items: { type: 'string', pattern: '^[a-z0-9-]{1,64}$' },
    },
    status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'RETIRED'] },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const OFFERING_QUERY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tag: { type: 'string', pattern: '^[a-z0-9-]{1,64}$' },
    category_id: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['DRAFT', 'READY', 'RETIRED'] },
    cursor: { type: 'string', minLength: 1, maxLength: 512 },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
  },
} as const;

export const CREATE_OFFERING_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['canonical_service_id', 'offering_code', 'local_name'],
  properties: {
    canonical_service_id: { type: 'string', format: 'uuid' },
    offering_code: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,62}$' },
    local_name: { type: 'string', minLength: 1, maxLength: 200 },
    provider_org_ref: { type: 'string', minLength: 1, maxLength: 200 },
    provider_office_ref: { type: 'string', minLength: 1, maxLength: 200 },
    tags: {
      type: 'array',
      maxItems: 32,
      items: { type: 'string', pattern: '^[a-z0-9-]{1,64}$' },
    },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const OFFERING_VERSION_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['local_name'],
  properties: {
    local_name: { type: 'string', minLength: 1, maxLength: 200 },
    status: { type: 'string', enum: ['DRAFT', 'READY', 'RETIRED'] },
    provider_org_ref: { type: 'string', minLength: 1, maxLength: 200 },
    provider_office_ref: { type: 'string', minLength: 1, maxLength: 200 },
    tags: {
      type: 'array',
      maxItems: 32,
      items: { type: 'string', pattern: '^[a-z0-9-]{1,64}$' },
    },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const BINDING_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['jurisdiction_ref', 'target_type', 'target_ref'],
  properties: {
    jurisdiction_ref: { type: 'string', minLength: 1, maxLength: 200 },
    target_type: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    target_ref: { type: 'string', minLength: 1, maxLength: 200 },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;
