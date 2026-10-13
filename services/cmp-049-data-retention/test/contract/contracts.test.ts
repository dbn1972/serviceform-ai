import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { ELIGIBILITY_STATES } from '../../src/domain/eligibility.js';
import { ERROR_CATALOGUE_SUBSET } from '../../src/errors.js';
import {
  DOMAIN_EVENT_TYPES,
  POLICY_EVENT_TYPES,
  SUBJECT_EVENT_TYPES,
  TOPIC_AUDIT,
  TOPIC_DOMAIN,
} from '../../src/outbox.js';
import { ctxFor, OWNER_PERIOD_REF, policyBody, RESOURCE_1, TENANT_A } from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';
import type { MemoryRetentionRepository } from '../doubles/memory-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1760360000000_cmp-049-data-retention.sql';
const OUTBOX_MIGRATION = 'db/migrations/1760360000001_cmp-049-outbox.sql';
const FROZEN_SCHEMA = 'contracts/m08/schemas/retention-policy.schema.json';

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

function readJson<T = Record<string, unknown>>(path: string): T {
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
const validatePolicy = ajv.getSchema(
  'https://contracts.serviceform.ai/m08/retention-policy/v1',
) as Validator;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : [p];
  });
}

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function fullFlow(): Promise<{ h: ReturnType<typeof makeHarness>; bodies: Body[] }> {
  const h = makeHarness();
  const bodies: Body[] = [];
  const reg = await h.call('POST', '/v1/retention/policies', policyBody());
  bodies.push(reg.body as Body);
  const policyId = (reg.body as Body)['policy']['policy_id'] as string;
  const enr = await h.call('POST', '/v1/retention/subjects', {
    policy_id: policyId,
    resource_type: 'APPLICATION',
    resource_id: RESOURCE_1,
  });
  const subjectId = (enr.body as Body)['subject_id'] as string;
  bodies.push((await transition(h, subjectId, 'ARCHIVE_ELIGIBLE', 1)).body as Body);
  bodies.push(
    (
      await h.call('POST', `/v1/retention/policies/${policyId}/period-ref`, {
        owner_supplied_period_ref: OWNER_PERIOD_REF,
      })
    ).body as Body,
  );
  bodies.push((await transition(h, subjectId, 'ARCHIVE_ELIGIBLE', 1)).body as Body);
  bodies.push((await h.call('GET', `/v1/retention/policies/${policyId}`)).body as Body);
  bodies.push((await h.call('GET', `/v1/retention/subjects/${subjectId}/evaluation`)).body as Body);
  h.authorizer.deniedActions.add('RETENTION_SUBJECT_READ');
  bodies.push((await h.call('GET', `/v1/retention/subjects/${subjectId}`)).body as Body);
  return { h, bodies };
}

function transition(
  h: ReturnType<typeof makeHarness>,
  subjectId: string,
  to: string,
  expected: number,
): ReturnType<ReturnType<typeof makeHarness>['call']> {
  return h.call('POST', `/v1/retention/subjects/${subjectId}/transitions`, {
    to_eligibility: to,
    expected_version: expected,
  });
}

describe('FROZEN SF-CON-RETENTION-POLICY', () => {
  it('the frozen schema still pins the policy-input markers', () => {
    const s = readJson<Body>(join(repoRoot, FROZEN_SCHEMA));
    expect(s['properties']['contract_status']['const']).toBe('FROZEN');
    expect(s['properties']['statutory_retention_policy_input_required']['const']).toBe(true);
    expect(s['properties']['invented_statutory_period_forbidden']['const']).toBe(true);
    expect(s['properties']['policy_neutral_shape']['const']).toBe(true);
  });

  it('frozen valid example passes and invalid example fails (harness sanity)', () => {
    const valid = readJson(join(repoRoot, 'contracts/m08/examples/valid/retention-policy.json'));
    const invalid = readJson(
      join(repoRoot, 'contracts/m08/examples/invalid/retention-policy.input-not-required.json'),
    );
    expect(validatePolicy(valid), JSON.stringify(validatePolicy.errors)).toBe(true);
    expect(validatePolicy(invalid)).toBe(false);
  });

  it('every policy CMP-049 returns validates against the frozen schema, bound or unbound', async () => {
    const { bodies } = await fullFlow();
    const policies = bodies.filter((b) => b['policy']).map((b) => b['policy'] as Body);
    expect(policies.length).toBe(3);
    for (const p of policies) {
      expect(validatePolicy(p), JSON.stringify(validatePolicy.errors)).toBe(true);
      expect(p['statutory_retention_policy_input_required']).toBe(true);
      expect(p['invented_statutory_period_forbidden']).toBe(true);
    }
    expect(policies[0]?.['owner_supplied_period_ref']).toBeNull();
    expect(policies[1]?.['owner_supplied_period_ref']).toBe(OWNER_PERIOD_REF);
  });

  it('component eligibility enum equals the frozen enum', () => {
    const s = readJson<Body>(join(repoRoot, FROZEN_SCHEMA));
    const frozenEnum =
      s['properties']['eligibility_transitions']['items']['properties']['to_eligibility']['enum'];
    expect([...ELIGIBILITY_STATES]).toEqual(frozenEnum);
  });
});

describe('shared frozen envelopes emitted by CMP-049', () => {
  it('outbox events, audit events and error responses validate against SF-CON schemas', async () => {
    const { h, bodies } = await fullFlow();
    const outbox = (h.repo as MemoryRetentionRepository).tenant(TENANT_A).outbox;
    const policyData = ajv.compile(
      readJson(join(root, 'contracts/events/retention-policy-event.data.schema.json')),
    );
    const subjectData = ajv.compile(
      readJson(join(root, 'contracts/events/retention-subject-event.data.schema.json')),
    );
    const envelope = validateShared('event-envelope');
    const audit = validateShared('audit-event');
    const seen = new Set<string>();
    for (const { topic, envelope: env } of outbox) {
      expect(envelope(env), JSON.stringify(envelope.errors)).toBe(true);
      seen.add(env.event_type);
      if (topic === TOPIC_DOMAIN) {
        const v = (POLICY_EVENT_TYPES as readonly string[]).includes(env.event_type)
          ? policyData
          : subjectData;
        expect(v(env.data), JSON.stringify(v.errors)).toBe(true);
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
    expect(errors[0]?.['details']).toEqual([{ code: 'POLICY_INPUT_REQUIRED' }]);
  });

  it('PEP inputs and the request context validate against the frozen authz and request-context schemas', async () => {
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

describe('CMP-049 component contracts', () => {
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
      [...POLICY_EVENT_TYPES, ...SUBJECT_EVENT_TYPES].sort(),
    );
    expect(readJson<{ name: string }>(join(root, 'contracts/topics.json')).name).toBe(TOPIC_DOMAIN);
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
        `-- sf:isolation ${row['entity']} ${row['isolation_class']} owner=CMP-049`,
      );
      if (row['isolation_class'] === 'TENANT_SCOPED') {
        expect(sql).toContain(`ALTER TABLE ${row['entity']} ENABLE ROW LEVEL SECURITY`);
        expect(sql).toContain(`ALTER TABLE ${row['entity']} FORCE ROW LEVEL SECURITY`);
      }
    }
    const declared = [...sql.matchAll(/-- sf:isolation (\S+)/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual(iso.entities.map((e) => String(e['entity'])).sort());
  });

  it('no request body schema accepts a period value or a tenant id', () => {
    const openapi = readJson<Body>(join(root, 'contracts/openapi.json'));
    const schemas = openapi['components']['schemas'] as Record<string, Body>;
    for (const [name, schema] of Object.entries(schemas)) {
      if (!name.endsWith('Request')) continue;
      expect(schema['additionalProperties'], name).toBe(false);
      const keys = Object.keys(schema['properties'] as object);
      expect(keys, name).not.toContain('tenant_id');
      for (const k of keys) expect(k, name).not.toMatch(/days|months|years|ttl|duration|until/);
    }
  });
});

describe('statutory policy invention guard and component boundary', () => {
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

  it('domain code computes no retention date, period or erasure timeline', () => {
    expect(srcText).not.toMatch(/retention_(days|months|years|period)\b/i);
    expect(srcText).not.toMatch(/\b(addDays|addYears|setFullYear|getFullYear|setMonth)\b/);
    expect(srcText).not.toMatch(/86_?400|365|\* 24 \* 60 \* 60 \* 1000 \* \d/);
    expect(srcText).not.toMatch(/\bDPDP\b|erasure_deadline|due_at|expires_after/i);
    const domain = readFileSync(join(root, 'src/domain/eligibility.ts'), 'utf8');
    expect(domain).not.toMatch(/Date|clock|now\(/);
  });

  it('migrations have no period columns and enforce POLICY_INPUT_REQUIRED at the database', () => {
    expect(sqlOnly).not.toMatch(/\b\w*(_days|_months|_years|_ttl|interval)\b/i);
    expect(sqlOnly).toContain(
      "to_eligibility NOT IN ('ARCHIVE_ELIGIBLE', 'DELETE_ELIGIBLE')\n    OR owner_supplied_period_ref IS NOT NULL",
    );
    expect(sqlOnly).toContain('SF_POLICY_INPUT_REQUIRED');
    expect(sqlOnly).toMatch(/CHECK \(statutory_retention_policy_input_required\)/);
    expect(sqlOnly).toMatch(/CHECK \(invented_statutory_period_forbidden\)/);
  });

  it('no hard-coded tenant, jurisdiction or service names in source', () => {
    expect(srcText).not.toMatch(/RESIDENCE_CERTIFICATE|11111111-1111|99999999-9999/);
    expect(srcText).not.toMatch(/\b(odisha|karnataka|kerala|delhi|maharashtra)\b/i);
  });

  it('declares no runtime dependency, makes no network call and imports no peer component', () => {
    expect(srcText).not.toMatch(/node:(http|https|net|tls|dgram)|@aws-sdk|from ['"]pg['"]/);
    expect(srcText).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/);
    expect(srcText).not.toMatch(/from\s+['"](\.\.\/)+services\/|apps\/api|fastify|@serviceform\//);
    const pkg = readJson<Body>(join(root, 'package.json'));
    expect(pkg['dependencies']).toBeUndefined();
    expect(pkg['devDependencies']).toBeUndefined();
    const sqlSrc = readFileSync(join(root, 'src/repo/pg.ts'), 'utf8');
    const schemas = new Set([...sqlSrc.matchAll(/\b(sf_[a-z_]+)\./g)].map((m) => m[1]));
    expect([...schemas]).toEqual(['sf_retention']);
    expect(sqlOnly).not.toMatch(/REFERENCES\s+(?!sf_retention\.)\w+\.\w+/i);
  });

  it('exposes no archive, purge or delete execution path', () => {
    for (const r of ROUTE_DESCRIPTORS) {
      expect(r.method === 'GET' || r.method === 'POST').toBe(true);
      expect(r.path).not.toMatch(/purge|erase|delete|archive/i);
    }
    expect(srcText).not.toMatch(/DELETE FROM|TRUNCATE/i);
  });

  it('role and privilege posture: NOLOGIN, no SUPERUSER/BYPASSRLS, no PUBLIC grants, no DELETE on state', () => {
    expect(migrationText).toMatch(
      /CREATE ROLE sf_cmp049_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/,
    );
    expect(migrationText.replaceAll(/NOBYPASSRLS|NOSUPERUSER/g, '')).not.toMatch(
      /\bBYPASSRLS\b|\bSUPERUSER\b/,
    );
    expect(migrationText).not.toMatch(/GRANT[^;]*\bTO\s+PUBLIC/i);
    expect(migrationText).not.toMatch(
      /GRANT[^;]*(DELETE|TRUNCATE)[^;]*(retention_policy|retention_subject|retention_transition_log)/i,
    );
  });
});
