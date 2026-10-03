import { randomUUID } from 'node:crypto';
import type { AuditEvent, RequestContext } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import { AuditClientError } from './errors.js';
import { assertEventFreeText } from './pii-guard.js';

export type AuditEventInput = Omit<
  AuditEvent,
  'audit_id' | 'tenant_id' | 'cell_id' | 'actor_type' | 'actor_id' | 'correlation_id' | 'trace_id'
> & {
  tenant_id?: string | null;
  occurred_at: string;
  action: string;
  resource_type: string;
  resource_id: string;
  result: AuditEvent['result'];
};

export interface BuildResult {
  event: AuditEvent;
  dropped_client_context: boolean;
}

function rejectNul(label: string, value: string): void {
  if (value.includes('\u0000')) {
    throw new AuditClientError('SF-SYS-003', `NUL in ${label}`);
  }
}

/**
 * Fills tenant/cell/actor/correlation/trace from the server context. Never trusts caller
 * identity fields. Drops client_context (O-3) after accepting it.
 */
export function buildAuditEvent(ctx: RequestContext, input: AuditEventInput): BuildResult {
  if (ctx.tenant_id !== null && input.tenant_id === null) {
    throw new AuditClientError('SF-TEN-002', 'Null-tenant audit refused for tenant context');
  }
  rejectNul('action', input.action);
  rejectNul('resource_id', input.resource_id);
  const event: AuditEvent = {
    audit_id: randomUUID(),
    occurred_at: input.occurred_at,
    tenant_id: ctx.tenant_id,
    cell_id: ctx.cell_id,
    actor_type: ctx.actor.type,
    actor_id: ctx.actor.id,
    action: input.action,
    resource_type: input.resource_type,
    resource_id: input.resource_id,
    correlation_id: ctx.correlation_id,
    trace_id: ctx.trace_id,
    result: input.result,
  };
  if (ctx.organisation_id !== undefined) event.organisation_id = ctx.organisation_id;
  if (ctx.office_id !== undefined) event.office_id = ctx.office_id;
  if (input.action_class !== undefined) event.action_class = input.action_class;
  if (input.before_ref !== undefined) event.before_ref = input.before_ref;
  if (input.after_ref !== undefined) event.after_ref = input.after_ref;
  if (input.reason !== undefined) event.reason = input.reason;
  if (input.classification !== undefined) event.classification = input.classification;
  if (input.jurisdiction_id !== undefined) event.jurisdiction_id = input.jurisdiction_id;
  const dropped = input.client_context !== undefined;
  const check = validate('audit-event', event);
  if (!check.valid) {
    throw new AuditClientError('SF-SYS-003', 'Request validation failed');
  }
  assertEventFreeText(event);
  return { event, dropped_client_context: dropped };
}
