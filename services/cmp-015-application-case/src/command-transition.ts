import type { CaseState } from './domain/model.js';
import type { PinGraph } from './domain/pins.js';

/**
 * SF-CON-COMMAND-TRANSITION phases. Kept outside pipeline.ts so ports can reference the
 * committed-record shape without a circular import (pipeline ↔ workflow-advance).
 */
export const PHASES = [
  'AUTHORIZE',
  'VALIDATE_PINS_STATE',
  'DOMAIN_TXN',
  'CASE_MUTATED',
  'OUTBOX_WRITTEN',
  'DOMAIN_COMMITTED',
  'TEMPORAL_ADVANCE',
] as const;
export type Phase = (typeof PHASES)[number];

/** FROZEN SF-CON-COMMAND-TRANSITION v1 record published by CMP-015 after its domain commit. */
export interface CommandTransitionRecord {
  contract_id: 'SF-CON-COMMAND-TRANSITION';
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  tenant_id: string;
  application_id: string;
  command_id: string;
  command_type: string;
  phase: Phase;
  expected_state: CaseState;
  pin_set: PinGraph;
  authz_decision_id: string;
  authz_policy_revision: string;
  idempotency_key: string;
  correlation_id: string;
  domain_committed: boolean;
  temporal_advanced: boolean;
  open_domain_txn_has_temporal_network: false;
}
