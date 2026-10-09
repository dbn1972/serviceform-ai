import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '../../src/contracts.js';
import { EVENT_TYPE } from '../../src/domain/states.js';
import { TOPIC_DOMAIN } from '../../src/outbox.js';
import { ctxFor, createBody, OFFICER_1, WORKFLOW_SYSTEM } from '../doubles/fixtures.js';
import { idem, makeService, type Ctx } from '../doubles/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const text = (p: string): string => readFileSync(p, 'utf8');
const json = <T>(p: string): T => JSON.parse(text(p)) as T;

function fileHash(rel: string): string {
  return createHash('sha256')
    .update(readFileSync(join(repoRoot, rel)))
    .digest('hex');
}

describe('29 frozen contracts MATCH (CG-02 candidate registry; read-only)', () => {
  it('lock file hashes equal on-disk artifacts', () => {
    const raw = text(join(repoRoot, 'orchestrator/contracts-lock.yaml'));
    const ids = [...raw.matchAll(/^\s+- id: (SF-CON-[A-Z0-9-]+)$/gm)].map((m) => m[1]);
    expect(ids).toHaveLength(29);
    const hashes = [...raw.matchAll(/^\s+schema_hash: ([0-9a-f]{64})$/gm)].map((m) => m[1]);
    expect(hashes).toHaveLength(29);
    const paths = [...raw.matchAll(/^\s+path: "?([^"\n]+)"?$/gm)]
      .map((m) => m[1])
      .filter((p): p is string => typeof p === 'string' && p.startsWith('contracts/'));
    expect(paths).toHaveLength(29);
    expect(ids).toHaveLength(hashes.length);
    expect(ids).toHaveLength(paths.length);
    for (let i = 0; i < ids.length; i++) {
      expect(fileHash(paths[i] as string), paths[i]).toBe(hashes[i]);
    }
    expect(raw).toContain('19_FROZEN_HASHES_MATCH');
    expect(raw).toContain('29_FROZEN_CANDIDATE_HASHES_MATCH');
  });
});

describe('component-local contracts', () => {
  it('OpenAPI documents every handler route; AsyncAPI lists every emitted event', () => {
    const openapi = json<{ paths: Record<string, Record<string, unknown>> }>(
      join(root, 'contracts/openapi.json'),
    );
    const expected: [string, string][] = [
      ['/v1/inspections', 'post'],
      ['/v1/inspections/available', 'get'],
      ['/v1/inspections/{inspection_id}', 'get'],
      ['/v1/inspections/{inspection_id}/detail', 'get'],
      ['/v1/inspections/{inspection_id}/history', 'get'],
      ['/v1/inspections/{inspection_id}/schedule', 'post'],
      ['/v1/inspections/{inspection_id}/reassign', 'post'],
      ['/v1/inspections/{inspection_id}/start', 'post'],
      ['/v1/inspections/{inspection_id}/checklist', 'post'],
      ['/v1/inspections/{inspection_id}/observations', 'post'],
      ['/v1/inspections/{inspection_id}/evidence', 'post'],
      ['/v1/inspections/{inspection_id}/findings', 'post'],
      ['/v1/inspections/{inspection_id}/result', 'post'],
      ['/v1/inspections/{inspection_id}/complete', 'post'],
      ['/v1/inspections/{inspection_id}/cancel', 'post'],
      ['/v1/inspections/{inspection_id}/reinspect', 'post'],
    ];
    for (const [path, method] of expected) expect(openapi.paths[path]?.[method]).toBeTruthy();
    const asyncapi = json<{ channels: Record<string, { messages: Record<string, unknown> }> }>(
      join(root, 'contracts/asyncapi.json'),
    );
    expect(Object.keys(asyncapi.channels[TOPIC_DOMAIN]?.messages ?? {}).sort()).toEqual(
      Object.values(EVENT_TYPE).sort(),
    );
  });

  it('isolation declarations validate and match the migration tables', () => {
    const iso = json<{ entities: Record<string, unknown>[] }>(
      join(root, 'contracts/isolation.json'),
    );
    for (const row of iso.entities) {
      expect(validate('isolation-declaration', row).valid, JSON.stringify(row)).toBe(true);
    }
    const sql = [
      '1759540180000_cmp-018-inspection-verification.sql',
      '1759540180001_cmp-018-outbox.sql',
    ]
      .map((f) => text(join(repoRoot, 'db/migrations', f)))
      .join('\n');
    const declared = [...sql.matchAll(/^-- sf:isolation (\S+) (\S+) owner=CMP-018$/gm)]
      .map((m) => `${m[1]}:${m[2]}`)
      .sort();
    expect(iso.entities.map((e) => `${e['entity']}:${e['isolation_class']}`).sort()).toEqual(
      declared,
    );
    for (const row of iso.entities) {
      if (row['isolation_class'] === 'TENANT_SCOPED') {
        expect(sql).toContain(`ALTER TABLE ${row['entity']} FORCE ROW LEVEL SECURITY`);
      }
    }
  });

  it('outbox migration is the frozen template with schema/component replacements only', () => {
    const template = text(join(repoRoot, 'contracts/shared/sql/outbox.template.sql'));
    const mine = text(join(repoRoot, 'db/migrations/1759540180001_cmp-018-outbox.sql'));
    const body = (s: string) =>
      s.slice(s.indexOf('-- sf:isolation')).split('-- Identity sequences')[0] ?? '';
    const norm = (s: string, schema: string, cmp: string) =>
      s.replaceAll(schema, '{schema}').replaceAll(cmp, '{cmp}');
    expect(body(norm(mine, 'sf_inspection', 'CMP-018')).replace(/\s+/g, ' ')).toContain(
      body(norm(template, '{schema}', '{cmp}'))
        .replace(/\s+/g, ' ')
        .slice(0, 1500),
    );
  });

  it('emitted domain events are valid envelopes and never statutory', async () => {
    const { service, repo } = makeService();
    const system = ctxFor(
      WORKFLOW_SYSTEM,
      {
        roles: ['WORKFLOW_ENGINE'],
        organisation_id: undefined,
        office_id: undefined,
        jurisdiction_ids: [],
      },
      'SYSTEM',
    ) as Ctx;
    const officer = ctxFor(OFFICER_1) as Ctx;
    const id = (await service.createInspection(system, createBody(), idem('POST /v1/inspections')))
      .body.inspection_id;
    await service.start(officer, id, idem('POST /st'));
    await service.recordResult(officer, id, { verification_result: 'VERIFIED' }, idem('POST /r'));
    await service.complete(officer, id, idem('POST /d'));
    for (const e of repo.outboxOf(TOPIC_DOMAIN)) {
      expect(validate('event-envelope', e).valid).toBe(true);
      expect(JSON.stringify(e.data)).not.toMatch(/APPROVED|REJECTED|ELIGIBLE/);
      expect((e.data as { statutory_effect: boolean }).statutory_effect).toBe(false);
    }
  });
});
