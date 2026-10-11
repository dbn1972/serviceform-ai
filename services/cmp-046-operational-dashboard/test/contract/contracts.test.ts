import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { VIEW_CODES, VIEW_DEFINITIONS } from '../../src/domain/model.js';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import { DOMAIN_EVENT_TYPES, TOPIC_DOMAIN } from '../../src/outbox.js';
import { ctxFor, TENANT_A } from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1759542460000_cmp-046-operational-dashboard.sql';
const OUTBOX_MIGRATION = 'db/migrations/1759542460001_cmp-046-outbox.sql';

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
const sharedDir = join(repoRoot, 'contracts/shared/schemas');
for (const f of readdirSync(sharedDir).filter((n) => n.endsWith('.schema.json'))) {
  ajv.addSchema(readJson(join(sharedDir, f)));
}
const validateShared = (name: string): ReturnType<Ajv['compile']> =>
  ajv.getSchema(`https://contracts.serviceform.ai/${name}/v1`) as ReturnType<Ajv['compile']>;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : [p];
  });
}

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('shared frozen envelopes emitted by CMP-046', () => {
  it('outbox events, audit events and error responses validate against SF-CON schemas', async () => {
    const h = makeHarness();
    await h.call('POST', '/v1/ops/views/SLA_SUMMARY/refresh', {});
    await h.call('GET', '/v1/ops/views/SLA_SUMMARY');
    h.authorizer.deniedActions.add('OPS_VIEW_EVENTS');
    const err = await h.call('GET', '/v1/ops/views/EVENT_HEALTH');
    const outbox = h.repo.tenant(TENANT_A).outbox;
    const dataSchema = ajv.compile(
      readJson(join(root, 'contracts/events/ops-view-event.data.schema.json')),
    );
    expect(outbox.length).toBeGreaterThan(3);
    for (const { topic, envelope } of outbox) {
      const ok = validateShared('event-envelope');
      expect(ok(envelope), JSON.stringify(ok.errors)).toBe(true);
      if (topic === TOPIC_DOMAIN) {
        expect(dataSchema(envelope.data), JSON.stringify(dataSchema.errors)).toBe(true);
      } else {
        const audit = validateShared('audit-event');
        expect(audit(envelope.data), JSON.stringify(audit.errors)).toBe(true);
      }
    }
    const errorSchema = validateShared('error-response');
    expect(errorSchema(err.body), JSON.stringify(errorSchema.errors)).toBe(true);
  });

  it('PEP inputs and the request context validate against the frozen authz and request-context schemas', async () => {
    const h = makeHarness();
    await h.call('GET', '/v1/ops/views');
    await h.call('POST', '/v1/ops/views/SLA_SUMMARY/refresh', {});
    const input = ajv.getSchema(
      'https://contracts.serviceform.ai/authz-decision/v1#/$defs/input',
    ) as ReturnType<Ajv['compile']>;
    expect(h.authorizer.calls.length).toBe(VIEW_CODES.length + 1);
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

describe('CMP-046 component contracts', () => {
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

  it('view definitions match the OpenAPI view enum, the event schema and the migration CHECKs', () => {
    const sql = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');
    const event = readJson<{
      properties: { view_code: { enum: string[] }; source_component: { enum: string[] } };
    }>(join(root, 'contracts/events/ops-view-event.data.schema.json'));
    expect(event.properties.view_code.enum).toEqual([...VIEW_CODES]);
    const sources = [...new Set(VIEW_CODES.map((c) => VIEW_DEFINITIONS[c].sourceComponent))].sort();
    expect([...event.properties.source_component.enum].sort()).toEqual(sources);
    for (const code of VIEW_CODES) {
      expect(sql).toContain(
        `view_code = '${code}' AND source_component = '${VIEW_DEFINITIONS[code].sourceComponent}'`,
      );
    }
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
        `-- sf:isolation ${row['entity']} ${row['isolation_class']} owner=CMP-046`,
      );
      if (row['isolation_class'] === 'TENANT_SCOPED') {
        expect(sql).toContain(`ALTER TABLE ${row['entity']} FORCE ROW LEVEL SECURITY`);
      }
    }
    const declared = [...sql.matchAll(/-- sf:isolation (\S+)/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual(iso.entities.map((e) => String(e['entity'])).sort());
  });

  it('OpenAPI mutating bodies take no client data or clock members', () => {
    const openapi = readJson<{
      paths: Record<
        string,
        Record<
          string,
          {
            requestBody?: {
              content: {
                'application/json': {
                  schema: { properties: Record<string, unknown>; additionalProperties: boolean };
                };
              };
            };
          }
        >
      >;
    }>(join(root, 'contracts/openapi.json'));
    for (const [path, ops] of Object.entries(openapi.paths)) {
      for (const op of Object.values(ops)) {
        const schema = op.requestBody?.content['application/json'].schema;
        if (!schema) continue;
        expect(schema.additionalProperties, path).toBe(false);
        expect(Object.keys(schema.properties), path).toEqual([]);
      }
    }
  });
});

describe('boundary: ports only, no peer SQL, no host mount, no authoritative ownership', () => {
  const srcFiles = sourceFiles(join(root, 'src'));
  const stripComments = (text: string): string =>
    text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
  const srcText = srcFiles.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
  const migrationText = [SCHEMA_MIGRATION, OUTBOX_MIGRATION]
    .map((m) => readFileSync(join(repoRoot, m), 'utf8'))
    .join('\n');
  const sqlOnly = migrationText
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');

  it('declares no runtime dependency and makes no network call', () => {
    const importLines = srcText
      .split('\n')
      .filter((l) => /^\s*(?:import|export)\b.*\bfrom\b/.test(l) || /^.*\brequire\(/.test(l));
    for (const line of importLines) {
      expect(line).not.toMatch(/node:(http|https|net|tls|dgram)|@aws-sdk|aws-sdk|pg['"]/i);
    }
    expect(srcText).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/);
    const pkg = readJson<{
      dependencies?: object;
      devDependencies?: object;
      peerDependencies?: object;
    }>(join(root, 'package.json'));
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });

  it('imports no peer component and has no SQL against peer schemas', () => {
    expect(srcText).not.toMatch(/from\s+['"](\.\.\/)+services\//);
    expect(srcText).not.toMatch(/apps\/api|fastify|@serviceform\//);
    for (const peer of [
      'sf_application_case',
      'sf_sla',
      'sf_work_queue',
      'sf_task',
      'sf_integration',
      'sf_event_bus',
      'sf_deficiency',
    ]) {
      expect(srcText, peer).not.toContain(peer);
      expect(sqlOnly, peer).not.toContain(peer);
    }
    expect(sqlOnly).not.toMatch(/REFERENCES\s+(?!sf_ops_dashboard\.)\w+\.\w+/i);
    const sqlSrc = readFileSync(join(root, 'src/repo/pg.ts'), 'utf8');
    const schemas = new Set([...sqlSrc.matchAll(/\b(sf_[a-z_]+)\./g)].map((m) => m[1]));
    expect([...schemas]).toEqual(['sf_ops_dashboard']);
  });

  it('exposes no case, task or SLA write path from the dashboard', () => {
    expect(srcText).not.toMatch(
      /RAISE_DEFICIENCY|APPROVE|REJECT|ISSUE_CERTIFICATE|pauseForDeficiency|resumeAfterDeficiency/,
    );
    const portSrc = readFileSync(join(root, 'src/ports/summary-port.ts'), 'utf8');
    expect(portSrc.match(/\b\w+\(ctx: TenantContext\)/g)).toEqual([
      'fetchSummary(ctx: TenantContext)',
    ]);
    expect(migrationText).toContain(
      'non_authoritative boolean NOT NULL DEFAULT true CHECK (non_authoritative)',
    );
  });

  it('runs no network call inside the authoritative transaction', () => {
    const svc = readFileSync(join(root, 'src/service/service.ts'), 'utf8');
    expect(svc).toContain('NETWORK_IN_TX');
    expect(svc.indexOf('this.readSource(ctx, viewCode)')).toBeGreaterThan(-1);
    expect(svc.indexOf('this.readSource(ctx, viewCode)')).toBeLessThan(
      svc.indexOf('this.deps.repo.withTx(ctx, async (tx): Promise<Committed>'),
    );
  });

  it('role and privilege posture: NOLOGIN, no SUPERUSER/BYPASSRLS, FORCE RLS, no public', () => {
    expect(migrationText).toMatch(
      /CREATE ROLE sf_cmp046_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/,
    );
    expect(migrationText.replaceAll(/NOBYPASSRLS|NOSUPERUSER/g, '')).not.toMatch(
      /\bBYPASSRLS\b|\bSUPERUSER\b/,
    );
    expect(migrationText).not.toMatch(/GRANT[^;]*\bTO\s+PUBLIC/i);
    expect(migrationText).not.toMatch(/GRANT[^;]*(DELETE|TRUNCATE)[^;]*ops_view_snapshot/i);
  });
});
