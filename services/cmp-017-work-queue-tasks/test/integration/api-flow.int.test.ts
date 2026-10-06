import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTaskHandler, type HttpRequest, type HttpResponse } from '../../src/http/handler.js';
import { PgTaskRepository } from '../../src/repo/pg.js';
import { TaskService } from '../../src/service/task-service.js';
import type { SqlPool } from '../../src/sql.js';
import { contextOnlyScope } from '../../src/ports/principal-scope.js';
import { ScriptedAuthorizer } from '../doubles/authorizer.js';
import {
  APP_1,
  APP_2,
  ctxFor,
  createBody,
  OFFICER_1,
  OFFICER_2,
  ORG_2,
  SCRUTINY_ASSIGNMENT,
  SUPERVISOR,
  TENANT_A,
  TENANT_B,
  WORKFLOW_SYSTEM,
} from '../doubles/fixtures.js';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

let h: Harness;
let authz: ScriptedAuthorizer;
let call: (token: string, method: string, path: string, body?: unknown) => Promise<HttpResponse>;
let seq = 0;

const tokens = new Map<string, ReturnType<typeof ctxFor>>([
  [
    'sys-a',
    ctxFor(
      WORKFLOW_SYSTEM,
      {
        roles: ['WORKFLOW_ENGINE'],
        organisation_id: undefined,
        office_id: undefined,
        jurisdiction_ids: [],
      },
      'SYSTEM',
    ),
  ],
  ['off1-a', ctxFor(OFFICER_1)],
  ['off2-a', ctxFor(OFFICER_2)],
  ['sup-a', ctxFor(SUPERVISOR, { roles: ['SUPERVISOR'] })],
  ['off1-b', ctxFor(OFFICER_1, { tenant_id: TENANT_B })],
  [
    'sys-b',
    ctxFor(
      WORKFLOW_SYSTEM,
      {
        tenant_id: TENANT_B,
        roles: ['WORKFLOW_ENGINE'],
        organisation_id: undefined,
        office_id: undefined,
        jurisdiction_ids: [],
      },
      'SYSTEM',
    ),
  ],
]);

beforeAll(async () => {
  h = await setupHarness();
  authz = new ScriptedAuthorizer();
  const service = new TaskService({
    repo: new PgTaskRepository(h.rt as unknown as SqlPool),
    authz,
    scopes: contextOnlyScope,
  });
  const handler = createTaskHandler({
    service,
    resolveContext: async (req) => {
      const auth = req.headers['authorization'];
      return tokens.get(typeof auth === 'string' ? auth.replace('Bearer ', '') : '') ?? null;
    },
  });
  call = (token, method, path, body) => {
    seq += 1;
    const req: HttpRequest = {
      method,
      path,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `int-key-${String(seq).padStart(8, '0')}`,
      },
      body,
    };
    return handler(req);
  };
});
afterAll(async () => closeHarness(h));
beforeEach(() => {
  authz.denyActions.clear();
  authz.denyWhen = null;
  authz.throws = false;
  authz.policyRevision = 'rev-int-1';
});

const bodyOf = <T>(r: HttpResponse): T => r.body as T;
interface Task {
  task_id: string;
  task_state: string;
  assignment: Record<string, string>;
}

describe('CMP-017 over PostgreSQL with real RLS and a least-privilege login', () => {
  it('runs create -> claim -> unclaim -> claim -> complete with history, outbox, audit and policy_revision', async () => {
    const created = await call('sys-a', 'POST', '/v1/tasks', createBody({ application_id: APP_1 }));
    expect(created.status).toBe(201);
    const id = bodyOf<Task>(created).task_id;

    expect((await call('off1-a', 'POST', `/v1/tasks/${id}/claim`)).status).toBe(200);
    expect(bodyOf<Task>(await call('off1-a', 'POST', `/v1/tasks/${id}/unclaim`)).task_state).toBe(
      'OPEN',
    );
    expect((await call('off2-a', 'POST', `/v1/tasks/${id}/claim`)).status).toBe(200);
    authz.policyRevision = 'rev-int-2';
    const done = await call('off2-a', 'POST', `/v1/tasks/${id}/complete`, {
      outcome: 'FORWARD_TO_APPROVAL',
    });
    expect(bodyOf<Task>(done).task_state).toBe('COMPLETED');

    const hist = bodyOf<{ items: { operation: string; policy_revision: string }[] }>(
      await call('off1-a', 'GET', `/v1/tasks/${id}/history`),
    );
    expect(hist.items.map((x) => x.operation)).toEqual([
      'CREATE',
      'CLAIM',
      'UNCLAIM',
      'CLAIM',
      'COMPLETE',
    ]);
    expect(hist.items.at(-1)?.policy_revision).toBe('rev-int-2');

    const events = await h.admin.query(
      `SELECT event_type, aggregate_version FROM sf_tasks.outbox_event
        WHERE topic = 'sf.tasks.events.v1' AND aggregate_id = $1 ORDER BY seq`,
      [id],
    );
    expect(events.rows.map((r) => r['event_type'])).toEqual([
      'HumanTaskCreated',
      'HumanTaskClaimed',
      'HumanTaskUnclaimed',
      'HumanTaskClaimed',
      'HumanTaskCompleted',
    ]);
    const audits = await h.admin.query(
      `SELECT count(*)::int AS n FROM sf_tasks.outbox_event WHERE topic = 'sf.audit.ingest.v1' AND envelope -> 'data' ->> 'resource_id' = $1`,
      [id],
    );
    expect(audits.rows[0]?.['n']).toBe(5);
  });

  it('a completed task cannot be reclaimed, reassigned, completed again or cancelled; row stays COMPLETED', async () => {
    const id = bodyOf<Task>(
      await call('sys-a', 'POST', '/v1/tasks', createBody({ application_id: APP_2 })),
    ).task_id;
    await call('off1-a', 'POST', `/v1/tasks/${id}/claim`);
    await call('off1-a', 'POST', `/v1/tasks/${id}/complete`, { outcome: 'FORWARD_TO_APPROVAL' });
    for (const [token, path, body] of [
      ['off1-a', 'claim', undefined],
      ['off2-a', 'claim', undefined],
      ['off1-a', 'unclaim', undefined],
      ['sup-a', 'reassign', { assignment: { ...SCRUTINY_ASSIGNMENT, organisation_id: ORG_2 } }],
      ['off1-a', 'complete', { outcome: 'FORWARD_TO_APPROVAL' }],
      ['sys-a', 'cancel', { outcome: 'CASE_WITHDRAWN' }],
    ] as const) {
      const r = await call(token, 'POST', `/v1/tasks/${id}/${path}`, body);
      expect(r.status, `${path}: ${JSON.stringify(r.body)}`).toBe(409);
    }
    const row = await h.admin.query(
      'SELECT task_state, claimed_principal_id FROM sf_tasks.human_task WHERE task_id = $1',
      [id],
    );
    expect(row.rows[0]).toMatchObject({ task_state: 'COMPLETED', claimed_principal_id: OFFICER_1 });
  });

  it('exactly one of two concurrent claimants wins; the other gets a conflict', async () => {
    const id = bodyOf<Task>(
      await call(
        'sys-a',
        'POST',
        '/v1/tasks',
        createBody({ application_id: '00000000-0000-4000-8000-000000000061' }),
      ),
    ).task_id;
    const [r1, r2] = await Promise.all([
      call('off1-a', 'POST', `/v1/tasks/${id}/claim`),
      call('off2-a', 'POST', `/v1/tasks/${id}/claim`),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const hist = await h.admin.query(
      `SELECT count(*)::int AS n FROM sf_tasks.task_history WHERE task_id = $1 AND operation = 'CLAIM'`,
      [id],
    );
    expect(hist.rows[0]?.['n']).toBe(1);
  });

  it('idempotent replay returns the stored response; a different body with the same key conflicts', async () => {
    const req = (body: unknown): HttpRequest => ({
      method: 'POST',
      path: '/v1/tasks',
      headers: { authorization: 'Bearer sys-a', 'idempotency-key': 'replay-key-0001' },
      body,
    });
    const handler = createTaskHandler({
      service: new TaskService({
        repo: new PgTaskRepository(h.rt as unknown as SqlPool),
        authz,
        scopes: contextOnlyScope,
      }),
      resolveContext: async () => tokens.get('sys-a') ?? null,
    });
    const body = createBody({ application_id: '00000000-0000-4000-8000-000000000062' });
    const first = await handler(req(body));
    const replay = await handler(req(body));
    expect(first.status).toBe(201);
    expect(replay).toEqual(first);
    const conflict = await handler(
      req(createBody({ application_id: '00000000-0000-4000-8000-000000000063' })),
    );
    expect(conflict.status).toBe(409);
    const n = await h.admin.query(
      `SELECT count(*)::int AS n FROM sf_tasks.human_task WHERE application_id = $1`,
      ['00000000-0000-4000-8000-000000000062'],
    );
    expect(n.rows[0]?.['n']).toBe(1);
  });

  it('wrong tenant: tenant B principals cannot see, list, or act on tenant A tasks (CROSS_TENANT_LEAKAGE=0)', async () => {
    const id = bodyOf<Task>(
      await call(
        'sys-a',
        'POST',
        '/v1/tasks',
        createBody({ application_id: '00000000-0000-4000-8000-000000000064' }),
      ),
    ).task_id;
    const attempts: [string, string, unknown?][] = [
      ['GET', `/v1/tasks/${id}`],
      ['GET', `/v1/tasks/${id}/history`],
      ['POST', `/v1/tasks/${id}/claim`],
      ['POST', `/v1/tasks/${id}/unclaim`],
      ['POST', `/v1/tasks/${id}/complete`, { outcome: 'FORWARD_TO_APPROVAL' }],
      ['POST', `/v1/tasks/${id}/cancel`, { outcome: 'CASE_WITHDRAWN' }],
      [
        'POST',
        `/v1/tasks/${id}/reassign`,
        { assignment: { ...SCRUTINY_ASSIGNMENT, organisation_id: ORG_2 } },
      ],
    ];
    let leakage = 0;
    for (const [method, path, body] of attempts) {
      const r = await call('off1-b', method, path, body);
      if (r.status !== 404) leakage += 1;
      if (JSON.stringify(r.body).includes(TENANT_A) || JSON.stringify(r.body).includes(id))
        leakage += 1;
    }
    const listed = await call('off1-b', 'GET', '/v1/tasks/available');
    leakage += bodyOf<{ items: Task[] }>(listed).items.length;
    expect(leakage).toBe(0);

    const bTask = bodyOf<Task>(
      await call(
        'sys-b',
        'POST',
        '/v1/tasks',
        createBody({ application_id: '00000000-0000-4000-8000-000000000064' }),
      ),
    ).task_id;
    expect((await call('off1-b', 'POST', `/v1/tasks/${bTask}/claim`)).status).toBe(200);
    const rowA = await h.admin.query(
      `SELECT task_state FROM sf_tasks.human_task WHERE task_id = $1 AND tenant_id = $2`,
      [id, TENANT_A],
    );
    expect(rowA.rows[0]?.['task_state']).toBe('OPEN');
    const rowsB = await h.admin.query(
      `SELECT count(*)::int AS n FROM sf_tasks.task_history WHERE tenant_id = $1 AND task_id = $2`,
      [TENANT_B, id],
    );
    expect(rowsB.rows[0]?.['n']).toBe(0);
  });

  it('unauthorized claim and reassignment are denied and audited; the row is unchanged', async () => {
    const id = bodyOf<Task>(
      await call(
        'sys-a',
        'POST',
        '/v1/tasks',
        createBody({ application_id: '00000000-0000-4000-8000-000000000065' }),
      ),
    ).task_id;
    authz.denyActions.add('TASK_CLAIM');
    authz.denyActions.add('TASK_REASSIGN');
    expect((await call('off1-a', 'POST', `/v1/tasks/${id}/claim`)).status).toBe(403);
    expect(
      (
        await call('sup-a', 'POST', `/v1/tasks/${id}/reassign`, {
          assignment: { ...SCRUTINY_ASSIGNMENT, organisation_id: ORG_2 },
        })
      ).status,
    ).toBe(403);
    const row = await h.admin.query(
      'SELECT task_state, organisation_id FROM sf_tasks.human_task WHERE task_id = $1',
      [id],
    );
    expect(row.rows[0]).toMatchObject({
      task_state: 'OPEN',
      organisation_id: SCRUTINY_ASSIGNMENT.organisation_id,
    });
    const denied = await h.admin.query(
      `SELECT envelope -> 'data' ->> 'action' AS action, envelope -> 'data' ->> 'result' AS result, envelope -> 'data' ->> 'reason' AS reason
         FROM sf_tasks.outbox_event WHERE topic = 'sf.audit.ingest.v1' AND envelope -> 'data' ->> 'resource_id' = $1
          AND envelope -> 'data' ->> 'result' = 'DENIED' ORDER BY seq`,
      [id],
    );
    expect(denied.rows.map((r) => r['action'])).toEqual(['TASK_CLAIM', 'TASK_REASSIGN']);
    expect(String(denied.rows[0]?.['reason'])).toContain('policy_revision=rev-int-1');
  });

  it('a named officer in published assignment metadata is rejected and nothing is stored', async () => {
    const before = await h.admin.query('SELECT count(*)::int AS n FROM sf_tasks.human_task');
    const r = await call(
      'sys-a',
      'POST',
      '/v1/tasks',
      createBody({
        application_id: '00000000-0000-4000-8000-000000000066',
        assignment: { ...SCRUTINY_ASSIGNMENT, named_officer: 'Permanent Assignee' },
      }),
    );
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('NAMED_OFFICER_FORBIDDEN');
    const after = await h.admin.query('SELECT count(*)::int AS n FROM sf_tasks.human_task');
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('reassignment by criteria returns a claimed task to the queue of the new role/org/jurisdiction scope', async () => {
    const id = bodyOf<Task>(
      await call(
        'sys-a',
        'POST',
        '/v1/tasks',
        createBody({ application_id: '00000000-0000-4000-8000-000000000067' }),
      ),
    ).task_id;
    await call('off1-a', 'POST', `/v1/tasks/${id}/claim`);
    const target = { ...SCRUTINY_ASSIGNMENT, role_code: 'APPROVING_AUTHORITY' };
    const r = await call('sup-a', 'POST', `/v1/tasks/${id}/reassign`, { assignment: target });
    expect(r.status).toBe(200);
    expect(bodyOf<Task>(r).task_state).toBe('OPEN');
    expect(bodyOf<Task>(r).assignment['claimed_principal_id']).toBeUndefined();
    const avail1 = bodyOf<{ items: Task[] }>(
      await call('off1-a', 'GET', '/v1/tasks/available'),
    ).items.map((t) => t.task_id);
    expect(avail1).not.toContain(id);
    const approver = ctxFor(OFFICER_2, { roles: ['APPROVING_AUTHORITY'] });
    tokens.set('approver-a', approver);
    const avail2 = bodyOf<{ items: Task[] }>(
      await call('approver-a', 'GET', '/v1/tasks/available'),
    ).items.map((t) => t.task_id);
    expect(avail2).toContain(id);
  });
});
