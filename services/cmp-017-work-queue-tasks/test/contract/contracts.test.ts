import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '../../src/contracts.js';
import { createAjv } from '../../../../packages/contracts/src/index.js';
import { EVENT_TYPE } from '../../src/domain/states.js';
import { TOPIC_DOMAIN } from '../../src/outbox.js';
import { ctxFor, createBody, OFFICER_1, WORKFLOW_SYSTEM } from '../doubles/fixtures.js';
import { idem, makeService, type Ctx } from '../doubles/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');
const read = (p: string): string => readFileSync(p, 'utf8');
const json = <T>(p: string): T => JSON.parse(read(p)) as T;

function humanTaskValidator() {
  const ajv = createAjv();
  ajv.addSchema(json<object>(join(repoRoot, 'contracts/m05/schemas/human-task.schema.json')));
  const fn = ajv.getSchema('https://contracts.serviceform.ai/m05/human-task/v1');
  if (!fn) throw new Error('human-task schema missing');
  return fn;
}

describe('SF-CON-HUMAN-TASK (FROZEN, read-only)', () => {
  const check = humanTaskValidator();

  it('is cataloged FROZEN and owned by CMP-017', () => {
    const catalog = json<{ contracts: { id: string; owner: string; status: string }[] }>(
      join(repoRoot, 'contracts/m05/catalog.json'),
    );
    expect(catalog.contracts.find((c) => c.id === 'SF-CON-HUMAN-TASK')).toMatchObject({
      owner: 'CMP-017',
      status: 'FROZEN',
    });
  });

  it('accepts the frozen valid example and refuses the named-officer example', () => {
    expect(check(json(join(repoRoot, 'contracts/m05/examples/valid/human-task.json')))).toBe(true);
    expect(
      check(
        json(join(repoRoot, 'contracts/m05/examples/invalid/human-task.named-officer-field.json')),
      ),
    ).toBe(false);
  });

  it('every event emitted by every operation is a valid SF-CON-HUMAN-TASK instance', async () => {
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
    const t = (await service.createTask(system, createBody(), idem('POST /v1/tasks'))).body.task_id;
    await service.claimTask(officer, t, idem('POST /c'));
    await service.unclaimTask(officer, t, idem('POST /u'));
    await service.reassignTask(
      officer,
      t,
      { assignment: { ...(createBody().assignment as object), role_code: 'APPROVING_AUTHORITY' } },
      idem('POST /r'),
    );
    await service.cancelCloseTask(system, t, { outcome: 'CASE_WITHDRAWN' }, idem('POST /x'));
    const t2 = (
      await service.createTask(
        system,
        createBody({ workflow_node_id: 'OTHER' }),
        idem('POST /v1/tasks'),
      )
    ).body.task_id;
    await service.claimTask(officer, t2, idem('POST /c'));
    await service.completeTask(officer, t2, { outcome: 'FORWARD_TO_APPROVAL' }, idem('POST /d'));

    const events = repo.outboxOf(TOPIC_DOMAIN);
    expect(new Set(events.map((e) => e.event_type))).toEqual(new Set(Object.values(EVENT_TYPE)));
    for (const e of events) {
      expect(validate('event-envelope', e).valid).toBe(true);
      expect(check(e.data), JSON.stringify(check.errors)).toBe(true);
      expect(JSON.stringify(e.data)).not.toMatch(/named_officer|assignee/);
    }
  });
});

describe('component-local contracts', () => {
  it('OpenAPI documents every handler route; AsyncAPI lists every emitted event', () => {
    const openapi = json<{ paths: Record<string, Record<string, unknown>> }>(
      join(root, 'contracts/openapi.json'),
    );
    const expected: [string, string][] = [
      ['/v1/tasks', 'post'],
      ['/v1/tasks/available', 'get'],
      ['/v1/tasks/{task_id}', 'get'],
      ['/v1/tasks/{task_id}/history', 'get'],
      ['/v1/tasks/{task_id}/claim', 'post'],
      ['/v1/tasks/{task_id}/unclaim', 'post'],
      ['/v1/tasks/{task_id}/reassign', 'post'],
      ['/v1/tasks/{task_id}/complete', 'post'],
      ['/v1/tasks/{task_id}/cancel', 'post'],
    ];
    for (const [path, method] of expected) expect(openapi.paths[path]?.[method]).toBeTruthy();
    const asyncapi = json<{ channels: Record<string, { messages: Record<string, unknown> }> }>(
      join(root, 'contracts/asyncapi.json'),
    );
    expect(Object.keys(asyncapi.channels[TOPIC_DOMAIN]?.messages ?? {}).sort()).toEqual(
      Object.values(EVENT_TYPE).sort(),
    );
    expect(json<{ name: string }>(join(root, 'contracts/topics.json')).name).toBe(TOPIC_DOMAIN);
  });

  it('isolation declarations validate and match the migration tables exactly (Constitution #24)', () => {
    const iso = json<{ entities: Record<string, unknown>[] }>(
      join(root, 'contracts/isolation.json'),
    );
    for (const row of iso.entities)
      expect(validate('isolation-declaration', row).valid, JSON.stringify(row)).toBe(true);
    const sql = ['1759540170000_cmp-017-work-queue-tasks.sql', '1759540170001_cmp-017-outbox.sql']
      .map((f) => read(join(repoRoot, 'db/migrations', f)))
      .join('\n');
    const declared = [...sql.matchAll(/^-- sf:isolation (\S+) (\S+) owner=CMP-017$/gm)]
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

  it('outbox migration is the frozen SF-CON-OUTBOX template with schema/component replacements only', () => {
    const template = read(join(repoRoot, 'contracts/shared/sql/outbox.template.sql'));
    const mine = read(join(repoRoot, 'db/migrations/1759540170001_cmp-017-outbox.sql'));
    const norm = (s: string, schema: string, cmp: string) =>
      s.replaceAll(schema, '{schema}').replaceAll(cmp, '{cmp}').replaceAll('CMP-0NN', '{cmp}');
    const body = (s: string) =>
      s.slice(s.indexOf('-- sf:isolation')).split('-- Identity sequences')[0] ?? '';
    expect(body(norm(mine, 'sf_tasks', 'CMP-017')).replace(/\s+/g, ' ')).toContain(
      body(norm(template, '{schema}', '{cmp}'))
        .replace(/\s+/g, ' ')
        .slice(0, 2000),
    );
  });
});
