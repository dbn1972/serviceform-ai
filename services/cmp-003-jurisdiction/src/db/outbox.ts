import { randomUUID } from 'node:crypto';
import { validate, type Actor, type EventEnvelope } from '@serviceform/contracts';
import type { PoolClient } from 'pg';
import { Cmp003Error } from '../errors.js';

export const TOPIC_DOMAIN = 'sf.jurisdiction.events.v1';
export const TOPIC_AUDIT = 'sf.audit.ingest.v1';

export function envelopeOf<T extends object>(params: {
  eventType: string;
  tenantId: string | null;
  cellId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  correlationId: string;
  actor: Actor;
  data: T;
}): EventEnvelope<T> {
  return {
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
}

export async function insertOutbox(
  client: PoolClient,
  envelope: EventEnvelope<object>,
  topic: string,
): Promise<void> {
  const checked = validate('event-envelope', envelope);
  if (!checked.valid)
    throw new Cmp003Error('SF-SYS-001', { details: [{ code: 'INVALID_ENVELOPE' }] });
  if (envelope.tenant_id === null) {
    await client.query(
      `INSERT INTO sf_jurisdiction.outbox_event_platform (
         event_id, topic, partition_key, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, envelope
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        envelope.event_id,
        topic,
        topic === TOPIC_AUDIT
          ? `audit:${String((envelope.data as { audit_id?: string }).audit_id ?? envelope.aggregate_id)}`
          : envelope.aggregate_id,
        envelope.event_type,
        envelope.schema_version,
        envelope.aggregate_type,
        envelope.aggregate_id,
        envelope.aggregate_version,
        JSON.stringify(envelope),
      ],
    );
    return;
  }
  await client.query(
    `INSERT INTO sf_jurisdiction.outbox_event (
       event_id, tenant_id, topic, partition_key, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, envelope
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [
      envelope.event_id,
      envelope.tenant_id,
      topic,
      envelope.aggregate_id,
      envelope.event_type,
      envelope.schema_version,
      envelope.aggregate_type,
      envelope.aggregate_id,
      envelope.aggregate_version,
      JSON.stringify(envelope),
    ],
  );
}
