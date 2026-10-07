import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import { DOMAIN_EVENT_TYPES, TOPIC_DOMAIN } from '../../src/outbox.js';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import {
  APPLICATION_ID,
  ACTOR_CITIZEN,
  ctxFor,
  OPEN_BODY,
  RESPOND_BODY,
  TENANT_A,
} from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1759541900000_cmp-019-deficiency.sql';
const OUTBOX_MIGRATION = 'db/migrations/1759541900001_cmp-019-outbox.sql';
const RECON_MIGRATION = 'db/migrations/1759541900002_cmp-019-reconciliation.sql';

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

describe('shared frozen envelopes emitted by CMP-019', () => {
  it('outbox events, audit events and error responses validate against SF-CON schemas', async () => {
    const h = makeHarness();
    await h.call('POST', '/v1/deficiencies', OPEN_BODY);
    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'CITIZEN');
    const id = [...h.repo.tenant(TENANT_A).notices.keys()][0] as string;
    await h.call('POST', `/v1/deficiencies/${id}/response`, RESPOND_BODY);
    const err = await h.call('POST', `/v1/deficiencies/${id}/response`, RESPOND_BODY);

    const outbox = h.repo.tenant(TENANT_A).outbox;
    const dataSchema = ajv.compile(
      readJson(join(root, 'contracts/events/deficiency-event.data.schema.json')),
    );
    expect(outbox.length).toBeGreaterThan(2);
    for (const { topic, envelope } of outbox) {
      const ok = validateShared('event-envelope');
      expect(ok(envelope), JSON.stringify(ok.errors)).toBe(true);
      if (topic === TOPIC_DOMAIN)
        expect(dataSchema(envelope.data), JSON.stringify(dataSchema.errors)).toBe(true);
      else {
        const audit = validateShared('audit-event');
        expect(audit(envelope.data), JSON.stringify(audit.errors)).toBe(true);
      }
    }
    const errorSchema = validateShared('error-response');
    expect(errorSchema(err.body), JSON.stringify(errorSchema.errors)).toBe(true);
  });

  it('PEP inputs and the request context validate against the frozen authz and request-context schemas', async () => {
    const h = makeHarness();
    await h.call('POST', '/v1/deficiencies', OPEN_BODY);
    const input = ajv.getSchema(
      'https://contracts.serviceform.ai/authz-decision/v1#/$defs/input',
    ) as ReturnType<Ajv['compile']>;
    expect(h.authorizer.calls.length).toBeGreaterThan(0);
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

describe('CMP-019 component contracts', () => {
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

  it('isolation declarations validate and match the migration (every table FORCE RLS)', () => {
    const iso = readJson<{ entities: Body[] }>(join(root, 'contracts/isolation.json'));
    const validateIso = validateShared('isolation-declaration');
    for (const row of iso.entities)
      expect(validateIso(row), JSON.stringify(validateIso.errors)).toBe(true);
    const sql =
      readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8') +
      readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8') +
      readFileSync(join(repoRoot, RECON_MIGRATION), 'utf8');
    for (const row of iso.entities) {
      expect(sql).toContain(
        `-- sf:isolation ${row['entity']} ${row['isolation_class']} owner=CMP-019`,
      );
      if (row['isolation_class'] === 'TENANT_SCOPED') {
        expect(sql).toContain(`ALTER TABLE ${row['entity']} FORCE ROW LEVEL SECURITY`);
      }
    }
    const declared = [...sql.matchAll(/-- sf:isolation (\S+)/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual(iso.entities.map((e) => String(e['entity'])).sort());
  });
});

describe('boundary: no providers, no CMP-015/029 SQL, no host mount', () => {
  const srcFiles = sourceFiles(join(root, 'src'));
  const stripComments = (text: string): string =>
    text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
  const srcText = srcFiles.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
  const migrationText = [SCHEMA_MIGRATION, OUTBOX_MIGRATION, RECON_MIGRATION]
    .map((m) => readFileSync(join(repoRoot, m), 'utf8'))
    .join('\n');

  it('contains no SMS, e-mail, push or notification provider (M06)', () => {
    expect(
      srcFiles.filter((f) =>
        /(sms|e-?mail|push|smtp|twilio|sendgrid|ses|sns|fcm|apns|msg91)/i.test(
          f.split('/src/')[1] ?? '',
        ),
      ),
    ).toEqual([]);
    const importLines = srcText
      .split('\n')
      .filter((l) => /^\s*(?:import|export)\b.*\bfrom\b/.test(l) || /^.*\brequire\(/.test(l));
    for (const line of importLines) {
      expect(line).not.toMatch(
        /nodemailer|twilio|sendgrid|@aws-sdk|aws-sdk|firebase|apn|msg91|smtp|node:(http|https|net|tls|dgram)/i,
      );
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

  it('does not import CMP-015 or CMP-029 source and has no SQL against their schemas', () => {
    const sqlOnly = migrationText
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(srcText).not.toMatch(/from\s+['"](\.\.\/)+services\//);
    expect(srcText).not.toMatch(/sf_application_case|sf_sla\./);
    expect(sqlOnly).not.toMatch(/sf_application_case|sf_sla\./);
    expect(migrationText).not.toMatch(/REFERENCES\s+(?!sf_deficiency\.)\w+\.\w+/i);
  });

  it('only touches sf_deficiency in SQL and never mounts on the API host', () => {
    const sqlSrc = readFileSync(join(root, 'src/repo/pg.ts'), 'utf8');
    const schemas = new Set([...sqlSrc.matchAll(/\b(sf_[a-z_]+)\./g)].map((m) => m[1]));
    expect([...schemas]).toEqual(['sf_deficiency']);
    expect(srcText).not.toMatch(/apps\/api|fastify|@serviceform\//);
  });

  it('runs no network call inside the authoritative transaction', () => {
    const svc = readFileSync(join(root, 'src/service/service.ts'), 'utf8');
    expect(svc).toContain('NETWORK_IN_TX');
    expect(svc).toContain('afterCommit');
    expect(svc).toMatch(/if \(!outcome\.replayed && outcome\.intentId\) await this\.afterCommit/);
    expect(svc).toContain('persistIntent');
    expect(svc).toContain('insertReconciliationIntent');
  });

  it('ships an executable reconciler with durable same-txn intent (not afterCommit-only)', () => {
    const recon = readFileSync(join(root, 'src/service/reconciliation.ts'), 'utf8');
    expect(recon).toContain('DeficiencyReconciliationConsumer');
    expect(recon).toContain('reconcileIntent');
    expect(recon).toContain('reconcilePending');
    expect(recon).toContain('RECONCILIATION_CONSUMER_GROUP');
    expect(recon).toContain('case_expected_state');
    expect(recon).toContain('case_expected_version');
    expect(recon).toContain('CaseCommandPort');
    expect(recon).toContain('SlaClockPort');
    const migration = readFileSync(
      join(root, '../../db/migrations/1759541900002_cmp-019-reconciliation.sql'),
      'utf8',
    );
    expect(migration).toContain('CREATE TABLE sf_deficiency.reconciliation_intent');
    expect(migration).toContain('case_expected_state');
    expect(migration).toContain('case_expected_version');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).not.toMatch(/ALTER TABLE sf_deficiency\.outbox_event\b/);
  });

  it('role and privilege posture: NOLOGIN, no SUPERUSER/BYPASSRLS, FORCE RLS, no public', () => {
    expect(migrationText).toMatch(
      /CREATE ROLE sf_cmp019_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/,
    );
    expect(migrationText.replaceAll(/NOBYPASSRLS|NOSUPERUSER/g, '')).not.toMatch(
      /\bBYPASSRLS\b|\bSUPERUSER\b/,
    );
    expect(migrationText).not.toMatch(/GRANT[^;]*\bTO\s+PUBLIC/i);
  });

  it('OpenAPI mutating bodies refuse client-supplied clock members', () => {
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
    const banned = ['now', 'opened_at', 'responded_at', 'closed_at', 'occurred_at', 'timestamp'];
    for (const [path, ops] of Object.entries(openapi.paths)) {
      for (const op of Object.values(ops)) {
        const schema = op.requestBody?.content['application/json'].schema;
        if (!schema) continue;
        expect(schema.additionalProperties, path).toBe(false);
        for (const key of banned)
          expect(Object.keys(schema.properties), `${path}:${key}`).not.toContain(key);
      }
    }
    expect(APPLICATION_ID).toMatch(/-/);
  });
});
