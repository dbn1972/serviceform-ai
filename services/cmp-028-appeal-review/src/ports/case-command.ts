import type { TenantContext } from '../context.js';

/** CMP-015 command port. Original case rows are never updated by CMP-028 SQL. */
export interface CaseCommandRequest {
  application_id: string;
  command_type: string;
  expected_state: string;
  idempotency_key: string;
  appeal_id: string;
}

export interface CaseCommandPort {
  apply(ctx: TenantContext, request: CaseCommandRequest): Promise<{ command_id: string }>;
}

export function unconfiguredCaseCommandPort(): CaseCommandPort {
  return {
    async apply() {
      throw new Error('CMP-015 command port is unconfigured');
    },
  };
}
