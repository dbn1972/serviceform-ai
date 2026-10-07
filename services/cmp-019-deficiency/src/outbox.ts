import { randomUUID } from 'node:crypto';
import { Cmp019Error } from './errors.js';
import type { Actor, EventEnvelope } from './types.js';

export const TOPIC_DOMAIN = 'sf.deficiency.events.v1';
export const TOPIC_AUDIT = 'sf.audit.ingest.v1';

export const DOMAIN_EVENT_TYPES = [
  'DeficiencyOpened',
  'DeficiencyResponded',
  'DeficiencyClosed',
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (
    !UUID_SHAPE.test(envelope.aggregate_id) ||
    !UUID_SHAPE.test(envelope.correlation_id) ||
    envelope.aggregate_version < 0 ||
    Number.isNaN(Date.parse(envelope.occurred_at))
  ) {
    throw new Cmp019Error('SF-SYS-001', { details: [{ code: 'INVALID_ENVELOPE' }] });
  }
  return envelope;
}
