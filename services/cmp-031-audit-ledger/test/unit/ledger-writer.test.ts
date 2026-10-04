import { hashEvent } from '@serviceform/audit-client';
import { describe, expect, it } from 'vitest';
import { DuplicateContentError } from '../../src/domain/errors.js';
import { appendLedger } from '../../src/domain/ledger-writer.js';
import { ACTOR, AUDIT_ID, sampleEvent, systemCtx, T1, T2 } from '../support/fixtures.js';
import { createLedgerState, createMockClient } from '../support/mock-pool.js';

describe('appendLedger tenant chain', () => {
  it('rejects a body tenant that does not match the session', async () => {
    const client = createMockClient(createLedgerState());
    await expect(
      appendLedger(client, systemCtx(T1), sampleEvent({ tenant_id: T2 })),
    ).rejects.toMatchObject({
      code: 'SF-TEN-002',
    });
  });

  it('stores a new tenant row and treats an identical retry as idempotent', async () => {
    const state = createLedgerState();
    const client = createMockClient(state);
    const event = sampleEvent({ client_context: { source_ip: '203.0.113.10' } });
    const first = await appendLedger(client, systemCtx(T1), event);
    expect(first.duplicate).toBe(false);
    expect(first.chain_seq).toBe(1);
    expect(state.tenantEvents[0]?.record.client_context).toBeUndefined();
    expect(state.outbox).toHaveLength(1);
    const again = await appendLedger(client, systemCtx(T1), sampleEvent());
    expect(again).toMatchObject({ duplicate: true, chain_seq: 1, audit_id: AUDIT_ID });
    expect(state.tenantEvents).toHaveLength(1);
  });

  it('conflicts when the same audit_id arrives with different content', async () => {
    const state = createLedgerState();
    const client = createMockClient(state);
    await appendLedger(client, systemCtx(T1), sampleEvent());
    await expect(
      appendLedger(client, systemCtx(T1), sampleEvent({ action: 'OTHER_WRITE' })),
    ).rejects.toBeInstanceOf(DuplicateContentError);
  });

  it('treats a post-lock identical key as a duplicate (race)', async () => {
    const event = sampleEvent();
    const recorded = new Date('2026-10-03T11:00:00.000Z');
    const state = createLedgerState({
      injectTenantKeyAfterLock: {
        tenantId: T1,
        auditId: event.audit_id,
        key: { chain_seq: '7', recorded_at: recorded, content_hash: hashEvent(event) },
      },
    });
    const result = await appendLedger(createMockClient(state), systemCtx(T1), event);
    expect(result).toMatchObject({ duplicate: true, chain_seq: 7 });
    expect(state.tenantEvents).toHaveLength(0);
  });

  it('conflicts when the post-lock key has a different hash', async () => {
    const event = sampleEvent();
    const state = createLedgerState({
      injectTenantKeyAfterLock: {
        tenantId: T1,
        auditId: event.audit_id,
        key: {
          chain_seq: '2',
          recorded_at: new Date('2026-10-03T11:00:00.000Z'),
          content_hash: Buffer.alloc(32, 9),
        },
      },
    });
    await expect(
      appendLedger(createMockClient(state), systemCtx(T1), event),
    ).rejects.toBeInstanceOf(DuplicateContentError);
  });

  it('fails closed when the tenant head cannot be locked', async () => {
    const state = createLedgerState({ skipCreateTenantHead: true });
    await expect(
      appendLedger(createMockClient(state), systemCtx(T1), sampleEvent()),
    ).rejects.toThrow(/tenant head missing/);
  });
});

describe('appendLedger platform chain', () => {
  const plat = sampleEvent({
    tenant_id: null,
    classification: 'PLATFORM_OPERATIONAL',
    action_class: 'PRIVILEGED',
    reason: 'platform ingest',
  });
  const platCtx = systemCtx(null);

  it('stores a platform row and emits a platform outbox envelope', async () => {
    const state = createLedgerState({
      platformHead: {
        last_seq: '0',
        last_hash: Buffer.alloc(0),
        last_recorded_at: new Date('1970-01-01T00:00:00.000Z'),
      },
    });
    const first = await appendLedger(createMockClient(state), platCtx, plat);
    expect(first.duplicate).toBe(false);
    expect(state.platformEvents).toHaveLength(1);
    expect(state.platformOutbox).toHaveLength(1);
    const again = await appendLedger(createMockClient(state), platCtx, plat);
    expect(again.duplicate).toBe(true);
  });

  it('conflicts on platform content mismatch and race mismatch', async () => {
    const state = createLedgerState();
    const client = createMockClient(state);
    await appendLedger(client, platCtx, plat);
    await expect(
      appendLedger(client, platCtx, { ...plat, action: 'OTHER_PRIVILEGED', reason: 'other' }),
    ).rejects.toBeInstanceOf(DuplicateContentError);

    const race = createLedgerState({
      injectPlatformKeyAfterLock: {
        auditId: plat.audit_id,
        key: {
          chain_seq: '4',
          recorded_at: new Date('2026-10-03T11:00:00.000Z'),
          content_hash: Buffer.alloc(32, 3),
        },
      },
    });
    await expect(appendLedger(createMockClient(race), platCtx, plat)).rejects.toBeInstanceOf(
      DuplicateContentError,
    );
  });

  it('returns the raced identical platform key without inserting', async () => {
    const state = createLedgerState({
      injectPlatformKeyAfterLock: {
        auditId: plat.audit_id,
        key: {
          chain_seq: '9',
          recorded_at: new Date('2026-10-03T11:00:00.000Z'),
          content_hash: hashEvent(plat),
        },
      },
    });
    const result = await appendLedger(createMockClient(state), platCtx, plat);
    expect(result).toMatchObject({ duplicate: true, chain_seq: 9 });
  });

  it('fails closed when platform head or clock is missing', async () => {
    await expect(
      appendLedger(createMockClient(createLedgerState({ platformHead: undefined })), platCtx, plat),
    ).rejects.toThrow(/platform head missing/);
    await expect(
      appendLedger(createMockClient(createLedgerState({ missingClock: true })), platCtx, plat),
    ).rejects.toThrow(/clock read failed/);
  });
});

describe('appendLedger actor binding', () => {
  it('keeps the session actor on the stored record', async () => {
    const state = createLedgerState();
    await appendLedger(createMockClient(state), systemCtx(T1), sampleEvent());
    expect(state.tenantEvents[0]?.record.actor_id).toBe(ACTOR);
    expect(state.tenantEvents[0]?.record.tenant_id).toBe(T1);
  });
});
