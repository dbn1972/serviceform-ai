/**
 * Temporal sequencing port (CMP-016 owns the runtime). CMP-015 only signals after its own domain
 * commit; the committed outbox event is the durable trigger, so a failed or skipped signal never
 * loses the transition. Signals are idempotent on (application_id, aggregate_version).
 */
export interface WorkflowAdvanceSignal {
  tenant_id: string;
  application_id: string;
  aggregate_version: number;
  to_state: string;
  transition_key: string;
  workflow_version_id: string;
  idempotency_key: string;
  correlation_id: string;
}

export interface WorkflowAdvancePort {
  advance(signal: WorkflowAdvanceSignal): Promise<void>;
}

/** Default: rely solely on the committed outbox event for CMP-016 to advance Temporal. */
export class OutboxOnlyWorkflowAdvance implements WorkflowAdvancePort {
  async advance(): Promise<void> {
    return undefined;
  }
}
