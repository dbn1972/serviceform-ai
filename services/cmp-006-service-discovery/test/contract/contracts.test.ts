import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import {
  DOMAIN_EVENT_TYPES,
  QUERY_EVENT_TYPES,
  TOPIC_AUDIT,
  TOPIC_DOMAIN,
} from '../../src/outbox.js';
import { ctxFor, JUR_CHILD, queryBody, SVC_1, SVC_2, TENANT_A } from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';
import type { MemoryDiscoveryRepository } from '../doubles/memory-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1760370000000_cmp-006-service-discovery.sql';
const OUTBOX_MIGRATION = 'db/migrations/1760370000001_cmp-006-outbox.sql';
const FROZEN_SCHEMA = 'contracts/m08/schemas/discovery-query.schema.json';
const FROZEN_ID = 'https://contracts.serviceform.ai/m08/discovery-query/v1';

const requireFromContracts = createRequire(join(repoRoot, 'packages/contracts/package.json'));
const { Ajv2020 } = requireFromContracts('ajv/dist/2020.js') as { Ajv2020: new (o: object) => Ajv };
const addFormatsModule = requireFromContracts('ajv-formats') as { default?: (a: Ajv) => void } & ((
  a: Ajv,
) => void);
const addFormats = addFormatsModule.default ?? addFormatsModule;

type Validator = ((d: unknown) => boolean) & { errors?: unknown };
interface Ajv {
  addSchema(s: object): void;
  getSchema(id: string): Validator | undefined;
  compile(s: object): Validator;
}
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function readJson<T = Body>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const sharedDir = join(repoRoot, 'contracts/shared/schemas');
for (const f of readdirSync(sharedDir).filter((n) => n.endsWith('.schema.json'))) {
  ajv.addSchema(readJson(join(sharedDir, f)));
}
ajv.addSchema(readJson(join(repoRoot, FROZEN_SCHEMA)));
const validateShared = (name: string): Validator =>
  ajv.getSchema(`https://contracts.serviceform.ai/${name}/v1`) as Validator;
const validateQuery = ajv.getSchema(FROZEN_ID) as Validator;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : [p];
  });
}

async function fullFlow(): Promise<{ h: ReturnType<typeof makeHarness>; bodies: Body[] }> {
  const h = makeHarness();
  const bodies: Body[] = [];
  const q = await h.call(
    'POST',
    '/v1/discovery/queries',
    queryBody({
      filters: { jurisdiction_codes: [JUR_CHILD], keywords: ['certificate'] },
      locale: 'en',
    }),
  );
  bodies.push(q.body as Body);
  const id = (q.body as Body)['query']['query_id'] as string;
  bodies.push((await h.call('GET', `/v1/discovery/queries/${id}`)).body as Body);
  bodies.push(
    (await h.call('POST', `/v1/discovery/queries/${id}/selections`, { service_id: SVC_1 }))
      .body as Body,
  );
  bodies.push(
    (await h.call('POST', `/v1/discovery/queries/${id}/selections`, { service_id: SVC_2 }))
      .body as Body,
  );
  bodies.push(
    (await h.call('POST', '/v1/discovery/queries', queryBody({ result_is_non_statutory: false })))
      .body as Body,
  );
  h.authorizer.deniedActions.add('DISCOVERY_QUERY_READ');
  bodies.push((await h.call('GET', `/v1/discovery/queries/${id}`)).body as Body);
  return { h, bodies };
}

describe('FROZEN SF-CON-DISCOVERY-QUERY', () => {
  it('the frozen schema still pins the non-statutory marker and required pagination', () => {
    const s = readJson(join(repoRoot, FROZEN_SCHEMA));
    expect(s['properties']['contract_id']['const']).toBe('SF-CON-DISCOVERY-QUERY');
    expect(s['properties']['contract_status']['const']).toBe('FROZEN');
    expect(s['properties']['result_is_non_statutory']['const']).toBe(true);
    expect(s['required']).toEqual(
      expect.arrayContaining(['filters', 'catalogue_version_id', 'pagination']),
    );
  });

  it('frozen valid example passes and invalid example fails (harness sanity)', () => {
    const valid = readJson(join(repoRoot, 'contracts/m08/examples/valid/discovery-query.json'));
    const invalid = readJson(
      join(repoRoot, 'contracts/m08/examples/invalid/discovery-query.statutory-result.json'),
    );
    expect(validateQuery(valid), JSON.stringify(validateQuery.errors)).toBe(true);
    expect(validateQuery(invalid)).toBe(false);
  });

  it('every query envelope CMP-006 returns validates against the frozen schema', async () => {
    const { bodies } = await fullFlow();
    const queries = bodies.filter((b) => b['query']).map((b) => b['query'] as Body);
    expect(queries).toHaveLength(2);
    for (const q of queries) {
      expect(validateQuery(q), JSON.stringify(validateQuery.errors)).toBe(true);
      expect(q['tenant_id']).toBe(TENANT_A);
      expect(q['result_is_non_statutory']).toBe(true);
    }
    expect(queries[0]?.['filters']['keywords']).toEqual(['certificate']);
    expect(queries[1]?.['filters']['keywords']).toBeUndefined();
  });

  it('component limits are inside the frozen bounds', async () => {
    const s = readJson(join(repoRoot, FROZEN_SCHEMA));
    const q = await import('../../src/domain/query.js');
    expect(q.MAX_LIMIT).toBe(s['properties']['pagination']['properties']['limit']['maximum']);
    expect(q.MAX_CODE_LENGTH).toBe(
      s['properties']['filters']['properties']['jurisdiction_codes']['items']['maxLength'],
    );
    expect(q.MAX_KEYWORD_LENGTH).toBe(
      s['properties']['filters']['properties']['keywords']['items']['maxLength'],
    );
  });
});

describe('shared frozen envelopes emitted by CMP-006', () => {
  it('outbox events, audit events and error responses validate against SF-CON schemas', async () => {
    const { h, bodies } = await fullFlow();
    const outbox = (h.repo as MemoryDiscoveryRepository).tenant(TENANT_A).outbox;
    const queryData = ajv.compile(
      readJson(join(root, 'contracts/events/discovery-query-event.data.schema.json')),
    );
    const selectionData = ajv.compile(
      readJson(join(root, 'contracts/events/discovery-selection-event.data.schema.json')),
    );
    const envelope = validateShared('event-envelope');
    const audit = validateShared('audit-event');
    const seen = new Set<string>();
    for (const { topic, envelope: env } of outbox) {
      expect(envelope(env), JSON.stringify(envelope.errors)).toBe(true);
      seen.add(env.event_type);
      if (topic === TOPIC_DOMAIN) {
        const v = (QUERY_EVENT_TYPES as readonly string[]).includes(env.event_type)
          ? queryData
          : selectionData;
        expect(v(env.data), JSON.stringify(v.errors)).toBe(true);
      } else {
        expect(topic).toBe(TOPIC_AUDIT);
        expect(audit(env.data), JSON.stringify(audit.errors)).toBe(true);
      }
    }
    for (const t of DOMAIN_EVENT_TYPES) expect(seen.has(t), t).toBe(true);
    expect(JSON.stringify(outbox)).not.toContain('certificate');
    const errorSchema = validateShared('error-response');
    const errors = bodies.filter((b) => b['error_code']);
    expect(errors.map((e) => e['error_code'])).toEqual(['SF-APP-001', 'SF-SYS-003', 'SF-AUTH-002']);
    for (const e of errors) expect(errorSchema(e), JSON.stringify(errorSchema.errors)).toBe(true);
  });

  it('PEP inputs and the request context validate against the frozen schemas', async () => {
    const { h } = await fullFlow();
    const input = ajv.getSchema(
      'https://contracts.serviceform.ai/authz-decision/v1#/$defs/input',
    ) as Validator;
    expect(h.authorizer.calls.length).toBeGreaterThanOrEqual(5);
    for (const call of h.authorizer.calls) {
      expect(input(call), JSON.stringify(input.errors)).toBe(true);
    }
    const ctxSchema = validateShared('request-context');
    expect(ctxSchema(ctxFor(TENANT_A)), JSON.stringify(ctxSchema.errors)).toBe(true);
  });

  it('error codes and statuses are exactly those of the frozen error catalogue', () => {
    const catalogue = readJson<{ codes: { code: string; http: number[] }[] }>(
      join(repoRoot, 'contracts/shared/error-catalogue.json'),
    );
    for (const [code, entry] of Object.entries(ERROR_CATALOGUE_SUBSET)) {
      const found = catalogue.codes.find((c) => c.code === code);
      expect(found, code).toBeTruthy();
      expect(found?.http).toContain(entry.http);
    }
  });
});

describe('CMP-006 component contracts', () => {
  it('OpenAPI lists every route the handler serves, and AsyncAPI every emitted event', () => {
    const openapi = readJson<{ paths: Record<string, Record<string, { operationId: string }>> }>(
      join(root, 'contracts/openapi.json'),
    );
    const documented = Object.entries(openapi.paths).flatMap(([path, ops]) =>
      Object.entries(ops).map(
        ([method, op]) =>
          `${method.toUpperCase()} ${path.replaceAll(/\{(\w+)\}/g, ':$1')} ${op.operationId}`,
      ),
    );
    const served = ROUTE_DESCRIPTORS.map((r) => `${r.method} ${r.path} ${r.operationId}`);
    expect(documented.sort()).toEqual(served.sort());
    const asyncapi = readJson<{ channels: Record<string, { messages: Record<string, unknown> }> }>(
      join(root, 'contracts/asyncapi.json'),
    );
    expect(Object.keys(asyncapi.channels[TOPIC_DOMAIN]?.messages ?? {}).sort()).toEqual(
      [...DOMAIN_EVENT_TYPES].sort(),
    );
    expect(readJson(join(root, 'contracts/topics.json'))['name']).toBe(TOPIC_DOMAIN);
  });

  it('OpenAPI response schemas accept what the handler returns', async () => {
    const openapi = readJson(join(root, 'contracts/openapi.json'));
    const local = new Ajv2020({ allErrors: true, strict: false });
    addFormats(local);
    for (const f of readdirSync(sharedDir).filter((n) => n.endsWith('.schema.json'))) {
      local.addSchema(readJson(join(sharedDir, f)));
    }
    local.addSchema(readJson(join(repoRoot, FROZEN_SCHEMA)));
    local.addSchema({ $id: 'cmp006-openapi', components: openapi['components'] });
    const v = (name: string): Validator =>
      local.getSchema(`cmp006-openapi#/components/schemas/${name}`) as Validator;
    const { bodies } = await fullFlow();
    const [queryResp, stored, selection] = bodies;
    expect(
      v('DiscoveryQueryResponse')(queryResp),
      JSON.stringify(v('DiscoveryQueryResponse').errors),
    ).toBe(true);
    expect(v('StoredQueryView')(stored), JSON.stringify(v('StoredQueryView').errors)).toBe(true);
    expect(v('SelectionView')(selection), JSON.stringify(v('SelectionView').errors)).toBe(true);
  });

  it('isolation.json declares exactly the tables the migrations create, all FORCE RLS or justified', () => {
    const iso = readJson<{ entities: { entity: string; rls: string; justification?: string }[] }>(
      join(root, 'contracts/isolation.json'),
    );
    const sql = [SCHEMA_MIGRATION, OUTBOX_MIGRATION]
      .map((p) => readFileSync(join(repoRoot, p), 'utf8'))
      .join('\n');
    const created = [...sql.matchAll(/CREATE TABLE (sf_discovery\.[a-z_]+)/g)].map((m) => m[1]);
    expect(iso.entities.map((e) => e.entity).sort()).toEqual([...created].sort());
    for (const e of iso.entities) {
      if (e.rls === 'FORCE') {
        expect(sql, e.entity).toContain(`ALTER TABLE ${e.entity} FORCE ROW LEVEL SECURITY`);
      } else {
        expect(e.justification, e.entity).toBeTruthy();
      }
    }
  });

  it('outbox migration is the SF-CON-OUTBOX template with only the documented substitutions', () => {
    const template = readFileSync(
      join(repoRoot, 'contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_discovery')
      .replaceAll('{cmp}', 'CMP-006');
    expect(readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8')).toContain(template);
  });
});

describe('architecture guards (static)', () => {
  const src = sourceFiles(join(root, 'src')).map((p) => ({ p, text: readFileSync(p, 'utf8') }));
  const migration = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');

  it('no peer component imports and no SQL outside sf_discovery (ports only)', () => {
    for (const { p, text } of src) {
      expect(text, p).not.toMatch(
        /from ['"][^'"]*(?:@serviceform\/cmp-|services\/cmp-|\.\.\/\.\.\/\.\.\/)/,
      );
      for (const m of text.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)\./g)) {
        expect(m[1], p).toBe('sf_discovery');
      }
    }
    for (const m of migration.matchAll(/\b(?:REFERENCES|ON)\s+([a-z_]+)\.[a-z_]+/g)) {
      expect(m[1]).toBe('sf_discovery');
    }
  });

  it('no named service, tenant or jurisdiction and no statutory decision vocabulary in source', () => {
    for (const { p, text } of src) {
      expect(text, p).not.toMatch(/RESIDENCE|INCOME_CERT|CASTE_CERT|IN-[A-Z]{2}\b/);
      expect(text, p).not.toMatch(/\b(?:ELIGIBLE|APPROVED|REJECTED|INELIGIBLE)\b/);
    }
  });

  it('no invented retention period anywhere in CMP-006 code or migrations', () => {
    const outbox = readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8');
    for (const [name, text] of [
      ...src.map(({ p, text: t }) => [p, t] as const),
      [SCHEMA_MIGRATION, migration] as const,
    ]) {
      expect(text, name).not.toMatch(/\bINTERVAL\b/i);
      expect(text, name).not.toMatch(/\b\d+\s*(?:days?|weeks?|months?|years?)\b/i);
      expect(text, name).not.toMatch(/retention_(?:days|period|until)|purge_after|delete_after/i);
    }
    expect(outbox).not.toMatch(/\bINTERVAL\b/i);
  });
});
