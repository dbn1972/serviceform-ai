import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import { DOMAIN_EVENT_TYPES, TOPIC_DOMAIN } from '../../src/outbox.js';
import { FEE_QUOTE_ID, fixtureToken, TENANT_A, TEST_RUN_ID } from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1759620210000_cmp-021-payment.sql';
const OUTBOX_MIGRATION = 'db/migrations/1759620210001_cmp-021-outbox.sql';
const PAYMENT_INTENT_ID = 'https://contracts.serviceform.ai/m06/payment-intent/v1';
const PAYMENT_CALLBACK_ID = 'https://contracts.serviceform.ai/m06/payment-callback/v1';

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

describe('SF-CON-PAYMENT-INTENT (FROZEN) conformance', () => {
  it('the frozen schema hash is unchanged versus contracts-lock', async () => {
    const { createHash } = await import('node:crypto');
    const lock = readFileSync(join(repoRoot, 'orchestrator/contracts-lock.yaml'), 'utf8');
    const block = lock.slice(lock.indexOf('id: SF-CON-PAYMENT-INTENT'));
    const expected = /schema_hash:\s*([0-9a-f]{64})/.exec(block)?.[1];
    const actual = createHash('sha256')
      .update(readFileSync(join(repoRoot, 'contracts/m06/schemas/payment-intent.schema.json')))
      .digest('hex');
    expect(actual).toBe(expected);
  });

  it('created intent validates against frozen SF-CON-PAYMENT-INTENT', async () => {
    const validate = schema(PAYMENT_INTENT_ID);
    const h = makeHarness();
    const r = await h.call('POST', '/v1/payment-intents', {
      fee_quote_id: FEE_QUOTE_ID,
      test_run_id: TEST_RUN_ID,
    });
    expect(r.status).toBe(201);
    expect(validate(r.body), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe('SF-CON-PAYMENT-CALLBACK (FROZEN) conformance', () => {
  it('the frozen schema hash is unchanged versus contracts-lock', async () => {
    const { createHash } = await import('node:crypto');
    const lock = readFileSync(join(repoRoot, 'orchestrator/contracts-lock.yaml'), 'utf8');
    const block = lock.slice(lock.indexOf('id: SF-CON-PAYMENT-CALLBACK'));
    const expected = /schema_hash:\s*([0-9a-f]{64})/.exec(block)?.[1];
    const actual = createHash('sha256')
      .update(readFileSync(join(repoRoot, 'contracts/m06/schemas/payment-callback.schema.json')))
      .digest('hex');
    expect(actual).toBe(expected);
  });

  it('verified callback validates against frozen SF-CON-PAYMENT-CALLBACK', async () => {
    const { signPayload, simulatorSecret } = await import('../../src/connectors/simulated-psp.js');
    const validate = schema(PAYMENT_CALLBACK_ID);
    const h = makeHarness();
    const created = await h.call('POST', '/v1/payment-intents', {
      fee_quote_id: FEE_QUOTE_ID,
      test_run_id: TEST_RUN_ID,
    });
    const paymentIntentId = String((created.body as Record<string, unknown>)['payment_intent_id']);
    const cbBody = {
      payment_intent_id: paymentIntentId,
      outcome: 'CAPTURED',
      exactly_once_key: fixtureToken('contract', 'cb', '001xxxx'),
      idempotency_key: fixtureToken('contract', 'idem', '001x'),
    };
    const sig = signPayload(simulatorSecret(TEST_RUN_ID), cbBody);
    h.state.ctx = {
      tenant_id: TENANT_A,
      cell_id: 'cell-01',
      actor: { type: 'INTEGRATION', id: '77777777-7777-4777-8777-777777777777' },
      roles: [],
      jurisdiction_ids: [],
      auth_assurance: 'WORKLOAD_IDENTITY',
      correlation_id: '00000000-0000-4000-8000-000000000099',
      trace_id: '0af7651916cd43dd8448eb211c80319c',
    };
    const cbResult = await h.call('POST', '/v1/payment-callbacks', cbBody, {
      headers: { 'x-sim-signature': sig },
    });
    expect(cbResult.status).toBe(201);
    expect((cbResult.body as Record<string, unknown>)['signature_verified']).toBe(true);
    expect(validate(cbResult.body), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe('shared frozen envelopes emitted by CMP-021', () => {
  it('outbox events and audit events validate against shared SF-CON schemas', async () => {
    const { signPayload, simulatorSecret } = await import('../../src/connectors/simulated-psp.js');
    const h = makeHarness();
    const created = await h.call('POST', '/v1/payment-intents', {
      fee_quote_id: FEE_QUOTE_ID,
      test_run_id: TEST_RUN_ID,
    });
    const paymentIntentId = String((created.body as Record<string, unknown>)['payment_intent_id']);
    const cbBody = {
      payment_intent_id: paymentIntentId,
      outcome: 'CAPTURED',
      exactly_once_key: fixtureToken('contract', 'env', '001xxx'),
      idempotency_key: fixtureToken('contract', 'idem', 'env', '01'),
    };
    const sig = signPayload(simulatorSecret(TEST_RUN_ID), cbBody);
    h.state.ctx = {
      tenant_id: TENANT_A,
      cell_id: 'cell-01',
      actor: { type: 'INTEGRATION', id: '77777777-7777-4777-8777-777777777777' },
      roles: [],
      jurisdiction_ids: [],
      auth_assurance: 'WORKLOAD_IDENTITY',
      correlation_id: '00000000-0000-4000-8000-000000000098',
      trace_id: '0af7651916cd43dd8448eb211c80319c',
    };
    await h.call('POST', '/v1/payment-callbacks', cbBody, {
      headers: { 'x-sim-signature': sig },
    });

    const outbox = h.repo.tenant(TENANT_A).outbox;
    expect(outbox.length).toBeGreaterThanOrEqual(2);
    for (const { topic, envelope } of outbox) {
      const env = shared('event-envelope');
      expect(env(envelope), JSON.stringify(env.errors)).toBe(true);
      if (topic === TOPIC_DOMAIN) {
        expect(DOMAIN_EVENT_TYPES).toContain(envelope.event_type);
      } else {
        const audit = shared('audit-event');
        expect(audit(envelope.data), JSON.stringify(audit.errors)).toBe(true);
      }
    }
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
      expect(e.owner_component).toBe('CMP-021');
    }
  });

  it('the migration grants nothing on peer component schemas and never BYPASSRLS', () => {
    const sql = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');
    const schemas = new Set([...sql.matchAll(/\b(sf_[a-z0-9_]+)\.[a-z_]+/g)].map((m) => m[1]));
    for (const s of schemas) expect(['sf_payment', 'sf_platform']).toContain(s);
    expect(sql.replace(/NOBYPASSRLS/g, '')).not.toMatch(/BYPASSRLS/);
  });
});
