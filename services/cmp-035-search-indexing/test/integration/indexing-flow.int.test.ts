import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SearchIndexConsumer } from '../../src/indexer.js';
import { SimulatedProjectionRules } from '../../src/ports/projection-rules.js';
import { SearchQueryService, type SearchHit } from '../../src/service.js';
import { PgSearchStore } from '../../src/store/pg-store.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { ctx, INDEXER, RULE, SOURCE_TOPIC, sourceEvent } from '../doubles/fixtures.js';
import { asTenant, closeHarness, setupHarness, T1, T2, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

interface QueryBody {
  hits: SearchHit[];
  next_cursor: string | null;
}

describe('CMP-035 projection and tenant-safe query against real PostgreSQL (INT-010/INT-011)', () => {
  it('indexes per tenant, is idempotent and monotonic, and CROSS_TENANT_LEAKAGE = 0', async () => {
    const store = new PgSearchStore(h.rt);
    const indexer = new SearchIndexConsumer({
      store,
      rules: new SimulatedProjectionRules([RULE]),
      indexerActorId: INDEXER,
      config: { environment: 'CI' },
    });
    const service = new SearchQueryService({
      store,
      authorizer: new ContractAuthorizer(),
      config: { environment: 'CI' },
    });

    const shared = '99999999-9999-4999-8999-999999999999';
    const perTenant = 5;
    for (const tenant of [T1, T2]) {
      const first = sourceEvent({ tenant, aggregateId: shared, version: 1 });
      expect((await indexer.ingest({ topic: SOURCE_TOPIC, envelope: first })).outcome).toBe(
        'INDEXED',
      );
      expect((await indexer.ingest({ topic: SOURCE_TOPIC, envelope: first })).outcome).toBe(
        'DUPLICATE',
      );
      for (let i = 1; i < perTenant; i += 1) {
        await indexer.ingest({ topic: SOURCE_TOPIC, envelope: sourceEvent({ tenant }) });
      }
    }

    const advanced = await indexer.ingest({
      topic: SOURCE_TOPIC,
      envelope: sourceEvent({
        tenant: T1,
        aggregateId: shared,
        version: 4,
        eventType: 'CaseStateChanged',
        data: { service_code: 'GENERIC_CERTIFICATE', state: 'APPROVED' },
      }),
    });
    expect(advanced).toMatchObject({ outcome: 'INDEXED', revision: 2, source_version: 4 });
    const stale = await indexer.ingest({
      topic: SOURCE_TOPIC,
      envelope: sourceEvent({ tenant: T1, aggregateId: shared, version: 2 }),
    });
    expect(stale.outcome).toBe('STALE');

    let leakage = 0;
    let returned = 0;
    for (const tenant of [T1, T2]) {
      let after: string | null = null;
      const seen: SearchHit[] = [];
      do {
        const body: Record<string, unknown> = { limit: 2 };
        if (after) body['after'] = after;
        const page = (await service.query(ctx(tenant), body)).body as QueryBody;
        seen.push(...page.hits);
        after = page.next_cursor;
      } while (after);
      expect(seen).toHaveLength(perTenant);
      returned += seen.length;
      leakage += seen.filter((s) => s.document.tenant_id !== tenant).length;
      const sharedHit = seen.find((s) => s.document.source_record_id === shared);
      expect(sharedHit?.document.tenant_id).toBe(tenant);
      for (const s of seen) {
        expect(JSON.stringify(s)).not.toContain('must-never-be-indexed');
        expect(s.document.cross_tenant_fields_forbidden).toBe(true);
      }
    }
    expect(returned).toBe(perTenant * 2);
    expect(leakage).toBe(0);

    const approved = (await service.query(ctx(T1), { facets: { state: 'APPROVED' } }))
      .body as QueryBody;
    expect(
      approved.hits.map((x) => [x.document.source_record_id, x.source.version, x.revision]),
    ).toEqual([[shared, 4, 2]]);
    const t2Approved = (await service.query(ctx(T2), { facets: { state: 'APPROVED' } }))
      .body as QueryBody;
    expect(t2Approved.hits).toEqual([]);
    const t1Id = approved.hits[0]?.document.document_id;
    await expect(service.getDocument(ctx(T2), t1Id)).rejects.toMatchObject({ code: 'SF-SYS-002' });

    console.info(
      `EVIDENCE SF-M08-001 CROSS_TENANT_LEAKAGE=${leakage} returned=${returned} tenants=2 per_tenant=${perTenant}`,
    );

    await expect(
      asTenant(h.rt, T1, (c) => c.query('SELECT count(*)::int AS n FROM sf_search.outbox_event')),
    ).rejects.toThrow(/permission denied/);
    const audit = await h.admin.query(
      `SELECT topic, count(*)::int AS n, count(DISTINCT tenant_id)::int AS tenants
         FROM sf_search.outbox_event GROUP BY topic ORDER BY topic`,
    );
    expect(audit.rows).toEqual([
      { topic: 'sf.audit.ingest.v1', n: perTenant * 2 + 1, tenants: 2 },
      { topic: 'sf.search.events.v1', n: perTenant * 2 + 1, tenants: 2 },
    ]);
  });

  it('removes documents as tombstones without deleting the projection row', async () => {
    const store = new PgSearchStore(h.rt);
    const indexer = new SearchIndexConsumer({
      store,
      rules: new SimulatedProjectionRules([RULE]),
      indexerActorId: INDEXER,
      config: { environment: 'CI' },
    });
    const service = new SearchQueryService({
      store,
      authorizer: new ContractAuthorizer(),
      config: { environment: 'CI' },
    });
    const id = 'abababab-abab-4bab-8bab-abababababab';
    await indexer.ingest({
      topic: SOURCE_TOPIC,
      envelope: sourceEvent({ tenant: T1, aggregateId: id, version: 1 }),
    });
    const removed = await indexer.ingest({
      topic: SOURCE_TOPIC,
      envelope: sourceEvent({
        tenant: T1,
        aggregateId: id,
        version: 2,
        eventType: 'CaseWithdrawn',
        data: {},
      }),
    });
    expect(removed).toMatchObject({ outcome: 'REMOVED', revision: 2 });
    await expect(
      service.getDocument(ctx(T1), removed.outcome === 'REMOVED' ? removed.document_id : ''),
    ).rejects.toMatchObject({
      code: 'SF-SYS-002',
    });
    const row = await asTenant(h.rt, T1, (c) =>
      c.query(
        'SELECT status, facets, source_version FROM sf_search.search_document WHERE source_record_id = $1',
        [id],
      ),
    );
    expect(row.rows).toEqual([{ status: 'REMOVED', facets: {}, source_version: '2' }]);
  });
});
