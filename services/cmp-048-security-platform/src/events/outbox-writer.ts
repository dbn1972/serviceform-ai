import type { PoolClient } from 'pg';

// replaced by packages/outbox at stitching

export async function writeOutbox(
  c: PoolClient,
  ev: {
    event_id: string;
    tenant_id: string | null;
    event_type: string;
    schema_version: number;
    aggregate_type: string;
    aggregate_id: string;
    aggregate_version: number;
  },
  topic: string,
): Promise<void> {
  if (ev.tenant_id === null) {
    await c.query(
      `INSERT INTO sf_security.outbox_event_platform
        (event_id, topic, partition_key, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, envelope)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        ev.event_id,
        topic,
        ev.aggregate_id,
        ev.event_type,
        ev.schema_version,
        ev.aggregate_type,
        ev.aggregate_id,
        ev.aggregate_version,
        JSON.stringify(ev),
      ],
    );
    return;
  }
  await c.query(
    `INSERT INTO sf_security.outbox_event
      (event_id, tenant_id, topic, partition_key, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, envelope)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      ev.event_id,
      ev.tenant_id,
      topic,
      ev.aggregate_id,
      ev.event_type,
      ev.schema_version,
      ev.aggregate_type,
      ev.aggregate_id,
      ev.aggregate_version,
      JSON.stringify(ev),
    ],
  );
}
