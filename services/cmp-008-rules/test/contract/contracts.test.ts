import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { envelopeOf } from '../../src/db/outbox.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

describe('CMP-008 component contracts', () => {
  it('parses OpenAPI and AsyncAPI and declares only the CMP-008 surface', () => {
    const openapi = JSON.parse(read('contracts/openapi.json')) as {
      paths: Record<string, unknown>;
    };
    const asyncapi = JSON.parse(read('contracts/asyncapi.json')) as {
      channels: Record<string, unknown>;
    };
    expect(Object.keys(openapi.paths).sort()).toEqual(['/v1/evaluations', '/v1/evaluations/{id}']);
    expect(asyncapi.channels['sf.rules.events.v1']).toBeTruthy();
    const topics = JSON.parse(read('contracts/topics.json')) as {
      topics: { name: string; event_types: string[] }[];
    };
    expect(topics.topics[0]).toEqual({
      name: 'sf.rules.events.v1',
      event_types: ['RuleEvaluated'],
    });
  });

  it('validates isolation declarations and matches the migration declarations', () => {
    const decls = JSON.parse(read('contracts/isolation.json')) as { entity: string }[];
    for (const d of decls) expect(validate('isolation-declaration', d).valid).toBe(true);
    const sql =
      read('../../db/migrations/1759530200000_cmp-008-rules.sql') +
      read('../../db/migrations/1759530200001_cmp-008-outbox.sql');
    const declared = [...sql.matchAll(/^-- sf:isolation (\S+) /gm)].map((m) => m[1]).sort();
    expect(decls.map((d) => d.entity).sort()).toEqual(declared);
  });

  it('validates the RuleEvaluated envelope', () => {
    const env = envelopeOf({
      eventType: 'RuleEvaluated',
      tenantId: '11111111-1111-4111-8111-111111111111',
      cellId: 'cell-01',
      aggregateType: 'RuleEvaluation',
      aggregateId: '22222222-2222-4222-8222-222222222222',
      aggregateVersion: 1,
      occurredAt: '2026-10-04T00:00:00.000Z',
      correlationId: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
      actor: { type: 'OFFICER', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      data: {
        evaluation_id: '22222222-2222-4222-8222-222222222222',
        pack_key: 'generic.criteria-check',
        version_id: '44444444-4444-4444-8444-444444444444',
        content_hash: `sha256:${'ab'.repeat(32)}`,
        outcome: 'MEETS_CRITERIA',
        result_code: 'RULE_OUTPUT_PRODUCED',
        reason_codes: ['ALPHA_THRESHOLD_MET'],
        matched_rule_count: 1,
        input_hash: `sha256:${'cd'.repeat(32)}`,
      },
    });
    expect(validate('event-envelope', env).valid).toBe(true);
  });

  it('outbox migration Up matches the frozen SF-CON-OUTBOX template after substitution', () => {
    const rendered = readFileSync(
      join(root, '../../contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_rules')
      .replaceAll('{cmp}', 'CMP-008')
      .trim();
    const file = read('../../db/migrations/1759530200001_cmp-008-outbox.sql');
    const up = file.split('-- Up Migration')[1]?.split('-- Down Migration')[0] ?? '';
    const at = up.indexOf(rendered);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(up.slice(at, at + rendered.length)).toBe(rendered);
    expect(rendered).not.toMatch(/OWNER TO/i);
    expect(up.slice(at + rendered.length)).toMatch(
      /ALTER TABLE sf_rules\.outbox_event OWNER TO sf_migrator/,
    );
  });
});
