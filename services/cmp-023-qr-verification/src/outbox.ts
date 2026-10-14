import { randomUUID } from 'node:crypto';
import { Cmp023Error } from './errors.js';
import { isUuid } from './domain/uuid.js';
import type { Actor, EventEnvelope } from './types.js';

export const TOPIC_DOMAIN = 'sf.qr.events.v1';
export const TOPIC_AUDIT = 'sf.audit.ingest.v1';

export const DOMAIN_EVENT_TYPES = ['VerificationTokenIssued'] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

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
    !isUuid(envelope.aggregate_id) ||
    !isUuid(envelope.correlation_id) ||
    envelope.aggregate_version < 0 ||
    Number.isNaN(Date.parse(envelope.occurred_at))
  ) {
    throw new Cmp023Error('SF-SYS-001', { details: [{ code: 'INVALID_ENVELOPE' }] });
  }
  return envelope;
}
