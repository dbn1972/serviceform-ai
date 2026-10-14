import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { OPAQUE_TOKEN, PUBLIC_VIEW_KEYS, REGISTRY_STATUSES } from '../../src/domain/token.js';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import { DOMAIN_EVENT_TYPES, TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/outbox.js';
import { ctxFor, issueBody, publicVerifierCtx, TENANT_A, TENANT_B } from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';
import type { MemoryQrRepository } from '../doubles/memory-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1760380300000_cmp-023-qr-verification.sql';
const OUTBOX_MIGRATION = 'db/migrations/1760380300001_cmp-023-outbox.sql';
const FROZEN_SCHEMA = 'contracts/m07/schemas/verification-token.schema.json';
const STATUS_SCHEMA = 'contracts/m07/schemas/credential-status.schema.json';
const FROZEN_ID = 'https://contracts.serviceform.ai/m07/verification-token/v1';

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

const sharedDir = join(repoRoot, 'contracts/shared/schemas');
function newAjv(strict: boolean): Ajv {
  const a = new Ajv2020({ allErrors: true, strict, strictRequired: false });
  addFormats(a);
  for (const f of readdirSync(sharedDir).filter((n) => n.endsWith('.schema.json'))) {
    a.addSchema(readJson(join(sharedDir, f)));
  }
  a.addSchema(readJson(join(repoRoot, STATUS_SCHEMA)));
  a.addSchema(readJson(join(repoRoot, FROZEN_SCHEMA)));
  return a;
}
const ajv = newAjv(true);
const validateShared = (name: string): Validator =>
  ajv.getSchema(`https://contracts.serviceform.ai/${name}/v1`) as Validator;
const validateToken = ajv.getSchema(FROZEN_ID) as Validator;
const validatePublicView = ajv.getSchema(`${FROZEN_ID}#/properties/public_view`) as Validator;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : [p];
  });
}

async function fullFlow() {
  const h = makeHarness();
  const minted = await h.call('POST', '/v1/qr/tokens', issueBody());
  const token = (minted.body as Body)['token'] as Body;
  const remint = await h.call('POST', '/v1/qr/tokens', issueBody());
  const read = await h.call('GET', `/v1/qr/tokens/${token['token_id'] as string}`);
  h.registry.setStatus(TENANT_A, token['credential_id'] as string, 'REVOKED');
  h.state.ctx = publicVerifierCtx(TENANT_A);
  const verified = await h.call('GET', `/v1/qr/verify/${token['opaque_token'] as string}`);
  h.state.ctx = publicVerifierCtx(TENANT_B);
  const foreign = await h.call('GET', `/v1/qr/verify/${token['opaque_token'] as string}`);
  h.state.ctx = ctxFor(TENANT_A);
  const statusWrite = await h.call(
    'POST',
    '/v1/qr/tokens',
    issueBody({ registry_status: 'ACTIVE' }),
  );
  h.registry.fail = true;
  const outage = await h.call('GET', `/v1/qr/tokens/${token['token_id'] as string}`);
  return { h, minted, remint, read, verified, foreign, statusWrite, outage };
}

describe('FROZEN SF-CON-VERIFICATION-TOKEN', () => {
  it('the frozen schema still pins read-only status, no-PII and a closed public view', () => {
    const s = readJson(join(repoRoot, FROZEN_SCHEMA));
    expect(s['properties']['contract_id']['const']).toBe('SF-CON-VERIFICATION-TOKEN');
    expect(s['properties']['status_source_cmp']['const']).toBe('CMP-024');
    expect(s['properties']['registry_status_read_only']['const']).toBe(true);
    expect(s['properties']['status_write_forbidden']['const']).toBe(true);
    expect(s['properties']['embedded_pii_forbidden']['const']).toBe(true);
    expect(s['properties']['public_view']['additionalProperties']).toBe(false);
    expect(Object.keys(s['properties']['public_view']['properties']).sort()).toEqual(
      [...PUBLIC_VIEW_KEYS].sort(),
    );
  });

  it('component constants match the frozen bounds and the CMP-024 status enum', () => {
    const s = readJson(join(repoRoot, FROZEN_SCHEMA));
    const t = s['properties']['opaque_token'];
    expect(OPAQUE_TOKEN.source).toBe(
      `^[A-Za-z0-9_-]{${t['minLength'] as number},${t['maxLength'] as number}}$`,
    );
    const status = readJson(join(repoRoot, STATUS_SCHEMA));
    expect([...REGISTRY_STATUSES]).toEqual(status['$defs']['registryStatus']['enum']);
  });

  it('frozen valid example passes and both invalid examples fail (harness sanity)', () => {
    const dir = join(repoRoot, 'contracts/m07/examples');
    expect(
      validateToken(readJson(join(dir, 'valid/verification-token.json'))),
      JSON.stringify(validateToken.errors),
    ).toBe(true);
    expect(validateToken(readJson(join(dir, 'invalid/verification-token.embedded-pii.json')))).toBe(
      false,
    );
    expect(
      validateToken(readJson(join(dir, 'invalid/verification-token.status-writable.json'))),
    ).toBe(false);
  });

  it('every token CMP-023 returns validates against the frozen schema', async () => {
    const { minted, remint, read } = await fullFlow();
    for (const r of [minted, remint, read]) {
      const token = (r.body as Body)['token'];
      expect(validateToken(token), JSON.stringify(validateToken.errors)).toBe(true);
      expect(token['tenant_id']).toBe(TENANT_A);
    }
  });

  it('the public verification body is the frozen public_view and nothing identifying', async () => {
    const { verified, minted } = await fullFlow();
    const body = verified.body as Body;
    expect(Object.keys(body).sort()).toEqual(['public_view', 'status_source_cmp', 'token_purpose']);
    expect(validatePublicView(body['public_view']), JSON.stringify(validatePublicView.errors)).toBe(
      true,
    );
    expect(body['public_view']['registry_status']).toBe('REVOKED');
    const token = (minted.body as Body)['token'] as Body;
    for (const k of ['tenant_id', 'token_id', 'credential_id', 'opaque_token']) {
      expect(JSON.stringify(body)).not.toContain(token[k] as string);
    }
  });
});

describe('shared frozen envelopes emitted by CMP-023', () => {
  it('outbox events, audit events and error responses validate against SF-CON schemas', async () => {
    const { h, foreign, statusWrite, outage, minted } = await fullFlow();
    const all = [TENANT_A, TENANT_B].flatMap(
      (t) => (h.repo as MemoryQrRepository).tenant(t).outbox,
    );
    const eventData = ajv.compile(
      readJson(join(root, 'contracts/events/verification-token-issued.data.schema.json')),
    );
    const envelope = validateShared('event-envelope');
    const audit = validateShared('audit-event');
    const seen = new Set<string>();
    for (const { topic, envelope: env } of all) {
      expect(envelope(env), JSON.stringify(envelope.errors)).toBe(true);
      seen.add(env.event_type);
      if (topic === TOPIC_DOMAIN) {
        expect(eventData(env.data), JSON.stringify(eventData.errors)).toBe(true);
      } else {
        expect(topic).toBe(TOPIC_AUDIT);
        expect(audit(env.data), JSON.stringify(audit.errors)).toBe(true);
      }
    }
    for (const t of DOMAIN_EVENT_TYPES) expect(seen.has(t), t).toBe(true);
    const opaque = ((minted.body as Body)['token'] as Body)['opaque_token'] as string;
    expect(JSON.stringify(all)).not.toContain(opaque);
    const errorSchema = validateShared('error-response');
    const errors = [foreign, statusWrite, outage].map((r) => r.body as Body);
    expect(errors.map((e) => e['error_code'])).toEqual(['SF-SYS-002', 'SF-SYS-003', 'SF-INT-001']);
    for (const e of errors) expect(errorSchema(e), JSON.stringify(errorSchema.errors)).toBe(true);
  });

  it('PEP inputs and the request contexts validate against the frozen schemas', async () => {
    const { h } = await fullFlow();
    const input = ajv.getSchema(
      'https://contracts.serviceform.ai/authz-decision/v1#/$defs/input',
    ) as Validator;
    expect(h.authorizer.calls.length).toBeGreaterThanOrEqual(5);
    for (const call of h.authorizer.calls) {
      expect(input(call), JSON.stringify(input.errors)).toBe(true);
    }
    const ctxSchema = validateShared('request-context');
    for (const c of [
      ctxFor(TENANT_A),
      ctxFor(TENANT_A, undefined, 'SYSTEM'),
      publicVerifierCtx(TENANT_A),
    ]) {
      expect(ctxSchema(c), JSON.stringify(ctxSchema.errors)).toBe(true);
    }
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

describe('CMP-023 component contracts', () => {
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
    expect(ROUTE_DESCRIPTORS.filter((r) => r.method === 'GET').map((r) => r.path)).toEqual([
      '/v1/qr/tokens/:token_id',
      '/v1/qr/verify/:opaque_token',
    ]);
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
    const local = newAjv(false);
    local.addSchema({ $id: 'cmp023-openapi', components: openapi['components'] });
    const v = (name: string): Validator =>
      local.getSchema(`cmp023-openapi#/components/schemas/${name}`) as Validator;
    const { minted, read, verified } = await fullFlow();
    for (const r of [minted, read]) {
      expect(v('TokenResponse')(r.body), JSON.stringify(v('TokenResponse').errors)).toBe(true);
    }
    expect(
      v('PublicVerificationResponse')(verified.body),
      JSON.stringify(v('PublicVerificationResponse').errors),
    ).toBe(true);
    expect(v('IssueTokenRequest')(issueBody())).toBe(true);
    expect(v('IssueTokenRequest')(issueBody({ registry_status: 'ACTIVE' }))).toBe(false);
  });

  it('isolation.json declares exactly the tables the migrations create, all FORCE RLS or justified', () => {
    const iso = readJson<{ entities: { entity: string; rls: string; justification?: string }[] }>(
      join(root, 'contracts/isolation.json'),
    );
    const sql = [SCHEMA_MIGRATION, OUTBOX_MIGRATION]
      .map((p) => readFileSync(join(repoRoot, p), 'utf8'))
      .join('\n');
    const created = [...sql.matchAll(/CREATE TABLE (sf_qr\.[a-z_]+)/g)].map((m) => m[1]);
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
      .replaceAll('{schema}', 'sf_qr')
      .replaceAll('{cmp}', 'CMP-023');
    expect(readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8')).toContain(template);
  });
});

describe('architecture guards (static)', () => {
  const src = sourceFiles(join(root, 'src')).map((p) => ({ p, text: readFileSync(p, 'utf8') }));
  const migration = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');
  const migrationCode = migration.replace(/--[^\n]*/g, '');

  it('no peer component imports and no SQL outside sf_qr (ports only)', () => {
    for (const { p, text } of src) {
      expect(text, p).not.toMatch(
        /from ['"][^'"]*(?:@serviceform\/cmp-|services\/cmp-|\.\.\/\.\.\/\.\.\/)/,
      );
      for (const m of text.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)\./g)) {
        expect(m[1], p).toBe('sf_qr');
      }
    }
    for (const m of migrationCode.matchAll(/\b(?:REFERENCES|ON)\s+([a-z_]+)\.[a-z_]+/g)) {
      expect(m[1]).toBe('sf_qr');
    }
  });

  it('CMP-023 has no place to store, cache or write a registry status', () => {
    expect(migrationCode).not.toMatch(/registry_status\s+text|current_status|\bstatus_cache\b/i);
    const tokenTable =
      /CREATE TABLE sf_qr\.verification_token \(([\s\S]*?)\n\);/.exec(migrationCode)?.[1] ?? '';
    expect(tokenTable).not.toMatch(/^\s*(?:registry_)?status\s/m);
    const port = readFileSync(join(root, 'src/ports/registry-status-port.ts'), 'utf8');
    const methods = [...port.matchAll(/^\s+([a-zA-Z]+)\(/gm)].map((m) => m[1]);
    expect(methods).toEqual(['getStatus']);
    const repoTypes = readFileSync(join(root, 'src/repo/types.ts'), 'utf8');
    expect(repoTypes).not.toMatch(/\w*[Ss]tatus\w*\(/);
    for (const { p, text } of src) {
      expect(text, p).not.toMatch(/\.(?:setStatus|updateStatus|writeStatus|revoke|suspend)\(/);
      expect(text, p).not.toMatch(/\b(?:new Map|LRU|cache\.set)\b/);
    }
  });

  it('no named service, tenant, issuer or jurisdiction and no statutory decision vocabulary', () => {
    for (const { p, text } of src) {
      expect(text, p).not.toMatch(/RESIDENCE|INCOME_CERT|CASTE_CERT|IN-[A-Z]{2}\b|DigiLocker/i);
      expect(text, p).not.toMatch(/\b(?:ELIGIBLE|APPROVED|REJECTED|INELIGIBLE)\b/);
    }
  });

  it('no invented validity or retention period anywhere in CMP-023 code or migrations', () => {
    const outbox = readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8');
    for (const [name, text] of [
      ...src.map(({ p, text: t }) => [p, t] as const),
      [SCHEMA_MIGRATION, migration] as const,
    ]) {
      expect(text, name).not.toMatch(/\bINTERVAL\b/i);
      expect(text, name).not.toMatch(/\b\d+\s*(?:days?|weeks?|months?|years?)\b/i);
      expect(text, name).not.toMatch(
        /retention_(?:days|period|until)|purge_after|delete_after|valid_for/i,
      );
    }
    expect(outbox).not.toMatch(/\bINTERVAL\b/i);
  });
});
