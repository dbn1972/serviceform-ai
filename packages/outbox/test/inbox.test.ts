import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@serviceform/contracts';
import type pg from 'pg';
import { consumeWithInbox } from '../src/index.js';
import { snapshotRegistry } from '../src/snapshot.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

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

function msg(value: string, headers: Record<string, string> = {}, topic = 'sf.example.events') {
  return { topic, partition: 0, offset: '0', key: 'k', value, headers };
}

function pool(insertRowCount: number, rollbackFails = false): pg.Pool {
  return {
    connect: async () => ({
      query: async (sql: string) => {
        if (sql.startsWith('INSERT')) return { rowCount: insertRowCount };
        if (sql === 'ROLLBACK' && rollbackFails) throw new Error('rollback-fail');
        return { rowCount: 1 };
      },
      release: () => undefined,
    }),
  } as unknown as pg.Pool;
}

const baseOpts = {
  schema: 'sf_event_bus',
  consumerGroup: 'cmp038-unit',
  supportedVersions: [1],
  workerActor: { type: 'SYSTEM' as const, id: 'bf5c3dae-06c2-4f4e-97bf-e2ad8ec06b3b' },
  cellId: 'cell-01',
  registry: snapshotRegistry(),
};

describe('consumeWithInbox', () => {
  it('dead-letters invalid JSON, invalid envelopes, tenancy and header mismatches', async () => {
    const codes: string[] = [];
    const handler = consumeWithInbox({
      ...baseOpts,
      pool: pool(1),
      onConsumerDlq: async (_m, code) => {
        codes.push(code);
      },
      handler: async () => undefined,
    });
    await handler(msg('not-json'));
    await handler(msg('{}'));
    await handler(msg(JSON.stringify(envelope({ tenant_id: null }))));
    await handler(msg(JSON.stringify(envelope()), {}, 'sf.eventbus.platform.v1'));
    await handler(msg(JSON.stringify(envelope()), { 'sf-tenant-id': T2 }));
    await handler(
      msg(JSON.stringify(envelope({ tenant_id: 'AaAaAaAa-bBbB-4cCc-8dDd-EeEeEeEeEeEe' }))),
    );
    await handler(
      msg(JSON.stringify(envelope({ tenant_id: '00000000-0000-0000-0000-000000000000' }))),
    );
    await handler(
      msg(
        JSON.stringify(envelope({ tenant_id: null, event_type: 'TopicRegistered' })),
        { 'sf-tenant-id': T1 },
        'sf.eventbus.platform.v1',
      ),
    );
    expect(codes).toEqual([
      'ENVELOPE_INVALID',
      'ENVELOPE_INVALID',
      'TENANCY_MISMATCH',
      'TENANCY_MISMATCH',
      'TENANT_HEADER_MISMATCH',
      'TENANT_INVALID',
      'TENANT_INVALID',
      'TENANT_HEADER_MISMATCH',
    ]);
  });

  it('throws on unsupported schema version', async () => {
    const handler = consumeWithInbox({
      ...baseOpts,
      supportedVersions: [1],
      pool: pool(1),
      onConsumerDlq: async () => undefined,
      handler: async () => undefined,
    });
    await expect(
      handler(msg(JSON.stringify(envelope({ schema_version: 9 })))),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
  });

  it('inserts tenant and platform rows, skips duplicates, and rolls back handler errors', async () => {
    let applied = 0;
    const tenant = consumeWithInbox({
      ...baseOpts,
      pool: pool(1),
      onConsumerDlq: async () => undefined,
      handler: async () => {
        applied += 1;
      },
    });
    await tenant(msg(JSON.stringify(envelope()), { 'sf-tenant-id': T1 }));
    expect(applied).toBe(1);

    const dup = consumeWithInbox({
      ...baseOpts,
      pool: pool(0),
      onConsumerDlq: async () => undefined,
      handler: async () => {
        applied += 1;
      },
    });
    await dup(msg(JSON.stringify(envelope())));
    expect(applied).toBe(1);

    const boom = consumeWithInbox({
      ...baseOpts,
      pool: pool(1, true),
      onConsumerDlq: async () => undefined,
      handler: async () => {
        throw new Error('handler-fail');
      },
    });
    await expect(boom(msg(JSON.stringify(envelope())))).rejects.toThrow(/handler-fail/);

    const unknownTopic = consumeWithInbox({
      ...baseOpts,
      pool: pool(1),
      onConsumerDlq: async () => undefined,
      handler: async () => {
        applied += 1;
      },
    });
    await unknownTopic(msg(JSON.stringify(envelope()), {}, 'sf.unknown.events'));
    expect(applied).toBe(2);

    const platform = consumeWithInbox({
      ...baseOpts,
      pool: pool(1),
      onConsumerDlq: async () => undefined,
      handler: async () => {
        applied += 1;
      },
    });
    await platform(
      msg(
        JSON.stringify(envelope({ tenant_id: null, event_type: 'TopicRegistered' })),
        {},
        'sf.eventbus.platform.v1',
      ),
    );
    expect(applied).toBe(3);
  });
});
