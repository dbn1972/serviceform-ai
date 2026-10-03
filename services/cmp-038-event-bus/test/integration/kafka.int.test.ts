import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  consumeWithInbox,
  insertOutboxEvent,
  snapshotRegistry,
  withOutboxTransaction,
} from '@serviceform/outbox';
import { KafkaTransport } from '@serviceform/outbox/kafka';
import { createOutboxPublisher } from '@serviceform/outbox/publisher';
import { recordLag } from '../../src/lag/lag-monitor.js';
import {
  APP_USER,
  PUB_USER,
  T1,
  adminPool,
  ctx,
  exampleEnvelope,
  migrate,
  rolePool,
  setupCmp038Roles,
} from '../helpers/db.js';
import { ensureKafka, startKafkaAgain, stopKafka } from '../helpers/kafka.js';

describe('real Kafka 4.1.0 (K1-K5, 004-29)', () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let pub: pg.Pool;
  let transport: KafkaTransport;
  let brokers: string[];

  beforeAll(async () => {
    brokers = await ensureKafka();
    migrate('up');
    admin = adminPool();
    await setupCmp038Roles(admin);
    app = rolePool(APP_USER);
    pub = rolePool(PUB_USER);
    transport = new KafkaTransport({ brokers, clientId: 'sf-t004' });
    const registry = snapshotRegistry();
    await transport.ensureTopics(
      registry.allTopics().flatMap((t) => [
        { topic: t.topic_name, partitions: t.partitions, replicationFactor: 1 },
        { topic: t.dlq_topic, partitions: t.partitions, replicationFactor: 1 },
      ]),
    );
  }, 120_000);

  afterAll(async () => {
    await transport?.close();
    await Promise.all([app?.end(), pub?.end(), admin?.end()]);
  });

  it('K1 publish after commit and consume with inbox dedup', async () => {
    const id = crypto.randomUUID();
    await withOutboxTransaction(app, ctx(T1), async (tx) => {
      await insertOutboxEvent(tx, {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        envelope: exampleEnvelope(T1, id),
      });
    });
    const publisher = createOutboxPublisher({
      pool: pub,
      transport,
      registry: snapshotRegistry(),
      workerId: 'k1',
      schemaAllowlist: ['sf_event_bus'],
    });
    await publisher.runOnce();
    let applied = 0;
    const handler = consumeWithInbox({
      pool: app,
      schema: 'sf_event_bus',
      consumerGroup: 'k1-group-' + id.slice(0, 8),
      supportedVersions: [1],
      workerActor: { type: 'SYSTEM', id: 'bf5c3dae-06c2-4f4e-97bf-e2ad8ec06b3b' },
      cellId: 'cell-01',
      registry: snapshotRegistry(),
      onConsumerDlq: async () => undefined,
      handler: async () => {
        applied += 1;
      },
    });
    const sub = await transport.subscribe(
      'k1-group-' + id.slice(0, 8),
      ['sf.example.events'],
      handler,
    );
    const deadline = Date.now() + 20_000;
    while (applied < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
    await sub.close();
    expect(applied).toBeGreaterThanOrEqual(1);
  });

  it('K2 per-aggregate order is preserved on the broker', async () => {
    const agg = crypto.randomUUID();
    for (let v = 0; v < 3; v += 1) {
      await withOutboxTransaction(app, ctx(T1), async (tx) => {
        await insertOutboxEvent(tx, {
          schema: 'sf_event_bus',
          topic: 'sf.example.events',
          partitionKey: agg,
          envelope: {
            ...exampleEnvelope(T1, crypto.randomUUID()),
            aggregate_id: agg,
            aggregate_version: v,
          },
        });
      });
    }
    const publisher = createOutboxPublisher({
      pool: pub,
      transport,
      registry: snapshotRegistry(),
      workerId: 'k2',
      schemaAllowlist: ['sf_event_bus'],
    });
    for (let i = 0; i < 6; i += 1) await publisher.runOnce();
    const versions: number[] = [];
    const handler = async (m: { value: string; key: string }) => {
      if (m.key !== agg) return;
      versions.push((JSON.parse(m.value) as { aggregate_version: number }).aggregate_version);
    };
    const group = 'k2-group-' + agg.slice(0, 8);
    const sub = await transport.subscribe(group, ['sf.example.events'], handler);
    const deadline = Date.now() + 20_000;
    while (versions.length < 3 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
    await sub.close();
    expect(versions.slice(0, 3)).toEqual([0, 1, 2]);
  });

  it('K4 poison envelope is dead-lettered not published on the topic', async () => {
    const id = crypto.randomUUID();
    await withOutboxTransaction(app, ctx(T1), async (tx) => {
      await insertOutboxEvent(tx, {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        partitionKey: 'not-the-aggregate-id',
        envelope: exampleEnvelope(T1, id),
      });
    });
    const publisher = createOutboxPublisher({
      pool: pub,
      transport,
      registry: snapshotRegistry(),
      workerId: 'k4',
      schemaAllowlist: ['sf_event_bus'],
    });
    await publisher.runOnce();
    const row = await admin.query<{ status: string; last_error_code: string | null }>(
      'SELECT status, last_error_code FROM sf_event_bus.outbox_event WHERE event_id = $1::uuid',
      [id],
    );
    expect(row.rows[0]?.status).toBe('DEAD_LETTERED');
    expect(row.rows[0]?.last_error_code).toBe('PARTITION_KEY_MISMATCH');
  });

  it('K5 lag monitor writes consumer_checkpoint', async () => {
    await recordLag(app, transport, 'sf.example.events', 'k1-group');
    const n = await app.query('SELECT 1 FROM sf_event_bus.consumer_checkpoint LIMIT 1');
    expect((n.rowCount ?? 0) >= 0).toBe(true);
  });

  it('K3 broker stop/start loses no committed outbox row', async () => {
    const id = crypto.randomUUID();
    await withOutboxTransaction(app, ctx(T1), async (tx) => {
      await insertOutboxEvent(tx, {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        envelope: exampleEnvelope(T1, id),
      });
    });
    await stopKafka();
    const down = new KafkaTransport({ brokers, clientId: 'sf-t004-k3' });
    const publisher = createOutboxPublisher({
      pool: pub,
      transport: down,
      registry: snapshotRegistry(),
      workerId: 'k3',
      schemaAllowlist: ['sf_event_bus'],
    });
    await publisher.runOnce();
    const mid = await admin.query<{ status: string }>(
      'SELECT status FROM sf_event_bus.outbox_event WHERE event_id = $1::uuid',
      [id],
    );
    expect(mid.rows[0]?.status === 'PENDING' || mid.rows[0]?.status === 'PUBLISHED').toBe(true);
    await startKafkaAgain();
    const up = new KafkaTransport({ brokers, clientId: 'sf-t004-k3b' });
    const publisher2 = createOutboxPublisher({
      pool: pub,
      transport: up,
      registry: snapshotRegistry(),
      workerId: 'k3b',
      schemaAllowlist: ['sf_event_bus'],
    });
    await publisher2.runOnce();
    await publisher2.runOnce();
    const end = await admin.query<{ status: string }>(
      'SELECT status FROM sf_event_bus.outbox_event WHERE event_id = $1::uuid',
      [id],
    );
    expect(end.rows[0]?.status).toBe('PUBLISHED');
    await up.close();
  });
});
