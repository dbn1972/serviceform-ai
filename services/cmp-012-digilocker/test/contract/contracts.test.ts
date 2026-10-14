import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import { DOMAIN_EVENT_TYPES, TOPIC_DOMAIN } from '../../src/outbox.js';
import {
  CREDENTIAL_ID,
  CONSENT_REF,
  PURPOSE_CODE,
  DOCUMENT_TYPE_REF,
  TEST_RUN_ID,
} from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1760380400000_cmp-012-digilocker.sql';
const OUTBOX_MIGRATION = 'db/migrations/1760380400001_cmp-012-outbox.sql';
const DIGILOCKER_PUBLISH_ID = 'https://contracts.serviceform.ai/m07/digilocker-publish/v1';

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
for (const dir of ['contracts/shared/schemas', 'contracts/m07/schemas']) {
  for (const f of readdirSync(join(repoRoot, dir)).filter((n) => n.endsWith('.schema.json'))) {
    ajv.addSchema(readJson(join(repoRoot, dir, f)));
  }
}

const schema = (id: string): ReturnType<Ajv['compile']> =>
  ajv.getSchema(id) as ReturnType<Ajv['compile']>;
const shared = (name: string): ReturnType<Ajv['compile']> =>
  schema(`https://contracts.serviceform.ai/${name}/v1`);

const validBody = {
  credential_id: CREDENTIAL_ID,
  consent_ref: CONSENT_REF,
  purpose_code: PURPOSE_CODE,
  document_type_ref: DOCUMENT_TYPE_REF,
  test_run_id: TEST_RUN_ID,
};

describe('SF-CON-DIGILOCKER-PUBLISH (FROZEN) hash conformance', () => {
  it('the frozen schema hash matches contracts-lock.yaml', async () => {
    const { createHash } = await import('node:crypto');
    const lock = readFileSync(join(repoRoot, 'orchestrator/contracts-lock.yaml'), 'utf8');
    const block = lock.slice(lock.indexOf('id: SF-CON-DIGILOCKER-PUBLISH'));
    const expected = /schema_hash:\s*([0-9a-f]{64})/.exec(block)?.[1];
    const actual = createHash('sha256')
      .update(readFileSync(join(repoRoot, 'contracts/m07/schemas/digilocker-publish.schema.json')))
      .digest('hex');
    expect(actual).toBe(expected);
  });
});

describe('SF-CON-CONNECTOR-BINDING + SF-CON-SIMULATION-MARKER hash conformance', () => {
  it('connector-binding schema hash matches contracts-lock.yaml', async () => {
    const { createHash } = await import('node:crypto');
    const lock = readFileSync(join(repoRoot, 'orchestrator/contracts-lock.yaml'), 'utf8');
    const block = lock.slice(lock.indexOf('id: SF-CON-CONNECTOR-BINDING'));
    const expected = /schema_hash:\s*([0-9a-f]{64})/.exec(block)?.[1];
    const actual = createHash('sha256')
      .update(
        readFileSync(join(repoRoot, 'contracts/shared/schemas/connector-binding.schema.json')),
      )
      .digest('hex');
    expect(actual).toBe(expected);
  });

  it('simulation-marker schema hash matches contracts-lock.yaml', async () => {
    const { createHash } = await import('node:crypto');
    const lock = readFileSync(join(repoRoot, 'orchestrator/contracts-lock.yaml'), 'utf8');
    const block = lock.slice(lock.indexOf('id: SF-CON-SIMULATION-MARKER'));
    const expected = /schema_hash:\s*([0-9a-f]{64})/.exec(block)?.[1];
    const actual = createHash('sha256')
      .update(
        readFileSync(join(repoRoot, 'contracts/shared/schemas/simulation-marker.schema.json')),
      )
      .digest('hex');
    expect(actual).toBe(expected);
  });
});

describe('DigiLocker publish record validates against SF-CON-DIGILOCKER-PUBLISH', () => {
  it('PUBLISHED record validates against frozen schema', async () => {
    const validate = schema(DIGILOCKER_PUBLISH_ID);
    const h = makeHarness();
    const r = await h.call('POST', '/v1/digilocker-publish', validBody);
    expect(r.status).toBe(201);
    const body = r.body as Record<string, unknown>;
    const publishRequestId = body['publish_request_id'] as string;
    const store = h.repo.tenant(h.state.ctx.tenant_id);
    const row = store.publishRecords.get(publishRequestId);
    expect(row).toBeDefined();

    const contractPayload = {
      contract_id: 'SF-CON-DIGILOCKER-PUBLISH',
      contract_status: 'FROZEN',
      freeze_status: 'FROZEN',
      tenant_id: row!.tenant_id,
      publish_request_id: row!.publish_request_id,
      credential_id: row!.credential_id,
      credential_lifecycle_status_at_request: row!.credential_lifecycle_status_at_request,
      consent_ref: row!.consent_ref,
      purpose_code: row!.purpose_code,
      connector_binding_id: row!.connector_binding_id,
      integration_contract: 'INT-013',
      connector_mode: row!.connector_mode,
      simulation_marker: row!.simulation_marker,
      document_type_ref: row!.document_type_ref,
      publish_status: row!.publish_status,
      provider_transaction_ref: row!.provider_transaction_ref,
      attempt_number: row!.attempt_number,
      idempotency_key: row!.idempotency_key,
      issuance_reversed_on_publish_failure: row!.issuance_reversed_on_publish_failure,
      registry_status_changed_by_publish: row!.registry_status_changed_by_publish,
      invented_statutory_policy_forbidden: row!.invented_statutory_policy_forbidden,
      correlation_id: row!.correlation_id,
    };
    expect(validate(contractPayload), JSON.stringify(validate.errors)).toBe(true);
  });

  it('FAILED record validates against frozen schema', async () => {
    const validate = schema(DIGILOCKER_PUBLISH_ID);
    const h = makeHarness({ scenario: 'digilocker_publish_fail' });
    const r = await h.call('POST', '/v1/digilocker-publish', validBody);
    expect(r.status).toBe(201);
    const body = r.body as Record<string, unknown>;
    const publishRequestId = body['publish_request_id'] as string;
    const store = h.repo.tenant(h.state.ctx.tenant_id);
    const row = store.publishRecords.get(publishRequestId);
    expect(row).toBeDefined();

    const contractPayload = {
      contract_id: 'SF-CON-DIGILOCKER-PUBLISH',
      contract_status: 'FROZEN',
      freeze_status: 'FROZEN',
      tenant_id: row!.tenant_id,
      publish_request_id: row!.publish_request_id,
      credential_id: row!.credential_id,
      credential_lifecycle_status_at_request: row!.credential_lifecycle_status_at_request,
      consent_ref: row!.consent_ref,
      purpose_code: row!.purpose_code,
      connector_binding_id: row!.connector_binding_id,
      integration_contract: 'INT-013',
      connector_mode: row!.connector_mode,
      simulation_marker: row!.simulation_marker,
      document_type_ref: row!.document_type_ref,
      publish_status: row!.publish_status,
      failure_code: row!.failure_code,
      attempt_number: row!.attempt_number,
      idempotency_key: row!.idempotency_key,
      issuance_reversed_on_publish_failure: row!.issuance_reversed_on_publish_failure,
      registry_status_changed_by_publish: row!.registry_status_changed_by_publish,
      invented_statutory_policy_forbidden: row!.invented_statutory_policy_forbidden,
      correlation_id: row!.correlation_id,
    };
    expect(validate(contractPayload), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe('shared frozen envelopes emitted by CMP-012', () => {
  it('outbox events validate against SF-CON-EVENT-ENVELOPE', async () => {
    const h = makeHarness();
    await h.call('POST', '/v1/digilocker-publish', validBody);
    const store = h.repo.tenant(h.state.ctx.tenant_id);
    expect(store.outbox.length).toBeGreaterThanOrEqual(1);
    for (const { topic, envelope } of store.outbox) {
      if (topic === TOPIC_DOMAIN) {
        const env = shared('event-envelope');
        expect(env(envelope), JSON.stringify(env.errors)).toBe(true);
        expect(DOMAIN_EVENT_TYPES).toContain(envelope['event_type']);
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
      expect(e.owner_component).toBe('CMP-012');
    }
  });

  it('the migration grants nothing on peer component schemas and never BYPASSRLS', () => {
    const sql = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');
    const schemas = new Set([...sql.matchAll(/\b(sf_[a-z0-9_]+)\.[a-z_]+/g)].map((m) => m[1]));
    for (const s of schemas) expect(['sf_digilocker', 'sf_platform']).toContain(s);
    expect(sql.replace(/NOBYPASSRLS/g, '')).not.toMatch(/BYPASSRLS/);
  });
});
