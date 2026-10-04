export const UUID_PARAM = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

export const CREATE_PURPOSE_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'label'],
  properties: {
    code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    label: { type: 'string', minLength: 1, maxLength: 200 },
    requires_consent: { type: 'boolean' },
  },
} as const;

export const CREATE_NOTICE_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['purpose_id', 'content_ref'],
  properties: {
    purpose_id: { type: 'string', format: 'uuid' },
    content_ref: { type: 'string', minLength: 1, maxLength: 500 },
    version_no: { type: 'integer', minimum: 1 },
  },
} as const;

export const GRANT_CONSENT_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['subject_id', 'purpose_id', 'channel'],
  properties: {
    subject_id: { type: 'string', format: 'uuid' },
    purpose_id: { type: 'string', format: 'uuid' },
    notice_id: { type: 'string', format: 'uuid' },
    channel: { type: 'string', enum: ['WEB', 'COUNTER', 'API'] },
    representation_basis: { type: 'string', enum: ['SELF', 'ASSISTED', 'LEGAL_REP'] },
    applied_for: { type: 'string', format: 'uuid' },
  },
} as const;

export const LIST_CONSENTS_QUERY = {
  type: 'object',
  additionalProperties: false,
  required: ['subject_id'],
  properties: {
    subject_id: { type: 'string', format: 'uuid' },
    purpose_id: { type: 'string', format: 'uuid' },
  },
} as const;

export const ACCESS_CHECK_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['subject_id', 'purpose_code'],
  properties: {
    subject_id: { type: 'string', format: 'uuid' },
    purpose_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
  },
} as const;

export const WITHDRAW_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reason_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
  },
} as const;
