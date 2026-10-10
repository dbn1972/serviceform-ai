import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import { NOTIFICATION_ACTIONS } from '../authz.js';
import { backoffMs, LEASE_MS } from '../domain/model.js';
import { isSimulationMarker, type ConnectorBindingView } from '../domain/simulation.js';
import { renderTemplate, type Rendered } from '../domain/template.js';
import { Cmp025Error, detail } from '../errors.js';
import type { DomainEventType } from '../outbox.js';
import type { ChannelConnector, SendResult } from '../ports/channel-connector.js';
import type { AttemptRow, DispatchRow, TemplateRow } from '../repo/types.js';
import type { TenantContext } from '../types.js';
import { assertBindingPolicy } from '../domain/simulation.js';
import type { NotificationService } from './service.js';

export interface DeliverySummary {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  lostLease: number;
}

type Outcome =
  | { kind: 'ACCEPTED'; providerMessageRef: string }
  | { kind: 'TRANSIENT'; errorCode: string }
  | { kind: 'PERMANENT'; errorCode: string };

const DEFAULT_SEND_TIMEOUT_MS = 10_000;

/**
 * Drains due dispatches for one tenant. Sequence per row: short claim tx (lease) -> provider I/O with
 * no transaction open -> short finalize tx. Delivery is at-least-once: an expired lease makes the row
 * claimable again and the provider idempotency key is the dispatch id.
 */
export class NotificationDeliveryWorker {
  constructor(private readonly service: NotificationService) {}

  private get deps(): NotificationService['deps'] {
    return this.service.deps;
  }

  async deliverDue(ctx: TenantContext, opts: { limit?: number } = {}): Promise<DeliverySummary> {
    this.service.assertActor(ctx, ['SYSTEM']);
    await this.service.guard(ctx, NOTIFICATION_ACTIONS.deliver, 'NotificationDispatch');
    const workerId = this.deps.workerId ?? `worker-${randomUUID()}`;
    const now = this.deps.clock();
    const claimed = await this.deps.repo.withTx(ctx, (tx) =>
      tx.claimDue({ limit: opts.limit ?? 10, now, leaseOwner: workerId, leaseMs: LEASE_MS }),
    );
    const summary: DeliverySummary = {
      claimed: claimed.length,
      sent: 0,
      retried: 0,
      failed: 0,
      lostLease: 0,
    };
    for (const row of claimed) {
      const result = await this.processOne(ctx, row, workerId);
      summary[result] += 1;
    }
    return summary;
  }

  private async processOne(
    ctx: TenantContext,
    row: DispatchRow,
    workerId: string,
  ): Promise<'sent' | 'retried' | 'failed' | 'lostLease'> {
    const outcome = await this.attemptSend(ctx, row);
    return this.finalize(ctx, row, workerId, outcome);
  }

  private async attemptSend(ctx: TenantContext, row: DispatchRow): Promise<Outcome> {
    if (row.attempts > row.max_attempts) {
      return { kind: 'PERMANENT', errorCode: 'MAX_ATTEMPTS_EXCEEDED' };
    }
    let binding: ConnectorBindingView;
    try {
      binding = await this.service.resolveBinding(
        ctx.tenant_id,
        row.connector_binding_id,
        row.channel,
      );
    } catch (err) {
      return isUnavailable(err)
        ? { kind: 'TRANSIENT', errorCode: 'CONNECTOR_BINDING_UNAVAILABLE' }
        : { kind: 'PERMANENT', errorCode: refusalCode(err) };
    }
    if (binding.mode !== row.connector_mode) {
      return { kind: 'PERMANENT', errorCode: 'CONNECTOR_MODE_DRIFT' };
    }
    let connector: ChannelConnector | null;
    try {
      assertBindingPolicy(binding, {
        tenantId: ctx.tenant_id,
        channel: row.channel,
        runtimeEnvironment: this.deps.environment,
      });
      connector = this.deps.connectors.forBinding(binding);
    } catch (err) {
      return { kind: 'PERMANENT', errorCode: refusalCode(err) };
    }
    if (connector === null) return { kind: 'TRANSIENT', errorCode: 'CONNECTOR_NOT_BOUND' };
    if (connector.mode === 'SIMULATED' && !isSimulationMarker(connector.simulation)) {
      return { kind: 'PERMANENT', errorCode: 'SIMULATION_MARKER_MISSING' };
    }
    if (connector.mode !== row.connector_mode) {
      return { kind: 'PERMANENT', errorCode: 'CONNECTOR_MODE_DRIFT' };
    }

    const template = await this.deps.repo.withTx(ctx, (tx) =>
      tx.getTemplate(row.template_ref, row.channel, row.locale, row.template_version),
    );
    let rendered: Rendered;
    try {
      rendered = renderPinned(template, row);
    } catch {
      return {
        kind: 'PERMANENT',
        errorCode: template ? 'TEMPLATE_RENDER_FAILED' : 'TEMPLATE_MISSING',
      };
    }

    const signal = AbortSignal.timeout(this.deps.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS);
    let address: string;
    try {
      const resolved = await this.deps.recipients.resolve({
        tenantId: ctx.tenant_id,
        handleClass: row.recipient_handle_class,
        handleRef: row.recipient_handle_ref,
        channel: row.channel,
        signal,
      });
      if (resolved === null) return { kind: 'PERMANENT', errorCode: 'RECIPIENT_UNRESOLVED' };
      address = resolved.address;
    } catch {
      return { kind: 'TRANSIENT', errorCode: 'RECIPIENT_DIRECTORY_UNAVAILABLE' };
    }

    let result: SendResult;
    try {
      result = await connector.send({
        tenantId: ctx.tenant_id,
        dispatchId: row.dispatch_id,
        attemptNo: row.attempts,
        channel: row.channel,
        locale: row.locale,
        address,
        recipientHandleRef: row.recipient_handle_ref,
        subject: rendered.subject,
        body: rendered.body,
        providerIdempotencyKey: row.dispatch_id,
        signal,
      });
    } catch {
      return { kind: 'TRANSIENT', errorCode: 'CONNECTOR_ERROR' };
    }
    if (result.status === 'ACCEPTED') {
      return { kind: 'ACCEPTED', providerMessageRef: result.providerMessageRef };
    }
    return {
      kind: result.status === 'TRANSIENT_FAILURE' ? 'TRANSIENT' : 'PERMANENT',
      errorCode: result.errorCode,
    };
  }

  private async finalize(
    ctx: TenantContext,
    claimed: DispatchRow,
    workerId: string,
    outcome: Outcome,
  ): Promise<'sent' | 'retried' | 'failed' | 'lostLease'> {
    const now = this.deps.clock();
    const nowIso = now.toISOString();
    const result = await this.deps.repo.withTx(ctx, async (tx) => {
      const current = await tx.getDispatch(claimed.dispatch_id);
      if (
        !current ||
        current.status !== 'SENDING' ||
        current.lease_owner !== workerId ||
        current.attempts !== claimed.attempts
      ) {
        return 'lostLease' as const;
      }
      const attempt: AttemptRow = {
        dispatch_id: current.dispatch_id,
        attempt_no: current.attempts,
        outcome:
          outcome.kind === 'ACCEPTED'
            ? 'ACCEPTED'
            : outcome.kind === 'TRANSIENT'
              ? 'TRANSIENT_FAILURE'
              : 'PERMANENT_FAILURE',
        error_code: outcome.kind === 'ACCEPTED' ? null : outcome.errorCode,
        provider_message_ref: outcome.kind === 'ACCEPTED' ? outcome.providerMessageRef : null,
        connector_mode: current.connector_mode,
        simulation_marker: current.simulation_marker,
        occurred_at: nowIso,
        correlation_id: ctx.correlation_id,
      };
      const base = {
        ...current,
        lease_owner: null,
        lease_expires_at: null,
        aggregate_version: current.aggregate_version + 1,
        updated_at: nowIso,
      };
      let next: DispatchRow;
      let event: DomainEventType;
      let tag: 'sent' | 'retried' | 'failed';
      if (outcome.kind === 'ACCEPTED') {
        next = {
          ...base,
          status: 'SENT',
          sent_at: nowIso,
          provider_message_ref: outcome.providerMessageRef,
          last_error_code: null,
        };
        event = 'NotificationSent';
        tag = 'sent';
      } else if (outcome.kind === 'TRANSIENT' && current.attempts < current.max_attempts) {
        next = {
          ...base,
          status: 'QUEUED',
          last_error_code: outcome.errorCode,
          next_attempt_at: new Date(now.getTime() + backoffMs(current.attempts)).toISOString(),
        };
        event = 'NotificationRetryScheduled';
        tag = 'retried';
      } else {
        next = { ...base, status: 'FAILED', last_error_code: outcome.errorCode };
        event = 'NotificationFailed';
        tag = 'failed';
      }
      await tx.insertAttempt(attempt);
      await tx.updateDispatch(next);
      await this.service.emitDispatchEvent(tx, ctx, next, event);
      if (tag !== 'retried') {
        await appendAudit(tx, ctx, {
          action: tag === 'sent' ? 'NOTIFICATION_SENT' : 'NOTIFICATION_FAILED',
          actionClass: 'WRITE',
          resourceType: 'NotificationDispatch',
          resourceId: next.dispatch_id,
          result: tag === 'sent' ? 'SUCCESS' : 'FAILED',
          ...(tag === 'failed' && next.last_error_code ? { reason: next.last_error_code } : {}),
          now,
        });
      }
      return tag;
    });
    this.service.logger.info({
      event: 'notification.delivery.attempt',
      tenant_id: ctx.tenant_id,
      dispatch_id: claimed.dispatch_id,
      correlation_id: ctx.correlation_id,
      channel: claimed.channel,
      connector_mode: claimed.connector_mode,
      attempt: claimed.attempts,
      outcome: result,
      error_code: outcome.kind === 'ACCEPTED' ? null : outcome.errorCode,
    });
    return result;
  }
}

function renderPinned(template: TemplateRow | undefined, row: DispatchRow): Rendered {
  if (!template) throw new Cmp025Error('SF-SYS-002', detail('TEMPLATE_MISSING'));
  return renderTemplate(template, row.template_params);
}

const TRANSIENT_REFUSALS = new Set([
  'CONNECTOR_BINDING_UNAVAILABLE',
  'CONNECTOR_BINDING_PORT_UNBOUND',
]);

function isUnavailable(err: unknown): boolean {
  return (
    err instanceof Cmp025Error && err.details?.some((d) => TRANSIENT_REFUSALS.has(d.code)) === true
  );
}

function refusalCode(err: unknown): string {
  if (err instanceof Cmp025Error) {
    const code = err.details?.[0]?.code;
    if (code && /^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return code;
    if (err.code === 'SF-TEN-002') return 'CROSS_TENANT_BINDING';
  }
  return 'CONNECTOR_POLICY_REFUSED';
}
