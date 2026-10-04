import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { envelopeOf } from '../../src/db/outbox.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('CMP-051 component contracts', () => {
  it('parses OpenAPI and AsyncAPI', () => {
    const openapi = JSON.parse(read('contracts/openapi.json')) as {
      paths: Record<string, unknown>;
    };
    const asyncapi = JSON.parse(read('contracts/asyncapi.json')) as {
      channels: Record<string, unknown>;
    };
    expect(openapi.paths['/v1/publication-requests']).toBeTruthy();
    expect(openapi.paths['/v1/publication-requests/{id}/approve']).toBeTruthy();
    expect(asyncapi.channels['sf.makerchecker.events.v1']).toBeTruthy();
  });

  it('validates isolation declarations', () => {
    const decls = JSON.parse(read('contracts/isolation.json')) as unknown[];
    for (const d of decls) {
      expect(validate('isolation-declaration', d).valid).toBe(true);
    }
  });

  it('validates PublicationRequestCreated envelope', () => {
    const env = envelopeOf({
      eventType: 'PublicationRequestCreated',
      tenantId: '11111111-1111-4111-8111-111111111111',
      cellId: 'cell-01',
      aggregateType: 'PublicationRequest',
      aggregateId: '22222222-2222-4222-8222-222222222222',
      aggregateVersion: 1,
      occurredAt: '2026-10-04T00:00:00.000Z',
      correlationId: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
      actor: { type: 'OFFICER', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      data: {
        request_id: '22222222-2222-4222-8222-222222222222',
        subject_type: 'TENANT_SERVICE_BINDING',
        subject_id: '33333333-3333-4333-8333-333333333333',
        proposed_hash: `sha256:${'ab'.repeat(32)}`,
        status: 'DRAFT',
      },
    });
    expect(validate('event-envelope', env).valid).toBe(true);
  });

  it('outbox migration Up matches frozen template after substitution', () => {
    const renderedTemplate = readFileSync(
      join(root, '../../contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_maker_checker')
      .replaceAll('{cmp}', 'CMP-051')
      .trim();
    const file = readFileSync(
      join(root, '../../db/migrations/1759520510001_cmp-051-outbox.sql'),
      'utf8',
    );
    const up = file.split('-- Up Migration')[1]?.split('-- Down Migration')[0] ?? '';
    expect(up).toContain(renderedTemplate);
    const templateOffset = up.indexOf(renderedTemplate);
    const afterTemplate = up.slice(templateOffset + renderedTemplate.length);
    expect(templateOffset).toBeGreaterThanOrEqual(0);
    expect(afterTemplate).toMatch(
      /ALTER TABLE sf_maker_checker\.outbox_event OWNER TO sf_migrator/,
    );
    const templateSection = up.slice(templateOffset, templateOffset + renderedTemplate.length);
    expect(templateSection).toBe(renderedTemplate);
    expect(templateSection).not.toMatch(/OWNER TO/i);
  });
});
