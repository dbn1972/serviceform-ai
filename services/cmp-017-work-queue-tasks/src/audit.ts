import { randomUUID } from 'node:crypto';
import { validate, type AuditEvent } from './contracts.js';
import type { AuthzRecord } from './authz.js';
import type { TenantContext } from './context.js';
import { Cmp017Error, detail } from './errors.js';
import { envelopeOf, TOPIC_AUDIT } from './outbox.js';
import type { TaskWriteTx } from './repo/types.js';

export interface AuditParams {
  action: string;
  actionClass: NonNullable<AuditEvent['action_class']>;
  resourceId: string;
  result: AuditEvent['result'];
  authz: AuthzRecord | null;
  reason?: string;
  organisationId?: string;
  jurisdictionId?: string;
  afterRef?: string;
  now: Date;
}

/** ADR-0005: audit carries the exact policy_revision, decision and reason code of the action. */
export function authzReason(authz: AuthzRecord | null, extra?: string): string | undefined {
  const parts: string[] = [];
  if (authz) {
    parts.push(
      `policy_revision=${authz.policy_revision}`,
      `decision_id=${authz.decision_id}`,
      `reason_code=${authz.reason_code}`,
    );
  }
  if (extra) parts.push(extra);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

export async function appendAudit(
  tx: TaskWriteTx,
  ctx: TenantContext,
  params: AuditParams,
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
    resource_type: 'HumanTask',
    resource_id: params.resourceId,
    correlation_id: ctx.correlation_id,
    trace_id: ctx.trace_id,
    result: params.result,
    classification: 'TENANT_SCOPED',
  };
  if (params.organisationId) event.organisation_id = params.organisationId;
  if (params.jurisdictionId) event.jurisdiction_id = params.jurisdictionId;
  if (params.afterRef) event.after_ref = params.afterRef;
  const reason = authzReason(params.authz, params.reason);
  if (reason) event.reason = reason;
  if (!validate('audit-event', event).valid) {
    throw new Cmp017Error('SF-SYS-001', detail('INVALID_AUDIT'));
  }
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
