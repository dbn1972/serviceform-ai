import { randomUUID } from 'node:crypto';
import { envelopeOf, insertOutbox, TOPIC_AUDIT } from './db/outbox.js';
import type { SqlClient } from './db/tx.js';
import type { WorkflowContext } from './ports.js';

/** SF-CON-AUDIT-EVENT v1 record, submitted to CMP-031 through this component's outbox. */
export interface AuditEvent {
  audit_id: string;
  occurred_at: string;
  tenant_id: string;
  cell_id: string;
  actor_type: string;
  actor_id: string;
  action: string;
  action_class: 'READ' | 'WRITE' | 'DECISION' | 'OVERRIDE' | 'PRIVILEGED';
  resource_type: string;
  resource_id: string;
  correlation_id: string;
  trace_id: string;
  result: 'SUCCESS' | 'DENIED' | 'FAILED';
  classification: 'TENANT_SCOPED';
}

export function auditEvent(
  ctx: WorkflowContext,
  params: {
    action: string;
    actionClass: AuditEvent['action_class'];
    resourceType: string;
    resourceId: string;
    result: AuditEvent['result'];
    at: string;
  },
): AuditEvent {
  return {
    audit_id: randomUUID(),
    occurred_at: params.at,
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
}

export async function appendAudit(
  client: SqlClient,
  ctx: WorkflowContext,
  params: Parameters<typeof auditEvent>[1],
): Promise<void> {
  const event = auditEvent(ctx, params);
  await insertOutbox(
    client,
    envelopeOf(ctx, {
      eventType: 'AuditEventSubmitted',
      aggregateType: 'AuditEvent',
      aggregateId: event.audit_id,
      aggregateVersion: 1,
      occurredAt: event.occurred_at,
      data: event,
    }),
    TOPIC_AUDIT,
  );
}
