import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { DOMAIN_EVENT_TYPES, TOPIC_DOMAIN } from '../../src/outbox.js';
import { APP_ID, REC_BODY, SVC_1, T1, buildHarness, seedPolicy } from '../doubles/fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1759550070000_cmp-007-recommendation.sql';
const OUTBOX_MIGRATION = 'db/migrations/1759550070001_cmp-007-outbox.sql';

const requireFromContracts = createRequire(join(repoRoot, 'packages/contracts/package.json'));
const Ajv2020 = requireFromContracts('ajv/dist/2020.js').Ajv2020 as new (opts: object) => AjvLike;
const addFormatsModule = requireFromContracts('ajv-formats') as {
  default?: (a: AjvLike) => void;
};
const addFormats = (addFormatsModule.default ?? addFormatsModule) as unknown as (
  a: AjvLike,
) => void;

interface AjvLike {
  addSchema(schema: object): void;
  compile(schema: object): ((data: unknown) => boolean) & { errors?: unknown };
}

function json<T>(rel: string, base = root): T {
  return JSON.parse(readFileSync(join(base, rel), 'utf8')) as T;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : [p];
  });
}

function frozenAjv(): AjvLike {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  const shared = join(repoRoot, 'contracts/shared/schemas');
  for (const f of readdirSync(shared).filter((n) => n.endsWith('.schema.json'))) {
    ajv.addSchema(json<object>(f, shared));
  }
  return ajv;
}

const EVENT_SCHEMA_FILES: Record<string, string> = {
  RecommendationRequested: 'recommendation-requested',
  RecommendationGenerated: 'recommendation-generated',
  RecommendationFailed: 'recommendation-failed',
  RecommendationSelected: 'recommendation-disposed',
  RecommendationDismissed: 'recommendation-disposed',
};

describe('CMP-007 consumes FROZEN SF-CON-RECOMMENDATION (no change)', () => {
  const schema = json<{ $id: string }>(
    'contracts/m08/schemas/recommendation.schema.json',
    repoRoot,
  );

  it('the response document validates against the frozen schema; the invalid example fails', async () => {
    const ajv = frozenAjv();
    const check = ajv.compile(schema);
    const h = await buildHarness();
    await seedPolicy(h);
    const res = await h.call(T1, 'POST', '/v1/recommendations', {
      ...REC_BODY,
      application_id: APP_ID,
    });
    expect(res.status).toBe(201);
    expect(check(res.body['recommendation'])).toBe(true);
    const selected = await h.call(
      T1,
      'POST',
      `/v1/recommendations/${String(res.body['recommendation_id'])}/disposition`,
      { decision: 'SELECT', service_id: SVC_1 },
    );
    expect(check(selected.body['recommendation'])).toBe(true);
    await h.app.close();

    const valid = json<object>('contracts/m08/examples/valid/recommendation.json', repoRoot);
    const invalid = json<object>(
      'contracts/m08/examples/invalid/recommendation.authoritative.json',
      repoRoot,
    );
    expect(check(valid)).toBe(true);
    expect(check(invalid)).toBe(false);
    expect(check({ ...(res.body['recommendation'] as object), authoritative: true })).toBe(false);
  });

  it('FAILED recommendations expose no contract document (reason_codes minItems 1)', async () => {
    const h = await buildHarness();
    await seedPolicy(h);
    h.gateway.scenario = 'unavailable';
    await h.call(T1, 'POST', '/v1/recommendations', REC_BODY);
    const row = h.repo.state.rows[0];
    const view = await h.call(T1, 'GET', `/v1/recommendations/${row?.recommendation_id}`);
    expect(view.body['recommendation']).toBeNull();
    await h.app.close();
  });
});

describe('CMP-007 component contracts', () => {
  it('OpenAPI exposes the Eng interfaces; AsyncAPI lists every emitted event', () => {
    const openapi = json<{ paths: Record<string, unknown> }>('contracts/openapi.json');
    for (const p of [
      '/v1/recommendation-policies',
      '/v1/recommendations',
      '/v1/recommendations/{id}',
      '/v1/recommendations/{id}/disposition',
    ]) {
      expect(openapi.paths[p]).toBeTruthy();
    }
    const asyncapi = json<{ channels: Record<string, { messages: Record<string, unknown> }> }>(
      'contracts/asyncapi.json',
    );
    expect(Object.keys(asyncapi.channels[TOPIC_DOMAIN]?.messages ?? {}).sort()).toEqual(
      [...DOMAIN_EVENT_TYPES].sort(),
    );
    expect(json<{ name: string }>('contracts/topics.json').name).toBe(TOPIC_DOMAIN);
  });

  it('isolation declarations validate against SF-CON-ISOLATION-DECLARATION and match the migration', () => {
    const iso = json<{ entities: Record<string, unknown>[] }>('contracts/isolation.json');
    for (const row of iso.entities) expect(validate('isolation-declaration', row).valid).toBe(true);
    const migration = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');
    for (const row of iso.entities) {
      if (row['isolation_class'] !== 'TENANT_SCOPED') continue;
      const table = String(row['entity']);
      if (table.includes('outbox') || table.includes('inbox')) continue;
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`-- sf:isolation ${table} TENANT_SCOPED owner=CMP-007`);
    }
  });

  it('emitted event data validates against component-local JSON Schemas and carries no PII', async () => {
    const h = await buildHarness();
    await seedPolicy(h);
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const created = await h.call(T1, 'POST', '/v1/recommendations', {
      ...REC_BODY,
      application_id: APP_ID,
    });
    const id = String(created.body['recommendation_id']);
    await h.call(T1, 'POST', `/v1/recommendations/${id}/disposition`, {
      decision: 'SELECT',
      service_id: SVC_1,
    });
    const second = await h.call(T1, 'POST', '/v1/recommendations', REC_BODY);
    await h.call(
      T1,
      'POST',
      `/v1/recommendations/${String(second.body['recommendation_id'])}/disposition`,
      {
        decision: 'DISMISS',
      },
    );
    h.gateway.scenario = 'unavailable';
    await h.call(T1, 'POST', '/v1/recommendations', REC_BODY);
    const seen = new Set<string>();
    for (const env of h.repo.events()) {
      const file = EVENT_SCHEMA_FILES[env.event_type];
      expect(file, env.event_type).toBeTruthy();
      const check = ajv.compile(json<object>(`contracts/events/${file}.data.schema.json`));
      expect(check(env.data), `${env.event_type} ${JSON.stringify(check.errors)}`).toBe(true);
      seen.add(env.event_type);
      expect(JSON.stringify(env)).not.toMatch(/@|prompt_text|output_text/);
    }
    expect([...seen].sort()).toEqual([...DOMAIN_EVENT_TYPES].sort());
    await h.app.close();
  });

  it('outbox migration Up matches the frozen SF-CON-OUTBOX template after substitution', () => {
    const rendered = readFileSync(
      join(repoRoot, 'contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_recommendation')
      .replaceAll('{cmp}', 'CMP-007')
      .trim();
    const file = readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8');
    const up = file.split('-- Up Migration')[1]?.split('-- Down Migration')[0] ?? '';
    expect(up).toContain(rendered);
    expect(up).toMatch(/ALTER TABLE sf_recommendation\.outbox_event OWNER TO sf_migrator/);
  });

  it('schema migration: own role, FORCE RLS, no BYPASSRLS/SUPERUSER, no cross-schema refs, no raw prompt/output columns', () => {
    const sql = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');
    const up = sql.split('-- Down Migration')[0] ?? '';
    expect(up).toContain(
      'sf_cmp007_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
    );
    expect(up).not.toMatch(/(?<!NO)BYPASSRLS/);
    expect(up).not.toMatch(/(?<!NO)SUPERUSER/);
    expect(up).not.toMatch(/\bbytea\b/i);
    expect(up).not.toMatch(/\b(prompt_text|output_text|raw_output|completion)\b/i);
    const refs = [...up.matchAll(/\b(sf_[a-z_]+)\.[a-z_]+/g)].map((m) => m[1]);
    expect([...new Set(refs)].sort()).toEqual(['sf_platform', 'sf_recommendation']);
    expect(up).toContain('CHECK (non_authoritative)');
    expect(up).toContain('CHECK (NOT authoritative)');
    expect(up).toContain("CHECK (ai_gateway_cmp = 'CMP-039')");
  });
});

describe('CMP-007 static hard checks', () => {
  const files = sourceFiles(join(root, 'src'));
  const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');

  it('never calls model provider SDKs or hosts; inference is the CMP-039 port only', () => {
    expect(text).not.toMatch(
      /@aws-sdk|@anthropic|openai|bedrock|vertex|gemini|cohere|mistral|huggingface|langchain|ollama/i,
    );
    expect(text).not.toMatch(/\bfetch\s*\(|from 'https?:\/\/|from 'node:https?'|axios|undici/);
    expect(text).toMatch(/AiGatewayPort/);
    expect(text).toMatch(/caller_component: 'CMP-007'/);
  });

  it('does not import sibling services or query their schemas (no cross-component SQL)', () => {
    expect(text).not.toMatch(
      /services\/cmp-0|cmp-039-ai-gateway|cmp-001-catalogue|cmp-030-consent/,
    );
    expect(text).not.toMatch(/sf_ai_gateway\.|sf_catalogue\.|sf_consent\.|sf_citizen/);
    const sql = files
      .filter((f) => f.endsWith('pg.ts'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const schemas = [...sql.matchAll(/\b(sf_[a-z_]+)\.[a-z_]+/g)].map((m) => m[1]);
    expect([...new Set(schemas)]).toEqual(['sf_recommendation']);
  });

  it('no named-service/tenant/jurisdiction branching and no authoritative writes', () => {
    expect(text).not.toMatch(/residence certificate|aadhaar|digilocker/i);
    expect(text).toMatch(/non_authoritative: true/);
    expect(text).toMatch(/authoritative: false/);
    expect(text).toMatch(/statutory_decision: false/);
    expect(text).not.toMatch(/(?<!non_)authoritative: true|statutory_decision: true/);
  });

  it('opens no network call inside a DB transaction (external() guard on every port call)', () => {
    const service = readFileSync(join(root, 'src/service/recommendation-service.ts'), 'utf8');
    for (const port of [
      'catalogue.resolve',
      'catalogue.listPublished',
      'consent.check',
      'gateway.invoke',
      'profile.signals',
    ]) {
      const at = service.indexOf(`this.deps.${port}`);
      expect(at, port).toBeGreaterThan(0);
      expect(service.slice(Math.max(0, at - 160), at), port).toMatch(/this\.external\(/);
    }
  });
});
