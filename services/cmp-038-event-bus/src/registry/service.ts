import type { TopicSpec } from '@serviceform/outbox';
import { assertCompatible } from './compatibility.js';
import type pg from 'pg';

export async function syncRegistry(
  client: pg.PoolClient,
  topics: readonly TopicSpec[],
): Promise<void> {
  for (const topic of topics) {
    await client.query(
      `INSERT INTO sf_event_bus.topic (
         topic_name, owner_component, tenancy, partition_key_strategy, partitions, replication_factor,
         broker_retention, outbox_retention, replay_class, compatibility, dlq_topic, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::interval,$8::interval,$9,$10,$11,$12)
       ON CONFLICT (topic_name) DO UPDATE SET
         partitions = EXCLUDED.partitions,
         replication_factor = EXCLUDED.replication_factor,
         broker_retention = EXCLUDED.broker_retention,
         outbox_retention = EXCLUDED.outbox_retention,
         replay_class = EXCLUDED.replay_class,
         status = EXCLUDED.status`,
      [
        topic.topic_name,
        topic.owner_component,
        topic.tenancy,
        topic.partition_key_strategy,
        topic.partitions,
        topic.replication_factor,
        topic.broker_retention,
        topic.outbox_retention,
        topic.replay_class,
        topic.compatibility,
        topic.dlq_topic,
        topic.status,
      ],
    );
    const existing = await client.query<{
      event_type: string;
      schema_version: number;
      data_schema: unknown;
    }>(
      'SELECT event_type, schema_version, data_schema FROM sf_event_bus.event_schema WHERE topic_name = $1',
      [topic.topic_name],
    );
    for (const schema of topic.schemas) {
      const sameType = existing.rows.filter((r) => r.event_type === schema.event_type);
      const maxVersion = sameType.reduce((m, r) => Math.max(m, r.schema_version), 0);
      const already = sameType.find((r) => r.schema_version === schema.schema_version);
      if (already) continue;
      const prev = sameType.find((r) => r.schema_version === maxVersion);
      assertCompatible(
        prev?.data_schema,
        schema.data_schema,
        topic.compatibility,
        schema.schema_version,
        maxVersion,
      );
      await client.query(
        `INSERT INTO sf_event_bus.event_schema (topic_name, event_type, schema_version, data_schema)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [
          topic.topic_name,
          schema.event_type,
          schema.schema_version,
          JSON.stringify(schema.data_schema),
        ],
      );
    }
  }
}
