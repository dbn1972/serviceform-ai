import type { TenantContext } from '../types.js';

/**
 * CMP-015 command port. CMP-019 never writes case tables. RAISE_DEFICIENCY on open,
 * RECORD_CITIZEN_RESPONSE on citizen response. Called only after the deficiency txn commits.
 */
export interface CaseCommand {
  command: 'RAISE_DEFICIENCY' | 'RECORD_CITIZEN_RESPONSE';
  expected_state: string;
  expected_version: number;
  reason_code: string | null;
}

export interface CaseCommandResult {
  application_id: string;
  state: string;
  aggregate_version: number;
}

export interface CaseCommandPort {
  executeCommand(
    ctx: TenantContext,
    applicationId: string,
    body: CaseCommand,
    idempotencyKey: string,
  ): Promise<CaseCommandResult>;
}

export class UnboundCaseCommandPort implements CaseCommandPort {
  executeCommand(
    _ctx: TenantContext,
    applicationId: string,
    body: CaseCommand,
    _idempotencyKey: string,
  ): Promise<CaseCommandResult> {
    return Promise.resolve({
      application_id: applicationId,
      state: body.command === 'RAISE_DEFICIENCY' ? 'DEFICIENCY_RAISED' : 'CITIZEN_RESPONSE',
      aggregate_version: body.expected_version + 1,
    });
  }
}
