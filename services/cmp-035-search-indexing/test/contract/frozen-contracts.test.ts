import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { authzInput } from '../../src/authz.js';
import { isSearchDocument } from '../../src/domain/document.js';
import { isRequestContext } from '../../src/domain/validate.js';
import { Cmp035Error, ERROR_CATALOGUE } from '../../src/errors.js';
import { errorResponse } from '../../src/http.js';
import { SearchIndexConsumer, type DocumentChangeData } from '../../src/indexer.js';
import { SimulatedProjectionRules } from '../../src/ports/projection-rules.js';
import { SearchQueryService, type SearchHit } from '../../src/service.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { ctx, INDEXER, RULE, SOURCE_TOPIC, T1, sourceEvent } from '../doubles/fixtures.js';
import { MemorySearchStore } from '../doubles/memory-store.js';
import { IDS, M08, REPO_ROOT, readJson, validator } from '../support/frozen.js';

const SERVICE = join(REPO_ROOT, 'services/cmp-035-search-indexing');
const MIGRATION = join(REPO_ROOT, 'db/migrations/1759600350000_cmp-035-search-indexing.sql');
const OUTBOX = join(REPO_ROOT, 'db/migrations/1759600350001_cmp-035-outbox.sql');

async function indexedFixture() {
  const store = new MemorySearchStore();
  const indexer = new SearchIndexConsumer({
    store,
    rules: new SimulatedProjectionRules([RULE]),
    indexerActorId: INDEXER,
    config: { environment: 'CI' },
  });
  await indexer.ingest({ topic: SOURCE_TOPIC, envelope: sourceEvent({ tenant: T1 }) });
  await indexer.ingest({
    topic: SOURCE_TOPIC,
    envelope: sourceEvent({ tenant: T1, eventType: 'CaseWithdrawn', data: {} }),
  });
  return store;
}

describe('SF-CON-SEARCH-DOCUMENT (FROZEN) conformance', () => {
  it('the frozen schema file is byte-identical to the contracts-lock hash', () => {
    const lock = readFileSync(join(REPO_ROOT, 'orchestrator/contracts-lock.yaml'), 'utf8');
    const block = lock.slice(lock.indexOf('id: SF-CON-SEARCH-DOCUMENT'));
    const expected = /schema_hash:\s*([0-9a-f]{64})/.exec(block)?.[1];
    const actual = createHash('sha256')
      .update(readFileSync(join(M08, 'schemas/search-document.schema.json')))
      .digest('hex');
    expect(actual).toBe(expected);
  });

  it('local guard agrees with the frozen schema on the frozen examples', () => {
    const v = validator(IDS.searchDocument);
    const good = readJson(join(M08, 'examples/valid/search-document.json'));
    const bad = readJson(join(M08, 'examples/invalid/search-document.cross-tenant.json'));
    expect(v(good).valid).toBe(true);
    expect(isSearchDocument(good)).toBe(true);
    expect(v(bad).valid).toBe(false);
    expect(isSearchDocument(bad)).toBe(false);
  });

  it('documents in emitted events and query hits validate against the frozen schema', async () => {
    const store = await indexedFixture();
    const v = validator(IDS.searchDocument);
    for (const o of store.state.outbox.filter((x) => x.topic === 'sf.search.events.v1')) {
      const data = o.envelope.data as DocumentChangeData;
      expect(v(data.document)).toEqual({ valid: true, errors: null });
    }
    const service = new SearchQueryService({
      store,
      authorizer: new ContractAuthorizer(),
      config: { environment: 'CI' },
    });
    const body = (await service.query(ctx(T1), {})).body as { hits: SearchHit[] };
    expect(body.hits).toHaveLength(1);
    for (const h of body.hits) expect(v(h.document)).toEqual({ valid: true, errors: null });
  });
});

describe('frozen shared contracts consumed by CMP-035', () => {
  it('error catalogue subset equals the FROZEN error-catalogue.json rows', () => {
    const frozen = readJson(
      join(REPO_ROOT, 'contracts/shared/error-catalogue.json'),
    ) as unknown as {
      codes: { code: string; message: string; http: number[] }[];
    };
    for (const [code, entry] of Object.entries(ERROR_CATALOGUE)) {
      const row = frozen.codes.find((c) => c.code === code);
      expect({ code, message: row?.message, http: row?.http }).toEqual({
        code,
        message: entry.message,
        http: [...entry.http],
      });
    }
  });

  it('emitted envelopes, audit events, request context, errors and authz input validate', async () => {
    const store = await indexedFixture();
    expect(store.state.outbox).toHaveLength(4);
    for (const o of store.state.outbox) {
      expect(validator(IDS.envelope)(o.envelope)).toEqual({ valid: true, errors: null });
      if (o.topic === 'sf.audit.ingest.v1') {
        expect(validator(IDS.audit)(o.envelope.data)).toEqual({ valid: true, errors: null });
      }
    }
    const c = ctx(T1);
    expect(validator(IDS.requestContext)(c).valid).toBe(true);
    expect(isRequestContext(c)).toBe(true);
    const err = errorResponse(
      new Cmp035Error('SF-SYS-003', { details: [{ code: 'X' }] }),
      c.correlation_id,
    );
    expect(validator(IDS.errorResponse)(err.body).valid).toBe(true);
    const input = authzInput(c, 'SEARCH_DOCUMENT_QUERY', new Date('2026-10-10T00:00:00.000Z'));
    expect(validator(IDS.authzInput)(input)).toEqual({ valid: true, errors: null });
  });

  it('isolation declarations validate against SF-CON-ISOLATION-DECLARATION', () => {
    const decls = JSON.parse(
      readFileSync(join(SERVICE, 'contracts/isolation.json'), 'utf8'),
    ) as unknown[];
    expect(decls.length).toBe(5);
    for (const d of decls) expect(validator(IDS.isolation)(d).valid).toBe(true);
  });

  it('outbox migration is the frozen template with schema/cmp replacements only', () => {
    const tmpl = readFileSync(join(REPO_ROOT, 'contracts/shared/sql/outbox.template.sql'), 'utf8');
    const applied = readFileSync(OUTBOX, 'utf8');
    const expected = tmpl.replaceAll('{schema}', 'sf_search').replaceAll('{cmp}', 'CMP-035');
    expect(applied.includes(expected)).toBe(true);
  });

  it('schema migration: NOLOGIN role, ENABLE+FORCE RLS, tenant accessor, no named-service SQL', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toMatch(/CREATE ROLE sf_cmp035_rw NOLOGIN NOSUPERUSER/);
    expect(sql).toMatch(/ALTER TABLE sf_search\.search_document ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE sf_search\.search_document FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/sf_platform\.current_tenant_id\(\)/);
    expect(sql).not.toMatch(/(?<!NO)BYPASSRLS/);
    expect(sql).not.toMatch(/sf_(?!search|platform|migrator|app|cmp035_rw)[a-z0-9_]+/);
    expect(sql).not.toMatch(/department\s*=|scheme\s*=/i);
  });
});
