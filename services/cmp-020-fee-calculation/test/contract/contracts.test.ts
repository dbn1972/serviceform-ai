import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import { DOMAIN_EVENT_TYPES, TOPIC_DOMAIN } from '../../src/outbox.js';
import {
  APPLICATION_ID,
  APPLICATION_NO_FEE_PIN,
  FEE_POLICY_RULES,
  fixedPolicy,
  rulesPolicy,
  TENANT_A,
} from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1759620200000_cmp-020-fee-calculation.sql';
const OUTBOX_MIGRATION = 'db/migrations/1759620200001_cmp-020-outbox.sql';
const FEE_QUOTE_ID = 'https://contracts.serviceform.ai/m06/fee-quote/v1';

const requireFromContracts = createRequire(join(repoRoot, 'packages/contracts/package.json'));
const { Ajv2020 } = requireFromContracts('ajv/dist/2020.js') as { Ajv2020: new (o: object) => Ajv };
const addFormatsModule = requireFromContracts('ajv-formats') as { default?: (a: Ajv) => void } & ((
  a: Ajv,
) => void);
const addFormats = addFormatsModule.default ?? addFormatsModule;

interface Ajv {
  addSchema(s: object): void;
  getSchema(id: string): (((d: unknown) => boolean) & { errors?: unknown }) | undefined;
  compile(s: object): ((d: unknown) => boolean) & { errors?: unknown };
}

function readJson<T = Record<string, unknown>>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
for (const dir of ['contracts/shared/schemas', 'contracts/m06/schemas']) {
  for (const f of readdirSync(join(repoRoot, dir)).filter((n) => n.endsWith('.schema.json'))) {
    ajv.addSchema(readJson(join(repoRoot, dir, f)));
  }
}
const schema = (id: string): ReturnType<Ajv['compile']> =>
  ajv.getSchema(id) as ReturnType<Ajv['compile']>;
const shared = (name: string): ReturnType<Ajv['compile']> =>
  schema(`https://contracts.serviceform.ai/${name}/v1`);

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('SF-CON-FEE-QUOTE (FROZEN) conformance', () => {
  it('the frozen schema hash is unchanged versus contracts-lock', async () => {
    const { createHash } = await import('node:crypto');
    const lock = readFileSync(join(repoRoot, 'orchestrator/contracts-lock.yaml'), 'utf8');
    const block = lock.slice(lock.indexOf('id: SF-CON-FEE-QUOTE'));
    const expected = /schema_hash:\s*([0-9a-f]{64})/.exec(block)?.[1];
    const actual = createHash('sha256')
      .update(readFileSync(join(repoRoot, 'contracts/m06/schemas/fee-quote.schema.json')))
      .digest('hex');
    expect(actual).toBe(expected);
  });

  it('fixed-policy and rules quotes (create, replay, dedupe, read, list) validate', async () => {
    const validate = schema(FEE_QUOTE_ID);
    const h = makeHarness();
    const bodies: unknown[] = [];
    bodies.push((await h.call('POST', '/v1/fee-quotes', { application_id: APPLICATION_ID })).body);
    bodies.push((await h.call('POST', '/v1/fee-quotes', { application_id: APPLICATION_ID })).body);
    h.pins.pinPolicy(FEE_POLICY_RULES);
    const ruled = await h.call('POST', '/v1/fee-quotes', {
      application_id: APPLICATION_ID,
      facts: { category_code: 'A' },
    });
    bodies.push(ruled.body);
    bodies.push(
      (
        await h.call('GET', `/v1/fee-quotes/${(ruled.body as Body)['quote_id']}`, undefined, {
          key: null,
        })
      ).body,
    );
    const list = await h.call('GET', `/v1/applications/${APPLICATION_ID}/fee-quotes`, undefined, {
      key: null,
    });
    bodies.push(...((list.body as Body)['quotes'] as unknown[]));
    expect(bodies).toHaveLength(6);
    for (const b of bodies) expect(validate(b), JSON.stringify(validate.errors)).toBe(true);
  });

  it('the frozen invalid example (client-authoritative amount) is rejected by the same schema', () => {
    const validate = schema(FEE_QUOTE_ID);
    const invalid = readJson(
      join(repoRoot, 'contracts/m06/examples/invalid/fee-quote.client-authoritative.json'),
    );
    expect(validate(invalid)).toBe(false);
  });
});

describe('shared frozen envelopes emitted by CMP-020', () => {
  it('outbox events, audit events and error responses validate against SF-CON schemas', async () => {
    const h = makeHarness();
    h.pins.pinPolicy(FEE_POLICY_RULES);
    await h.call('POST', '/v1/fee-quotes', {
      application_id: APPLICATION_ID,
      facts: { category_code: 'A' },
    });
    const outbox = h.repo.tenant(TENANT_A).outbox;
    const dataSchema = ajv.compile(
      readJson(join(root, 'contracts/events/fee-quote-event.data.schema.json')),
    );
    expect(outbox).toHaveLength(2);
    for (const { topic, envelope } of outbox) {
      const env = shared('event-envelope');
      expect(env(envelope), JSON.stringify(env.errors)).toBe(true);
      if (topic === TOPIC_DOMAIN) {
        expect(DOMAIN_EVENT_TYPES).toContain(envelope.event_type);
        expect(dataSchema(envelope.data), JSON.stringify(dataSchema.errors)).toBe(true);
      } else {
        const audit = shared('audit-event');
        expect(audit(envelope.data), JSON.stringify(audit.errors)).toBe(true);
      }
    }
    const errors = [
      await h.call('POST', '/v1/fee-quotes', { application_id: APPLICATION_NO_FEE_PIN }),
      await h.call('POST', '/v1/fee-quotes', { application_id: APPLICATION_ID, amount: 1 }),
      await h.call('GET', '/v1/nope', undefined, { key: null }),
    ];
    const errSchema = shared('error-response');
    for (const e of errors) expect(errSchema(e.body), JSON.stringify(errSchema.errors)).toBe(true);
  });

  it('error subset codes, messages and statuses match the frozen catalogue', () => {
    const catalogue = readJson<{ codes: { code: string; message: string; http: number[] }[] }>(
      join(repoRoot, 'contracts/shared/error-catalogue.json'),
    );
    const byCode = new Map(catalogue.codes.map((c) => [c.code, c]));
    for (const [code, entry] of Object.entries(ERROR_CATALOGUE_SUBSET)) {
      const frozen = byCode.get(code);
      expect(frozen, code).toBeDefined();
      expect(entry.message).toBe(frozen?.message);
      expect(frozen?.http).toContain(entry.http);
    }
  });
});

describe('component-local contracts', () => {
  it('OpenAPI operations match the implemented routes', () => {
    const doc = readJson<{ paths: Record<string, Record<string, { operationId: string }>> }>(
      join(root, 'contracts/openapi.json'),
    );
    const declared = Object.entries(doc.paths).flatMap(([path, ops]) =>
      Object.entries(ops).map(([method, op]) => ({
        method: method.toUpperCase(),
        path: path.replace(/\{([^}]+)\}/g, ':$1'),
        operationId: op.operationId,
      })),
    );
    expect(new Set(declared.map((d) => JSON.stringify(d)))).toEqual(
      new Set(ROUTE_DESCRIPTORS.map((d) => JSON.stringify(d))),
    );
  });

  it('AsyncAPI declares every emitted domain event on the domain topic', () => {
    const doc = readJson<{ channels: Record<string, { messages: Record<string, unknown> }> }>(
      join(root, 'contracts/asyncapi.json'),
    );
    expect(Object.keys(doc.channels[TOPIC_DOMAIN]?.messages ?? {})).toEqual([
      ...DOMAIN_EVENT_TYPES,
    ]);
    expect(readJson<{ name: string }>(join(root, 'contracts/topics.json')).name).toBe(TOPIC_DOMAIN);
  });

  it('test fee-policy fixtures conform to the consumer port schema', () => {
    const port = ajv.compile(
      readJson(join(root, 'contracts/ports/published-fee-policy.schema.json')),
    );
    for (const p of [fixedPolicy(), rulesPolicy()])
      expect(port(p), JSON.stringify(port.errors)).toBe(true);
    expect(port(fixedPolicy({ publication_status: 'DRAFT' }))).toBe(false);
    expect(
      port(fixedPolicy({ lines: [{ code: 'A', basis: 'FIXED_AMOUNT', amount_minor: 1.5 }] })),
    ).toBe(false);
  });

  it('isolation.json matches the migration sf:isolation declarations and FORCE RLS', () => {
    const sql = [SCHEMA_MIGRATION, OUTBOX_MIGRATION]
      .map((p) => readFileSync(join(repoRoot, p), 'utf8'))
      .join('\n');
    const declared = [...sql.matchAll(/^-- sf:isolation (\S+) (\S+) owner=(CMP-\d{3})$/gm)].map(
      (m) => ({
        entity: m[1],
        isolation_class: m[2],
        owner_component: m[3],
      }),
    );
    const iso = readJson<{
      entities: { entity: string; isolation_class: string; owner_component: string; rls: string }[];
    }>(join(root, 'contracts/isolation.json'));
    expect(
      new Set(iso.entities.map((e) => `${e.entity}|${e.isolation_class}|${e.owner_component}`)),
    ).toEqual(
      new Set(declared.map((d) => `${d.entity}|${d.isolation_class}|${d.owner_component}`)),
    );
    for (const e of iso.entities.filter((x) => x.rls === 'FORCE')) {
      expect(sql).toContain(`ALTER TABLE ${e.entity} FORCE ROW LEVEL SECURITY`);
    }
    const declaration = shared('isolation-declaration');
    for (const e of iso.entities) {
      expect(declaration(e), JSON.stringify(declaration.errors)).toBe(true);
      expect(e.owner_component).toBe('CMP-020');
    }
  });

  it('the migration grants nothing on peer component schemas and never BYPASSRLS', () => {
    const sql = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');
    const schemas = new Set([...sql.matchAll(/\b(sf_[a-z0-9_]+)\.[a-z_]+/g)].map((m) => m[1]));
    for (const s of schemas) expect(['sf_fee', 'sf_platform']).toContain(s);
    expect(sql.replace(/NOBYPASSRLS/g, '')).not.toMatch(/BYPASSRLS/);
  });
});
