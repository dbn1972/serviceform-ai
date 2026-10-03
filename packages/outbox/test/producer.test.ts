import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@serviceform/contracts';
import { insertOutboxEvent, MAX_ENVELOPE_BYTES, OutboxError } from '../src/index.js';
import type { OutboxTx } from '../src/tx.js';

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

function fakeTx(currentTenant: string | null, onInsert?: (sql: string) => void): OutboxTx {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('current_tenant_id')) {
        return { rows: [{ tid: currentTenant }], rowCount: 1 };
      }
      onInsert?.(sql);
      void params;
      return { rows: [], rowCount: 1 };
    },
  } as unknown as OutboxTx;
}

describe('insertOutboxEvent (U1-U3, U10)', () => {
  it('rejects an invalid envelope with SF-SYS-003 and no insert', async () => {
    let inserted = false;
    await expect(
      insertOutboxEvent(
        fakeTx(T1, () => (inserted = true)),
        {
          schema: 'sf_event_bus',
          topic: 'sf.example.events',
          envelope: { hello: 'nope' } as unknown as EventEnvelope,
        },
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
    expect(inserted).toBe(false);
  });

  it('rejects tenant mismatch with SF-TEN-002', async () => {
    await expect(
      insertOutboxEvent(fakeTx('22222222-2222-4222-8222-222222222222'), {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        envelope: envelope(),
      }),
    ).rejects.toBeInstanceOf(OutboxError);
    await expect(
      insertOutboxEvent(fakeTx('22222222-2222-4222-8222-222222222222'), {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        envelope: envelope(),
      }),
    ).rejects.toMatchObject({ code: 'SF-TEN-002' });
  });

  it('rejects a tenant event with no context using SF-TEN-001', async () => {
    await expect(
      insertOutboxEvent(fakeTx(null), {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        envelope: envelope(),
      }),
    ).rejects.toMatchObject({ code: 'SF-TEN-001' });
  });

  it('rejects oversize payloads counted in bytes', async () => {
    const big = envelope({ data: { blob: 'x'.repeat(MAX_ENVELOPE_BYTES) } });
    await expect(
      insertOutboxEvent(fakeTx(T1), {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        envelope: big,
      }),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
  });

  it('inserts tenant and allowlisted platform rows', async () => {
    const sqls: string[] = [];
    const tx = fakeTx(T1, (sql) => sqls.push(sql));
    await insertOutboxEvent(tx, {
      schema: 'sf_event_bus',
      topic: 'sf.example.events',
      envelope: envelope(),
    });
    expect(sqls.some((s) => s.includes('INSERT INTO'))).toBe(true);
    sqls.length = 0;
    await insertOutboxEvent(fakeTx(T1), {
      schema: 'sf_event_bus',
      topic: 'sf.eventbus.platform.v1',
      platformAllowlist: ['AuditEventSubmitted'],
      envelope: envelope({ tenant_id: null, event_type: 'AuditEventSubmitted' }),
    });
    await insertOutboxEvent(fakeTx(null), {
      schema: 'sf_event_bus',
      topic: 'sf.eventbus.platform.v1',
      envelope: envelope({ tenant_id: null, event_type: 'TopicRegistered' }),
    });
  });

  it('rejects a platform event that is not allowlisted in a tenant transaction', async () => {
    await expect(
      insertOutboxEvent(fakeTx(T1), {
        schema: 'sf_event_bus',
        topic: 'sf.eventbus.platform.v1',
        envelope: envelope({ tenant_id: null, event_type: 'TopicRegistered' }),
      }),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
  });

  it('treats a missing tenant-context row as null tenant', async () => {
    const tx = {
      query: async (sql: string) => {
        if (sql.includes('current_tenant_id')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 1 };
      },
    } as unknown as OutboxTx;
    await expect(
      insertOutboxEvent(tx, {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        envelope: envelope(),
      }),
    ).rejects.toMatchObject({ code: 'SF-TEN-001' });
  });

  it('rejects an empty or overlong partition key', async () => {
    await expect(
      insertOutboxEvent(fakeTx(T1), {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        partitionKey: '',
        envelope: envelope(),
      }),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
    await expect(
      insertOutboxEvent(fakeTx(T1), {
        schema: 'sf_event_bus',
        topic: 'sf.example.events',
        partitionKey: 'k'.repeat(201),
        envelope: envelope(),
      }),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
  });
});
