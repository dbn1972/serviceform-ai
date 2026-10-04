import type { EventEnvelope } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import type { PoolClient } from 'pg';
import { AuditError } from '../domain/errors.js';

const EVENTS_TOPIC = 'sf.audit.events.v1';

export async function insertAuditRecordCreated(
  client: PoolClient,
  envelope: EventEnvelope,
): Promise<void> {
  const check = validate('event-envelope', envelope);
  if (!check.valid) {
    throw new AuditError('SF-SYS-003', {
      details: [{ code: 'INVALID_ENVELOPE' }],
    });
  }
  if (envelope.tenant_id === null) {
    await client.query(
      `INSERT INTO sf_audit.outbox_event_platform
         (event_id, topic, partition_key, event_type, schema_version,
          aggregate_type, aggregate_id, aggregate_version, envelope)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        envelope.event_id,
        EVENTS_TOPIC,
        `audit:${envelope.aggregate_id}`,
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
    `INSERT INTO sf_audit.outbox_event
       (event_id, tenant_id, topic, partition_key, event_type, schema_version,
        aggregate_type, aggregate_id, aggregate_version, envelope)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      envelope.event_id,
      envelope.tenant_id,
      EVENTS_TOPIC,
      `audit:${envelope.aggregate_id}`,
      envelope.event_type,
      envelope.schema_version,
      envelope.aggregate_type,
      envelope.aggregate_id,
      envelope.aggregate_version,
      JSON.stringify(envelope),
    ],
  );
}

export async function insertInbox(
  client: PoolClient,
  eventId: string,
  tenantId: string | null,
): Promise<boolean> {
  if (tenantId === null) {
    const res = await client.query(
      `INSERT INTO sf_audit.inbox_event_platform (consumer_group, event_id)
       VALUES ('cmp-031-audit-ingest', $1)
       ON CONFLICT DO NOTHING`,
      [eventId],
    );
    return (res.rowCount ?? 0) > 0;
  }
  const res = await client.query(
    `INSERT INTO sf_audit.inbox_event (consumer_group, event_id, tenant_id)
     VALUES ('cmp-031-audit-ingest', $1, $2)
     ON CONFLICT DO NOTHING`,
    [eventId, tenantId],
  );
  return (res.rowCount ?? 0) > 0;
}
