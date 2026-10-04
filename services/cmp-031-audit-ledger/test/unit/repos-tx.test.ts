import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@serviceform/contracts';
import { AuditError } from '../../src/domain/errors.js';
import { encodeCursor, parseAuditQuery } from '../../src/domain/query-filters.js';
import {
  findPlatformKey,
  findTenantKey,
  insertPlatformLedger,
  insertTenantLedger,
  listPlatformChain,
  listTenantChain,
  lockPlatformHead,
  lockTenantHead,
  nextRecordedAt,
  updatePlatformHead,
  updateTenantHead,
} from '../../src/repo/ledger-repo.js';
import { insertAuditRecordCreated, insertInbox } from '../../src/repo/outbox-repo.js';
import { queryTenantAudit } from '../../src/repo/query-repo.js';
import { withTenantTx } from '../../src/repo/tx.js';
import { sampleEvent, submittedEnvelope, systemCtx, T1 } from '../support/fixtures.js';
import { createLedgerState, createMockClient, createMockPool } from '../support/mock-pool.js';

describe('withTenantTx', () => {
  it('applies session settings and commits on success', async () => {
    const state = createLedgerState();
    const value = await withTenantTx(createMockPool(state), systemCtx(T1), async (client) => {
      await client.query('SELECT set_config($1, $2, true)', ['app.cell_id', 'cell-01']);
      return 42;
    });
    expect(value).toBe(42);
  });

  it('rolls back on failure and still throws when rollback itself fails', async () => {
    const boom = new Error('write failed');
    await expect(
      withTenantTx(createMockPool(createLedgerState()), systemCtx(T1), async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    const rollbackFail = createLedgerState({ rollbackError: new Error('rollback') });
    await expect(
      withTenantTx(createMockPool(rollbackFail), systemCtx(null), async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});

describe('ledger-repo', () => {
  it('locks, inserts, lists, and updates a tenant chain', async () => {
    const state = createLedgerState();
    const client = createMockClient(state);
    const head = await lockTenantHead(client, T1);
    expect(head.last_seq).toBe('0');
    const recorded = new Date('2026-10-03T12:00:00.000Z');
    const event = sampleEvent();
    await insertTenantLedger(client, {
      tenantId: T1,
      chainSeq: 1,
      recordedAt: recorded,
      auditId: event.audit_id,
      record: event,
      prevHash: head.last_hash,
      rowHash: Buffer.alloc(32, 1),
      contentHash: Buffer.alloc(32, 2),
    });
    await updateTenantHead(client, T1, 1, Buffer.alloc(32, 1), recorded);
    const key = await findTenantKey(client, T1, event.audit_id);
    expect(key?.chain_seq).toBe('1');
    const rows = await listTenantChain(client, T1);
    expect(rows).toHaveLength(1);
    expect(await nextRecordedAt(client, recorded)).toEqual(state.recordedAt);
  });

  it('locks and lists the platform chain', async () => {
    const state = createLedgerState();
    const client = createMockClient(state);
    const head = await lockPlatformHead(client);
    const recorded = new Date('2026-10-03T12:00:00.000Z');
    await insertPlatformLedger(client, {
      chainSeq: 1,
      recordedAt: recorded,
      auditId: sampleEvent().audit_id,
      record: sampleEvent({ tenant_id: null, classification: 'PLATFORM_OPERATIONAL' }),
      prevHash: head.last_hash,
      rowHash: Buffer.alloc(32, 4),
      contentHash: Buffer.alloc(32, 5),
    });
    await updatePlatformHead(client, 1, Buffer.alloc(32, 4), recorded);
    expect(await findPlatformKey(client, sampleEvent().audit_id)).toBeDefined();
    expect(await listPlatformChain(client)).toHaveLength(1);
  });
});

describe('outbox-repo', () => {
  it('rejects an invalid AuditRecordCreated envelope', async () => {
    await expect(
      insertAuditRecordCreated(createMockClient(createLedgerState()), {
        event_id: 'not-a-uuid',
      } as never),
    ).rejects.toBeInstanceOf(AuditError);
  });

  it('inserts tenant and platform outbox and reports inbox idempotency', async () => {
    const state = createLedgerState();
    const client = createMockClient(state);
    const env = submittedEnvelope(sampleEvent({ tenant_id: T1 }), {
      event_type: 'AuditRecordCreated',
    });
    await insertAuditRecordCreated(client, env as unknown as EventEnvelope);
    expect(state.outbox).toHaveLength(1);
    const platform = submittedEnvelope(sampleEvent({ tenant_id: null }), {
      event_type: 'AuditRecordCreated',
      tenant_id: null,
    });
    await insertAuditRecordCreated(client, platform as unknown as EventEnvelope);
    expect(state.platformOutbox).toHaveLength(1);
    expect(await insertInbox(client, env.event_id, T1)).toBe(true);
    expect(await insertInbox(client, env.event_id, T1)).toBe(false);
    expect(await insertInbox(client, env.event_id, null)).toBe(true);
    expect(await insertInbox(client, env.event_id, null)).toBe(false);
  });
});

describe('queryTenantAudit', () => {
  it('pages and encodes a cursor when more rows exist', async () => {
    const event = sampleEvent();
    const rows = [1, 2, 3].map((seq) => ({
      tenant_id: T1,
      chain_seq: String(seq),
      recorded_at: new Date(`2026-10-0${String(seq)}T12:00:00.000Z`),
      audit_id: event.audit_id,
      record: event,
      prev_hash: Buffer.alloc(32),
      row_hash: Buffer.alloc(32, seq),
    }));
    const page = await queryTenantAudit(
      createMockClient(createLedgerState({ tenantEvents: rows })),
      T1,
      {
        from: new Date('2026-10-01T00:00:00Z'),
        to: new Date('2026-10-31T00:00:00Z'),
        actor_id: event.actor_id,
        action: 'WRITE',
        action_class: 'WRITE',
        resource_type: 'ExampleAggregate',
        resource_id: 'res-1',
        result: 'SUCCESS',
        correlation_id: event.correlation_id,
        cursor: { recorded_at: '2026-10-01T00:00:00.000Z', chain_seq: 0 },
        limit: 2,
      },
    );
    expect(page.items).toHaveLength(2);
    const cursorRow = rows[1];
    expect(cursorRow).toBeDefined();
    if (cursorRow === undefined) throw new Error('expected second row');
    expect(page.next_cursor).toBe(encodeCursor(cursorRow.recorded_at.toISOString(), 2));
  });

  it('omits next_cursor on the last page', async () => {
    const event = sampleEvent();
    const page = await queryTenantAudit(
      createMockClient(
        createLedgerState({
          tenantEvents: [
            {
              tenant_id: T1,
              chain_seq: '1',
              recorded_at: new Date('2026-10-03T12:00:00.000Z'),
              audit_id: event.audit_id,
              record: event,
              prev_hash: Buffer.alloc(32),
              row_hash: Buffer.alloc(32, 1),
            },
          ],
        }),
      ),
      T1,
      parseAuditQuery(
        { from: '2026-10-01T00:00:00Z', to: '2026-10-31T00:00:00Z', limit: 50 },
        31,
        200,
      ),
    );
    expect(page.items).toHaveLength(1);
    expect(page.next_cursor).toBeUndefined();
  });
});
