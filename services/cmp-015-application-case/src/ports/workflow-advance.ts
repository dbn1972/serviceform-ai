import type { CommandTransitionRecord } from '../pipeline.js';

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
  /** event_id of the state-changed outbox row committed in the same domain transaction. */
  outbox_event_id: string;
  /** SF-CON-COMMAND-TRANSITION record as of DOMAIN_COMMITTED (temporal_advanced: false). */
  command_transition: CommandTransitionRecord;
}

export interface WorkflowAdvancePort {
  /** Resolves `DEFERRED_TO_OUTBOX` when no signal was sent and the outbox event is the trigger. */
  advance(signal: WorkflowAdvanceSignal): Promise<'DEFERRED_TO_OUTBOX' | undefined>;
}

/** Default: rely solely on the committed outbox event for CMP-016 to advance Temporal. */
export class OutboxOnlyWorkflowAdvance implements WorkflowAdvancePort {
  async advance(): Promise<'DEFERRED_TO_OUTBOX'> {
    return 'DEFERRED_TO_OUTBOX';
  }
}
