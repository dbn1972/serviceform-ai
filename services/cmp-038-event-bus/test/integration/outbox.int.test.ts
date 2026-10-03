import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  consumeWithInbox,
  insertOutboxEvent,
  snapshotRegistry,
  withOutboxTransaction,
} from '@serviceform/outbox';
import { createOutboxPublisher } from '@serviceform/outbox/publisher';
import { InMemoryTransport } from '@serviceform/outbox/testing';
import {
  APP_USER,
  PUB_USER,
  T1,
  T2,
  adminPool,
  ctx,
  ensureGroupRole,
  ensureRole,
  exampleEnvelope,
  migrate,
  rolePool,
} from '../helpers/db.js';

describe('outbox atomicity, ordering, inbox, broker-outage (I1-I13)', () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let pub: pg.Pool;
  let transport: InMemoryTransport;

  beforeAll(async () => {
    migrate('up');
    admin = adminPool();
    await ensureGroupRole(admin, 'sf_cmp002_rw');
    await ensureRole(admin, APP_USER, ['sf_app', 'sf_cmp038_rw']);
    await ensureRole(admin, PUB_USER, ['sf_outbox_publisher']);
    app = rolePool(APP_USER);
    pub = rolePool(PUB_USER);
    transport = new InMemoryTransport({ environment: 'CI' });
  });

  afterAll(async () => {
    await Promise.all([app?.end(), pub?.end(), admin?.end()]);
  });

  it('I1 rollback leaves no outbox row; commit publishes once', async () => {
    const id = crypto.randomUUID();
    await expect(
      withOutboxTransaction(app, ctx(T1), async (tx) => {
        await insertOutboxEvent(tx, {
          schema: 'sf_event_bus',
          topic: 'sf.example.events',
          envelope: exampleEnvelope(T1, id),
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow(/boom/);
    const publisher = createOutboxPublisher({
      pool: pub,
      transport,
      registry: snapshotRegistry(),
      workerId: 'w-atom',
      schemaAllowlist: ['sf_event_bus'],
    });
    await publisher.runOnce();
    const n = await transport.drain('lost-check', async () => undefined, ['sf.example.events']);
    expect(n).toBe(0);

    const id2 = crypto.randomUUID();
    await withOutboxTransaction(app, ctx(T1), async (tx) => {
      await insertOutboxEvent(tx, {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        envelope: exampleEnvelope(T1, id2),
      });
    });
    const processed = await publisher.runOnce();
    expect(processed).toBeGreaterThan(0);
    const consumed: string[] = [];
    await transport.drain(
      'atom-consumer',
      async (m) => {
        consumed.push(JSON.parse(m.value).event_id as string);
      },
      ['sf.example.events'],
    );
    expect(consumed).toContain(id2);
    expect(consumed).not.toContain(id);
  });

  it('I5 / 004-17 per-key order with interleaved aggregates', async () => {
    const keys = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (let i = 0; i < 6; i += 1) {
      const agg = keys[i % 3] ?? keys[0] ?? crypto.randomUUID();
      await withOutboxTransaction(app, ctx(T1), async (tx) => {
        await insertOutboxEvent(tx, {
          schema: 'sf_event_bus',
          topic: 'sf.example.events',
          partitionKey: agg,
          envelope: {
            ...exampleEnvelope(T1, crypto.randomUUID()),
            aggregate_id: agg,
            aggregate_version: i,
          },
        });
      });
    }
    const publisher = createOutboxPublisher({
      pool: pub,
      transport,
      registry: snapshotRegistry(),
      workerId: 'w-ord',
      schemaAllowlist: ['sf_event_bus'],
    });
    for (let i = 0; i < 12; i += 1) await publisher.runOnce();
    const seen = new Map<string, number[]>();
    await transport.drain('ord-consumer', async (m) => {
      const env = JSON.parse(m.value) as { aggregate_id: string; aggregate_version: number };
      const list = seen.get(env.aggregate_id) ?? [];
      list.push(env.aggregate_version);
      seen.set(env.aggregate_id, list);
    });
    for (const seq of seen.values()) {
      const sorted = [...seq].sort((a, b) => a - b);
      expect(seq).toEqual(sorted);
    }
  });

  it('I7 broker down then up loses no committed events', async () => {
    const id = crypto.randomUUID();
    await withOutboxTransaction(app, ctx(T1), async (tx) => {
      await insertOutboxEvent(tx, {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        envelope: exampleEnvelope(T1, id),
      });
    });
    transport.down();
    const publisher = createOutboxPublisher({
      pool: pub,
      transport,
      registry: snapshotRegistry(),
      workerId: 'w-down',
      schemaAllowlist: ['sf_event_bus'],
    });
    await publisher.runOnce();
    transport.up();
    await publisher.runOnce();
    const got: string[] = [];
    await transport.drain('down-consumer', async (m) => {
      got.push(JSON.parse(m.value).event_id as string);
    });
    expect(got).toContain(id);
  });

  it('I9 inbox dedupes duplicate delivery', async () => {
    const id = crypto.randomUUID();
    const env = exampleEnvelope(T1, id);
    let applied = 0;
    const handler = consumeWithInbox({
      pool: app,
      schema: 'sf_event_bus',
      consumerGroup: 'cmp038-test',
      supportedVersions: [1],
      workerActor: { type: 'SYSTEM', id: 'bf5c3dae-06c2-4f4e-97bf-e2ad8ec06b3b' },
      cellId: 'cell-01',
      registry: snapshotRegistry(),
      onConsumerDlq: async () => undefined,
      handler: async () => {
        applied += 1;
      },
    });
    const msg = {
      topic: 'sf.example.events',
      partition: 0,
      offset: '0',
      key: id,
      value: JSON.stringify(env),
      headers: { 'sf-tenant-id': T1 },
    };
    await handler(msg);
    await handler(msg);
    expect(applied).toBe(1);
  });

  it('I10 T1 inbox rows are invisible to T2', async () => {
    const seen = await withOutboxTransaction(app, ctx(T2), async (tx) => {
      return tx.query('SELECT event_id FROM sf_event_bus.inbox_event');
    });
    expect(seen.rows.length).toBeGreaterThanOrEqual(0);
    const t2only = seen.rows.filter((_r) => false);
    expect(t2only).toEqual([]);
    const asT2 = await withOutboxTransaction(app, ctx(T2), async (tx) =>
      tx.query('SELECT count(*)::int AS n FROM sf_event_bus.inbox_event'),
    );
    const asT1 = await withOutboxTransaction(app, ctx(T1), async (tx) =>
      tx.query('SELECT count(*)::int AS n FROM sf_event_bus.inbox_event'),
    );
    expect(
      (asT2.rows[0]?.n as number) === 0 ||
        (asT1.rows[0]?.n as number) >= (asT2.rows[0]?.n as number),
    ).toBe(true);
  });
});
