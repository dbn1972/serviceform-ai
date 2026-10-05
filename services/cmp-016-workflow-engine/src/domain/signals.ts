import { CODE_RE, NODE_ID_RE, isUuid } from './model.js';
import { reject } from '../errors.js';

/**
 * Proof that an authoritative domain commit (CMP-015 case transition, or CMP-016's own
 * withdrawal/cancellation request record) succeeded and its outbox row was written. It is the
 * only external input that moves a workflow token past a commit-wait node (Constitution #10,
 * #11; SF-CON-COMMAND-TRANSITION order: domain commit -> outbox -> Temporal advance).
 */
export interface CommittedSignal {
  signal_id: string;
  source_component: 'CMP-015' | 'CMP-016';
  tenant_id: string;
  application_id: string;
  workflow_version_id: string;
  command_id: string;
  outcome: string;
  phase: string;
  domain_committed: boolean;
  outbox_event_id: string;
  node_id?: string;
}

/** FROZEN SF-CON-COMMAND-TRANSITION v1 record published by CMP-015 after its domain commit. */
export interface CommandTransitionRecord {
  contract_id: 'SF-CON-COMMAND-TRANSITION';
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  tenant_id: string;
  application_id: string;
  command_id: string;
  command_type: string;
  phase:
    | 'AUTHORIZE'
    | 'VALIDATE_PINS_STATE'
    | 'DOMAIN_TXN'
    | 'CASE_MUTATED'
    | 'OUTBOX_WRITTEN'
    | 'DOMAIN_COMMITTED'
    | 'TEMPORAL_ADVANCE';
  expected_state: string;
  pin_set: { workflow_version_id: string } & Record<string, string>;
  authz_decision_id: string;
  authz_policy_revision: string;
  idempotency_key: string;
  correlation_id?: string;
  domain_committed: boolean;
  temporal_advanced: boolean;
  open_domain_txn_has_temporal_network: boolean;
}

/**
 * Maps a CMP-015 command-transition record to a workflow signal. Only a record in phase
 * DOMAIN_COMMITTED, committed, not yet advanced and with no Temporal I/O inside its domain
 * transaction is accepted; anything else is an attempt to advance before (or without) the commit.
 */
export function signalFromCommandTransition(
  record: CommandTransitionRecord,
  outboxEventId: string,
): CommittedSignal {
  if (record.contract_id !== 'SF-CON-COMMAND-TRANSITION') {
    throw reject('SIGNAL_CONTRACT_INVALID', '/contract_id');
  }
  if (record.open_domain_txn_has_temporal_network !== false) {
    throw reject('TEMPORAL_CALL_INSIDE_DOMAIN_TXN', '/open_domain_txn_has_temporal_network');
  }
  const signal: CommittedSignal = {
    signal_id: record.command_id,
    source_component: 'CMP-015',
    tenant_id: record.tenant_id,
    application_id: record.application_id,
    workflow_version_id: record.pin_set?.workflow_version_id,
    command_id: record.command_id,
    outcome: record.command_type,
    phase: record.phase,
    domain_committed: record.domain_committed,
    outbox_event_id: outboxEventId,
  };
  assertCommitted(signal);
  if (record.temporal_advanced !== false) throw reject('ALREADY_ADVANCED', '/temporal_advanced');
  return signal;
}

/** Fails closed unless the signal proves a completed domain commit with an outbox record. */
export function assertCommitted(signal: CommittedSignal): void {
  if (signal.domain_committed !== true || signal.phase !== 'DOMAIN_COMMITTED') {
    throw reject('ADVANCE_BEFORE_DOMAIN_COMMIT', '/domain_committed');
  }
  if (typeof signal.outbox_event_id !== 'string' || !isUuid(signal.outbox_event_id)) {
    throw reject('ADVANCE_WITHOUT_OUTBOX', '/outbox_event_id');
  }
  if (signal.source_component !== 'CMP-015' && signal.source_component !== 'CMP-016') {
    throw reject('SIGNAL_SOURCE_NOT_AUTHORITATIVE', '/source_component');
  }
  for (const key of [
    'signal_id',
    'tenant_id',
    'application_id',
    'workflow_version_id',
    'command_id',
  ] as const) {
    if (typeof signal[key] !== 'string' || !isUuid(signal[key])) {
      throw reject('SIGNAL_FIELD_INVALID', `/${key}`);
    }
  }
  if (typeof signal.outcome !== 'string' || !CODE_RE.test(signal.outcome)) {
    throw reject('SIGNAL_FIELD_INVALID', '/outcome');
  }
  if (signal.node_id !== undefined && !NODE_ID_RE.test(signal.node_id)) {
    throw reject('SIGNAL_FIELD_INVALID', '/node_id');
  }
}
