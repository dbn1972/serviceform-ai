import { randomUUID } from 'node:crypto';
import { validate, type AuditEvent, type RequestContext } from '@serviceform/contracts';
import type { PoolClient } from 'pg';
import { envelopeOf, insertOutbox, TOPIC_AUDIT } from './db/outbox.js';
import { Cmp051Error } from './errors.js';

export async function appendAudit(
  tx: PoolClient,
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
  const checked = validate('audit-event', event);
  if (!checked.valid) throw new Cmp051Error('SF-SYS-001', { details: [{ code: 'INVALID_AUDIT' }] });
  const env = envelopeOf({
    eventType: 'AuditEventSubmitted',
    tenantId: event.tenant_id as string,
    cellId: event.cell_id,
    aggregateType: 'AuditEvent',
    aggregateId: event.audit_id,
    aggregateVersion: 1,
    occurredAt: event.occurred_at,
    correlationId: event.correlation_id,
    actor: { type: event.actor_type, id: event.actor_id },
    data: event,
  });
  await insertOutbox(tx, env, TOPIC_AUDIT);
}
