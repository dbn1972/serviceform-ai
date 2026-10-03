import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  APP_USER,
  PUB_USER,
  T1,
  T2,
  adminPool,
  ctx,
  exampleEnvelope,
  migrate,
  rolePool,
  setupCmp038Roles,
} from '../../helpers/db.js';
import {
  consumeWithInbox,
  insertOutboxEvent,
  MAX_ENVELOPE_BYTES,
  snapshotRegistry,
  withOutboxTransaction,
} from '@serviceform/outbox';

describe('producer and consumer helpers (004-08..004-16)', () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let pub: pg.Pool;

  beforeAll(async () => {
    migrate('up');
    admin = adminPool();
    await setupCmp038Roles(admin);
    app = rolePool(APP_USER);
    pub = rolePool(PUB_USER);
    void pub;
  });

  afterAll(async () => {
    await Promise.all([app?.end(), pub?.end(), admin?.end()]);
  });

  it('004-08 rollback leaves no row; no ctx SF-TEN-001; invalid envelope SF-SYS-003', async () => {
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
    const leftover = await admin.query(
      'SELECT 1 FROM sf_event_bus.outbox_event WHERE event_id = $1::uuid',
      [id],
    );
    expect(leftover.rowCount).toBe(0);
    await expect(
      withOutboxTransaction(app, ctx(null), async (tx) => {
        await insertOutboxEvent(tx, {
          schema: 'sf_event_bus',
          topic: 'sf.example.events',
          envelope: exampleEnvelope(T1),
        });
      }),
    ).rejects.toMatchObject({ code: 'SF-TEN-001' });
    await expect(
      withOutboxTransaction(app, ctx(T1), async (tx) => {
        await insertOutboxEvent(tx, {
          schema: 'sf_event_bus',
          topic: 'sf.example.events',
          envelope: { hello: 'nope' } as never,
        });
      }),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
  });

  it('004-09 identifier injection is rejected before SQL', async () => {
    await expect(
      withOutboxTransaction(app, ctx(T1), async (tx) => {
        await insertOutboxEvent(tx, {
          schema: 'sf_t004_a; DROP',
          topic: 'sf.example.events',
          envelope: exampleEnvelope(T1),
        });
      }),
    ).rejects.toThrow(/invalid schema identifier/);
    await expect(
      withOutboxTransaction(app, ctx(T1), async (tx) => {
        await insertOutboxEvent(tx, {
          schema: 'sf_event_bus',
          topic: '../x',
          envelope: exampleEnvelope(T1),
        });
      }),
    ).rejects.toThrow(/invalid topic name/);
  });

  it('004-10 platform event inside tenant tx is refused unless allowlisted', async () => {
    await expect(
      withOutboxTransaction(app, ctx(T1), async (tx) => {
        await insertOutboxEvent(tx, {
          schema: 'sf_event_bus',
          topic: 'sf.eventbus.platform.v1',
          envelope: {
            ...exampleEnvelope(null),
            event_type: 'AuditEventSubmitted',
            tenant_id: null,
          },
        });
      }),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
  });

  it('004-11 raw SQL CHECK and producer DML denials', async () => {
    await expect(
      withOutboxTransaction(app, ctx(T1), async (tx) => {
        const env = exampleEnvelope(T2);
        return tx.query(
          `INSERT INTO sf_event_bus.outbox_event (
            event_id, tenant_id, topic, partition_key, event_type, schema_version,
            aggregate_type, aggregate_id, aggregate_version, envelope
          ) VALUES ($1::uuid, $2::uuid, 'sf.example.events', $1, 'ExampleAggregateCreated', 1,
            'ExampleAggregate', $1::uuid, 1, $3::jsonb)`,
          [env.event_id, T1, JSON.stringify(env)],
        );
      }),
    ).rejects.toThrow();
    await expect(
      withOutboxTransaction(app, ctx(T1), async (tx) =>
        tx.query('SELECT seq FROM sf_event_bus.outbox_event'),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withOutboxTransaction(app, ctx(T1), async (tx) =>
        tx.query("UPDATE sf_event_bus.outbox_event SET status = 'PUBLISHED'"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withOutboxTransaction(app, ctx(T1), async (tx) =>
        tx.query('DELETE FROM sf_event_bus.outbox_event'),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('004-12 envelope size is counted in bytes', async () => {
    const over = exampleEnvelope(T1);
    over.data = { blob: 'x'.repeat(MAX_ENVELOPE_BYTES) };
    await expect(
      withOutboxTransaction(app, ctx(T1), async (tx) => {
        await insertOutboxEvent(tx, {
          schema: 'sf_event_bus',
          topic: 'sf.example.events',
          envelope: over,
        });
      }),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
  });

  it('004-13 / 004-16 inbox dedupes; handler throw rolls back; T2 cannot see T1', async () => {
    const id = crypto.randomUUID();
    const env = exampleEnvelope(T1, id);
    let applied = 0;
    let failOnce = true;
    const handler = consumeWithInbox({
      pool: app,
      schema: 'sf_event_bus',
      consumerGroup: 'cmp038-sec',
      supportedVersions: [1],
      workerActor: { type: 'SYSTEM', id: 'bf5c3dae-06c2-4f4e-97bf-e2ad8ec06b3b' },
      cellId: 'cell-01',
      registry: snapshotRegistry(),
      onConsumerDlq: async () => undefined,
      handler: async () => {
        if (failOnce) {
          failOnce = false;
          throw new Error('handler-fail');
        }
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
    await expect(handler(msg)).rejects.toThrow(/handler-fail/);
    await handler(msg);
    await handler(msg);
    expect(applied).toBe(1);
    const asT2 = await withOutboxTransaction(app, ctx(T2), async (tx) =>
      tx.query('SELECT count(*)::int AS n FROM sf_event_bus.inbox_event'),
    );
    expect(asT2.rows[0]?.n).toBe(0);
  });

  it('004-14 forged envelopes go to consumer DLQ with no handler and no inbox row', async () => {
    const dlq: string[] = [];
    let applied = 0;
    const handler = consumeWithInbox({
      pool: app,
      schema: 'sf_event_bus',
      consumerGroup: 'cmp038-forge',
      supportedVersions: [1],
      workerActor: { type: 'SYSTEM', id: 'bf5c3dae-06c2-4f4e-97bf-e2ad8ec06b3b' },
      cellId: 'cell-01',
      registry: snapshotRegistry(),
      onConsumerDlq: async (_m, code) => {
        dlq.push(code);
      },
      handler: async () => {
        applied += 1;
      },
    });
    const base = exampleEnvelope(T1);
    await handler({
      topic: 'sf.example.events',
      partition: 0,
      offset: '1',
      key: 'k',
      value: JSON.stringify({ ...base, tenant_id: null }),
      headers: {},
    });
    await handler({
      topic: 'sf.example.events',
      partition: 0,
      offset: '2',
      key: 'k',
      value: JSON.stringify(base),
      headers: { 'sf-tenant-id': T2 },
    });
    expect(applied).toBe(0);
    expect(dlq.length).toBeGreaterThanOrEqual(2);
  });

  it('004-15 platform then T2 sees no residual T1 tenant setting', async () => {
    const seen: (string | null)[] = [];
    const handler = consumeWithInbox({
      pool: app,
      schema: 'sf_event_bus',
      consumerGroup: 'cmp038-residual',
      supportedVersions: [1],
      workerActor: { type: 'SYSTEM', id: 'bf5c3dae-06c2-4f4e-97bf-e2ad8ec06b3b' },
      cellId: 'cell-01',
      registry: snapshotRegistry(),
      onConsumerDlq: async () => undefined,
      handler: async (tx) => {
        const r = await tx.query<{ tid: string | null }>(
          'SELECT sf_platform.current_tenant_id() AS tid',
        );
        seen.push(r.rows[0]?.tid ?? null);
      },
    });
    const platform = {
      ...exampleEnvelope(null),
      event_type: 'TopicRegistered',
    };
    await handler({
      topic: 'sf.eventbus.platform.v1',
      partition: 0,
      offset: '0',
      key: platform.aggregate_id,
      value: JSON.stringify(platform),
      headers: {},
    });
    const t2 = exampleEnvelope(T2);
    await handler({
      topic: 'sf.example.events',
      partition: 0,
      offset: '1',
      key: t2.aggregate_id,
      value: JSON.stringify(t2),
      headers: { 'sf-tenant-id': T2 },
    });
    expect(seen[0]).toBeNull();
    expect(seen[1]).toBe(T2);
  });
});
