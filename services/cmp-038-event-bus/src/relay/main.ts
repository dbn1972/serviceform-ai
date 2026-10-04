import pg from 'pg';
import { snapshotRegistry } from '@serviceform/outbox';
import { createOutboxPublisher } from '@serviceform/outbox/publisher';
import { KafkaTransport } from '@serviceform/outbox/kafka';
import { loadConfig } from '../config.js';

export async function startRelay(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.databaseUrl) throw new Error('DATABASE_URL required');
  if (cfg.kafkaBrokers.length === 0) throw new Error('SF_KAFKA_BROKERS required for REAL relay');
  const pool = new pg.Pool({ connectionString: cfg.databaseUrl });
  const transport = new KafkaTransport({ brokers: cfg.kafkaBrokers });
  const registry = snapshotRegistry();
  await transport.ensureTopics(
    registry.allTopics().flatMap((t) => [
      { topic: t.topic_name, partitions: t.partitions, replicationFactor: t.replication_factor },
      { topic: t.dlq_topic, partitions: t.partitions, replicationFactor: t.replication_factor },
    ]),
  );
  const publisher = createOutboxPublisher({
    pool,
    transport,
    registry,
    workerId: cfg.workerId,
  });
  await publisher.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startRelay().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
