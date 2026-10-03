import { describe, expect, it } from 'vitest';
import { handleEnvelope } from '../../src/consumer/handle-envelope.js';
import { sampleEvent, submittedEnvelope, T2 } from '../support/fixtures.js';
import { createLedgerState, createMockPool } from '../support/mock-pool.js';

describe('handleEnvelope ingest', () => {
  it('dead-letters tenant mismatch, missing platform source, and PII in free text', async () => {
    const pool = createMockPool(createLedgerState());
    const tenant = await handleEnvelope(pool, submittedEnvelope(sampleEvent(), { tenant_id: T2 }), {
      platformSources: [],
    });
    expect(tenant).toEqual({ status: 'dead_lettered', reason: 'TENANT_MISMATCH' });

    const platformEvent = sampleEvent({
      tenant_id: null,
      classification: 'PLATFORM_OPERATIONAL',
    });
    const platform = await handleEnvelope(
      pool,
      submittedEnvelope(platformEvent, { tenant_id: null }),
      {
        platformSources: ['sf-source-platform'],
      },
    );
    expect(platform).toEqual({ status: 'dead_lettered', reason: 'PLATFORM_SOURCE' });

    const pii = await handleEnvelope(
      pool,
      submittedEnvelope(sampleEvent({ reason: 'contact user@example.com' })),
      { platformSources: [] },
    );
    expect(pii).toEqual({ status: 'dead_lettered', reason: 'PII_FIELD_REJECTED' });
  });

  it('dead-letters an envelope that fails schema validation', async () => {
    const result = await handleEnvelope(
      createMockPool(createLedgerState()),
      { event_id: 'nope' } as never,
      { platformSources: [] },
    );
    expect(result).toEqual({ status: 'dead_lettered', reason: 'INVALID_ENVELOPE' });
  });

  it('stores a new envelope and marks a replay already_applied', async () => {
    const state = createLedgerState();
    const pool = createMockPool(state);
    const env = submittedEnvelope();
    const stored = await handleEnvelope(pool, env, { platformSources: [] });
    expect(stored).toEqual({ status: 'stored', audit_id: env.aggregate_id });
    expect(state.tenantEvents).toHaveLength(1);
    const replay = await handleEnvelope(pool, env, { platformSources: [] });
    expect(replay).toEqual({ status: 'already_applied', audit_id: env.aggregate_id });
  });

  it('returns duplicate when the ledger already has the same content under a new inbox id', async () => {
    const state = createLedgerState();
    const pool = createMockPool(state);
    const first = submittedEnvelope();
    await handleEnvelope(pool, first, { platformSources: [] });
    const second = submittedEnvelope(sampleEvent(), {
      event_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    const dup = await handleEnvelope(pool, second, { platformSources: [] });
    expect(dup).toEqual({ status: 'duplicate', audit_id: first.aggregate_id });
  });

  it('stores a platform envelope only from an allow-listed source', async () => {
    const event = sampleEvent({
      tenant_id: null,
      classification: 'PLATFORM_OPERATIONAL',
      action_class: 'PRIVILEGED',
      reason: 'platform ingest',
    });
    const env = submittedEnvelope(event, { tenant_id: null });
    const stored = await handleEnvelope(createMockPool(createLedgerState()), env, {
      source: 'sf-source-platform',
      platformSources: ['sf-source-platform'],
    });
    expect(stored.status).toBe('stored');
  });
});
