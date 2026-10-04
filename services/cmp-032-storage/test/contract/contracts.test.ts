import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { buildStorageSimulationMarker } from '@serviceform/storage';
import { envelopeOf } from '../../src/db/outbox.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('CMP-032 component contracts', () => {
  it('parses OpenAPI and AsyncAPI', () => {
    const openapi = JSON.parse(read('contracts/openapi.json')) as {
      paths: Record<string, unknown>;
    };
    const asyncapi = JSON.parse(read('contracts/asyncapi.json')) as {
      channels: Record<string, unknown>;
    };
    expect(openapi.paths['/v1/storage/objects']).toBeTruthy();
    expect(openapi.paths['/v1/storage/objects/{id}/access']).toBeTruthy();
    expect(openapi.paths['/v1/storage/objects/{id}/archive']).toBeTruthy();
    expect(asyncapi.channels['sf.storage.events.v1']).toBeTruthy();
  });

  it('validates isolation declarations', () => {
    const decls = JSON.parse(read('contracts/isolation.json')) as unknown[];
    for (const d of decls) {
      expect(validate('isolation-declaration', d).valid).toBe(true);
    }
  });

  it('validates ObjectStored envelope + simulation marker', () => {
    const simulation = buildStorageSimulationMarker({
      environment: 'LOCAL',
      scenario: 'store_success',
      testRunId: 'run-1',
      storageBindingId: '03203203-2032-4032-8032-032032032032',
    });
    expect(validate('simulation-marker', simulation).valid).toBe(true);
    const env = envelopeOf({
      eventType: 'ObjectStored',
      tenantId: '11111111-1111-4111-8111-111111111111',
      cellId: 'cell-01',
      aggregateType: 'StorageObject',
      aggregateId: '22222222-2222-4222-8222-222222222222',
      aggregateVersion: 1,
      occurredAt: '2026-10-04T00:00:00.000Z',
      correlationId: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
      actor: { type: 'OFFICER', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      data: {
        object_id: '22222222-2222-4222-8222-222222222222',
        object_key: 't/x/c/cell-01/o/y/abcd',
        checksum_sha256: 'ab'.repeat(32),
        byte_size: 3,
        storage_mode: 'SIMULATED',
        simulation,
      },
    });
    expect(validate('event-envelope', env).valid).toBe(true);
  });

  it('outbox migration Up matches frozen template after substitution', () => {
    const renderedTemplate = readFileSync(
      join(root, '../../contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_storage')
      .replaceAll('{cmp}', 'CMP-032')
      .trim();
    const file = readFileSync(
      join(root, '../../db/migrations/1759500610000_cmp-032-outbox.sql'),
      'utf8',
    );
    const up = file.split('-- Up Migration')[1]?.split('-- Down Migration')[0] ?? '';
    expect(up).toContain(renderedTemplate);
    const templateOffset = up.indexOf(renderedTemplate);
    const afterTemplate = up.slice(templateOffset + renderedTemplate.length);
    expect(templateOffset).toBeGreaterThanOrEqual(0);
    expect(afterTemplate).toMatch(/ALTER TABLE sf_storage\.outbox_event OWNER TO sf_migrator/);
    const templateSection = up.slice(templateOffset, templateOffset + renderedTemplate.length);
    expect(templateSection).toBe(renderedTemplate);
    expect(templateSection).not.toMatch(/OWNER TO/i);
  });
});
