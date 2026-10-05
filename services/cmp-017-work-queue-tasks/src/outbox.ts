import { randomUUID } from 'node:crypto';
import { validate, type Actor, type EventEnvelope } from './contracts.js';
import { Cmp017Error, detail } from './errors.js';

export const TOPIC_DOMAIN = 'sf.tasks.events.v1';
export const TOPIC_AUDIT = 'sf.audit.ingest.v1';

export function envelopeOf<T extends object>(params: {
  eventType: string;
  tenantId: string;
  cellId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  correlationId: string;
  actor: Actor;
  data: T;
}): EventEnvelope<T> {
  const envelope: EventEnvelope<T> = {
    event_id: randomUUID(),
    event_type: params.eventType,
    schema_version: 1,
    tenant_id: params.tenantId,
    cell_id: params.cellId,
    aggregate_type: params.aggregateType,
    aggregate_id: params.aggregateId,
    aggregate_version: params.aggregateVersion,
    occurred_at: params.occurredAt,
    correlation_id: params.correlationId,
    actor: params.actor,
    data: params.data,
  };
  if (!validate('event-envelope', envelope).valid) {
    throw new Cmp017Error('SF-SYS-001', detail('INVALID_ENVELOPE'));
  }
  return envelope;
}
