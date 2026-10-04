import { randomUUID } from 'node:crypto';
import { validate, type AuditEvent, type RequestContext } from '@serviceform/contracts';
import { Cmp013Error } from './errors.js';
import { envelopeOf, TOPIC_AUDIT } from './outbox.js';
import type { UploadTx } from './repo/types.js';

export async function appendAudit(
  tx: UploadTx,
  ctx: RequestContext,
  params: {
    action: string;
    actionClass: NonNullable<AuditEvent['action_class']>;
    resourceType: string;
    resourceId: string;
    result: AuditEvent['result'];
    reason?: string;
    now: Date;
  },
): Promise<void> {
  const event: AuditEvent = {
    audit_id: randomUUID(),
    occurred_at: params.now.toISOString(),
    tenant_id: ctx.tenant_id,
    cell_id: ctx.cell_id,
    actor_type: ctx.actor.type,
    actor_id: ctx.actor.id,
    action: params.action,
    action_class: params.actionClass,
    resource_type: params.resourceType,
    resource_id: params.resourceId,
    correlation_id: ctx.correlation_id,
    trace_id: ctx.trace_id,
    result: params.result,
    classification: 'TENANT_SCOPED',
  };
  if (params.reason) event.reason = params.reason;
  if (!validate('audit-event', event).valid) {
    throw new Cmp013Error('SF-SYS-001', { details: [{ code: 'INVALID_AUDIT' }] });
  }
  if (ctx.tenant_id === null) throw new Cmp013Error('SF-TEN-001');
  const env = envelopeOf({
    eventType: 'AuditEventSubmitted',
    tenantId: ctx.tenant_id,
    cellId: ctx.cell_id,
    aggregateType: 'AuditEvent',
    aggregateId: event.audit_id,
    aggregateVersion: 1,
    occurredAt: event.occurred_at,
    correlationId: event.correlation_id,
    actor: ctx.actor,
    data: event,
  });
  await tx.insertOutbox(env, TOPIC_AUDIT);
}
