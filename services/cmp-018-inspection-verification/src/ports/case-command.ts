/**
 * CMP-015 remains authoritative for case state. CMP-018 never mutates CMP-015 tables.
 * After the inspection domain commit, a command may be offered through this port.
 * Statutory RECORD_APPROVED / RECORD_REJECTED are refused in domain code.
 */
export interface CaseCommand {
  tenant_id: string;
  application_id: string;
  command_type: string;
  inspection_id: string;
  verification_result: string;
  statutory_effect: false;
  domain_committed: true;
  open_domain_txn_has_temporal_network: false;
  idempotency_key: string;
  correlation_id: string;
  authz_decision_id: string;
  authz_policy_revision: string;
}

export interface CaseCommandPort {
  submit(command: CaseCommand): Promise<void>;
}

/** Default: rely on committed inspection outbox events; STITCH-B/009 may wire CMP-015. */
export const noopCaseCommand: CaseCommandPort = {
  async submit() {
    return undefined;
  },
};
