import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  APP_ROLE,
  APP_ONLY,
  PUB_ROLE,
  T1,
  adminPool,
  ctx,
  exampleEnvelope,
  migrate,
  rolePool,
  setupCmp038Roles,
} from '../../helpers/db.js';
import {
  ATTR_SAFE,
  insertOutboxEvent,
  snapshotRegistry,
  withOutboxTransaction,
} from '@serviceform/outbox';
import { createOutboxPublisher } from '@serviceform/outbox/publisher';
import { InMemoryTransport } from '@serviceform/outbox/testing';
import { auditThenAct } from '../../../src/dead-letter/operator-actions.js';
import { syncRegistry } from '../../../src/registry/service.js';
import { assertCompatible } from '../../../src/registry/compatibility.js';

describe('operator actions and registry (004-25..004-28, 004-26)', () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let pub: pg.Pool;
  let appOnly: pg.Pool;

  beforeAll(async () => {
    migrate('up');
    admin = adminPool();
    await setupCmp038Roles(admin);
    app = rolePool(APP_ROLE);
    pub = rolePool(PUB_ROLE);
    appOnly = rolePool(APP_ONLY);
  });

  afterAll(async () => {
    await Promise.all([app?.end(), pub?.end(), appOnly?.end(), admin?.end()]);
  });

  it('004-25 replay/discard requires PRIVILEGED_ADMIN, MFA, reason, authz; audit before act', async () => {
    let applied = 0;
    const allow = {
      decide: async () => ({
        allow: true,
        reason_code: 'ALLOW',
        policy_revision: '1',
        decision_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    };
    const deny = {
      decide: async () => ({
        allow: false,
        reason_code: 'DENY',
        policy_revision: '1',
        decision_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    };
    await expect(
      auditThenAct(
        app,
        ctx(null, 'SYSTEM'),
        allow,
        { kind: 'replay', schema: 'sf_event_bus', table: 'outbox_event', seq: '1', reason: 'ops' },
        async () => {
          applied += 1;
          return 1;
        },
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    const noMfa = { ...ctx(null, 'PRIVILEGED_ADMIN'), auth_assurance: 'PASSWORD' as const };
    await expect(
      auditThenAct(
        app,
        noMfa,
        allow,
        { kind: 'replay', schema: 'sf_event_bus', table: 'outbox_event', seq: '1', reason: 'ops' },
        async () => {
          applied += 1;
          return 1;
        },
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    await expect(
      auditThenAct(
        app,
        ctx(null, 'PRIVILEGED_ADMIN'),
        allow,
        { kind: 'replay', schema: 'sf_event_bus', table: 'outbox_event', seq: '1', reason: '   ' },
        async () => {
          applied += 1;
          return 1;
        },
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
    await expect(
      auditThenAct(
        app,
        ctx(null, 'PRIVILEGED_ADMIN'),
        deny,
        { kind: 'replay', schema: 'sf_event_bus', table: 'outbox_event', seq: '1', reason: 'ops' },
        async () => {
          applied += 1;
          return 1;
        },
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    expect(applied).toBe(0);
    await auditThenAct(
      app,
      ctx(null, 'PRIVILEGED_ADMIN'),
      allow,
      {
        kind: 'replay',
        schema: 'sf_event_bus',
        table: 'outbox_event',
        seq: '1',
        reason: 'restore',
      },
      async () => {
        applied += 1;
        return 1;
      },
    );
    expect(applied).toBe(1);
    const n = await admin.query(
      "SELECT count(*)::int AS n FROM sf_event_bus.outbox_event_platform WHERE event_type IN ('DeadLetterReplayed','AuditEventSubmitted')",
    );
    expect((n.rows[0]?.n as number) >= 2).toBe(true);
  });

  it('004-26 incompatible schema fails; event_schema is insert-only; sync is idempotent', async () => {
    const c = await app.connect();
    try {
      const topics = snapshotRegistry().allTopics();
      await syncRegistry(c, topics);
      await syncRegistry(c, topics);
    } finally {
      c.release();
    }
    await expect(
      app.query('UPDATE sf_event_bus.event_schema SET schema_version = schema_version + 1'),
    ).rejects.toThrow(/permission denied/);
    await expect(
      app.query('DELETE FROM sf_event_bus.event_schema WHERE schema_version = 1'),
    ).rejects.toThrow(/permission denied/);
    await expect(
      admin.query('UPDATE sf_event_bus.event_schema SET data_schema = data_schema'),
    ).rejects.toThrow(/insert-only/);
    expect(() =>
      assertCompatible(
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
        'BACKWARD',
        2,
        1,
      ),
    ).toThrow();
  });

  it('004-27 non-CMP-038 sf_app cannot INSERT registry; snapshot drives the relay', async () => {
    await expect(
      appOnly.query(
        `INSERT INTO sf_event_bus.topic (
           topic_name, owner_component, tenancy, partition_key_strategy, partitions, replication_factor,
           broker_retention, outbox_retention, replay_class, compatibility, dlq_topic, status
         ) VALUES ('sf.t004.shadow', 'CMP-038', 'PLATFORM_OPERATIONAL', 'AGGREGATE_ID', 1, 1, '7 days', '7 days', 'STANDARD', 'BACKWARD', 'sf.t004.shadow.dlq', 'ACTIVE')`,
      ),
    ).rejects.toThrow(/permission denied/);
    const c = await app.connect();
    try {
      await c.query(
        `INSERT INTO sf_event_bus.topic (
           topic_name, owner_component, tenancy, partition_key_strategy, partitions, replication_factor,
           broker_retention, outbox_retention, replay_class, compatibility, dlq_topic, status
         ) VALUES ('sf.t004.shadow', 'CMP-038', 'PLATFORM_OPERATIONAL', 'AGGREGATE_ID', 1, 1, '7 days', '7 days', 'STANDARD', 'BACKWARD', 'sf.t004.shadow.dlq', 'ACTIVE')
         ON CONFLICT DO NOTHING`,
      );
    } finally {
      c.release();
    }
    expect(snapshotRegistry().getTopic('sf.t004.shadow')).toBeUndefined();
    const id = crypto.randomUUID();
    await withOutboxTransaction(app, ctx(T1), async (tx) => {
      await insertOutboxEvent(tx, {
        schema: 'sf_event_bus',
        topic: 'sf.t004.shadow',
        envelope: exampleEnvelope(T1, id),
      });
    });
    const transport = new InMemoryTransport({ environment: 'CI' });
    const publisher = createOutboxPublisher({
      pool: pub,
      transport,
      registry: snapshotRegistry(),
      workerId: 'w-shadow',
      schemaAllowlist: ['sf_event_bus'],
    });
    await publisher.runOnce();
    const row = await admin.query<{ last_error_code: string | null }>(
      'SELECT last_error_code FROM sf_event_bus.outbox_event WHERE event_id = $1::uuid',
      [id],
    );
    expect(row.rows[0]?.last_error_code).toBe('TOPIC_UNREGISTERED');
  });

  it('004-28 metric attribute names do not include tenant_id or canary fields', () => {
    const values = Object.values(ATTR_SAFE);
    expect(values.some((v) => /tenant|event_id|partition_key|secret|canary/i.test(v))).toBe(false);
  });
});
