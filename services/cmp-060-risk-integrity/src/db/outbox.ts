import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Cmp060Error } from '../errors.js';

export const TOPIC_DOMAIN = 'sf.risk.events.v1';

export interface RiskEventEnvelope<T extends object> {
  event_id: string;
  event_type: string;
  schema_version: number;
  tenant_id: string;
  cell_id: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  occurred_at: string;
  correlation_id: string;
  actor: { type: string; id: string };
  data: T;
}

export function envelopeOf<T extends object>(params: {
  eventType: string;
  tenantId: string;
  cellId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  correlationId: string;
  actor: { type: string; id: string };
  data: T;
}): RiskEventEnvelope<T> {
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

export async function insertOutbox<T extends object>(
  client: PoolClient,
  envelope: RiskEventEnvelope<T>,
): Promise<void> {
  if (!envelope.tenant_id) {
    throw new Cmp060Error('SF-TEN-001', { details: [{ code: 'TENANT_REQUIRED' }] });
  }
  await client.query(
    `INSERT INTO sf_risk.outbox_event (
       event_id, tenant_id, topic, partition_key, event_type, schema_version,
       aggregate_type, aggregate_id, aggregate_version, envelope
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [
      envelope.event_id,
      envelope.tenant_id,
      TOPIC_DOMAIN,
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
