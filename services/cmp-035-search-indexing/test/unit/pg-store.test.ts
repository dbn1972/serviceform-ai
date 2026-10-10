import { describe, expect, it } from 'vitest';
import { Cmp035Error, mapPgError } from '../../src/errors.js';
import { envelopeOf, auditEnvelope, TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/events.js';
import {
  PgSearchStore,
  SQL,
  documentFromRow,
  type SqlClient,
  type SqlQueryResult,
} from '../../src/store/pg-store.js';
import type { DbSession, SearchDocumentRow } from '../../src/store/types.js';
import { guardOutboundPort, runInDomainTransaction } from '../../src/tx-scope.js';
import { ctx, T1 } from '../doubles/fixtures.js';

interface Call {
  text: string;
  values: unknown[] | undefined;
}

class FakeClient implements SqlClient {
  calls: Call[] = [];
  released = 0;
  responses: Partial<SqlQueryResult>[] = [];
  failOn: ((text: string) => boolean) | null = null;
  failWith: unknown = null;

  async query(text: string, values?: unknown[]): Promise<SqlQueryResult> {
    this.calls.push({ text, values });
    if (this.failOn?.(text)) throw this.failWith;
    const control = ['BEGIN', 'COMMIT', 'ROLLBACK', 'SELECT set_config'].some((p) =>
      text.startsWith(p),
    );
    const next = control ? {} : (this.responses.shift() ?? {});
    return { rows: next.rows ?? [], rowCount: next.rowCount ?? 0 };
  }

  release(): void {
    this.released += 1;
  }
}

const SESSION: DbSession = {
  tenantId: T1,
  cellId: 'cell-01',
  actorType: 'SYSTEM',
  actorId: '5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e',
  correlationId: '99999999-9999-4999-8999-999999999999',
};

const ROW: SearchDocumentRow = {
  document_id: 'dddddddd-dddd-5ddd-8ddd-dddddddddddd',
  tenant_id: T1,
  cell_id: 'cell-01',
  source_cmp_id: 'CMP-015',
  source_record_id: '33333333-3333-4333-8333-333333333333',
  source_aggregate_type: 'ApplicationCase',
  source_topic: 'sf.case.events.v1',
  source_version: 2,
  source_event_id: '44444444-4444-4444-8444-444444444444',
  source_event_type: 'CaseSubmitted',
  source_occurred_at: '2026-10-10T01:00:00.000Z',
  projection_rule_id: '35353535-3535-4535-8535-353535353535',
  projection_rule_version: 1,
  facets: { state: 'SUBMITTED' },
  status: 'ACTIVE',
  revision: 1,
  indexed_at: '2026-10-10T01:00:01.000Z',
  updated_at: '2026-10-10T01:00:01.000Z',
  last_correlation_id: '99999999-9999-4999-8999-999999999999',
};

function store(client: FakeClient): PgSearchStore {
  return new PgSearchStore({ connect: async () => client });
}

describe('PgSearchStore transaction and session context', () => {
  it('sets SF-CON-DB-SESSION-CONTEXT keys transaction-locally and commits', async () => {
    const client = new FakeClient();
    await store(client).withTx(SESSION, async () => 'ok');
    expect(client.calls.map((c) => c.text)).toEqual([
      'BEGIN',
      ...Array(5).fill('SELECT set_config($1, $2, true)'),
      'COMMIT',
    ]);
    expect(client.calls.slice(1, 6).map((c) => c.values)).toEqual([
      ['app.tenant_id', T1],
      ['app.cell_id', 'cell-01'],
      ['app.actor_type', 'SYSTEM'],
      ['app.actor_id', SESSION.actorId],
      ['app.correlation_id', SESSION.correlationId],
    ]);
    expect(client.released).toBe(1);
  });

  it('rolls back, maps PG errors and releases on failure', async () => {
    const client = new FakeClient();
    client.failOn = (text) => text.startsWith('INSERT INTO sf_search.inbox_event');
    client.failWith = Object.assign(new Error('rls'), { code: '42501' });
    await expect(
      store(client).withTx(SESSION, (tx) => tx.recordInbox('cmp-035.indexer', ROW.source_event_id)),
    ).rejects.toMatchObject({ code: 'SF-TEN-002' });
    expect(client.calls.at(-1)?.text).toBe('ROLLBACK');
    expect(client.released).toBe(1);
  });

  it('tolerates a failing ROLLBACK', async () => {
    const client = new FakeClient();
    client.failOn = (text) => text === 'ROLLBACK';
    client.failWith = new Error('gone');
    await expect(
      store(client).withTx(SESSION, async (tx) => {
        await tx.getDocument(ROW.document_id);
        throw new Error('boom');
      }),
    ).rejects.toMatchObject({ code: 'SF-SYS-001' });
  });
});

describe('PgSearchStore statements are tenant-predicated', () => {
  it('binds the session tenant first on every read and write', async () => {
    const client = new FakeClient();
    client.responses = [
      { rowCount: 1 },
      { rows: [{ ...ROW, facets: JSON.stringify(ROW.facets) }] },
      { rows: [] },
      { rowCount: 1 },
      { rowCount: 0 },
      { rows: [{ ...ROW }] },
      { rowCount: 1 },
      { rowCount: 1 },
    ];
    const c = ctx(T1);
    const domain = envelopeOf({
      eventType: 'SearchDocumentIndexed',
      ctx: c,
      aggregateId: ROW.document_id.replace('-5ddd-', '-4ddd-'),
      aggregateVersion: 1,
      occurredAt: ROW.indexed_at,
      data: {},
    });
    const audit = auditEnvelope(c, {
      action: 'SEARCH_DOCUMENT_INDEX',
      actionClass: 'WRITE',
      resourceId: ROW.document_id,
      result: 'SUCCESS',
      occurredAt: ROW.indexed_at,
    });
    const result = await store(client).withTx(SESSION, async (tx) => {
      const inbox = await tx.recordInbox('cmp-035.indexer', ROW.source_event_id);
      const bySource = await tx.getDocumentBySource('CMP-015', ROW.source_record_id, {
        forUpdate: true,
      });
      const byId = await tx.getDocument(ROW.document_id);
      await tx.insertDocument(ROW);
      const updated = await tx.updateDocument({
        documentId: ROW.document_id,
        fromRevision: 1,
        fromSourceVersion: 2,
        sourceVersion: 3,
        sourceEventId: ROW.source_event_id,
        sourceEventType: 'CaseStateChanged',
        sourceOccurredAt: ROW.source_occurred_at,
        projectionRuleId: ROW.projection_rule_id,
        projectionRuleVersion: 1,
        facets: { state: 'APPROVED' },
        status: 'ACTIVE',
        updatedAt: ROW.updated_at,
        correlationId: ROW.last_correlation_id,
      });
      const hits = await tx.queryDocuments({
        sourceCmpId: null,
        facets: { state: 'X' },
        limit: 3,
        after: null,
      });
      await tx.insertOutbox(domain, TOPIC_DOMAIN);
      await tx.insertOutbox(audit, TOPIC_AUDIT);
      return { inbox, bySource, byId, updated, hits };
    });
    expect(result.inbox).toBe(true);
    expect(result.bySource).toEqual(ROW);
    expect(result.byId).toBeNull();
    expect(result.updated).toBe(false);
    expect(result.hits).toEqual([ROW]);

    const work = client.calls.slice(6, -1);
    expect(work.map((w) => w.text)).toEqual([
      SQL.insertInbox,
      `${SQL.selectBySource} FOR UPDATE`,
      SQL.selectById,
      SQL.insertD,
      SQL.updateD,
      SQL.query,
      SQL.insertOutbox,
      SQL.insertOutbox,
    ]);
    expect(work[0]?.values).toEqual(['cmp-035.indexer', ROW.source_event_id, T1]);
    for (const i of [1, 2, 5]) expect(work[i]?.values?.[0]).toBe(T1);
    expect(work[3]?.values?.[1]).toBe(T1);
    expect(work[3]?.values?.[13]).toBe(JSON.stringify(ROW.facets));
    expect(work[4]?.values?.slice(10, 14)).toEqual([T1, ROW.document_id, 1, 2]);
    expect(work[5]?.values).toEqual([T1, null, '{"state":"X"}', null, 3]);
    expect(work[6]?.values?.[3]).toBe(domain.aggregate_id);
    expect(work[7]?.values?.[3]).toBe(`audit:${audit.data.audit_id}`);
    for (const w of work) expect(w.text).toMatch(/sf_search\./);
    expect(SQL.query).toMatch(/WHERE tenant_id = \$1/);
    expect(SQL.updateD).toMatch(/WHERE tenant_id = \$11/);
  });

  it('documentFromRow normalises PG types', () => {
    const r = documentFromRow({
      ...ROW,
      source_version: '7',
      revision: '2',
      projection_rule_version: '1',
      source_occurred_at: new Date(ROW.source_occurred_at),
      facets: null,
    });
    expect(r).toMatchObject({ source_version: 7, revision: 2, facets: {} });
    expect(r.source_occurred_at).toBe(ROW.source_occurred_at);
  });
});

describe('error mapping and transaction scope', () => {
  it.each([
    [{ code: 'P0001', hint: 'SF_STALE_VERSION' }, 'SF-APP-001'],
    [{ code: 'P0001', hint: 'SF_RECORD_IMMUTABLE' }, 'SF-SYS-003'],
    [{ code: 'P0001', hint: 'OTHER' }, 'SF-SYS-001'],
    [{ code: '42501' }, 'SF-TEN-002'],
    [{ code: '23505' }, 'SF-APP-002'],
    [{ code: '23514' }, 'SF-SYS-003'],
    [{ code: '40001' }, 'SF-APP-001'],
    [{ code: '40P01' }, 'SF-APP-001'],
    [null, 'SF-SYS-001'],
  ])('maps %j to %s', (err, code) => {
    expect(mapPgError(err).code).toBe(code);
  });

  it('passes Cmp035Error through', () => {
    const e = new Cmp035Error('SF-AUTH-002');
    expect(mapPgError(e)).toBe(e);
  });

  it('refuses outbound port calls inside the domain transaction', async () => {
    const port = guardOutboundPort('authorization', { decide: async () => 1, label: 'x' });
    expect(port.label).toBe('x');
    await expect(port.decide()).resolves.toBe(1);
    await expect(runInDomainTransaction(async () => port.decide())).rejects.toMatchObject({
      code: 'SF-SYS-001',
      details: [{ code: 'NETWORK_IO_IN_DOMAIN_TX' }],
    });
  });
});
