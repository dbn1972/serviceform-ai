import { randomUUID } from 'node:crypto';
import type { CaseState } from './domain/model.js';
import type { PinGraph } from './domain/pins.js';
import { Cmp015Error, detail } from './errors.js';
import type { WorkflowAdvancePort, WorkflowAdvanceSignal } from './ports/workflow-advance.js';
import { assertNoOpenDomainTransaction } from './tx-scope.js';

/**
 * SF-CON-COMMAND-TRANSITION: authorize -> validate pins/state -> short PostgreSQL transaction ->
 * case change -> outbox -> commit -> only then Temporal (Constitution #10, #11). Phases can only
 * advance one step at a time, and a Temporal advance needs a CommitReceipt that exists only after
 * the domain transaction resolved.
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

export interface CommitReceipt {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly aggregateVersion: number;
}

const issuedReceipts = new WeakSet<object>();

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

export class CommandPipeline {
  readonly commandId = randomUUID();
  private phaseIndex = -1;
  private authz: { decisionId: string; policyRevision: string } | null = null;
  private expectedState: CaseState | null = null;
  private pins: PinGraph | null = null;
  private receipt: CommitReceipt | null = null;
  private advanced = false;

  constructor(
    private readonly base: {
      tenantId: string;
      applicationId: string;
      commandType: string;
      idempotencyKey: string;
      correlationId: string;
    },
  ) {}

  get phase(): Phase | null {
    return this.phaseIndex < 0 ? null : (PHASES[this.phaseIndex] ?? null);
  }

  private enter(phase: Phase): void {
    const target = PHASES.indexOf(phase);
    if (target !== this.phaseIndex + 1) {
      throw new Cmp015Error('SF-WF-001', {
        details: [
          { code: 'COMMAND_PHASE_ORDER', message: `${phase} after ${this.phase ?? 'START'}` },
        ],
      });
    }
    this.phaseIndex = target;
  }

  authorized(decisionId: string, policyRevision: string): void {
    this.enter('AUTHORIZE');
    this.authz = { decisionId, policyRevision };
  }

  validated(expectedState: CaseState, pins: PinGraph): void {
    this.enter('VALIDATE_PINS_STATE');
    this.expectedState = expectedState;
    this.pins = pins;
  }

  domainTxnOpened(): void {
    this.enter('DOMAIN_TXN');
  }

  caseMutated(): void {
    this.enter('CASE_MUTATED');
  }

  outboxWritten(): void {
    this.enter('OUTBOX_WRITTEN');
  }

  /** Call only after the store transaction promise resolved (COMMIT acknowledged). */
  committed(aggregateVersion: number): CommitReceipt {
    assertNoOpenDomainTransaction('commit-receipt');
    this.enter('DOMAIN_COMMITTED');
    const receipt: CommitReceipt = Object.freeze({
      tenantId: this.base.tenantId,
      applicationId: this.base.applicationId,
      aggregateVersion,
    });
    issuedReceipts.add(receipt);
    this.receipt = receipt;
    return receipt;
  }

  temporalAdvanced(receipt: CommitReceipt): void {
    if (receipt !== this.receipt) {
      throw new Cmp015Error('SF-WF-001', { details: detail('TEMPORAL_ADVANCE_BEFORE_COMMIT') });
    }
    this.enter('TEMPORAL_ADVANCE');
    this.advanced = true;
  }

  record(): CommandTransitionRecord {
    if (!this.authz || !this.expectedState || !this.pins || this.phase === null) {
      throw new Cmp015Error('SF-SYS-001', { details: detail('COMMAND_RECORD_INCOMPLETE') });
    }
    return {
      contract_id: 'SF-CON-COMMAND-TRANSITION',
      contract_status: 'FROZEN',
      freeze_status: 'FROZEN',
      tenant_id: this.base.tenantId,
      application_id: this.base.applicationId,
      command_id: this.commandId,
      command_type: this.base.commandType,
      phase: this.phase,
      expected_state: this.expectedState,
      pin_set: { ...this.pins },
      authz_decision_id: this.authz.decisionId,
      authz_policy_revision: this.authz.policyRevision,
      idempotency_key: this.base.idempotencyKey,
      correlation_id: this.base.correlationId,
      domain_committed: this.receipt !== null,
      temporal_advanced: this.advanced,
      open_domain_txn_has_temporal_network: false,
    };
  }
}

export function isCommitReceipt(value: unknown): value is CommitReceipt {
  return typeof value === 'object' && value !== null && issuedReceipts.has(value);
}

/**
 * The only path from CMP-015 to the workflow runtime. Refuses forged receipts and any call made
 * while a domain transaction is open.
 */
export class WorkflowAdvanceGate {
  constructor(private readonly port: WorkflowAdvancePort) {}

  async advance(
    pipeline: CommandPipeline,
    receipt: CommitReceipt,
    signal: Omit<WorkflowAdvanceSignal, 'tenant_id' | 'application_id' | 'aggregate_version'>,
  ): Promise<'SIGNALLED' | 'DEFERRED_TO_OUTBOX'> {
    assertNoOpenDomainTransaction('workflow-advance');
    if (!isCommitReceipt(receipt)) {
      throw new Cmp015Error('SF-WF-001', { details: detail('TEMPORAL_ADVANCE_BEFORE_COMMIT') });
    }
    try {
      await this.port.advance({
        ...signal,
        tenant_id: receipt.tenantId,
        application_id: receipt.applicationId,
        aggregate_version: receipt.aggregateVersion,
      });
    } catch {
      return 'DEFERRED_TO_OUTBOX';
    }
    pipeline.temporalAdvanced(receipt);
    return 'SIGNALLED';
  }
}
