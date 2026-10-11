import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { CATEGORY_CODE_PATTERN, IDENTIFYING_TOKENS } from '../../src/domain/privacy.js';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import { DOMAIN_EVENT_TYPES, TOPIC_DOMAIN } from '../../src/outbox.js';
import {
  COUNT_DEFINITION,
  ctxFor,
  PURPOSE,
  SUM_DEFINITION,
  TENANT_A,
} from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1759560450000_cmp-045-analytics-mis.sql';
const OUTBOX_MIGRATION = 'db/migrations/1759560450001_cmp-045-outbox.sql';

// Frozen shared + M08 schemas are loaded read-only. AJV is resolved through packages/contracts
// (the established pattern in evidence/SF-M08-CG-001/validate-m08-schemas.mjs) because CMP-045
// declares no runtime or dev dependencies of its own.
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
const metricSchemaPath = join(repoRoot, 'contracts/m08/schemas/analytics-metric.schema.json');
ajv.addSchema(readJson(metricSchemaPath));
const validateMetric = ajv.getSchema(
  'https://contracts.serviceform.ai/m08/analytics-metric/v1',
) as ReturnType<Ajv['compile']>;
const validateShared = (name: string): ReturnType<Ajv['compile']> =>
  ajv.getSchema(`https://contracts.serviceform.ai/${name}/v1`) as ReturnType<Ajv['compile']>;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : [p];
  });
}

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function seededHarness() {
  const h = makeHarness();
  await h.publish({ ...COUNT_DEFINITION, min_cohort_size: 1 });
  await h.publish(SUM_DEFINITION);
  for (const channel of ['WEB', 'MOBILE', 'KIOSK']) {
    await h.service.ingest(h.submitted(TENANT_A, { service_code: 'S1', channel }));
  }
  return h;
}

describe('frozen contract consumption (read-only)', () => {
  it('SF-CON-ANALYTICS-METRIC file hash still matches contracts-lock.yaml', () => {
    const lock = readFileSync(join(repoRoot, 'orchestrator/contracts-lock.yaml'), 'utf8');
    const block = lock.split(/\n {2}- id: /).find((b) => b.startsWith('SF-CON-ANALYTICS-METRIC'));
    expect(block).toBeTruthy();
    const hash = /schema_hash: ([0-9a-f]{64})/.exec(block ?? '')?.[1];
    const actual = createHash('sha256').update(readFileSync(metricSchemaPath)).digest('hex');
    expect(actual).toBe(hash);
    expect(block).toContain('status: FROZEN');
  });

  it('the frozen valid example is accepted and the frozen raw-PII example is refused', () => {
    const dir = join(repoRoot, 'contracts/m08/examples');
    expect(validateMetric(readJson(join(dir, 'valid/analytics-metric.json')))).toBe(true);
    expect(validateMetric(readJson(join(dir, 'invalid/analytics-metric.raw-pii.json')))).toBe(
      false,
    );
  });
});

describe('SF-CON-ANALYTICS-METRIC conformance of CMP-045 projections', () => {
  it('every metric the query API returns validates against the frozen schema', async () => {
    const h = await seededHarness();
    const res = await h.call('GET', '/v1/analytics/metrics', undefined, {
      query: { metric_code: 'APPLICATIONS_SUBMITTED', purpose_code: PURPOSE },
    });
    const metrics = (res.body as Body).metrics as Body[];
    expect(metrics.length).toBe(3);
    for (const { metric } of metrics) {
      expect(validateMetric(metric), JSON.stringify(validateMetric.errors)).toBe(true);
      expect(metric.aggregate_only).toBe(true);
      expect(metric.raw_pii_payload_forbidden).toBe(true);
    }
  });

  it('the contract has no field that could carry a raw payload or person-level value', () => {
    const schema = readJson<{ properties: Record<string, unknown>; additionalProperties: boolean }>(
      metricSchemaPath,
    );
    expect(schema.additionalProperties).toBe(false);
    for (const banned of [
      'payload',
      'raw',
      'subject_id',
      'citizen_id',
      'application_id',
      'actor_id',
      'name',
      'email',
      'mobile',
    ]) {
      expect(Object.keys(schema.properties), banned).not.toContain(banned);
    }
  });
});

describe('shared frozen envelopes emitted by CMP-045', () => {
  it('outbox events, audit events and error responses validate against SF-CON schemas', async () => {
    const h = await seededHarness();
    const dataSchema = ajv.compile(
      readJson(join(root, 'contracts/events/analytics-event.data.schema.json')),
    );
    const id = [...h.repo.tenant(TENANT_A).definitions.keys()][0] as string;
    h.replay.add(h.submitted(TENANT_A, { service_code: 'S1', channel: 'WEB' }));
    await h.call('POST', `/v1/analytics/metric-definitions/${id}/rebuild`, {});
    await h.call('POST', `/v1/analytics/metric-definitions/${id}/retire`, {});
    await h.call('GET', '/v1/analytics/metrics', undefined, {
      query: { metric_code: 'APPLICATIONS_SUBMITTED', purpose_code: PURPOSE },
    });
    const err = await h.call('GET', '/v1/analytics/metrics', undefined, {
      query: { metric_code: 'APPLICATIONS_SUBMITTED', purpose_code: 'WRONG' },
    });

    const outbox = h.repo.tenant(TENANT_A).outbox;
    expect(outbox.length).toBeGreaterThan(6);
    const seenTypes = new Set<string>();
    for (const { topic, envelope } of outbox) {
      const ok = validateShared('event-envelope');
      expect(ok(envelope), JSON.stringify(ok.errors)).toBe(true);
      if (topic === TOPIC_DOMAIN) {
        seenTypes.add(envelope.event_type);
        expect(dataSchema(envelope.data), JSON.stringify(dataSchema.errors)).toBe(true);
      } else {
        const audit = validateShared('audit-event');
        expect(audit(envelope.data), JSON.stringify(audit.errors)).toBe(true);
      }
    }
    expect([...seenTypes].sort()).toEqual([...DOMAIN_EVENT_TYPES].sort());
    const errorSchema = validateShared('error-response');
    expect(errorSchema(err.body), JSON.stringify(errorSchema.errors)).toBe(true);
  });

  it('PEP inputs and the request context validate against the frozen authz and request-context schemas', async () => {
    const h = await seededHarness();
    await h.call('GET', '/v1/analytics/metric-definitions');
    await h.call('GET', '/v1/analytics/metrics', undefined, {
      query: { metric_code: 'APPLICATIONS_SUBMITTED', purpose_code: PURPOSE },
    });
    const input = ajv.getSchema(
      'https://contracts.serviceform.ai/authz-decision/v1#/$defs/input',
    ) as ReturnType<Ajv['compile']>;
    expect(h.authorizer.calls.length).toBeGreaterThan(4);
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

describe('CMP-045 component contracts', () => {
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

  it('exposes no mutation of another component state: only definition/projection commands and reads', () => {
    expect(ROUTE_DESCRIPTORS.map((r) => r.operationId).sort()).toEqual([
      'createMetricDefinition',
      'getMetricDefinition',
      'listMetricDefinitions',
      'queryMetrics',
      'rebuildMetricProjection',
      'retireMetricDefinition',
    ]);
    for (const r of ROUTE_DESCRIPTORS) {
      expect(r.path).toMatch(/^\/v1\/analytics\//);
      expect(r.path).not.toMatch(/case|application|payment|credential|task/i);
    }
  });

  it('isolation declarations validate and match the migration (every tenant table FORCE RLS)', () => {
    const iso = readJson<{ entities: Body[] }>(join(root, 'contracts/isolation.json'));
    const validateIso = validateShared('isolation-declaration');
    for (const row of iso.entities) {
      expect(validateIso(row), JSON.stringify(validateIso.errors)).toBe(true);
    }
    const sql =
      readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8') +
      readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8');
    for (const row of iso.entities) {
      expect(sql).toContain(
        `-- sf:isolation ${row['entity']} ${row['isolation_class']} owner=CMP-045`,
      );
      if (row['isolation_class'] === 'TENANT_SCOPED') {
        expect(sql).toContain(`ALTER TABLE ${row['entity']} FORCE ROW LEVEL SECURITY`);
      }
    }
    const declared = [...sql.matchAll(/-- sf:isolation (\S+)/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual(iso.entities.map((e) => String(e['entity'])).sort());
  });

  it('the outbox migration is the frozen template with only schema and CMP id replaced', () => {
    const template = readFileSync(
      join(repoRoot, 'db/migrations/1759540400001_cmp-029-outbox.sql'),
      'utf8',
    )
      .replaceAll('sf_sla', 'sf_analytics')
      .replaceAll('CMP-029', 'CMP-045');
    expect(readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8')).toBe(template);
  });
});

describe('privacy guards are identical in code and database', () => {
  const sql = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');

  it('the SQL identifying-field token list equals the TypeScript list', () => {
    const fn = /FUNCTION sf_analytics\.is_identifying_field_name[\s\S]*?ARRAY\[([\s\S]*?)\]/.exec(
      sql,
    );
    const sqlTokens = [...(fn?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(sqlTokens.sort()).toEqual([...IDENTIFYING_TOKENS].sort());
  });

  it('the SQL category-code pattern equals the TypeScript pattern', () => {
    expect(sql).toContain(`v ~ '${CATEGORY_CODE_PATTERN}'`);
  });

  it('aggregates are the only stored shape: point columns carry no payload, subject or actor', () => {
    const table = /CREATE TABLE sf_analytics\.metric_point \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? '';
    const columns = [...table.matchAll(/^ {2}([a-z_]+) /gm)].map((m) => m[1]);
    expect(columns.sort()).toEqual(
      [
        'aggregate_only',
        'contributor_count',
        'created_at',
        'definition_id',
        'dimension_hash',
        'dimensions',
        'generation',
        'last_event_at',
        'metric_code',
        'metric_id',
        'period_end',
        'period_start',
        'purpose_code',
        'raw_pii_payload_forbidden',
        'tenant_id',
        'updated_at',
        'value',
      ].sort(),
    );
    const applied =
      /CREATE TABLE sf_analytics\.projection_applied_event \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? '';
    expect([...applied.matchAll(/^ {2}([a-z_]+) /gm)].map((m) => m[1]).sort()).toEqual([
      'applied_at',
      'definition_id',
      'event_id',
      'generation',
      'tenant_id',
    ]);
  });
});

describe('boundary: projection only, no authoritative state, no provider, no host mount', () => {
  const srcFiles = sourceFiles(join(root, 'src'));
  const stripComments = (text: string): string =>
    text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
  const srcText = srcFiles.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
  const migrationText = [SCHEMA_MIGRATION, OUTBOX_MIGRATION]
    .map((m) => readFileSync(join(repoRoot, m), 'utf8'))
    .join('\n');

  it('has no path to case, application or payment state: no reference to their schemas, tables or code', () => {
    expect(srcText).not.toMatch(
      /sf_case|sf_application|sf_payment|cmp-015|CMP-015|cmp-02[0-6]|case_state|application_state|payment_state/,
    );
    expect(migrationText).not.toMatch(/sf_case|sf_application|sf_payment/);
    expect(migrationText).not.toMatch(/REFERENCES\s+(?!sf_analytics\.)\w+\.\w+/i);
    const grants = migrationText.split('\n').filter((l) => /^GRANT /i.test(l));
    for (const g of grants) {
      expect(g).not.toMatch(/sf_case|sf_application|sf_tenant_org|sf_audit|sf_workflow|sf_sla/);
    }
    for (const f of srcFiles) {
      expect(stripComments(readFileSync(f, 'utf8')), f).not.toMatch(
        /from\s+['"](\.\.\/)+(\.\.\/)?services\//,
      );
    }
  });

  it('only touches its own schema in SQL and never mounts on the API host', () => {
    const sqlSrc = readFileSync(join(root, 'src/repo/pg.ts'), 'utf8');
    const schemas = new Set([...sqlSrc.matchAll(/\b(sf_[a-z_]+)\./g)].map((m) => m[1]));
    expect([...schemas]).toEqual(['sf_analytics']);
    expect(srcText).not.toMatch(/apps\/api|fastify|@serviceform\//);
  });

  it('declares no dependencies and uses no network or provider library', () => {
    const importLines = srcText
      .split('\n')
      .filter((l) => /^\s*(?:import|export)\b.*\bfrom\b/.test(l) || /^.*\brequire\(/.test(l));
    for (const line of importLines) {
      expect(line).not.toMatch(
        /@aws-sdk|aws-sdk|opensearch|elasticsearch|kafkajs|node:(http|https|net|tls|dgram)/i,
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

  it('runs no network call inside the authoritative transaction', () => {
    const svc = readFileSync(join(root, 'src/service/analytics-service.ts'), 'utf8');
    expect(svc).toContain('NETWORK_IN_TX');
    expect(svc).toMatch(/await this\.deps\.replay\.readBatch\(/);
  });

  it('role and privilege posture in the migration: NOLOGIN, no SUPERUSER/BYPASSRLS, FORCE RLS, no public', () => {
    expect(migrationText).toMatch(
      /CREATE ROLE sf_cmp045_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/,
    );
    expect(migrationText.replaceAll(/NOBYPASSRLS|NOSUPERUSER/g, '')).not.toMatch(
      /\bBYPASSRLS\b|\bSUPERUSER\b/,
    );
    expect(migrationText).not.toMatch(/GRANT[^;]*\bTO\s+PUBLIC/i);
    const sfAppGrants = migrationText.split('\n').filter((l) => /^GRANT\b.*\bTO sf_app;/.test(l));
    for (const g of sfAppGrants) {
      expect(g).toMatch(
        /GRANT (USAGE ON SCHEMA|INSERT ON sf_analytics\.(outbox|inbox)|SELECT, INSERT ON sf_analytics\.inbox|USAGE, SELECT ON ALL SEQUENCES)/,
      );
    }
  });
});
