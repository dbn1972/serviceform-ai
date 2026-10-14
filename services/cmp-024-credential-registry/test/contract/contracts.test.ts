import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { REASON_REQUIRED_STATUSES, REGISTRY_STATUSES } from '../../src/domain/status.js';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import { DOMAIN_EVENT_TYPES, TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/outbox.js';
import { ACTOR_OFFICER, CRED_1, CRED_2, CRED_3, ctxFor, TENANT_A } from '../doubles/fixtures.js';
import { BASE, makeHarness } from '../doubles/harness.js';
import type { MemoryRegistryRepository } from '../doubles/memory-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1760400240000_cmp-024-credential-registry.sql';
const OUTBOX_MIGRATION = 'db/migrations/1760400240001_cmp-024-outbox.sql';
const FROZEN_SCHEMA = 'contracts/m07/schemas/credential-status.schema.json';
const STATUS_ID = 'https://contracts.serviceform.ai/m07/credential-status/v1';

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
const validateStatus = ajv.getSchema(STATUS_ID) as Validator;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : [p];
  });
}

/** Drives every status, a refusal and a denial through the API; returns all bodies. */
async function fullFlow(): Promise<{ h: ReturnType<typeof makeHarness>; bodies: Body[] }> {
  const h = makeHarness();
  const bodies: Body[] = [];
  bodies.push(await h.register(CRED_1));
  bodies.push((await h.transition(CRED_1, 'activate', 1)).body);
  h.as(TENANT_A, ACTOR_OFFICER, 'OFFICER');
  bodies.push((await h.transition(CRED_1, 'suspend', 2, h.reason)).body);
  bodies.push((await h.transition(CRED_1, 'reinstate', 3)).body);
  bodies.push((await h.call('GET', `${BASE}/${CRED_1}/status`)).body);
  bodies.push(await h.register(CRED_2));
  h.as(TENANT_A, ACTOR_OFFICER, 'OFFICER');
  bodies.push(
    (await h.transition(CRED_1, 'reissue', 4, { superseded_by_credential_id: CRED_2 })).body,
  );
  await h.register(CRED_3);
  h.as(TENANT_A, ACTOR_OFFICER, 'OFFICER');
  bodies.push((await h.transition(CRED_3, 'revoke', 1, h.reason)).body);
  bodies.push((await h.transition(CRED_3, 'activate', 2)).body);
  h.authorizer.deniedActions.add('CREDENTIAL_REGISTRY_STATUS_READ');
  bodies.push((await h.call('GET', `${BASE}/${CRED_3}/status`)).body);
  return { h, bodies };
}

describe('FROZEN SF-CON-CREDENTIAL-STATUS (consumed, owned by CMP-024)', () => {
  it('frozen schema still pins authority, append-only history and the policy guard', () => {
    const s = readJson(join(repoRoot, FROZEN_SCHEMA));
    expect(s['properties']['contract_status']['const']).toBe('FROZEN');
    expect(s['properties']['status_authority_cmp']['const']).toBe('CMP-024');
    expect(s['properties']['history_append_only']['const']).toBe(true);
    expect(s['properties']['invented_statutory_policy_forbidden']['const']).toBe(true);
  });

  it('frozen valid example passes and both invalid examples fail (harness sanity)', () => {
    const ex = (p: string) => readJson(join(repoRoot, 'contracts/m07/examples', p));
    expect(
      validateStatus(ex('valid/credential-status.json')),
      JSON.stringify(validateStatus.errors),
    ).toBe(true);
    expect(validateStatus(ex('invalid/credential-status.revoked-without-reason.json'))).toBe(false);
    expect(validateStatus(ex('invalid/credential-status.non-registry-authority.json'))).toBe(false);
  });

  it('every status document CMP-024 returns validates, across all five statuses', async () => {
    const { bodies } = await fullFlow();
    const docs = bodies
      .filter((b) => b['credential_status'])
      .map((b) => b['credential_status'] as Body);
    const seen = new Set<string>();
    for (const d of docs) {
      expect(validateStatus(d), JSON.stringify(validateStatus.errors)).toBe(true);
      for (const e of d['history']) seen.add(e['to_status']);
      seen.add(d['current_status']);
    }
    expect([...seen].sort()).toEqual([...REGISTRY_STATUSES].sort());
  });

  it('component status enum and reason-required set equal the frozen schema', () => {
    const s = readJson(join(repoRoot, FROZEN_SCHEMA));
    expect([...REGISTRY_STATUSES]).toEqual(s['$defs']['registryStatus']['enum']);
    expect([...REASON_REQUIRED_STATUSES]).toEqual(
      s['$defs']['historyEntry']['allOf'][0]['if']['properties']['to_status']['enum'],
    );
  });
});

describe('shared frozen envelopes emitted by CMP-024', () => {
  it('outbox events, audit events and error responses validate against SF-CON schemas', async () => {
    const { h, bodies } = await fullFlow();
    const outbox = (h.repo as MemoryRegistryRepository).tenant(TENANT_A).outbox;
    const data = ajv.compile(
      readJson(join(root, 'contracts/events/credential-status-event.data.schema.json')),
    );
    const envelope = validateShared('event-envelope');
    const audit = validateShared('audit-event');
    const seen = new Set<string>();
    for (const { topic, envelope: env } of outbox) {
      expect(envelope(env), JSON.stringify(envelope.errors)).toBe(true);
      seen.add(env.event_type);
      if (topic === TOPIC_DOMAIN) {
        expect(data(env.data), JSON.stringify(data.errors)).toBe(true);
      } else {
        expect(topic).toBe(TOPIC_AUDIT);
        expect(audit(env.data), JSON.stringify(audit.errors)).toBe(true);
      }
    }
    for (const t of DOMAIN_EVENT_TYPES) expect(seen.has(t), t).toBe(true);
    const errorSchema = validateShared('error-response');
    const errors = bodies.filter((b) => b['error_code']);
    expect(errors.length).toBe(2);
    for (const e of errors) expect(errorSchema(e), JSON.stringify(errorSchema.errors)).toBe(true);
  });

  it('PEP inputs and the request context validate against frozen authz and request-context schemas', async () => {
    const { h } = await fullFlow();
    const input = ajv.getSchema(
      'https://contracts.serviceform.ai/authz-decision/v1#/$defs/input',
    ) as Validator;
    expect(h.authorizer.calls.length).toBeGreaterThan(5);
    for (const call of h.authorizer.calls)
      expect(input(call), JSON.stringify(input.errors)).toBe(true);
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

describe('CMP-024 component contracts', () => {
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
    expect(readJson<{ name: string }>(join(root, 'contracts/topics.json')).name).toBe(TOPIC_DOMAIN);
  });

  it('OpenAPI status responses reference the frozen SF-CON-CREDENTIAL-STATUS schema', () => {
    const openapi = readJson(join(root, 'contracts/openapi.json'));
    expect(
      openapi['components']['schemas']['StatusView']['properties']['credential_status']['$ref'],
    ).toBe(STATUS_ID);
    const reasoned = openapi['components']['schemas']['ReasonedTransitionRequest'];
    expect(reasoned['required']).toContain('reason_code_ref');
  });

  it('isolation declarations validate and match the migrations (every tenant table FORCE RLS)', () => {
    const iso = readJson<{ entities: Body[] }>(join(root, 'contracts/isolation.json'));
    const validateIso = validateShared('isolation-declaration');
    for (const row of iso.entities)
      expect(validateIso(row), JSON.stringify(validateIso.errors)).toBe(true);
    const sql =
      readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8') +
      readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8');
    for (const row of iso.entities) {
      expect(sql).toContain(
        `-- sf:isolation ${row['entity']} ${row['isolation_class']} owner=CMP-024`,
      );
      if (row['isolation_class'] === 'TENANT_SCOPED') {
        expect(sql).toContain(`ALTER TABLE ${row['entity']} ENABLE ROW LEVEL SECURITY`);
        expect(sql).toContain(`ALTER TABLE ${row['entity']} FORCE ROW LEVEL SECURITY`);
      }
    }
    const declared = [...sql.matchAll(/-- sf:isolation (\S+)/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual(iso.entities.map((e) => String(e['entity'])).sort());
  });

  it('no request body schema accepts a tenant id or a status field', () => {
    const openapi = readJson(join(root, 'contracts/openapi.json'));
    const schemas = openapi['components']['schemas'] as Record<string, Body>;
    for (const [name, schema] of Object.entries(schemas)) {
      if (!name.endsWith('Request')) continue;
      expect(schema['additionalProperties'], name).toBe(false);
      const keys = Object.keys(schema['properties'] as object);
      expect(keys, name).not.toContain('tenant_id');
      for (const k of keys) expect(k, name).not.toMatch(/status$|history/);
    }
  });
});

describe('policy invention guard, read-only posture and component boundary', () => {
  const stripComments = (text: string): string =>
    text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
  const srcText = sourceFiles(join(root, 'src'))
    .map((f) => stripComments(readFileSync(f, 'utf8')))
    .join('\n');
  const migrationText = [SCHEMA_MIGRATION, OUTBOX_MIGRATION]
    .map((m) => readFileSync(join(repoRoot, m), 'utf8'))
    .join('\n');
  const sqlOnly = migrationText
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');

  it('defines no statutory revocation grounds, validity periods or eSign/DigiLocker policy', () => {
    expect(srcText).not.toMatch(/\b(FRAUD|FORGED|DECEASED|MISREPRESENTATION|COURT_ORDER)\b/i);
    expect(srcText).not.toMatch(/valid_until|expires_on|validity_(days|period)|esign|digilocker/i);
    expect(sqlOnly).not.toMatch(/valid_until|validity|expiry|_days\b|interval/i);
    expect(sqlOnly).toMatch(
      /CHECK \(to_status NOT IN \('SUSPENDED', 'REVOKED'\) OR reason_code_ref IS NOT NULL\)/,
    );
    expect(sqlOnly).toMatch(/CHECK \(invented_statutory_policy_forbidden\)/);
  });

  it('history is insert-only at the database and the runtime role cannot update or delete it', () => {
    expect(sqlOnly).toMatch(
      /BEFORE UPDATE OR DELETE ON sf_credential_registry\.credential_status_history/,
    );
    expect(sqlOnly).toMatch(
      /GRANT SELECT, INSERT ON sf_credential_registry\.credential_status_history TO sf_cmp024_rw;/,
    );
    expect(sqlOnly).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)[^;]*credential_status_history/i);
    expect(sqlOnly).not.toMatch(/GRANT[^;]*DELETE[^;]*credential_registry_entry/i);
  });

  it('the read path opens a READ ONLY transaction with a mutator-free view', () => {
    const pg = readFileSync(join(root, 'src/repo/pg.ts'), 'utf8');
    expect(pg).toMatch(/'BEGIN READ ONLY'/);
    expect(pg).toMatch(/new PgReadTx\(c, tenantId\)/);
    const svc = readFileSync(join(root, 'src/service/service.ts'), 'utf8');
    const readStatus = svc.slice(
      svc.indexOf('async readStatus'),
      svc.indexOf('async function readView'),
    );
    expect(readStatus).toMatch(/withReadTx/);
    expect(readStatus).not.toMatch(/withTx|insert|update/);
  });

  it('no hard-coded tenant, jurisdiction, service or official names in source', () => {
    expect(srcText).not.toMatch(/RESIDENCE_CERTIFICATE|11111111-1111|99999999-9999/);
    expect(srcText).not.toMatch(
      /\b(odisha|karnataka|kerala|delhi|maharashtra|collector|tahsildar)\b/i,
    );
  });

  it('declares no runtime dependency, makes no network call and imports no peer component', () => {
    expect(srcText).not.toMatch(/node:(http|https|net|tls|dgram)|@aws-sdk|from ['"]pg['"]/);
    expect(srcText).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/);
    expect(srcText).not.toMatch(/from\s+['"](\.\.\/)+services\/|apps\/api|fastify|@serviceform\//);
    const pkg = readJson(join(root, 'package.json'));
    expect(pkg['dependencies']).toBeUndefined();
    expect(pkg['devDependencies']).toBeUndefined();
    const sqlSrc = readFileSync(join(root, 'src/repo/pg.ts'), 'utf8');
    const schemas = new Set([...sqlSrc.matchAll(/\b(sf_[a-z_]+)\./g)].map((m) => m[1]));
    expect([...schemas]).toEqual(['sf_credential_registry']);
    expect(sqlOnly).not.toMatch(/REFERENCES\s+(?!sf_credential_registry\.)\w+\.\w+/i);
  });

  it('role and privilege posture: NOLOGIN, no SUPERUSER/BYPASSRLS, no PUBLIC grants', () => {
    expect(migrationText).toMatch(
      /CREATE ROLE sf_cmp024_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/,
    );
    expect(migrationText.replaceAll(/NOBYPASSRLS|NOSUPERUSER/g, '')).not.toMatch(
      /\bBYPASSRLS\b|\bSUPERUSER\b/,
    );
    expect(migrationText).not.toMatch(/GRANT[^;]*\bTO\s+PUBLIC/i);
  });
});
