import { randomUUID } from 'node:crypto';
import type { Actor, AuditEvent, TenantContext } from './types.js';

export interface AuditWriter {
  insertOutbox(envelope: unknown, topic: string): Promise<void>;
}

export function auditEvent(
  ctx: TenantContext,
  opts: {
    action: string;
    actionClass?: AuditEvent['action_class'];
    resourceType: string;
    resourceId: string;
    result: AuditEvent['result'];
    now: Date;
  },
): AuditEvent {
  const event: AuditEvent = {
    audit_id: randomUUID(),
    occurred_at: opts.now.toISOString(),
    tenant_id: ctx.tenant_id,
    cell_id: ctx.cell_id,
    actor_type: ctx.actor.type,
    actor_id: ctx.actor.id,
    action: opts.action,
    resource_type: opts.resourceType,
    resource_id: opts.resourceId,
    correlation_id: ctx.correlation_id,
    trace_id: ctx.trace_id,
    result: opts.result,
    classification: 'TENANT_SCOPED',
  };
  if (opts.actionClass !== undefined) {
    event.action_class = opts.actionClass;
  }
  return event;
}

export async function appendAudit(
  tx: AuditWriter,
  ctx: TenantContext,
  opts: {
    action: string;
    actionClass?: AuditEvent['action_class'];
    resourceType: string;
    resourceId: string;
    result: AuditEvent['result'];
    now: Date;
  },
): Promise<void> {
  const event = auditEvent(ctx, opts);
  const actor: Actor = ctx.actor;
  await tx.insertOutbox(
    {
      event_id: randomUUID(),
      event_type: 'AuditEvent',
      schema_version: 1,
      tenant_id: null,
      cell_id: ctx.cell_id,
      aggregate_type: 'AuditEvent',
      aggregate_id: event.audit_id,
      aggregate_version: 0,
      occurred_at: event.occurred_at,
      correlation_id: ctx.correlation_id,
      actor,
      data: event,
    },
    'sf.audit.ingest.v1',
  );
}
