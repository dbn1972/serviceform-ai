import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { DOMAIN_EVENT_TYPES, TOPIC_DOMAIN } from '../../src/outbox.js';
import { buildHarness, pdfBytes } from '../doubles/fixtures.js';
import { complete, createPolicy, openSession, putBytes, scanRequestFor } from '../doubles/flow.js';
import { MemoryUploadRepository } from '../doubles/memory-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const SCHEMA_MIGRATION = 'db/migrations/1759530400000_cmp-013-document-upload.sql';
const OUTBOX_MIGRATION = 'db/migrations/1759530400001_cmp-013-outbox.sql';

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

/** Minimal structural check for component-local event data schemas. */
function conforms(schema: DataSchema, data: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const key of schema.required) if (!(key in data)) errors.push(`missing ${key}`);
  for (const [key, value] of Object.entries(data)) {
    const prop = schema.properties[key];
    if (!prop) {
      if (!schema.additionalProperties) errors.push(`unexpected ${key}`);
      continue;
    }
    if (prop.enum && !prop.enum.includes(String(value))) errors.push(`enum ${key}`);
    if (prop.type === 'integer' && !Number.isInteger(value)) errors.push(`integer ${key}`);
    if (prop.type === 'string' && typeof value !== 'string') errors.push(`string ${key}`);
  }
  return errors;
}

describe('CMP-013 component contracts', () => {
  it('OpenAPI exposes the Eng v1.4 interfaces; AsyncAPI lists every emitted event', () => {
    const openapi = json<{ paths: Record<string, unknown> }>('contracts/openapi.json');
    for (const p of [
      '/v1/documents/upload-sessions',
      '/v1/documents/{id}/complete',
      '/v1/documents/{id}',
      '/v1/documents/{id}/access',
      '/v1/upload-policies',
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

  it('emitted event data conforms to the component-local schemas (no URLs/keys/filenames)', async () => {
    const repo = new MemoryUploadRepository();
    const h = await buildHarness(repo);
    await createPolicy(h);
    const bytes = pdfBytes();
    const { body } = await openSession(h, 't1-citizen', bytes);
    await putBytes(h, body.upload, bytes);
    await complete(h, 't1-citizen', body.document_id);
    await h.service.processScanRequest(scanRequestFor(repo.events(), body.document_id));
    const bad = await openSession(h, 't1-citizen', bytes);
    await putBytes(h, bad.body.upload, pdfBytes('xxxxxxxxxxxxxxxxxxxxxxx'));
    await complete(h, 't1-citizen', bad.body.document_id);
    const files: Record<string, string> = {
      DocumentUploaded: 'document-uploaded',
      DocumentScanRequested: 'document-scan-requested',
      DocumentScanned: 'document-scanned',
      DocumentAvailable: 'document-available',
      DocumentRejected: 'document-rejected',
    };
    const seen = new Set<string>();
    for (const env of repo.events()) {
      seen.add(env.event_type);
      const schema = json<DataSchema>(`contracts/events/${files[env.event_type]}.data.schema.json`);
      expect(conforms(schema, env.data as Record<string, unknown>)).toEqual([]);
      const text = JSON.stringify(env);
      expect(text).not.toContain('sim://');
      expect(text).not.toContain('/o/');
    }
    expect([...seen].sort()).toEqual([...DOMAIN_EVENT_TYPES].sort());
  });

  it('outbox migration Up matches the frozen SF-CON-OUTBOX template after substitution', () => {
    const rendered = readFileSync(
      join(repoRoot, 'contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_upload')
      .replaceAll('{cmp}', 'CMP-013')
      .trim();
    const file = readFileSync(join(repoRoot, OUTBOX_MIGRATION), 'utf8');
    const up = file.split('-- Up Migration')[1]?.split('-- Down Migration')[0] ?? '';
    expect(up).toContain(rendered);
    expect(up).toMatch(/ALTER TABLE sf_upload\.outbox_event OWNER TO sf_migrator/);
  });

  it('schema migration: own role, FORCE RLS, no BYPASSRLS/SUPERUSER, no cross-schema refs', () => {
    const sql = readFileSync(join(repoRoot, SCHEMA_MIGRATION), 'utf8');
    const up = sql.split('-- Down Migration')[0] ?? '';
    expect(up).toContain(
      'sf_cmp013_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
    );
    expect(up).not.toMatch(/(?<!NO)BYPASSRLS/);
    expect(up).not.toMatch(/(?<!NO)SUPERUSER/);
    expect(up).not.toMatch(/\bbytea\b/i);
    const refs = [...up.matchAll(/\b(sf_[a-z_]+)\.[a-z_]+/g)].map((m) => m[1]);
    expect([...new Set(refs)].sort()).toEqual(['sf_platform', 'sf_upload']);
    expect(up).not.toMatch(/\b(STATE|DISTRICT|VILLAGE|TALUKA)\b/);
  });
});

describe('CMP-013 static hard checks', () => {
  const files = sourceFiles(join(root, 'src'));
  const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');

  it('consumes CMP-032 only via the @serviceform/storage port package (no cross-component import)', () => {
    expect(text).not.toMatch(/cmp-032-storage/);
    expect(text).not.toMatch(/from '\.\.\/\.\.\/\.\.\//);
    expect(text).not.toMatch(/sf_storage\./);
    expect(text).toMatch(/from '@serviceform\/storage'/);
  });

  it('no durable local/pod filesystem writes', () => {
    expect(text).not.toMatch(
      /from 'node:fs'|from 'fs'|node:fs\/promises|writeFile|createWriteStream/,
    );
  });

  it('no raw provider credentials or cloud SDKs in the component', () => {
    expect(text).not.toMatch(/accessKeyId|secretAccessKey|sessionToken|AKIA[0-9A-Z]{8}|@aws-sdk/);
  });

  it('no OCR / document-intelligence implementation (SF-M04-006 scope)', () => {
    expect(text).not.toMatch(/\bocr\b|textract|tesseract|paddle|extraction/i);
  });

  it('no named-service/jurisdiction branching', () => {
    expect(text).not.toMatch(/residence|income certificate|aadhaar/i);
  });
});
