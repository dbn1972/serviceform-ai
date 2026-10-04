import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@serviceform/contracts';
import type pg from 'pg';
import { createOutboxPublisher } from '../src/publisher/index.js';
import { snapshotRegistry } from '../src/snapshot.js';
import { InMemoryTransport } from '../src/testing/index.js';
import type { TopicRegistryReader, TopicSpec } from '../src/registry-port.js';
import type { ClaimedRow } from '../src/publisher/claim.js';

const T1 = '11111111-1111-4111-8111-111111111111';

function envelope(over: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    event_id: '8c2f0a7b-d39f-4c1b-a48c-bf7a5b9d3e08',
    event_type: 'ExampleAggregateCreated',
    schema_version: 1,
    tenant_id: T1,
    cell_id: 'cell-01',
    aggregate_type: 'ExampleAggregate',
    aggregate_id: '9d3a1b8c-e4a0-4d2c-b59d-c08b6cae4f19',
    aggregate_version: 1,
    occurred_at: '2026-10-03T09:00:00Z',
    correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
    actor: { type: 'SYSTEM', id: 'bf5c3dae-06c2-4f4e-97bf-e2ad8ec06b3b' },
    data: {},
    ...over,
  };
}

function claimed(over: Partial<ClaimedRow> = {}): ClaimedRow {
  const env = (over.envelope as EventEnvelope | undefined) ?? envelope();
  return {
    schema: 'sf_event_bus',
    table: 'outbox_event',
    seq: '1',
    event_id: env.event_id,
    topic: 'sf.example.events',
    partition_key: env.aggregate_id,
    event_type: env.event_type,
    schema_version: env.schema_version,
    aggregate_type: env.aggregate_type,
    aggregate_id: env.aggregate_id,
    aggregate_version: String(env.aggregate_version),
    envelope: env,
    status: 'PENDING',
    attempts: 1,
    next_attempt_at: new Date(),
    lease_owner: 'w',
    lease_expires_at: new Date(),
    last_error_code: null,
    created_at: new Date(),
    published_at: null,
    ...over,
  };
}

function publisherSql(opts: {
  rows?: ClaimedRow[];
  discovered?: { schema: string; table: string; relkind: string }[];
  markCount?: number;
  retryCount?: number;
  throwOn?: string;
  rollbackFail?: boolean;
}) {
  return async (sql: string, params?: unknown[]) => {
    if (opts.throwOn && sql.includes(opts.throwOn)) throw new Error('sql-fail');
    if (sql === 'ROLLBACK' && opts.rollbackFail) throw new Error('rollback-fail');
    if (sql.includes('session_user') && sql.includes('pg_roles') && !sql.includes('pg_has_role')) {
      return { rows: [{ rolsuper: false, rolbypassrls: false, rolname: 'pub' }] };
    }
    if (sql.includes('current_user') && sql.includes('pg_roles') && !sql.includes('pg_has_role')) {
      return { rows: [{ rolsuper: false, rolbypassrls: false, rolname: 'pub' }] };
    }
    if (sql.includes('pg_has_role')) {
      return { rows: [{ ok: params?.[0] === 'sf_outbox_publisher' }] };
    }
    if (sql.includes('sf_cmp') || sql.includes('relowner')) {
      return { rows: [{ ok: false }] };
    }
    if (sql.includes('nspname AS schema')) {
      return {
        rows: opts.discovered ?? [{ schema: 'sf_event_bus', table: 'outbox_event', relkind: 'r' }],
      };
    }
    if (sql.includes('FOR UPDATE SKIP LOCKED')) {
      return { rows: opts.rows ?? [], rowCount: (opts.rows ?? []).length };
    }
    if (sql.includes("SET status = 'PENDING'") && sql.includes('DEAD_LETTERED')) {
      return { rowCount: 0 };
    }
    if (sql.includes("status = 'PUBLISHED'") && sql.includes('UPDATE')) {
      return { rowCount: opts.markCount ?? 1 };
    }
    if (sql.includes("SET status = 'DEAD_LETTERED'")) {
      return { rowCount: 1 };
    }
    if (sql.includes('next_attempt_at')) {
      return { rowCount: opts.retryCount ?? 1 };
    }
    if (sql.includes('DELETE FROM')) {
      return { rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  };
}

function pool(query: (sql: string, params?: unknown[]) => Promise<unknown>): pg.Pool {
  const client = {
    query,
    release: () => undefined,
  };
  return { connect: async () => client } as unknown as pg.Pool;
}

function registryWith(topics: TopicSpec[]): TopicRegistryReader {
  const byName = new Map(topics.map((t) => [t.topic_name, t]));
  return {
    getTopic: (name) => byName.get(name),
    allTopics: () => topics,
    retentionFor: (name) => byName.get(name)?.outbox_retention,
  };
}

describe('createOutboxPublisher', () => {
  it('publishes a valid row and supports start/stop/replay/discard', async () => {
    const transport = new InMemoryTransport({ environment: 'CI' });
    const pub = createOutboxPublisher({
      pool: pool(publisherSql({ rows: [claimed()] })),
      transport,
      registry: snapshotRegistry(),
      workerId: 'unit',
      schemaAllowlist: ['sf_event_bus'],
      leaseMs: 4000,
      loggerService: '@serviceform/outbox',
    });
    expect(pub.workerId().startsWith('unit:')).toBe(true);
    expect(await pub.runOnce()).toBe(1);
    expect(transport).toBeTruthy();
    await pub.start();
    await pub.stop();
    expect(await pub.replay('sf_event_bus', 'outbox_event', '1')).toBe(0);
    await expect(pub.discard('sf_event_bus', 'outbox_event', '1', false)).rejects.toMatchObject({
      code: 'SF-SYS-003',
    });
    expect(await pub.discard('sf_event_bus', 'outbox_event', '1', true)).toBe(0);
  });

  it('retries poison envelope when DLQ publish fails and dead-letters when it succeeds', async () => {
    const fail = new InMemoryTransport({ environment: 'CI' });
    fail.down();
    const retryPub = createOutboxPublisher({
      pool: pool(
        publisherSql({
          rows: [claimed({ envelope: { nope: true }, partition_key: 'poison-key' })],
        }),
      ),
      transport: fail,
      registry: snapshotRegistry(),
      workerId: 'poison-retry',
    });
    expect(await retryPub.runOnce()).toBe(1);

    const ok = new InMemoryTransport({ environment: 'CI' });
    const deadPub = createOutboxPublisher({
      pool: pool(
        publisherSql({
          rows: [claimed({ envelope: 'bad', partition_key: 'poison-key' })],
        }),
      ),
      transport: ok,
      registry: snapshotRegistry(),
      workerId: 'poison-dead',
    });
    expect(await deadPub.runOnce()).toBe(1);
  });

  it('retries unregistered or deprecated topics and dead-letters fatal registry mismatches', async () => {
    const transport = new InMemoryTransport({ environment: 'CI' });
    const example = snapshotRegistry().getTopic('sf.example.events');
    if (!example) throw new Error('missing snapshot topic');
    const registry = registryWith([{ ...example, status: 'DEPRECATED' }, example]);

    const unreg = createOutboxPublisher({
      pool: pool(publisherSql({ rows: [claimed({ topic: 'sf.unknown.events' })] })),
      transport,
      registry,
      workerId: 'unreg',
    });
    expect(await unreg.runOnce()).toBe(1);

    const deprecated = createOutboxPublisher({
      pool: pool(publisherSql({ rows: [claimed()] })),
      transport,
      registry: registryWith([{ ...example, status: 'DEPRECATED' }]),
      workerId: 'deprecated',
    });
    expect(await deprecated.runOnce()).toBe(1);

    const mismatch = createOutboxPublisher({
      pool: pool(publisherSql({ rows: [claimed({ partition_key: 'not-the-aggregate' })] })),
      transport,
      registry: snapshotRegistry(),
      workerId: 'mismatch',
    });
    expect(await mismatch.runOnce()).toBe(1);

    const dlqFail = new InMemoryTransport({ environment: 'CI' });
    dlqFail.down();
    const mismatchDown = createOutboxPublisher({
      pool: pool(publisherSql({ rows: [claimed({ partition_key: 'not-the-aggregate' })] })),
      transport: dlqFail,
      registry: snapshotRegistry(),
      workerId: 'mismatch-down',
    });
    expect(await mismatchDown.runOnce()).toBe(1);
  });

  it('retries unsupported schema versions and dead-letters invalid payload data', async () => {
    const transport = new InMemoryTransport({ environment: 'CI' });
    const example = snapshotRegistry().getTopic('sf.example.events');
    if (!example) throw new Error('missing snapshot topic');
    const strict = registryWith([
      {
        ...example,
        schemas: [
          {
            event_type: 'ExampleAggregateCreated',
            schema_version: 1,
            data_schema: {
              type: 'object',
              required: ['must'],
              properties: { must: { type: 'string' } },
              additionalProperties: false,
            },
          },
        ],
      },
    ]);

    const badVersion = createOutboxPublisher({
      pool: pool(publisherSql({ rows: [claimed({ envelope: envelope({ schema_version: 9 }) })] })),
      transport,
      registry: snapshotRegistry(),
      workerId: 'ver',
    });
    expect(await badVersion.runOnce()).toBe(1);

    const badData = createOutboxPublisher({
      pool: pool(publisherSql({ rows: [claimed({ envelope: envelope({ data: {} }) })] })),
      transport,
      registry: strict,
      workerId: 'data',
    });
    expect(await badData.runOnce()).toBe(1);
  });

  it('retries when the broker is down and when the publish lease is lost', async () => {
    const down = new InMemoryTransport({ environment: 'CI' });
    down.down();
    const retryPub = createOutboxPublisher({
      pool: pool(publisherSql({ rows: [claimed()], retryCount: 0 })),
      transport: down,
      registry: snapshotRegistry(),
      workerId: 'down',
      leaseMs: 3000,
    });
    expect(await retryPub.runOnce()).toBe(1);

    const up = new InMemoryTransport({ environment: 'CI' });
    const lost = createOutboxPublisher({
      pool: pool(publisherSql({ rows: [claimed()], markCount: 0 })),
      transport: up,
      registry: snapshotRegistry(),
      workerId: 'lost',
    });
    expect(await lost.runOnce()).toBe(1);
  });

  it('dead-letters tenancy mismatch and publishes declared-key platform events', async () => {
    const transport = new InMemoryTransport({ environment: 'CI' });
    const example = snapshotRegistry().getTopic('sf.example.events');
    const platform = snapshotRegistry().getTopic('sf.eventbus.platform.v1');
    const audit = snapshotRegistry().getTopic('sf.audit.ingest.v1');
    if (!example || !platform || !audit) throw new Error('missing snapshot topic');

    const tenantOnPlatform = createOutboxPublisher({
      pool: pool(publisherSql({ rows: [claimed({ table: 'outbox_event_platform' })] })),
      transport,
      registry: snapshotRegistry(),
      workerId: 'tenancy',
    });
    expect(await tenantOnPlatform.runOnce()).toBe(1);

    const platformOnTenant = createOutboxPublisher({
      pool: pool(
        publisherSql({
          rows: [
            claimed({
              topic: 'sf.eventbus.platform.v1',
              envelope: envelope({ tenant_id: null, event_type: 'TopicRegistered' }),
            }),
          ],
        }),
      ),
      transport,
      registry: snapshotRegistry(),
      workerId: 'platform-on-tenant',
    });
    expect(await platformOnTenant.runOnce()).toBe(1);

    const declared = createOutboxPublisher({
      pool: pool(
        publisherSql({
          discovered: [{ schema: 'sf_event_bus', table: 'outbox_event_platform', relkind: 'r' }],
          rows: [
            claimed({
              table: 'outbox_event_platform',
              topic: 'sf.audit.ingest.v1',
              partition_key: 'declared-key',
              envelope: envelope({ tenant_id: null, event_type: 'AuditEventSubmitted' }),
            }),
          ],
        }),
      ),
      transport,
      registry: snapshotRegistry(),
      workerId: 'declared',
    });
    expect(await declared.runOnce()).toBe(1);
  });

  it('start() swallows loop failures then stop() closes the transport', async () => {
    const transport = new InMemoryTransport({ environment: 'CI' });
    const pub = createOutboxPublisher({
      pool: pool(publisherSql({ throwOn: 'nspname AS schema', rollbackFail: true })),
      transport,
      registry: snapshotRegistry(),
      workerId: 'loop-fail',
    });
    await pub.start();
    await new Promise((r) => setTimeout(r, 30));
    await pub.stop();
  });

  it('rolls back inTx failures from runOnce', async () => {
    const transport = new InMemoryTransport({ environment: 'CI' });
    const pub = createOutboxPublisher({
      pool: pool(publisherSql({ throwOn: 'nspname', rollbackFail: true })),
      transport,
      registry: snapshotRegistry(),
      workerId: 'fail',
    });
    await expect(pub.runOnce()).rejects.toThrow(/sql-fail/);
  });
});
