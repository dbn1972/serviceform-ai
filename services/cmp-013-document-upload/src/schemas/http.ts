import { SNIFFABLE_CONTENT_TYPES } from '../domain/content-type.js';

export const UUID_PARAM = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

export const POLICY_CODE_PARAM = {
  type: 'object',
  additionalProperties: false,
  required: ['code'],
  properties: { code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' } },
} as const;

export const CREATE_POLICY_BODY = {
  type: 'object',
  additionalProperties: false,
  required: [
    'policy_code',
    'allowed_content_types',
    'max_bytes',
    'session_ttl_seconds',
    'max_scan_attempts',
    'classification',
  ],
  properties: {
    policy_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    allowed_content_types: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
      items: { type: 'string', enum: [...SNIFFABLE_CONTENT_TYPES] },
    },
    max_bytes: { type: 'integer', minimum: 1, maximum: 5368709120 },
    session_ttl_seconds: { type: 'integer', minimum: 60, maximum: 86400 },
    max_scan_attempts: { type: 'integer', minimum: 1, maximum: 10 },
    classification: { type: 'string', enum: ['TENANT_SCOPED', 'CITIZEN_PRIVATE'] },
    status: { type: 'string', enum: ['ACTIVE', 'RETIRED'] },
  },
} as const;

/** No filename, tenant or storage key is accepted from the client. */
export const CREATE_SESSION_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['policy_code', 'content_type', 'byte_size', 'checksum_sha256'],
  properties: {
    policy_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    content_type: { type: 'string', minLength: 3, maxLength: 100 },
    byte_size: { type: 'integer', minimum: 1, maximum: 5368709120 },
    checksum_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    application_ref: { type: 'string', format: 'uuid' },
  },
} as const;
