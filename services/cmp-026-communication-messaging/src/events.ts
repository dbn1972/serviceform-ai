import { randomUUID } from 'node:crypto';
import { Cmp026Error, detail } from './errors.js';
import {
  isAuditEvent,
  isEventEnvelope,
  type AuditActionClass,
  type AuditEvent,
  type AuditResult,
  type EventEnvelope,
  type TenantRequestContext,
} from './domain/validate.js';

export const TOPIC_DOMAIN = 'sf.messaging.events.v1';
export const TOPIC_AUDIT = 'sf.audit.ingest.v1';
export const AGGREGATE_TYPE = 'MessageThread';
export const RESOURCE_TYPE = 'MessageThread';

export const EVENT_TYPES = {
  threadOpened: 'ThreadOpened',
  threadStatusChanged: 'ThreadStatusChanged',
  participantAdded: 'ThreadParticipantAdded',
  participantRemoved: 'ThreadParticipantRemoved',
  messageSent: 'CaseMessageSent',
  messageRetracted: 'CaseMessageRetracted',
  noticeAcknowledged: 'NoticeAcknowledged',
  audit: 'AuditEventSubmitted',
} as const;

export function envelopeOf<T extends object>(params: {
  eventType: string;
  ctx: TenantRequestContext;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  aggregateType?: string;
  data: T;
}): EventEnvelope<T> {
  const env: EventEnvelope<T> = {
    event_id: randomUUID(),
    event_type: params.eventType,
    schema_version: 1,
    tenant_id: params.ctx.tenant_id,
    cell_id: params.ctx.cell_id,
    aggregate_type: params.aggregateType ?? AGGREGATE_TYPE,
    aggregate_id: params.aggregateId,
    aggregate_version: params.aggregateVersion,
    occurred_at: params.occurredAt,
    correlation_id: params.ctx.correlation_id,
    actor: { type: params.ctx.actor.type, id: params.ctx.actor.id },
    data: params.data,
  };
  if (!isEventEnvelope(env)) {
    throw new Cmp026Error('SF-SYS-001', { details: detail('INVALID_ENVELOPE') });
  }
  return env;
}

export function auditEnvelope(
  ctx: TenantRequestContext,
  params: {
    action: string;
    actionClass: AuditActionClass;
    resourceId: string;
    result: AuditResult;
    occurredAt: string;
    reason?: string;
    afterRef?: string;
  },
): EventEnvelope<AuditEvent> {
  const event: AuditEvent = {
    audit_id: randomUUID(),
    occurred_at: params.occurredAt,
    tenant_id: ctx.tenant_id,
    cell_id: ctx.cell_id,
    actor_type: ctx.actor.type,
    actor_id: ctx.actor.id,
    action: params.action,
    action_class: params.actionClass,
    resource_type: RESOURCE_TYPE,
    resource_id: params.resourceId,
    correlation_id: ctx.correlation_id,
    trace_id: ctx.trace_id,
    result: params.result,
    classification: 'TENANT_SCOPED',
  };
  if (ctx.organisation_id) event.organisation_id = ctx.organisation_id;
  if (ctx.office_id) event.office_id = ctx.office_id;
  if (params.reason) event.reason = params.reason;
  if (params.afterRef) event.after_ref = params.afterRef;
  if (!isAuditEvent(event)) {
    throw new Cmp026Error('SF-SYS-001', { details: detail('INVALID_AUDIT') });
  }
  return envelopeOf({
    eventType: EVENT_TYPES.audit,
    ctx,
    aggregateType: 'AuditEvent',
    aggregateId: event.audit_id,
    aggregateVersion: 1,
    occurredAt: event.occurred_at,
    data: event,
  });
}
