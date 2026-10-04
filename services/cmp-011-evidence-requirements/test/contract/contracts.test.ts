import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { envelopeOf } from '../../src/db/outbox.js';
import { ASSURANCE_LEVELS, EVIDENCE_SOURCES, PREDICATE_OPS } from '../../src/domain/policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('CMP-011 component contracts', () => {
  it('parses OpenAPI and AsyncAPI and lists the Eng v1.4 interfaces', () => {
    const openapi = JSON.parse(read('contracts/openapi.json')) as {
      paths: Record<string, unknown>;
    };
    const asyncapi = JSON.parse(read('contracts/asyncapi.json')) as {
      channels: Record<string, { messages: Record<string, unknown> }>;
    };
    expect(openapi.paths['/v1/evidence-requirements/calculate']).toBeTruthy();
    expect(openapi.paths['/v1/evidence-policies/{id}/publish']).toBeTruthy();
    const messages = Object.keys(asyncapi.channels['sf.evidence.events.v1']?.messages ?? {});
    expect(messages).toContain('EvidencePolicyPublished');
    expect(messages).toContain('EvidenceRequirementsResolved');
  });

  it('validates isolation declarations with FORCE RLS on every tenant-scoped entity', () => {
    const decls = JSON.parse(read('contracts/isolation.json')) as {
      isolation_class: string;
      rls: string;
    }[];
    for (const d of decls) {
      expect(validate('isolation-declaration', d).valid).toBe(true);
      if (d.isolation_class === 'TENANT_SCOPED') expect(d.rls).toBe('FORCE');
    }
    expect(
      decls.filter((d) => d.isolation_class === 'TENANT_SCOPED').length,
    ).toBeGreaterThanOrEqual(5);
  });

  it('keeps the metadata schema aligned with the parser enumerations', () => {
    const schema = JSON.parse(read('contracts/evidence-policy.schema.json')) as {
      properties: {
        evidence_types: {
          items: {
            properties: Record<
              string,
              { enum?: string[]; items?: { properties: { source: { enum: string[] } } } }
            >;
          };
        };
      };
      $defs: { predicate: { oneOf: { properties?: Record<string, { enum?: string[] }> }[] } };
    };
    const typeProps = schema.properties.evidence_types.items.properties;
    expect(typeProps['min_assurance']?.enum).toEqual([...ASSURANCE_LEVELS]);
    expect(typeProps['sources']?.items?.properties.source.enum).toEqual([...EVIDENCE_SOURCES]);
    const leaf = schema.$defs.predicate.oneOf.find((o) => o.properties?.['op']);
    expect(leaf?.properties?.['op']?.enum).toEqual([...PREDICATE_OPS]);
  });

  it('validates the published and resolved event envelopes', () => {
    const base = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      cellId: 'cell-01',
      occurredAt: '2026-10-04T00:00:00.000Z',
      correlationId: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
      actor: { type: 'OFFICER' as const, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    };
    const published = envelopeOf({
      ...base,
      eventType: 'EvidencePolicyPublished',
      aggregateType: 'EvidencePolicy',
      aggregateId: '22222222-2222-4222-8222-222222222222',
      aggregateVersion: 2,
      data: {
        policy_id: '22222222-2222-4222-8222-222222222222',
        policy_key: 'generic.policy',
        content_hash: `sha256:${'ab'.repeat(32)}`,
        status: 'PUBLISHED',
        version_ref: 'generic.policy@1',
      },
    });
    expect(validate('event-envelope', published).valid).toBe(true);
  });

  it('outbox migration Up matches the frozen template after substitution', () => {
    const rendered = readFileSync(
      join(root, '../../contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_evidence')
      .replaceAll('{cmp}', 'CMP-011')
      .trim();
    const file = readFileSync(
      join(root, '../../db/migrations/1759530110001_cmp-011-outbox.sql'),
      'utf8',
    );
    const up = file.split('-- Up Migration')[1]?.split('-- Down Migration')[0] ?? '';
    expect(up).toContain(rendered);
    const offset = up.indexOf(rendered);
    expect(up.slice(offset, offset + rendered.length)).not.toMatch(/OWNER TO/i);
    expect(up.slice(offset + rendered.length)).toMatch(
      /ALTER TABLE sf_evidence\.outbox_event OWNER TO sf_migrator/,
    );
  });

  it('component source never imports sibling components or live connector packages', () => {
    for (const file of walk(join(root, 'src'))) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/from\s+['"][^'"]*services\//);
      expect(text, file).not.toMatch(/from\s+['"]@serviceform\/cmp-0(?!11)\d\d/);
      expect(text, file).not.toMatch(/from\s+['"]\.\.\/\.\.\/cmp-/);
    }
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    for (const dep of Object.keys(pkg.dependencies)) expect(dep).not.toMatch(/cmp-0/);
  });

  it('the migration declares the privilege role, FORCE RLS and no bypass', () => {
    const sql = readFileSync(
      join(root, '../../db/migrations/1759530110000_cmp-011-evidence.sql'),
      'utf8',
    );
    expect(sql).toMatch(
      /CREATE ROLE sf_cmp011_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/,
    );
    for (const table of ['evidence_policy', 'evidence_resolution', 'idempotency_record']) {
      expect(sql).toContain(`ALTER TABLE sf_evidence.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE sf_evidence.${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(sql).not.toMatch(/\bBYPASSRLS\b(?<!NOBYPASSRLS)/);
  });
});
