export const UUID_PARAM = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

export const PROPOSAL_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'proposalId'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    proposalId: { type: 'string', format: 'uuid' },
  },
} as const;

export const CREATE_TENANT_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'display_name', 'cell_id', 'isolation_model', 'reason'],
  properties: {
    code: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,62}$' },
    display_name: { type: 'string', minLength: 1, maxLength: 200 },
    cell_id: { type: 'string', pattern: '^cell-[a-z0-9-]{1,40}$' },
    isolation_model: { type: 'string', enum: ['POOL', 'BRIDGE', 'SILO'] },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const CREATE_ORG_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'name', 'organisation_type_code'],
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 64 },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    organisation_type_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    parent_id: { type: 'string', format: 'uuid' },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const ORG_VERSION_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    organisation_type_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    status: { type: 'string', enum: ['ACTIVE', 'DISSOLVED'] },
    parent_id: { type: ['string', 'null'], format: 'uuid' },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const CREATE_OFFICE_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['organisation_id', 'code', 'name'],
  properties: {
    organisation_id: { type: 'string', format: 'uuid' },
    code: { type: 'string', minLength: 1, maxLength: 64 },
    name: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

export const ACTIVATE_OFFICE_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'integer', minimum: 1 },
  },
} as const;

export const PLACEMENT_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['cell_id', 'isolation_model', 'reason'],
  properties: {
    cell_id: { type: 'string', pattern: '^cell-[a-z0-9-]{1,40}$' },
    isolation_model: { type: 'string', enum: ['POOL', 'BRIDGE', 'SILO'] },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
    valid_from: { type: 'string', format: 'date-time' },
  },
} as const;

export const APPROVE_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['reason'],
  properties: {
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export const ORG_QUERY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    as_of: { type: 'string', format: 'date-time' },
    parent_id: { type: 'string', format: 'uuid' },
    cursor: { type: 'string', maxLength: 500 },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
  },
} as const;

export const OFFICE_QUERY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    organisation_id: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'INACTIVE'] },
    cursor: { type: 'string', maxLength: 500 },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
  },
} as const;
