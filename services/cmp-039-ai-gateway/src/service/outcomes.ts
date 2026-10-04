import { errorEntry, type ErrorResponse } from '@serviceform/contracts';

export type BlockReason =
  | 'AUTHZ_DENIED'
  | 'POLICY_NOT_FOUND'
  | 'POLICY_NOT_ACTIVE'
  | 'OPERATION_MISMATCH'
  | 'MODEL_NOT_APPROVED'
  | 'DATA_CLASSIFICATION_EXCEEDED'
  | 'PURPOSE_NOT_PERMITTED'
  | 'SOURCE_ACL_DENIED'
  | 'CROSS_TENANT_SOURCE'
  | 'TOOL_NOT_ALLOWED'
  | 'VARIABLES_INVALID'
  | 'INPUT_TOO_LARGE'
  | 'BUDGET_EXCEEDED'
  | 'PROVIDER_UNAVAILABLE'
  | 'STATUTORY_DECISION_OUTPUT'
  | 'TOOL_CALL_NOT_ALLOWED'
  | 'OUTPUT_TOO_LARGE'
  | 'CITATION_NOT_IN_SOURCES'
  | 'EMBEDDING_INVALID';

interface BlockSpec {
  code: string;
  status: number;
  outcome: 'BLOCKED' | 'FAILED';
}

const BLOCKS: Record<BlockReason, BlockSpec> = {
  AUTHZ_DENIED: { code: 'SF-AUTH-002', status: 403, outcome: 'BLOCKED' },
  POLICY_NOT_FOUND: { code: 'SF-SYS-002', status: 404, outcome: 'BLOCKED' },
  POLICY_NOT_ACTIVE: { code: 'SF-SYS-002', status: 404, outcome: 'BLOCKED' },
  OPERATION_MISMATCH: { code: 'SF-SYS-003', status: 400, outcome: 'BLOCKED' },
  MODEL_NOT_APPROVED: { code: 'SF-AUTH-002', status: 403, outcome: 'BLOCKED' },
  DATA_CLASSIFICATION_EXCEEDED: { code: 'SF-AUTH-002', status: 403, outcome: 'BLOCKED' },
  PURPOSE_NOT_PERMITTED: { code: 'SF-AUTH-002', status: 403, outcome: 'BLOCKED' },
  SOURCE_ACL_DENIED: { code: 'SF-AUTH-002', status: 403, outcome: 'BLOCKED' },
  CROSS_TENANT_SOURCE: { code: 'SF-TEN-002', status: 403, outcome: 'BLOCKED' },
  TOOL_NOT_ALLOWED: { code: 'SF-AUTH-002', status: 403, outcome: 'BLOCKED' },
  VARIABLES_INVALID: { code: 'SF-SYS-003', status: 400, outcome: 'BLOCKED' },
  INPUT_TOO_LARGE: { code: 'SF-SYS-003', status: 400, outcome: 'BLOCKED' },
  BUDGET_EXCEEDED: { code: 'SF-RATE-001', status: 429, outcome: 'BLOCKED' },
  PROVIDER_UNAVAILABLE: { code: 'SF-AI-001', status: 503, outcome: 'FAILED' },
  STATUTORY_DECISION_OUTPUT: { code: 'SF-AI-001', status: 422, outcome: 'BLOCKED' },
  TOOL_CALL_NOT_ALLOWED: { code: 'SF-AI-001', status: 422, outcome: 'BLOCKED' },
  OUTPUT_TOO_LARGE: { code: 'SF-AI-001', status: 422, outcome: 'BLOCKED' },
  CITATION_NOT_IN_SOURCES: { code: 'SF-AI-001', status: 422, outcome: 'BLOCKED' },
  EMBEDDING_INVALID: { code: 'SF-AI-001', status: 422, outcome: 'BLOCKED' },
};

export function blockSpec(reason: BlockReason): BlockSpec {
  return BLOCKS[reason];
}

export function errorBody(
  correlationId: string,
  code: string,
  message: string,
  details?: ErrorResponse['details'],
): ErrorResponse {
  const out: ErrorResponse = { error_code: code, message, correlation_id: correlationId };
  if (details && details.length > 0) out.details = details;
  return out;
}

export function blockedBody(
  correlationId: string,
  reason: BlockReason,
  fallbackBehavior?: 'DENY' | 'NON_AI_PATH',
): { status: number; body: ErrorResponse } {
  const spec = BLOCKS[reason];
  const details: { code: string }[] = [{ code: reason }];
  if (fallbackBehavior === 'NON_AI_PATH') details.push({ code: 'FALLBACK_NON_AI_PATH' });
  return {
    status: spec.status,
    body: errorBody(correlationId, spec.code, errorEntry(spec.code).message, details),
  };
}
