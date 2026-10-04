import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { DOMAIN_EVENT_TYPES, TOPIC_DOMAIN } from '../../src/outbox.js';
import { JOB_BODY, T1, buildHarness, seedPolicy } from '../doubles/fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1759530600000_cmp-014-document-intelligence.sql';
const OUTBOX_MIGRATION = 'db/migrations/1759530600001_cmp-014-outbox.sql';

function json<T>(rel: string): T {
  return JSON.parse(readFileSync(join(root, rel), 'utf8')) as T;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : [p];
  });
}

interface DataSchema {
  required: string[];
  properties: Record<string, { enum?: string[]; type?: string }>;
  additionalProperties: boolean;
}

function conforms(schema: DataSchema, data: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const key of schema.required) if (!(key in data)) errors.push(`missing ${key}`);
  for (const [key, value] of Object.entries(data)) {
    const prop = schema.properties[key];
    if (!prop) {
      if (!schema.additionalProperties) errors.push(`unexpected ${key}`);
    }
    void value;
  }
  return errors;
}

describe('CMP-014 component contracts', () => {
  it('OpenAPI exposes orchestration interfaces; AsyncAPI lists every emitted event', () => {
    const openapi = json<{ paths: Record<string, unknown> }>('contracts/openapi.json');
    for (const p of [
      '/v1/extraction-policies',
      '/v1/intelligence-jobs',
      '/v1/intelligence-jobs/{id}',
      '/v1/intelligence-jobs/{id}/process',
      '/v1/intelligence-jobs/{id}/review',
    ]) {
      expect(openapi.paths[p]).toBeTruthy();
    }
    const asyncapi = json<{ channels: Record<string, { messages: Record<string, unknown> }> }>(
      'contracts/asyncapi.json',
    );
    expect(Object.keys(asyncapi.channels[TOPIC_DOMAIN]?.messages ?? {}).sort()).toEqual(
      [...DOMAIN_EVENT_TYPES].sort(),
    );
  });

  it('isolation declarations validate against SF-CON-ISOLATION-DECLARATION', () => {
    const iso = json<{ entities: Record<string, unknown>[] }>('contracts/isolation.json');
    for (const row of iso.entities) expect(validate('isolation-declaration', row).valid).toBe(true);
    const migration = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');
    for (const row of iso.entities) {
      if (row['isolation_class'] !== 'TENANT_SCOPED') continue;
      const table = String(row['entity']);
      if (table.includes('outbox') || table.includes('inbox')) continue;
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
  });

  it('emitted event data conforms to component-local schemas (hashes, not values)', async () => {
    const h = await buildHarness();
    await seedPolicy(h);
    const created = await h.call(T1, 'POST', '/v1/intelligence-jobs', JOB_BODY);
    await h.call(T1, 'POST', `/v1/intelligence-jobs/${created.body['job_id']}/process`);
    const files: Record<string, string> = {
      IntelligenceJobAccepted: 'job-accepted',
      IntelligenceJobClassified: 'job-classified',
      IntelligenceJobExtracted: 'job-extracted',
      IntelligenceJobNeedsReview: 'job-status',
      IntelligenceJobCompleted: 'job-status',
      IntelligenceJobFailed: 'job-failed',
      IntelligenceJobRejected: 'job-failed',
      IntelligenceJobReviewed: 'job-reviewed',
    };
    for (const env of h.repo.events()) {
      const schema = json<DataSchema>(`contracts/events/${files[env.event_type]}.data.schema.json`);
      expect(conforms(schema, env.data as Record<string, unknown>)).toEqual([]);
      const text = JSON.stringify(env);
      expect(text).not.toContain('citizen@example.test');
      expect(text).not.toContain('9876543210');
    }
    await h.app.close();
  });

  it('outbox migration Up matches the frozen SF-CON-OUTBOX template after substitution', () => {
    const rendered = readFileSync(
      join(repoRoot, 'contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_docintel')
      .replaceAll('{cmp}', 'CMP-014')
      .trim();
    const file = readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8');
    const up = file.split('-- Up Migration')[1]?.split('-- Down Migration')[0] ?? '';
    expect(up).toContain(rendered);
    expect(up).toMatch(/ALTER TABLE sf_docintel\.outbox_event OWNER TO sf_migrator/);
  });

  it('schema migration: own role, FORCE RLS, no BYPASSRLS/SUPERUSER, no cross-schema refs', () => {
    const sql = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');
    const up = sql.split('-- Down Migration')[0] ?? '';
    expect(up).toContain(
      'sf_cmp014_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
    );
    expect(up).not.toMatch(/(?<!NO)BYPASSRLS/);
    expect(up).not.toMatch(/(?<!NO)SUPERUSER/);
    expect(up).not.toMatch(/\bbytea\b/i);
    const refs = [...up.matchAll(/\b(sf_[a-z_]+)\.[a-z_]+/g)].map((m) => m[1]);
    expect([...new Set(refs)].sort()).toEqual(['sf_docintel', 'sf_platform']);
  });
});

describe('CMP-014 static hard checks', () => {
  const files = sourceFiles(join(root, 'src'));
  const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');

  it('never calls Bedrock/OpenAI/Anthropic/OCR provider SDKs; inference is CMP-039 port only', () => {
    expect(text).not.toMatch(/@aws-sdk|@anthropic|openai|bedrock|textract|tesseract|paddleocr/i);
    expect(text).not.toMatch(/from 'https?:\/\//);
    expect(text).toMatch(/AiGatewayPort/);
    expect(text).toMatch(/caller_component: 'CMP-014'/);
  });

  it('does not import CMP-013/CMP-039 services or query their schemas', () => {
    expect(text).not.toMatch(/cmp-013-document-upload|cmp-039-ai-gateway/);
    expect(text).not.toMatch(/sf_upload\.|sf_ai_gateway\./);
  });

  it('no named-service/jurisdiction branching and no statutory decision writes', () => {
    expect(text).not.toMatch(/residence certificate|aadhaar/i);
    expect(text).toMatch(/advisory_only: true/);
    expect(text).toMatch(/statutory_decision: false/);
  });
});
