import { ALLOWED_CONTENT_TYPES } from '../domain/states.js';

export const UUID_PARAM = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

export const CREATE_POLICY_BODY = {
  type: 'object',
  additionalProperties: false,
  required: [
    'policy_code',
    'allowed_content_types',
    'min_confidence',
    'max_excerpt_chars',
    'gateway_policy_id',
    'gateway_policy_version',
    'latency_budget_ms',
  ],
  properties: {
    policy_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    allowed_content_types: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
      items: { type: 'string', enum: [...ALLOWED_CONTENT_TYPES] },
    },
    min_confidence: { type: 'number', minimum: 0, maximum: 1 },
    max_excerpt_chars: { type: 'integer', minimum: 32, maximum: 20000 },
    gateway_policy_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{2,63}$' },
    gateway_policy_version: { type: 'integer', minimum: 1 },
    latency_budget_ms: { type: 'integer', minimum: 100, maximum: 120000 },
    status: { type: 'string', enum: ['ACTIVE', 'RETIRED'] },
  },
} as const;

export const CREATE_JOB_BODY = {
  type: 'object',
  additionalProperties: false,
  required: [
    'policy_code',
    'source_document_id',
    'source_checksum_sha256',
    'purpose',
    'data_classification',
  ],
  properties: {
    policy_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    source_document_id: { type: 'string', format: 'uuid' },
    source_checksum_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    purpose: { type: 'string', minLength: 1, maxLength: 200 },
    data_classification: { type: 'string', enum: ['PUBLIC', 'INTERNAL', 'PERSONAL', 'SENSITIVE'] },
  },
} as const;

export const REVIEW_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['decision'],
  properties: {
    decision: { type: 'string', enum: ['CONFIRM_ASSISTIVE', 'DISCARD'] },
  },
} as const;
