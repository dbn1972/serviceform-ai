import { Cmp020Error, detail } from '../errors.js';
import type { TenantContext } from '../types.js';

export const FEE_RULES_PURPOSE = 'FEE_CALCULATION';

export interface FeeRulesRequest {
  rule_version_id: string;
  purpose_code: typeof FEE_RULES_PURPOSE;
  application_id: string;
  facts: Record<string, unknown>;
  idempotency_key: string;
}

/** Structural subset of the CMP-008 Evaluation resource (services/cmp-008-rules/contracts). */
export interface FeeRulesEvaluation {
  evaluation_id: string;
  rule_pack: { version_id: string; content_hash: string };
  result_code: 'RULE_OUTPUT_PRODUCED' | 'NO_RULE_OUTPUT';
  outputs: Record<string, unknown>;
  decision_basis: 'DETERMINISTIC_RULES';
}

export interface FeeRulesPort {
  evaluate(ctx: TenantContext, request: FeeRulesRequest): Promise<FeeRulesEvaluation>;
}

export class UnboundFeeRulesPort implements FeeRulesPort {
  evaluate(): Promise<FeeRulesEvaluation> {
    return Promise.reject(new Cmp020Error('SF-SYS-004', detail('FEE_RULES_PORT_NOT_BOUND')));
  }
}
