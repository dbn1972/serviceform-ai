import type { EventEnvelope } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import { AuditClientError } from './errors.js';
import { AUDIT_INGEST_TOPIC } from './envelope.js';

export interface OutboxInsertValues {
  event_id: string;
  tenant_id: string | null;
  topic: string;
  partition_key: string;
  event_type: string;
  schema_version: number;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  envelope: EventEnvelope;
}

/** Column values for the producer's own outbox. Does not write SQL. */
export function toOutboxRow<T extends object>(
  envelope: EventEnvelope<T>,
  topic = AUDIT_INGEST_TOPIC,
): OutboxInsertValues {
  const data = envelope.data as unknown as Record<string, unknown>;
  const auditId = typeof data['audit_id'] === 'string' ? data['audit_id'] : envelope.aggregate_id;
  const values: OutboxInsertValues = {
    event_id: envelope.event_id,
    tenant_id: envelope.tenant_id,
    topic,
    partition_key: `audit:${auditId}`,
    event_type: envelope.event_type,
    schema_version: envelope.schema_version,
    aggregate_type: envelope.aggregate_type,
    aggregate_id: envelope.aggregate_id,
    aggregate_version: envelope.aggregate_version,
    envelope: envelope as EventEnvelope,
  };
  const record = {
    seq: 1,
    event_id: values.event_id,
    topic: values.topic,
    partition_key: values.partition_key,
    event_type: values.event_type,
    schema_version: values.schema_version,
    aggregate_type: values.aggregate_type,
    aggregate_id: values.aggregate_id,
    aggregate_version: values.aggregate_version,
    envelope: values.envelope,
    status: 'PENDING',
    attempts: 0,
    next_attempt_at: envelope.occurred_at,
    created_at: envelope.occurred_at,
    ...(values.tenant_id === null ? {} : { tenant_id: values.tenant_id }),
  };
  const check = validate('outbox-record', record);
  if (!check.valid) {
    throw new AuditClientError('SF-SYS-003', 'Invalid outbox row');
  }
  return values;
}
