import { Cmp019Error, detail } from '../errors.js';
import type { CaseCommandPort } from '../ports/case-command-port.js';
import type { NotificationPort } from '../ports/notification-port.js';
import type { SlaClockPort } from '../ports/sla-clock-port.js';
import type { DeficiencyRepository, EffectStatus, ReconciliationIntentRow } from '../repo/types.js';
import type { TenantContext } from '../types.js';

/** CMP-016-like consumer group for committed deficiency reconciliation intents. */
export const RECONCILIATION_CONSUMER_GROUP = 'cmp-019.reconciliation';

export interface ReconcilerDeps {
  repo: DeficiencyRepository;
  caseCommands: CaseCommandPort;
  slaClock: SlaClockPort;
  notifier: NotificationPort;
  clock?: () => Date;
}

export interface ReconcileResult {
  intent_id: string;
  source_event_id: string;
  case_effect_status: EffectStatus;
  sla_effect_status: EffectStatus;
  notification_effect_status: EffectStatus;
  replayed: boolean;
  reconstructed_from_durable_state: true;
}

function isIncomplete(status: EffectStatus): boolean {
  return status === 'PENDING' || status === 'FAILED_RETRYABLE';
}

function intentComplete(row: ReconciliationIntentRow): boolean {
  // FAILED_STALE is terminal for case; incomplete statuses keep the intent open.
  return (
    !isIncomplete(row.case_effect_status) &&
    !isIncomplete(row.sla_effect_status) &&
    !isIncomplete(row.notification_effect_status)
  );
}

function errorCode(err: unknown): string {
  if (err instanceof Cmp019Error) {
    return err.details?.[0]?.code ?? err.code;
  }
  const e = err as { code?: string; details?: { code?: string }[] };
  return e.details?.[0]?.code ?? e.code ?? 'PORT_FAILURE';
}

function isStale(err: unknown): boolean {
  const code = errorCode(err);
  // CMP-015 optimistic concurrency: STALE_EXPECTED_STATE / STALE_VERSION are terminal.
  return (
    code === 'STALE_EXPECTED_STATE' ||
    code === 'STALE_EXPECTED_VERSION' ||
    code === 'EXPECTED_VERSION_MISMATCH' ||
    code === 'STALE_VERSION'
  );
}

function sanitizeErrorCode(err: unknown): string {
  return (
    errorCode(err)
      .replace(/[^A-Z0-9_]/g, '')
      .slice(0, 64) || 'PORT_FAILURE'
  );
}

/**
 * Executable reconciler for durable same-txn reconciliation intents.
 * Ports run only after the authoritative deficiency transaction commits.
 * Temporal is not authoritative. Inbox records at-least-once delivery.
 */
export class DeficiencyReconciliationConsumer {
  constructor(private readonly deps: ReconcilerDeps) {}

  private now(): Date {
    return (this.deps.clock ?? ((): Date => new Date()))();
  }

  /**
   * Apply incomplete effects for one committed intent. Idempotent on duplicate delivery.
   * Reconstructs exact intended CaseCommandPort / SlaClockPort calls from durable state.
   */
  async reconcileIntent(ctx: TenantContext, intentId: string): Promise<ReconcileResult> {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp019Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    if (ctx.tenant_id === null) throw new Cmp019Error('SF-TEN-001');

    const loaded = await this.deps.repo.withTx(ctx, async (tx) => {
      const row = await tx.getReconciliationIntent(intentId);
      if (!row) throw new Cmp019Error('SF-SYS-002', detail('RECONCILIATION_INTENT_NOT_FOUND'));
      if (row.tenant_id !== ctx.tenant_id) throw new Cmp019Error('SF-TEN-002');
      const already = await tx.hasInbox(RECONCILIATION_CONSUMER_GROUP, row.source_event_id);
      return { row, already };
    });

    let row = loaded.row;
    if (loaded.already && intentComplete(row)) {
      return {
        intent_id: row.intent_id,
        source_event_id: row.source_event_id,
        case_effect_status: row.case_effect_status,
        sla_effect_status: row.sla_effect_status,
        notification_effect_status: row.notification_effect_status,
        replayed: true,
        reconstructed_from_durable_state: true,
      };
    }

    // Apply incomplete effects outside the authoritative transaction (ports may network).
    if (isIncomplete(row.case_effect_status) && row.case_command) {
      try {
        await this.deps.caseCommands.executeCommand(
          ctx,
          row.application_id,
          {
            command: row.case_command,
            expected_state: row.case_expected_state as string,
            expected_version: row.case_expected_version as number,
            reason_code: row.case_reason_code,
          },
          row.case_idempotency_key as string,
        );
        row = await this.mark(ctx, row.intent_id, { case_effect_status: 'APPLIED' });
      } catch (err) {
        if (isStale(err)) {
          row = await this.mark(ctx, row.intent_id, {
            case_effect_status: 'FAILED_STALE',
            last_error_code: sanitizeErrorCode(err),
          });
        } else {
          row = await this.mark(ctx, row.intent_id, {
            case_effect_status: 'FAILED_RETRYABLE',
            last_error_code: sanitizeErrorCode(err),
          });
        }
      }
    }

    if (isIncomplete(row.sla_effect_status) && row.sla_kind) {
      const command = {
        application_id: row.application_id,
        stage_code: row.sla_stage_code as string,
        reason_code: row.sla_reason_code as string,
        idempotency_key: row.sla_idempotency_key as string,
      };
      try {
        if (row.sla_kind === 'pause') await this.deps.slaClock.pauseForDeficiency(ctx, command);
        else await this.deps.slaClock.resumeAfterDeficiency(ctx, command);
        row = await this.mark(ctx, row.intent_id, { sla_effect_status: 'APPLIED' });
      } catch (err) {
        row = await this.mark(ctx, row.intent_id, {
          sla_effect_status: 'FAILED_RETRYABLE',
          last_error_code:
            errorCode(err)
              .replace(/[^A-Z0-9_]/g, '')
              .slice(0, 64) || 'PORT_FAILURE',
        });
      }
    }

    if (isIncomplete(row.notification_effect_status) && row.notification_kind) {
      try {
        await this.deps.notifier.requestNotification({
          notification_port: 'M06_CMP025',
          tenant_id: row.tenant_id,
          application_id: row.application_id,
          deficiency_id: row.deficiency_id,
          kind: row.notification_kind,
          source_event_id: row.source_event_id,
        });
        row = await this.mark(ctx, row.intent_id, { notification_effect_status: 'APPLIED' });
      } catch (err) {
        row = await this.mark(ctx, row.intent_id, {
          notification_effect_status: 'FAILED_RETRYABLE',
          last_error_code:
            errorCode(err)
              .replace(/[^A-Z0-9_]/g, '')
              .slice(0, 64) || 'PORT_FAILURE',
        });
      }
    }

    // Record inbox when no incomplete effects remain (including FAILED_STALE terminal).
    const stillIncomplete =
      isIncomplete(row.case_effect_status) ||
      isIncomplete(row.sla_effect_status) ||
      isIncomplete(row.notification_effect_status);
    if (!stillIncomplete) {
      await this.deps.repo.withTx(ctx, async (tx) => {
        await tx.recordInbox(RECONCILIATION_CONSUMER_GROUP, row.source_event_id);
      });
    }

    return {
      intent_id: row.intent_id,
      source_event_id: row.source_event_id,
      case_effect_status: row.case_effect_status,
      sla_effect_status: row.sla_effect_status,
      notification_effect_status: row.notification_effect_status,
      replayed: false,
      reconstructed_from_durable_state: true,
    };
  }

  /** Crash-recovery drain: reconcile every incomplete intent for the tenant. */
  async reconcilePending(ctx: TenantContext, limit = 50): Promise<ReconcileResult[]> {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp019Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    const pending = await this.deps.repo.withTx(ctx, (tx) =>
      tx.listPendingReconciliationIntents(limit),
    );
    const results: ReconcileResult[] = [];
    for (const intent of pending) {
      results.push(await this.reconcileIntent(ctx, intent.intent_id));
    }
    return results;
  }

  private async mark(
    ctx: TenantContext,
    intentId: string,
    patch: {
      case_effect_status?: EffectStatus;
      sla_effect_status?: EffectStatus;
      notification_effect_status?: EffectStatus;
      last_error_code?: string | null;
    },
  ): Promise<ReconciliationIntentRow> {
    return this.deps.repo.withTx(ctx, async (tx) => {
      await tx.updateReconciliationEffects({
        intentId,
        ...patch,
        now: this.now(),
      });
      const row = await tx.getReconciliationIntent(intentId);
      if (!row) throw new Cmp019Error('SF-SYS-002');
      return row;
    });
  }
}
