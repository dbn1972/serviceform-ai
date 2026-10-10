import { describe, expect, it } from 'vitest';
import { deriveDocumentId } from '../../src/domain/document.js';
import type { ProjectionRule } from '../../src/domain/projection.js';
import { isAuditEvent, isEventEnvelope } from '../../src/domain/validate.js';
import {
  EVENT_TYPES,
  INDEXER_CONSUMER_GROUP,
  TOPIC_AUDIT,
  TOPIC_DOMAIN,
} from '../../src/events.js';
import { SearchIndexConsumer, type DocumentChangeData } from '../../src/indexer.js';
import {
  SimulatedProjectionRules,
  type ProjectionRulePort,
} from '../../src/ports/projection-rules.js';
import type { SearchTx } from '../../src/store/types.js';
import {
  FIXED_NOW,
  INDEXER,
  RULE,
  SOURCE_TOPIC,
  T1,
  T2,
  sourceEvent,
} from '../doubles/fixtures.js';
import { MemorySearchStore } from '../doubles/memory-store.js';

function setup(rules: ProjectionRulePort = new SimulatedProjectionRules([RULE])) {
  const store = new MemorySearchStore();
  const indexer = new SearchIndexConsumer({
    store,
    rules,
    indexerActorId: INDEXER,
    config: { environment: 'CI' },
    clock: () => FIXED_NOW,
  });
  return { store, indexer };
}

describe('SearchIndexConsumer projection', () => {
  it('indexes declared facets only and retains source identity and version', async () => {
    const { store, indexer } = setup();
    const env = sourceEvent({ tenant: T1, version: 4 });
    const out = await indexer.ingest({ topic: SOURCE_TOPIC, envelope: env });
    const documentId = deriveDocumentId(T1, 'CMP-015', env.aggregate_id);
    expect(out).toEqual({
      outcome: 'INDEXED',
      document_id: documentId,
      revision: 1,
      source_version: 4,
    });

    const [row] = store.state.documents;
    expect(row).toMatchObject({
      document_id: documentId,
      tenant_id: T1,
      source_cmp_id: 'CMP-015',
      source_record_id: env.aggregate_id,
      source_aggregate_type: 'ApplicationCase',
      source_topic: SOURCE_TOPIC,
      source_version: 4,
      source_event_id: env.event_id,
      source_event_type: 'CaseSubmitted',
      projection_rule_id: RULE.rule_id,
      projection_rule_version: RULE.rule_version,
      status: 'ACTIVE',
      revision: 1,
      indexed_at: FIXED_NOW.toISOString(),
    });
    expect(row?.facets).toEqual({
      service_code: 'GENERIC_CERTIFICATE',
      state: 'SUBMITTED',
      office_code: 'OFFICE_A',
    });
    expect(JSON.stringify(store.state)).not.toContain('must-never-be-indexed');
    expect(store.sessions[0]).toMatchObject({
      tenantId: T1,
      actorType: 'SYSTEM',
      actorId: INDEXER,
    });
    expect(store.state.inbox).toEqual([
      { tenant_id: T1, consumer_group: INDEXER_CONSUMER_GROUP, event_id: env.event_id },
    ]);
  });

  it('writes a domain event and an audit event to the outbox in the same transaction', async () => {
    const { store, indexer } = setup();
    const env = sourceEvent({ tenant: T1 });
    await indexer.ingest({ topic: SOURCE_TOPIC, envelope: env });
    expect(store.state.outbox.map((o) => [o.topic, o.envelope.event_type])).toEqual([
      [TOPIC_DOMAIN, EVENT_TYPES.indexed],
      [TOPIC_AUDIT, EVENT_TYPES.audit],
    ]);
    for (const o of store.state.outbox) {
      expect(isEventEnvelope(o.envelope)).toBe(true);
      expect(o.envelope.tenant_id).toBe(T1);
      expect(o.envelope.causation_id).toBe(env.event_id);
      expect(o.envelope.correlation_id).toBe(env.correlation_id);
      expect(o.envelope.actor).toEqual({ type: 'SYSTEM', id: INDEXER });
    }
    const data = store.state.outbox[0]?.envelope.data as DocumentChangeData;
    expect(data.document.facets).not.toHaveProperty('applicant_name');
    expect(data.source).toEqual({
      aggregate_type: 'ApplicationCase',
      version: 1,
      event_id: env.event_id,
      event_type: 'CaseSubmitted',
    });
    expect(isAuditEvent(store.state.outbox[1]?.envelope.data)).toBe(true);
  });

  it('is idempotent on re-delivery of the same event', async () => {
    const { store, indexer } = setup();
    const env = sourceEvent({ tenant: T1 });
    await indexer.ingest({ topic: SOURCE_TOPIC, envelope: env });
    const again = await indexer.ingest({ topic: SOURCE_TOPIC, envelope: structuredClone(env) });
    expect(again.outcome).toBe('DUPLICATE');
    expect(store.state.documents).toHaveLength(1);
    expect(store.state.outbox).toHaveLength(2);
  });

  it('advances on newer source versions and ignores stale ones', async () => {
    const { store, indexer } = setup();
    const id = '44444444-4444-4444-8444-444444444444';
    await indexer.ingest({
      topic: SOURCE_TOPIC,
      envelope: sourceEvent({ tenant: T1, aggregateId: id, version: 2 }),
    });
    const newer = sourceEvent({
      tenant: T1,
      aggregateId: id,
      version: 5,
      eventType: 'CaseStateChanged',
      data: { service_code: 'GENERIC_CERTIFICATE', state: 'APPROVED' },
    });
    expect(await indexer.ingest({ topic: SOURCE_TOPIC, envelope: newer })).toMatchObject({
      outcome: 'INDEXED',
      revision: 2,
      source_version: 5,
    });
    const stale = sourceEvent({ tenant: T1, aggregateId: id, version: 3 });
    expect((await indexer.ingest({ topic: SOURCE_TOPIC, envelope: stale })).outcome).toBe('STALE');
    const equal = sourceEvent({ tenant: T1, aggregateId: id, version: 5 });
    expect((await indexer.ingest({ topic: SOURCE_TOPIC, envelope: equal })).outcome).toBe('STALE');
    expect(store.state.documents[0]).toMatchObject({
      source_version: 5,
      source_event_id: newer.event_id,
      revision: 2,
      facets: { service_code: 'GENERIC_CERTIFICATE', state: 'APPROVED' },
    });
    expect(store.state.outbox).toHaveLength(4);
  });

  it('tombstones on remove events and a late older upsert cannot resurrect it', async () => {
    const { store, indexer } = setup();
    const id = '55555555-5555-4555-8555-555555555555';
    await indexer.ingest({
      topic: SOURCE_TOPIC,
      envelope: sourceEvent({ tenant: T1, aggregateId: id, version: 1 }),
    });
    const removed = await indexer.ingest({
      topic: SOURCE_TOPIC,
      envelope: sourceEvent({
        tenant: T1,
        aggregateId: id,
        version: 3,
        eventType: 'CaseWithdrawn',
        data: {},
      }),
    });
    expect(removed).toMatchObject({ outcome: 'REMOVED', revision: 2 });
    expect(store.state.documents[0]).toMatchObject({ status: 'REMOVED', facets: {} });
    expect(store.state.outbox[2]?.envelope.event_type).toBe(EVENT_TYPES.removed);
    const late = await indexer.ingest({
      topic: SOURCE_TOPIC,
      envelope: sourceEvent({ tenant: T1, aggregateId: id, version: 2 }),
    });
    expect(late.outcome).toBe('STALE');
    expect(store.state.documents[0]?.status).toBe('REMOVED');
  });

  it('records a tombstone when the remove arrives before any upsert', async () => {
    const { store, indexer } = setup();
    const out = await indexer.ingest({
      topic: SOURCE_TOPIC,
      envelope: sourceEvent({ tenant: T1, version: 7, eventType: 'CaseWithdrawn', data: {} }),
    });
    expect(out).toMatchObject({ outcome: 'REMOVED', revision: 1, source_version: 7 });
    expect(store.state.documents[0]).toMatchObject({ status: 'REMOVED', facets: {} });
  });

  it('keeps the same source record in two tenants as two isolated documents', async () => {
    const { store, indexer } = setup();
    const id = '66666666-6666-4666-8666-666666666666';
    await indexer.ingest({
      topic: SOURCE_TOPIC,
      envelope: sourceEvent({ tenant: T1, aggregateId: id }),
    });
    await indexer.ingest({
      topic: SOURCE_TOPIC,
      envelope: sourceEvent({ tenant: T2, aggregateId: id }),
    });
    const [a, b] = store.state.documents;
    expect(a?.tenant_id).toBe(T1);
    expect(b?.tenant_id).toBe(T2);
    expect(a?.document_id).not.toBe(b?.document_id);
    expect(store.sessions.map((s) => s.tenantId)).toEqual([T1, T2]);
    expect(store.state.outbox.every((o) => o.tenant_id === o.envelope.tenant_id)).toBe(true);
  });
});

describe('SearchIndexConsumer skips and failures', () => {
  it('skips platform (tenant_id null) events without opening a transaction', async () => {
    const { store, indexer } = setup();
    const out = await indexer.ingest({
      topic: SOURCE_TOPIC,
      envelope: sourceEvent({ tenant: null }),
    });
    expect(out).toEqual({ outcome: 'SKIPPED', reason: 'NOT_TENANT_SCOPED' });
    expect(store.sessions).toEqual([]);
  });

  it('skips events with no published projection rule (default port)', async () => {
    const store = new MemorySearchStore();
    const indexer = new SearchIndexConsumer({
      store,
      indexerActorId: INDEXER,
      config: { environment: 'PRODUCTION' },
    });
    expect(
      await indexer.ingest({ topic: SOURCE_TOPIC, envelope: sourceEvent({ tenant: T1 }) }),
    ).toEqual({
      outcome: 'SKIPPED',
      reason: 'NO_PROJECTION_RULE',
    });
    expect(store.sessions).toEqual([]);
  });

  it('skips event types the rule does not project', async () => {
    const { indexer } = setup({ resolve: async () => RULE });
    expect(
      await indexer.ingest({
        topic: SOURCE_TOPIC,
        envelope: sourceEvent({ tenant: T1, eventType: 'CaseNoted' }),
      }),
    ).toEqual({ outcome: 'SKIPPED', reason: 'EVENT_TYPE_NOT_PROJECTED' });
  });

  it.each([
    ['INVALID_TOPIC', { topic: 'x', envelope: sourceEvent({ tenant: T1 }) }],
    ['INVALID_ENVELOPE', { topic: SOURCE_TOPIC, envelope: { event_id: 'x' } }],
  ])('rejects %s', async (code, delivery) => {
    const { indexer } = setup();
    await expect(indexer.ingest(delivery)).rejects.toMatchObject({
      code: 'SF-SYS-003',
      details: [{ code }],
    });
  });

  it('rejects malformed or mismatched rules from the metadata port', async () => {
    const bad = setup({
      resolve: async () => ({ ...RULE, status: 'DRAFT' }) as unknown as ProjectionRule,
    });
    await expect(
      bad.indexer.ingest({ topic: SOURCE_TOPIC, envelope: sourceEvent({ tenant: T1 }) }),
    ).rejects.toMatchObject({ details: [{ code: 'INVALID_PROJECTION_RULE' }] });
    const mismatch = setup({ resolve: async () => ({ ...RULE, topic: 'sf.other.events.v1' }) });
    await expect(
      mismatch.indexer.ingest({ topic: SOURCE_TOPIC, envelope: sourceEvent({ tenant: T1 }) }),
    ).rejects.toMatchObject({ details: [{ code: 'PROJECTION_RULE_MISMATCH' }] });
  });

  it('rejects events missing a required facet without writing anything', async () => {
    const { store, indexer } = setup();
    await expect(
      indexer.ingest({
        topic: SOURCE_TOPIC,
        envelope: sourceEvent({ tenant: T1, data: { state: 'X' } }),
      }),
    ).rejects.toMatchObject({ details: [{ code: 'REQUIRED_FACET_MISSING' }] });
    expect(store.state.documents).toEqual([]);
    expect(store.state.inbox).toEqual([]);
  });

  it('fails closed on a lost optimistic update', async () => {
    const { store, indexer } = setup();
    const id = '77777777-7777-4777-8777-777777777777';
    await indexer.ingest({
      topic: SOURCE_TOPIC,
      envelope: sourceEvent({ tenant: T1, aggregateId: id }),
    });
    const original = store.withTx.bind(store);
    store.withTx = (session, fn) =>
      original(session, (tx) =>
        fn(
          new Proxy(tx, {
            get(t, p, r) {
              if (p === 'updateDocument') return async () => false;
              return Reflect.get(t, p, r) as unknown;
            },
          }) as SearchTx,
        ),
      );
    await expect(
      indexer.ingest({
        topic: SOURCE_TOPIC,
        envelope: sourceEvent({ tenant: T1, aggregateId: id, version: 2 }),
      }),
    ).rejects.toMatchObject({ code: 'SF-APP-001', details: [{ code: 'CONCURRENT_UPDATE' }] });
  });

  it('refuses SIMULATED rules outside simulation environments and invalid indexer identity', () => {
    const store = new MemorySearchStore();
    const rules = new SimulatedProjectionRules([RULE]);
    for (const environment of ['PRODUCTION', 'UAT'] as const) {
      expect(
        () =>
          new SearchIndexConsumer({
            store,
            rules,
            indexerActorId: INDEXER,
            config: { environment },
          }),
      ).toThrow(expect.objectContaining({ code: 'SF-SYS-003' }));
    }
    expect(
      () =>
        new SearchIndexConsumer({
          store,
          rules,
          indexerActorId: 'nope',
          config: { environment: 'CI' },
        }),
    ).toThrow(expect.objectContaining({ details: [{ code: 'INDEXER_ACTOR_ID_INVALID' }] }));
  });

  it('resolves rules through the port before the domain transaction opens', async () => {
    const seen: boolean[] = [];
    const { indexer } = setup({
      resolve: async () => {
        const { inDomainTransaction } = await import('../../src/tx-scope.js');
        seen.push(inDomainTransaction());
        return RULE;
      },
    });
    await indexer.ingest({ topic: SOURCE_TOPIC, envelope: sourceEvent({ tenant: T1 }) });
    expect(seen).toEqual([false]);
  });
});
