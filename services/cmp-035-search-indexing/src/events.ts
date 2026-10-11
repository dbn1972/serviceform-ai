import { randomUUID } from 'node:crypto';
import { Cmp035Error, detail } from './errors.js';
import {
  isAuditEvent,
  isEventEnvelope,
  type Actor,
  type AuditActionClass,
  type AuditEvent,
  type AuditResult,
  type EventEnvelope,
} from './domain/validate.js';

export const TOPIC_DOMAIN = 'sf.search.events.v1';
export const TOPIC_AUDIT = 'sf.audit.ingest.v1';
export const AGGREGATE_TYPE = 'SearchDocument';
export const RESOURCE_TYPE = 'SearchDocument';
export const INDEXER_CONSUMER_GROUP = 'cmp-035.indexer';

export const EVENT_TYPES = {
  indexed: 'SearchDocumentIndexed',
  removed: 'SearchDocumentRemoved',
  audit: 'AuditEventSubmitted',
} as const;

/** Tenant-scoped producer identity for envelopes CMP-035 writes to its outbox. */
export interface EventContext {
  tenant_id: string;
  cell_id: string;
  actor: Actor;
  correlation_id: string;
  trace_id: string;
}

export function envelopeOf<T extends object>(params: {
  eventType: string;
  ctx: EventContext;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  aggregateType?: string;
  causationId?: string;
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
  if (params.causationId !== undefined) env.causation_id = params.causationId;
  if (!isEventEnvelope(env)) {
    throw new Cmp035Error('SF-SYS-001', { details: detail('INVALID_ENVELOPE') });
  }
  return env;
}

export function auditEnvelope(
  ctx: EventContext,
  params: {
    action: string;
    actionClass: AuditActionClass;
    resourceId: string;
    result: AuditResult;
    occurredAt: string;
    afterRef?: string;
    causationId?: string;
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
  if (params.afterRef) event.after_ref = params.afterRef;
  if (!isAuditEvent(event)) {
    throw new Cmp035Error('SF-SYS-001', { details: detail('INVALID_AUDIT') });
  }
  const audit: Parameters<typeof envelopeOf<AuditEvent>>[0] = {
    eventType: EVENT_TYPES.audit,
    ctx,
    aggregateType: 'AuditEvent',
    aggregateId: event.audit_id,
    aggregateVersion: 1,
    occurredAt: event.occurred_at,
    data: event,
  };
  if (params.causationId !== undefined) audit.causationId = params.causationId;
  return envelopeOf(audit);
}
