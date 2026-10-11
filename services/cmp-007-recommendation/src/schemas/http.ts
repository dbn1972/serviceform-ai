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
    'consent_purpose_code',
    'gateway_policy_id',
    'gateway_policy_version',
    'model_route_ref',
    'allowed_reason_codes',
    'max_candidates',
    'max_results',
    'latency_budget_ms',
  ],
  properties: {
    policy_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    consent_purpose_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    gateway_policy_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{2,63}$' },
    gateway_policy_version: { type: 'integer', minimum: 1 },
    model_route_ref: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{2,127}$' },
    allowed_reason_codes: {
      type: 'array',
      minItems: 1,
      maxItems: 64,
      uniqueItems: true,
      items: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    },
    allowed_signal_codes: {
      type: 'array',
      maxItems: 64,
      uniqueItems: true,
      items: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    },
    max_candidates: { type: 'integer', minimum: 1, maximum: 50 },
    max_results: { type: 'integer', minimum: 1, maximum: 10 },
    latency_budget_ms: { type: 'integer', minimum: 100, maximum: 120000 },
    status: { type: 'string', enum: ['ACTIVE', 'RETIRED'] },
  },
} as const;

export const CREATE_RECOMMENDATION_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['policy_code'],
  properties: {
    policy_code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    application_id: { type: 'string', format: 'uuid' },
    candidate_service_ids: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      uniqueItems: true,
      items: { type: 'string', format: 'uuid' },
    },
    context_signals: {
      type: 'array',
      maxItems: 16,
      uniqueItems: true,
      items: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
    },
  },
} as const;

export const DISPOSITION_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['decision'],
  properties: {
    decision: { type: 'string', enum: ['SELECT', 'DISMISS'] },
    service_id: { type: 'string', format: 'uuid' },
  },
} as const;
