import { randomUUID } from 'node:crypto';
import type { AuditEvent, EventEnvelope } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import { AuditClientError } from './errors.js';

export const AUDIT_INGEST_TOPIC = 'sf.audit.ingest.v1';
export const AUDIT_EVENT_TYPE = 'AuditEventSubmitted';

export function toSubmittedEnvelope(event: AuditEvent): EventEnvelope<AuditEvent> {
  const envelope: EventEnvelope<AuditEvent> = {
    event_id: randomUUID(),
    event_type: AUDIT_EVENT_TYPE,
    schema_version: 1,
    tenant_id: event.tenant_id,
    cell_id: event.cell_id,
    aggregate_type: 'AuditEvent',
    aggregate_id: event.audit_id,
    aggregate_version: 0,
    occurred_at: event.occurred_at,
    correlation_id: event.correlation_id,
    actor: { type: event.actor_type, id: event.actor_id },
    data: event,
  };
  const check = validate('event-envelope', envelope);
  if (!check.valid) {
    throw new AuditClientError('SF-SYS-003', 'Invalid AuditEventSubmitted envelope');
  }
  return envelope;
}
