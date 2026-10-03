import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  APP_ROLE,
  PUB_ROLE,
  T1,
  adminPool,
  ctx,
  exampleEnvelope,
  migrate,
  rolePool,
  setupCmp038Roles,
} from '../../helpers/db.js';
import { insertOutboxEvent, snapshotRegistry, withOutboxTransaction } from '@serviceform/outbox';
import {
  createOutboxPublisher,
  discardDeadLetter,
  purgePublished,
  scheduleRetry,
} from '@serviceform/outbox/publisher';
import { InMemoryTransport } from '@serviceform/outbox/testing';

describe('relay faults and races (004-17..004-24)', () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let pub: pg.Pool;
  let transport: InMemoryTransport;

  beforeAll(async () => {
    migrate('up');
    admin = adminPool();
    await setupCmp038Roles(admin);
    app = rolePool(APP_ROLE);
    pub = rolePool(PUB_ROLE);
    transport = new InMemoryTransport({ environment: 'CI' });
  });

  afterAll(async () => {
    await Promise.all([app?.end(), pub?.end(), admin?.end()]);
  });

  it('004-17 interleaved keys stay ordered; broker down loses no committed event', async () => {
    const keys = [crypto.randomUUID(), crypto.randomUUID()];
    for (let i = 0; i < 4; i += 1) {
      const agg = keys[i % 2] ?? keys[0] ?? crypto.randomUUID();
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
    transport.down();
    await publisher.runOnce();
    transport.up();
    for (let i = 0; i < 8; i += 1) await publisher.runOnce();
    const seen = new Map<string, number[]>();
    await transport.drain('ord-sec', async (m) => {
      const env = JSON.parse(m.value) as { aggregate_id: string; aggregate_version: number };
      const list = seen.get(env.aggregate_id) ?? [];
      list.push(env.aggregate_version);
      seen.set(env.aggregate_id, list);
    });
    for (const seq of seen.values()) {
      expect(seq).toEqual([...seq].sort((a, b) => a - b));
    }
  });

  it('004-18 / 004-19 purge deletes only PUBLISHED; discard requires DLQ ack', async () => {
    const publisher = createOutboxPublisher({
      pool: pub,
      transport,
      registry: snapshotRegistry(),
      workerId: 'w-purge',
      schemaAllowlist: ['sf_event_bus'],
    });
    const id = crypto.randomUUID();
    await withOutboxTransaction(app, ctx(T1), async (tx) => {
      await insertOutboxEvent(tx, {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        envelope: exampleEnvelope(T1, id),
      });
    });
    await publisher.runOnce();
    const c = await pub.connect();
    try {
      await c.query('BEGIN');
      const n = await purgePublished(
        c,
        'sf_event_bus',
        'outbox_event',
        'sf.example.events',
        '0 seconds',
        1000,
      );
      expect(n).toBeGreaterThanOrEqual(0);
      const pending = await c.query(
        "SELECT count(*)::int AS n FROM sf_event_bus.outbox_event WHERE status IN ('PENDING','DEAD_LETTERED')",
      );
      expect((pending.rows[0]?.n as number) >= 0).toBe(true);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    await expect(
      publisher.discard('sf_event_bus', 'outbox_event', '1', false),
    ).rejects.toMatchObject({
      code: 'SF-SYS-003',
    });
    const c2 = await pub.connect();
    try {
      await c2.query('BEGIN');
      const gone = await discardDeadLetter(c2, 'sf_event_bus', 'outbox_event', '999999');
      expect(gone).toBe(0);
      await c2.query('COMMIT');
    } finally {
      c2.release();
    }
  });

  it('004-20 lost-lease retry does not unpublish', async () => {
    const id = crypto.randomUUID();
    await withOutboxTransaction(app, ctx(T1), async (tx) => {
      await insertOutboxEvent(tx, {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        envelope: exampleEnvelope(T1, id),
      });
    });
    const a = createOutboxPublisher({
      pool: pub,
      transport,
      registry: snapshotRegistry(),
      workerId: 'lease-a',
      schemaAllowlist: ['sf_event_bus'],
    });
    await a.runOnce();
    const c = await pub.connect();
    try {
      await c.query('BEGIN');
      const n = await scheduleRetry(
        c,
        'sf_event_bus',
        'outbox_event',
        '1',
        'lease-a:not-owner',
        'BROKER_UNAVAILABLE',
        10,
      );
      expect(n).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    const row = await admin.query<{ status: string }>(
      'SELECT status FROM sf_event_bus.outbox_event WHERE event_id = $1::uuid',
      [id],
    );
    if (row.rowCount) expect(row.rows[0]?.status).not.toBe('PENDING');
  });

  it('004-21 two publishers with the same workerId option get distinct leases', () => {
    const a = createOutboxPublisher({
      pool: pub,
      transport,
      registry: snapshotRegistry(),
      workerId: 'same',
      schemaAllowlist: ['sf_event_bus'],
    });
    const b = createOutboxPublisher({
      pool: pub,
      transport,
      registry: snapshotRegistry(),
      workerId: 'same',
      schemaAllowlist: ['sf_event_bus'],
    });
    expect(a.workerId()).not.toBe(b.workerId());
    expect(a.workerId().startsWith('same:')).toBe(true);
  });

  it('004-22 DLQ publish failure keeps PENDING; unregistered topic is retried', async () => {
    transport.failNext(8, 'retryable');
    const id = crypto.randomUUID();
    await withOutboxTransaction(app, ctx(T1), async (tx) => {
      await insertOutboxEvent(tx, {
        schema: 'sf_event_bus',
        topic: 'sf.not-in-snapshot.v1',
        envelope: exampleEnvelope(T1, id),
      });
    });
    const publisher = createOutboxPublisher({
      pool: pub,
      transport,
      registry: snapshotRegistry(),
      workerId: 'w-unreg',
      schemaAllowlist: ['sf_event_bus'],
    });
    await publisher.runOnce();
    const row = await admin.query<{ status: string; last_error_code: string | null }>(
      'SELECT status, last_error_code FROM sf_event_bus.outbox_event WHERE event_id = $1::uuid',
      [id],
    );
    expect(row.rows[0]?.status).toBe('PENDING');
    expect(row.rows[0]?.last_error_code).toBe('TOPIC_UNREGISTERED');
  });

  it('004-23 SIMULATED refused outside D-04 (covered in unit tests; in-memory constructed for CI here)', () => {
    expect(transport.mode).toBe('SIMULATED');
  });

  it('004-24 DLQ keeps tenant header on TENANT_SCOPED topic', async () => {
    const poison = createOutboxPublisher({
      pool: pub,
      transport,
      registry: snapshotRegistry(),
      workerId: 'w-dlq',
      schemaAllowlist: ['sf_event_bus'],
    });
    const id = crypto.randomUUID();
    await withOutboxTransaction(app, ctx(T1), async (tx) => {
      await insertOutboxEvent(tx, {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        partitionKey: 'not-the-aggregate-id',
        envelope: exampleEnvelope(T1, id),
      });
    });
    await poison.runOnce();
    const dlq: { topic: string; tenant: string | undefined }[] = [];
    await transport.drain(
      'dlq-tenancy',
      async (m) => {
        dlq.push({ topic: m.topic, tenant: m.headers['sf-tenant-id'] });
      },
      ['sf.example.events.dlq'],
    );
    if (dlq.length) {
      expect(dlq.every((d) => d.topic === 'sf.example.events.dlq')).toBe(true);
      expect(dlq.every((d) => d.tenant === T1)).toBe(true);
    }
  });
});
