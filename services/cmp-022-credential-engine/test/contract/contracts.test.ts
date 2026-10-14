import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { credentialIdFor } from '../../src/domain/credential.js';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import { DOMAIN_EVENT_TYPES, TOPIC_DOMAIN } from '../../src/outbox.js';
import {
  APPLICATION_ID,
  APPLICATION_UNAPPROVED,
  ctxFor,
  ISSUANCE_KEY,
  pins,
  simulatedFailed,
  simulatedSigned,
  TENANT_A,
} from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1760440000000_cmp-022-credential-engine.sql';
const OUTBOX_MIGRATION = 'db/migrations/1760440000001_cmp-022-outbox.sql';
const CREDENTIAL_ID = 'https://contracts.serviceform.ai/m07/credential/v1';
const SIGNING_ID = 'https://contracts.serviceform.ai/m07/signing-record/v1';

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

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function lockHash(id: string): string | undefined {
  const lock = readFileSync(join(repoRoot, 'orchestrator/contracts-lock.yaml'), 'utf8');
  const block = lock.slice(lock.indexOf(`id: ${id}\n`));
  return /schema_hash:\s*([0-9a-f]{64})/.exec(block)?.[1];
}

describe('frozen M07 contracts consumed by CMP-022', () => {
  it.each([
    ['SF-CON-CREDENTIAL', 'contracts/m07/schemas/credential.schema.json'],
    ['SF-CON-SIGNING-RECORD', 'contracts/m07/schemas/signing-record.schema.json'],
  ])('%s schema hash matches contracts-lock', (id, path) => {
    const actual = createHash('sha256')
      .update(readFileSync(join(repoRoot, path)))
      .digest('hex');
    expect(actual).toBe(lockHash(id));
  });

  it('every credential response (issued, replayed, read, listed) validates as SF-CON-CREDENTIAL', async () => {
    const validate = schema(CREDENTIAL_ID);
    const h = makeHarness();
    const bodies: unknown[] = [];
    bodies.push(
      (
        await h.call('POST', '/v1/credentials', {
          application_id: APPLICATION_ID,
          issuance_key: ISSUANCE_KEY,
        })
      ).body,
    );
    bodies.push(
      (
        await h.call('POST', '/v1/credentials', {
          application_id: APPLICATION_ID,
          issuance_key: ISSUANCE_KEY,
        })
      ).body,
    );
    const id = credentialIdFor(TENANT_A, APPLICATION_ID, ISSUANCE_KEY);
    bodies.push((await h.call('GET', `/v1/credentials/${id}`, undefined, { key: null })).body);
    const list = await h.call('GET', `/v1/applications/${APPLICATION_ID}/credentials`, undefined, {
      key: null,
    });
    bodies.push(...((list.body as Body)['credentials'] as unknown[]));
    expect(bodies).toHaveLength(4);
    for (const b of bodies) expect(validate(b), JSON.stringify(validate.errors)).toBe(true);
  });

  it('GENERATED and SIGNED intermediate credentials validate too', async () => {
    const validate = schema(CREDENTIAL_ID);
    const h = makeHarness();
    h.signer.script = [simulatedFailed];
    await h.call('POST', '/v1/credentials', {
      application_id: APPLICATION_ID,
      issuance_key: ISSUANCE_KEY,
    });
    const id = credentialIdFor(TENANT_A, APPLICATION_ID, ISSUANCE_KEY);
    const generated = (await h.call('GET', `/v1/credentials/${id}`, undefined, { key: null }))
      .body as Body;
    expect(generated['lifecycle_status']).toBe('GENERATED');
    expect(validate(generated), JSON.stringify(validate.errors)).toBe(true);
    h.registry.failures = [new Error('down')];
    await h.call('POST', '/v1/credentials', {
      application_id: APPLICATION_ID,
      issuance_key: ISSUANCE_KEY,
    });
    const signed = (await h.call('GET', `/v1/credentials/${id}`, undefined, { key: null }))
      .body as Body;
    expect(signed['lifecycle_status']).toBe('SIGNED');
    expect(validate(signed), JSON.stringify(validate.errors)).toBe(true);
  });

  it('signing records (SIGNED and FAILED, SIMULATED and REAL) validate as SF-CON-SIGNING-RECORD', async () => {
    const validate = schema(SIGNING_ID);
    const h = makeHarness();
    h.signer.script = [simulatedFailed];
    await h.call('POST', '/v1/credentials', {
      application_id: APPLICATION_ID,
      issuance_key: ISSUANCE_KEY,
    });
    await h.call('POST', '/v1/credentials', {
      application_id: APPLICATION_ID,
      issuance_key: ISSUANCE_KEY,
    });
    const prod = makeHarness({ environment: 'PRODUCTION' });
    prod.signer.fallback = (req) => {
      const { simulation_marker: _m, ...rest } = simulatedSigned(req);
      return { ...rest, connector_mode: 'REAL' };
    };
    await prod.call('POST', '/v1/credentials', {
      application_id: APPLICATION_ID,
      issuance_key: ISSUANCE_KEY,
    });
    const id = credentialIdFor(TENANT_A, APPLICATION_ID, ISSUANCE_KEY);
    const records: Body[] = [];
    for (const harness of [h, prod]) {
      const res = await harness.call('GET', `/v1/credentials/${id}/signing-records`, undefined, {
        key: null,
      });
      records.push(...((res.body as Body)['signing_records'] as Body[]));
    }
    expect(records.map((r) => `${r['connector_mode']}:${r['signing_result']}`)).toEqual([
      'SIMULATED:FAILED',
      'SIMULATED:SIGNED',
      'REAL:SIGNED',
    ]);
    for (const r of records) expect(validate(r), JSON.stringify(validate.errors)).toBe(true);
  });

  it('frozen valid examples pass and frozen invalid examples fail the same schemas', () => {
    const ex = (p: string): unknown => readJson(join(repoRoot, 'contracts/m07/examples', p));
    expect(schema(CREDENTIAL_ID)(ex('valid/credential.json'))).toBe(true);
    expect(schema(SIGNING_ID)(ex('valid/signing-record.json'))).toBe(true);
    expect(schema(CREDENTIAL_ID)(ex('invalid/credential.approval-decided.json'))).toBe(false);
    expect(schema(CREDENTIAL_ID)(ex('invalid/credential.issued-unsigned.json'))).toBe(false);
    expect(schema(SIGNING_ID)(ex('invalid/signing-record.real-with-marker.json'))).toBe(false);
    expect(schema(SIGNING_ID)(ex('invalid/signing-record.simulated-without-marker.json'))).toBe(
      false,
    );
  });
});

describe('shared frozen envelopes emitted by CMP-022', () => {
  it('outbox events, audit events and error responses validate against SF-CON schemas', async () => {
    const h = makeHarness();
    h.signer.script = [simulatedFailed];
    await h.call('POST', '/v1/credentials', {
      application_id: APPLICATION_ID,
      issuance_key: ISSUANCE_KEY,
    });
    await h.call('POST', '/v1/credentials', {
      application_id: APPLICATION_ID,
      issuance_key: ISSUANCE_KEY,
    });
    const outbox = h.repo.tenant(TENANT_A).outbox;
    const dataSchema = ajv.compile(
      readJson(join(root, 'contracts/events/credential-event.data.schema.json')),
    );
    const types = outbox.filter((o) => o.topic === TOPIC_DOMAIN).map((o) => o.envelope.event_type);
    expect(types).toEqual([
      'CredentialGenerated',
      'CredentialSigningFailed',
      'CredentialSigned',
      'CredentialIssued',
    ]);
    expect(outbox).toHaveLength(8);
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
    h.state.ctx = ctxFor(TENANT_A, undefined, 'INTEGRATION');
    const id = credentialIdFor(TENANT_A, APPLICATION_ID, ISSUANCE_KEY);
    const outcome = await h.call('POST', `/v1/credentials/${id}/downstream-outcomes`, {
      channel: 'DIGILOCKER_PUBLISH',
      outcome: 'FAILED',
      outcome_ref: 'publish:0001',
      failure_code: 'SF-INT-001',
    });
    const doc = readJson<{ components: { schemas: Record<string, object> } }>(
      join(root, 'contracts/openapi.json'),
    );
    const outcomeSchema = ajv.compile(doc.components.schemas['DownstreamOutcome'] as object);
    expect(outcomeSchema(outcome.body), JSON.stringify(outcomeSchema.errors)).toBe(true);

    h.state.ctx = ctxFor(TENANT_A);
    const errors = [
      await h.call('POST', '/v1/credentials', {
        application_id: APPLICATION_UNAPPROVED,
        issuance_key: ISSUANCE_KEY,
      }),
      await h.call('POST', '/v1/credentials', {
        application_id: APPLICATION_ID,
        issuance_key: ISSUANCE_KEY,
        approval_decision_ref: 'x',
      }),
      await h.call('GET', '/v1/nope', undefined, { key: null }),
    ];
    const prod = makeHarness({ environment: 'PRODUCTION' });
    errors.push(
      await prod.call('POST', '/v1/credentials', {
        application_id: APPLICATION_ID,
        issuance_key: ISSUANCE_KEY,
      }),
    );
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
    for (const d of ROUTE_DESCRIPTORS) expect(d.path.startsWith('/v1/')).toBe(true);
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

  it('test doubles conform to the consumer port schemas', () => {
    const pinPort = ajv.compile(
      readJson(join(root, 'contracts/ports/case-issuance-pins.schema.json')),
    );
    const signPort = ajv.compile(
      readJson(join(root, 'contracts/ports/signing-adapter-result.schema.json')),
    );
    const req = {
      credential_id: '22222222-2222-4222-8222-222222222222',
      artifact: { storage_key: 'k', sha256: 'a'.repeat(64) },
      attempt_number: 1,
      idempotency_key: 'cmp022.sign.x.1',
    };
    for (const p of [
      pins(),
      pins({
        approval_decision_ref: null,
        credential_template_id: null,
        credential_template_version: null,
      }),
    ]) {
      expect(pinPort(p), JSON.stringify(pinPort.errors)).toBe(true);
    }
    expect(pinPort({ ...pins(), approval_decision_ref: 'has space' })).toBe(false);
    for (const r of [simulatedSigned(req), simulatedFailed(req)]) {
      expect(signPort(r), JSON.stringify(signPort.errors)).toBe(true);
    }
    const { simulation_marker: marker, ...noMarker } = simulatedSigned(req);
    expect(signPort(noMarker)).toBe(false);
    expect(signPort({ ...noMarker, connector_mode: 'REAL', simulation_marker: marker })).toBe(
      false,
    );
    expect(
      signPort({
        ...simulatedSigned(req),
        simulation_marker: { ...marker, environment: 'PRODUCTION' },
      }),
    ).toBe(false);
  });

  it('isolation.json matches the migration sf:isolation declarations and FORCE RLS', () => {
    const sql = [SCHEMA_MIGRATION, OUTBOX_MIGRATION]
      .map((p) => readFileSync(join(repoRoot, p), 'utf8'))
      .join('\n');
    const declared = [...sql.matchAll(/^-- sf:isolation (\S+) (\S+) owner=(CMP-\d{3})$/gm)].map(
      (m) => ({ entity: m[1], isolation_class: m[2], owner_component: m[3] }),
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
      expect(e.owner_component).toBe('CMP-022');
      expect(e.entity.startsWith('sf_credential.')).toBe(true);
    }
  });

  it('the migration grants nothing on peer component schemas and never BYPASSRLS', () => {
    const sql = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');
    const schemas = new Set([...sql.matchAll(/\b(sf_[a-z0-9_]+)\.[a-z_]+/g)].map((m) => m[1]));
    for (const s of schemas) expect(['sf_credential', 'sf_platform']).toContain(s);
    expect(sql.replace(/NOBYPASSRLS/g, '')).not.toMatch(/BYPASSRLS/);
    expect(sql).toContain('CREATE SCHEMA sf_credential AUTHORIZATION sf_migrator');
    expect(sql).toMatch(/CREATE ROLE sf_cmp022_rw NOLOGIN/);
    expect(sql).not.toMatch(
      /GRANT[^;]*\bUPDATE\b[^;]*ON sf_credential\.(credential_artifact|signing_record|downstream_outcome)\b/,
    );
    expect(sql).not.toMatch(/GRANT[^;]*\bDELETE\b[^;]*ON sf_credential\.credential\b/);
  });

  it('the outbox migration embeds the SF-CON-OUTBOX template with only schema/CMP replaced', () => {
    const ours = readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8');
    const template = readFileSync(
      join(repoRoot, 'contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_credential')
      .replaceAll('{cmp}', 'CMP-022');
    expect(ours).toContain(template);
    const tail = ours.slice(ours.indexOf(template) + template.length).replace(/^--.*$/gm, '');
    expect(tail).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b/);
  });
});
