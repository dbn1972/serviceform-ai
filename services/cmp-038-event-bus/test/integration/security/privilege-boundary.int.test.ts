import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  APP_ONLY,
  APP_USER,
  FIXTURE_A,
  PEER_USER,
  PUB_USER,
  T1,
  T2,
  adminPool,
  ctx,
  exampleEnvelope,
  migrate,
  rolePool,
  setupCmp038Roles,
  setupFixtureSchema,
} from '../../helpers/db.js';
import { insertOutboxEvent, withOutboxTransaction } from '@serviceform/outbox';
import { assertPublisherRole, discoverOutboxTables } from '@serviceform/outbox/publisher';

describe('CMP-038 privilege boundary (004-P*, 004-01..07, ADR-0006)', () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let pub: pg.Pool;
  let peer: pg.Pool;
  let appOnly: pg.Pool;

  beforeAll(async () => {
    migrate('up');
    admin = adminPool();
    await setupCmp038Roles(admin);
    await setupFixtureSchema(admin, FIXTURE_A);
    app = rolePool(APP_USER);
    pub = rolePool(PUB_USER);
    peer = rolePool(PEER_USER);
    appOnly = rolePool(APP_ONLY);
  });

  afterAll(async () => {
    await Promise.all([app?.end(), pub?.end(), peer?.end(), appOnly?.end(), admin?.end()]);
  });

  it('004-P1 own authorized DML on GRANT-only registry succeeds', async () => {
    const c = await app.connect();
    try {
      await c.query(
        `INSERT INTO sf_event_bus.topic (
           topic_name, owner_component, tenancy, partition_key_strategy, partitions, replication_factor,
           broker_retention, outbox_retention, replay_class, compatibility, dlq_topic, status
         ) VALUES ('sf.t004.p1', 'CMP-038', 'PLATFORM_OPERATIONAL', 'AGGREGATE_ID', 1, 1, '7 days', '7 days', 'STANDARD', 'BACKWARD', 'sf.t004.p1.dlq', 'ACTIVE')
         ON CONFLICT DO NOTHING`,
      );
      await c.query(
        `INSERT INTO sf_event_bus.event_schema (topic_name, event_type, schema_version, data_schema)
         VALUES ('sf.t004.p1', 'TopicRegistered', 1, '{"type":"object"}'::jsonb)
         ON CONFLICT DO NOTHING`,
      );
      await c.query(
        `INSERT INTO sf_event_bus.consumer_checkpoint
           (consumer_group, topic_name, partition, committed_offset, log_end_offset, lag)
         VALUES ('g1', 'sf.t004.p1', 0, 0, 10, 10)
         ON CONFLICT (consumer_group, topic_name, partition) DO UPDATE SET lag = 10`,
      );
      const n = await c.query('SELECT 1 FROM sf_event_bus.topic WHERE topic_name = $1', [
        'sf.t004.p1',
      ]);
      expect(n.rowCount).toBe(1);
    } finally {
      c.release();
    }
    await withOutboxTransaction(app, ctx(T1), async (tx) => {
      await insertOutboxEvent(tx, {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        envelope: exampleEnvelope(T1),
      });
    });
  });

  it('004-P2 wrong-tenant insert fails', async () => {
    await expect(
      withOutboxTransaction(app, ctx(T1), async (tx) => {
        await insertOutboxEvent(tx, {
          schema: 'sf_event_bus',
          topic: 'sf.example.events',
          envelope: exampleEnvelope(T2),
        });
      }),
    ).rejects.toMatchObject({ code: 'SF-TEN-002' });
  });

  it('004-P3 / 004-P8 peer and sf_app-only cannot DML registry (42501 from GRANT)', async () => {
    await expect(peer.query('SELECT * FROM sf_event_bus.topic')).rejects.toThrow(
      /permission denied/,
    );
    await expect(peer.query("UPDATE sf_event_bus.topic SET status = 'DEPRECATED'")).rejects.toThrow(
      /permission denied/,
    );
    await expect(peer.query('DELETE FROM sf_event_bus.topic')).rejects.toThrow(/permission denied/);
    await expect(peer.query('SELECT * FROM sf_event_bus.event_schema')).rejects.toThrow(
      /permission denied/,
    );
    await expect(peer.query('DELETE FROM sf_event_bus.event_schema')).rejects.toThrow(
      /permission denied/,
    );
    await expect(peer.query('SELECT * FROM sf_event_bus.consumer_checkpoint')).rejects.toThrow(
      /permission denied/,
    );
    await expect(peer.query('DELETE FROM sf_event_bus.consumer_checkpoint')).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      peer.query(
        `INSERT INTO sf_event_bus.topic (
           topic_name, owner_component, tenancy, partition_key_strategy, partitions, replication_factor,
           broker_retention, outbox_retention, replay_class, compatibility, dlq_topic, status
         ) VALUES ('sf.t004.peer', 'CMP-038', 'PLATFORM_OPERATIONAL', 'AGGREGATE_ID', 1, 1, '7 days', '7 days', 'STANDARD', 'BACKWARD', 'sf.t004.peer.dlq', 'ACTIVE')`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(appOnly.query('SELECT * FROM sf_event_bus.topic')).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.query('SELECT secret_note FROM ' + FIXTURE_A + '.orders')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('004-P4 SET ROLE into another component _rw is unavailable', async () => {
    await expect(app.query('SET ROLE sf_cmp002_rw')).rejects.toThrow();
    await expect(app.query('SET ROLE sf_cmp031_rw')).rejects.toThrow();
    await expect(app.query('SET ROLE sf_cmp037_rw')).rejects.toThrow();
    await expect(app.query('SET ROLE sf_cmp048_rw')).rejects.toThrow();
    await expect(pub.query('SET ROLE sf_app')).rejects.toThrow();
    await expect(pub.query('SET ROLE sf_cmp038_rw')).rejects.toThrow();
    for (const role of ['sf_cmp002_rw', 'sf_cmp031_rw', 'sf_cmp037_rw', 'sf_cmp048_rw']) {
      const mem = await app.query<{ ok: boolean }>(
        'SELECT pg_has_role(session_user, $1, $2) AS ok',
        [role, 'MEMBER'],
      );
      expect(mem.rows[0]?.ok).toBe(false);
    }
  });

  it('004-P5 / 004-01 runtime and publisher are not superuser and have no BYPASSRLS', async () => {
    const q =
      'SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user';
    const a = await app.query<{ rolsuper: boolean; rolbypassrls: boolean }>(q);
    const p = await pub.query<{ rolsuper: boolean; rolbypassrls: boolean }>(q);
    expect(a.rows[0]?.rolsuper).toBe(false);
    expect(a.rows[0]?.rolbypassrls).toBe(false);
    expect(p.rows[0]?.rolsuper).toBe(false);
    expect(p.rows[0]?.rolbypassrls).toBe(false);
    const appMem = await pub.query<{ ok: boolean }>(
      "SELECT pg_has_role(session_user, 'sf_app', 'MEMBER') AS ok",
    );
    expect(appMem.rows[0]?.ok).toBe(false);
  });

  it('004-P6 runtime is not table owner (sf_migrator owns)', async () => {
    const r = await admin.query<{ tableowner: string }>(
      "SELECT tableowner FROM pg_tables WHERE schemaname = 'sf_event_bus'",
    );
    for (const row of r.rows) {
      expect(row.tableowner).toBe('sf_migrator');
      expect(row.tableowner).not.toBe(APP_USER);
      expect(row.tableowner).not.toBe(PUB_USER);
    }
  });

  it('004-P7 FORCE RLS on tenant outbox/inbox; registry relrowsecurity false', async () => {
    const r = await admin.query<{ relname: string; rls: boolean; force: boolean }>(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'sf_event_bus' AND c.relkind = 'r'`,
    );
    const by = Object.fromEntries(r.rows.map((row) => [row.relname, row]));
    expect(by['outbox_event']?.rls).toBe(true);
    expect(by['outbox_event']?.force).toBe(true);
    expect(by['inbox_event']?.rls).toBe(true);
    expect(by['inbox_event']?.force).toBe(true);
    expect(by['outbox_event_platform']?.rls).toBe(false);
    expect(by['inbox_event_platform']?.rls).toBe(false);
    expect(by['topic']?.rls).toBe(false);
    expect(by['event_schema']?.rls).toBe(false);
    expect(by['consumer_checkpoint']?.rls).toBe(false);
  });

  it('004-P8 PUBLIC has no table privileges', async () => {
    for (const rel of [
      'topic',
      'event_schema',
      'consumer_checkpoint',
      'outbox_event',
      'inbox_event',
    ]) {
      const r = await admin.query<{ ok: boolean }>('SELECT has_table_privilege($1, $2, $3) AS ok', [
        'public',
        'sf_event_bus.' + rel,
        'SELECT',
      ]);
      expect(r.rows[0]?.ok).toBe(false);
    }
  });

  it('004-02 / 004-P9 publisher catalogue is frozen outbox grants only', async () => {
    const r = await admin.query<{ nspname: string; relname: string; priv: string }>(
      `SELECT n.nspname, c.relname, p AS priv
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
       WHERE has_table_privilege('sf_t004_pub', c.oid, p)
         AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')`,
    );
    for (const row of r.rows) {
      expect(['outbox_event', 'outbox_event_platform']).toContain(row.relname);
      expect(['SELECT', 'UPDATE', 'DELETE']).toContain(row.priv);
    }
    expect(r.rows.some((row) => row.relname === 'topic')).toBe(false);
    expect(r.rows.some((row) => row.relname === 'event_schema')).toBe(false);
    expect(r.rows.some((row) => row.relname === 'consumer_checkpoint')).toBe(false);
  });

  it('004-03 publisher runtime denials', async () => {
    await expect(
      pub.query(
        `INSERT INTO sf_event_bus.outbox_event_platform (
        event_id, topic, partition_key, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, envelope
      ) VALUES (gen_random_uuid(), 'sf.example.events', 'k', 'ExampleAggregateCreated', 1, 'ExampleAggregate', gen_random_uuid(), 1, '{}')`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(pub.query('SELECT * FROM ' + FIXTURE_A + '.orders')).rejects.toThrow(
      /permission denied/,
    );
    await expect(pub.query('SELECT * FROM sf_event_bus.topic')).rejects.toThrow(
      /permission denied/,
    );
    await expect(pub.query('CREATE TABLE sf_event_bus.nope (id int)')).rejects.toThrow();
    await expect(pub.query('SET ROLE sf_app')).rejects.toThrow();
    await expect(pub.query('TRUNCATE sf_event_bus.outbox_event')).rejects.toThrow();
  });

  it('004-04 policies match the frozen template; no policy TO PUBLIC', async () => {
    const pols = await admin.query<{ polname: string; relname: string; public_role: boolean }>(
      `SELECT p.polname, c.relname, (ARRAY['public'::regrole] && p.polroles) AS public_role
       FROM pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'sf_event_bus'`,
    );
    const names = pols.rows.map((r) => r.polname).sort();
    expect(names).toEqual(
      ['inbox_event_tenant', 'outbox_event_publisher', 'outbox_event_tenant_insert'].sort(),
    );
    expect(pols.rows.every((r) => r.public_role === false)).toBe(true);
    const sec = await admin.query<{ prosecdef: boolean }>(
      "SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'sf_event_bus'",
    );
    expect(sec.rows.every((r) => r.prosecdef === false)).toBe(true);
  });

  it('004-05 relay guard refuses sf_app, superuser, and SET ROLE from superuser', async () => {
    await expect(assertPublisherRole(app)).rejects.toMatchObject({ code: 'SF-SYS-001' });
    await expect(assertPublisherRole(admin)).rejects.toMatchObject({ code: 'SF-SYS-001' });
    const c = await admin.connect();
    try {
      await c.query('SET ROLE sf_t004_pub');
      await expect(assertPublisherRole(c)).rejects.toMatchObject({ code: 'SF-SYS-001' });
    } finally {
      await c.query('RESET ROLE');
      c.release();
    }
    await expect(assertPublisherRole(pub)).resolves.toBeUndefined();
  });

  it('004-06 publisher SQL sources do not name business tables', () => {
    const pkgRoot = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../packages/outbox/src/publisher',
    );
    const src = readFileSync(join(pkgRoot, 'publisher.ts'), 'utf8');
    expect(src.includes('orders')).toBe(false);
  });

  it('004-07 discovery ignores views and non-allowlisted schemas; quoted names work', async () => {
    const weird = 'xdrop_t004_orders';
    await admin.query('DROP SCHEMA IF EXISTS ' + weird + ' CASCADE');
    await admin.query('CREATE SCHEMA ' + weird);
    await admin.query('GRANT USAGE ON SCHEMA ' + weird + ' TO sf_outbox_publisher');
    await admin.query(
      'CREATE TABLE ' +
        weird +
        '.outbox_event (seq bigint PRIMARY KEY, status text); GRANT SELECT, UPDATE ON ' +
        weird +
        '.outbox_event TO sf_outbox_publisher',
    );
    await admin.query(
      'CREATE VIEW sf_event_bus.outbox_event_view AS SELECT 1 AS seq; GRANT SELECT ON sf_event_bus.outbox_event_view TO sf_outbox_publisher',
    );
    const c = await pub.connect();
    try {
      await c.query('BEGIN');
      const found = await discoverOutboxTables(c, ['sf_event_bus']);
      expect(found.every((t) => t.schema === 'sf_event_bus')).toBe(true);
      expect(found.some((t) => t.schema === weird)).toBe(false);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    const orders = await admin.query('SELECT 1 FROM ' + FIXTURE_A + '.orders');
    expect(orders.rowCount).toBe(0);
  });
});
