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

describe('CMP-039 component contracts', () => {
  it('parses OpenAPI (Eng v1.4 interfaces) and AsyncAPI (Eng v1.4 events)', () => {
    const openapi = JSON.parse(read('contracts/openapi.json')) as {
      paths: Record<string, unknown>;
    };
    const asyncapi = JSON.parse(read('contracts/asyncapi.json')) as {
      channels: Record<string, { messages: Record<string, unknown> }>;
    };
    expect(openapi.paths['/v1/ai/invoke']).toBeTruthy();
    expect(openapi.paths['/v1/ai/embed']).toBeTruthy();
    expect(openapi.paths['/v1/ai/models/capabilities']).toBeTruthy();
    const messages = Object.keys(asyncapi.channels['sf.aigateway.events.v1']?.messages ?? {});
    expect(messages.sort()).toEqual([
      'AIProviderFallbackUsed',
      'AIRequestBlocked',
      'AIRequestCompleted',
    ]);
  });

  it('declares every table with the shared isolation-declaration contract', () => {
    const decls = JSON.parse(read('contracts/isolation.json')) as { entity: string }[];
    for (const d of decls) expect(validate('isolation-declaration', d).valid).toBe(true);
    const migration = readFileSync(
      join(root, '../../db/migrations/1759530039000_cmp-039-ai-gateway.sql'),
      'utf8',
    );
    for (const d of decls.filter((x) => !/outbox|inbox/.test(x.entity))) {
      expect(migration).toContain(`-- sf:isolation ${d.entity} `);
    }
  });

  it('validates an AIRequestCompleted envelope', () => {
    const env = envelopeOf({
      eventType: 'AIRequestCompleted',
      tenantId: '11111111-1111-4111-8111-111111111111',
      cellId: 'cell-01',
      aggregateType: 'AiRequest',
      aggregateId: '22222222-2222-4222-8222-222222222222',
      aggregateVersion: 1,
      occurredAt: '2026-10-04T00:00:00.000Z',
      correlationId: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
      actor: { type: 'OFFICER', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      data: { request_id: '22222222-2222-4222-8222-222222222222', operation: 'INVOKE' },
    });
    expect(validate('event-envelope', env).valid).toBe(true);
  });

  it('outbox migration Up matches the frozen SF-CON-OUTBOX template after substitution', () => {
    const rendered = readFileSync(
      join(root, '../../contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_ai_gateway')
      .replaceAll('{cmp}', 'CMP-039')
      .trim();
    const file = readFileSync(
      join(root, '../../db/migrations/1759530039001_cmp-039-outbox.sql'),
      'utf8',
    );
    const up = file.split('-- Up Migration')[1]?.split('-- Down Migration')[0] ?? '';
    const offset = up.indexOf(rendered);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(up.slice(offset, offset + rendered.length)).not.toMatch(/OWNER TO/i);
    expect(up.slice(offset + rendered.length)).toMatch(
      /ALTER TABLE sf_ai_gateway\.outbox_event OWNER TO sf_migrator/,
    );
  });
});
