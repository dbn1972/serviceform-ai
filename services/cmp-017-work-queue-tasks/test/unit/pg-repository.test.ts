import { describe, expect, it } from 'vitest';
import { PgTaskRepository, toHistory, toTask } from '../../src/repo/pg.js';
import { guardClient, type SqlClient, type SqlPool } from '../../src/sql.js';
import { ctxFor, OFFICER_1, TENANT_A, uuid } from '../doubles/fixtures.js';
import { requestFingerprint } from '../../src/domain/fingerprint.js';
import { scopeFromContext } from '../../src/domain/resolution.js';
import type { RepoContext } from '../../src/repo/types.js';

class FakeClient implements SqlClient {
  statements: { text: string; values: readonly unknown[] | undefined }[] = [];
  released = 0;
  results: Record<string, unknown>[][] = [];
  rowCounts: number[] = [];
  failOn: RegExp | null = null;

  async query<R>(text: string, values?: readonly unknown[]) {
    this.statements.push({ text, values });
    if (/^(BEGIN|COMMIT|ROLLBACK|SELECT set_config)/.test(text))
      return { rows: [] as R[], rowCount: 0 };
    if (/^INSERT INTO sf_tasks\.idempotency_record/.test(text)) {
      return { rows: [] as R[], rowCount: this.rowCounts.shift() ?? 0 };
    }
    if (this.failOn?.test(text)) throw Object.assign(new Error('boom'), { code: 'P0001' });
    return { rows: (this.results.shift() ?? []) as R[], rowCount: this.rowCounts.shift() ?? 0 };
  }
  release() {
    this.released += 1;
  }
}

const taskRow = {
  tenant_id: TENANT_A,
  task_id: uuid(7),
  application_id: uuid(8),
  workflow_node_id: 'SCRUTINY',
  cell_id: 'cell-01',
  task_state: 'CLAIMED',
  role_code: 'SCRUTINY_OFFICER',
  organisation_id: uuid(11),
  office_id: null,
  jurisdiction_id: uuid(31),
  service_scope_id: null,
  claimed_principal_id: OFFICER_1,
  claimed_at: new Date('2026-10-05T12:00:00Z'),
  outcome: null,
  created_by: uuid(104),
  correlation_id: uuid(9),
  aggregate_version: '2',
  created_at: new Date('2026-10-05T11:00:00Z'),
  updated_at: '2026-10-05T12:00:00.000Z',
};

function setup() {
  const client = new FakeClient();
  const pool: SqlPool = { connect: async () => client };
  return { client, repo: new PgTaskRepository(pool), ctx: ctxFor(OFFICER_1) as RepoContext };
}

describe('PgTaskRepository', () => {
  it('runs each unit in one transaction with transaction-local, server-derived session settings', async () => {
    const { client, repo, ctx } = setup();
    client.results = [[taskRow]];
    const task = await repo.read(ctx, (tx) => tx.getTask(uuid(7)));
    expect(task?.aggregate_version).toBe(2);
    expect(task?.assignment.office_id).toBeNull();
    const texts = client.statements.map((s) => s.text);
    expect(texts[0]).toBe('BEGIN');
    expect(texts.filter((t) => t.startsWith('SELECT set_config'))).toHaveLength(5);
    expect(
      client.statements
        .filter((s) => s.text.startsWith('SELECT set_config'))
        .every((s) => (s.values?.length ?? 0) === 2),
    ).toBe(true);
    expect(client.statements.find((s) => s.values?.[0] === 'app.tenant_id')?.values?.[1]).toBe(
      ctx.tenant_id,
    );
    expect(texts.at(-1)).toBe('COMMIT');
    expect(client.released).toBe(1);
  });

  it('rolls back, releases and maps failures without driver text', async () => {
    const { client, repo, ctx } = setup();
    client.failOn = /FROM sf_tasks\.human_task/;
    await expect(repo.read(ctx, (tx) => tx.getTask(uuid(7)))).rejects.toMatchObject({
      code: 'SF-APP-001',
    });
    expect(client.statements.at(-1)?.text).toBe('ROLLBACK');
    expect(client.released).toBe(1);
  });

  it('refuses SQL that names another component schema before it reaches the driver', async () => {
    const client = new FakeClient();
    const guarded = guardClient(client);
    await expect(guarded.query('SELECT * FROM sf_workflow.instance')).rejects.toBeTruthy();
    await expect(guarded.query('UPDATE sf_cases.application SET x = 1')).rejects.toBeTruthy();
    await guarded.query('SELECT 1 FROM sf_tasks.human_task');
    guarded.release();
    expect(client.statements.map((s) => s.text)).toEqual(['SELECT 1 FROM sf_tasks.human_task']);
    expect(client.released).toBe(1);
  });

  it('executes every write statement against sf_tasks only, with tenant bound as $1', async () => {
    const { client, repo, ctx } = setup();
    client.rowCounts = [1, 1];
    client.results = [
      [taskRow],
      [taskRow],
      [
        {
          ...taskRow,
          seq: 1,
          history_id: uuid(1),
          task_id: uuid(7),
          operation: 'CLAIM',
          from_state: 'OPEN',
          to_state: 'CLAIMED',
          actor_type: 'OFFICER',
          actor_id: OFFICER_1,
          authz_decision_id: uuid(2),
          policy_revision: 'r',
          target_authz_decision_id: null,
          idempotency_key: 'k-00000001',
          occurred_at: new Date(),
        },
      ],
    ];
    const now = new Date('2026-10-05T12:00:00Z');
    const assignment = {
      role_code: 'SCRUTINY_OFFICER',
      organisation_id: uuid(11),
      office_id: null,
      jurisdiction_id: uuid(31),
      service_scope_id: null,
    };
    await repo.write(ctx, async (tx) => {
      expect(
        await tx.claimIdempotency({
          principalId: OFFICER_1,
          endpoint: 'POST /v1/tasks/{task_id}/claim',
          key: 'k-00000001',
          fingerprint: requestFingerprint('POST', '/x', null),
          now,
        }),
      ).toBe('claimed');
      await tx.insertTask({
        task_id: uuid(7),
        application_id: uuid(8),
        workflow_node_id: 'SCRUTINY',
        cell_id: 'cell-01',
        assignment,
        created_by: uuid(104),
        correlation_id: uuid(9),
        now,
      });
      await tx.updateTask(uuid(7), {
        task_state: 'CLAIMED',
        assignment,
        claimed_principal_id: OFFICER_1,
        claimed_at: now,
        outcome: null,
        expected_version: 1,
        now,
      });
      const h = await tx.insertHistory({
        history_id: uuid(1),
        task_id: uuid(7),
        operation: 'CLAIM',
        from_state: 'OPEN',
        to_state: 'CLAIMED',
        actor_type: 'OFFICER',
        actor_id: OFFICER_1,
        assignment,
        claimed_principal_id: OFFICER_1,
        outcome: null,
        authz_decision_id: uuid(2),
        policy_revision: 'r',
        target_authz_decision_id: null,
        idempotency_key: 'k-00000001',
        correlation_id: uuid(9),
        now,
      });
      expect(h.seq).toBe(1);
      await tx.completeIdempotency({
        principalId: OFFICER_1,
        endpoint: 'e',
        key: 'k-00000001',
        status: 200,
        body: { ok: true },
      });
      await tx.lockTask(uuid(7));
    });
    const data = client.statements.filter((s) => /sf_tasks\./.test(s.text));
    expect(data.length).toBeGreaterThanOrEqual(6);
    for (const s of data.filter(
      (x) =>
        !/INSERT INTO sf_tasks\.human_task|INSERT INTO sf_tasks\.idempotency_record/.test(x.text),
    )) {
      expect(s.text).toMatch(/tenant_id = \$1/);
      expect(s.values?.[0]).toBe(TENANT_A);
    }
    expect(client.statements.some((s) => /FOR UPDATE/.test(s.text))).toBe(true);
  });

  it('replays a stored idempotent response and rejects fingerprint mismatch', async () => {
    const { client, repo, ctx } = setup();
    const fp = requestFingerprint('POST', '/a', { a: 1 });
    client.rowCounts = [0];
    client.results = [
      [
        {
          request_fingerprint: fp,
          status: 'COMPLETED',
          response_status: 200,
          response_body: { x: 1 },
        },
      ],
    ];
    const out = await repo.write(ctx, (tx) =>
      tx.claimIdempotency({
        principalId: OFFICER_1,
        endpoint: 'e',
        key: 'k-00000001',
        fingerprint: fp,
        now: new Date(),
      }),
    );
    expect(out).toEqual({ status: 200, body: { x: 1 } });
    client.rowCounts = [0];
    client.results = [
      [{ request_fingerprint: fp, status: 'COMPLETED', response_status: 200, response_body: {} }],
    ];
    await expect(
      repo.write(ctx, (tx) =>
        tx.claimIdempotency({
          principalId: OFFICER_1,
          endpoint: 'e',
          key: 'k-00000001',
          fingerprint: 'sha256:' + '0'.repeat(64),
          now: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'SF-APP-002' });
    client.rowCounts = [0];
    client.results = [
      [
        {
          request_fingerprint: fp,
          status: 'IN_PROGRESS',
          response_status: null,
          response_body: null,
        },
      ],
    ];
    await expect(
      repo.write(ctx, (tx) =>
        tx.claimIdempotency({
          principalId: OFFICER_1,
          endpoint: 'e',
          key: 'k-00000001',
          fingerprint: fp,
          now: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'SF-APP-002' });
    client.rowCounts = [0];
    client.results = [[]];
    await expect(
      repo.write(ctx, (tx) =>
        tx.claimIdempotency({
          principalId: OFFICER_1,
          endpoint: 'e',
          key: 'k-00000001',
          fingerprint: fp,
          now: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-001' });
  });

  it('availability binds the principal scope arrays; a stale update raises a conflict; outbox keys by aggregate', async () => {
    const { client, repo, ctx } = setup();
    client.results = [[taskRow]];
    const scope = scopeFromContext(ctx);
    const rows = await repo.read(ctx, (tx) => tx.listAvailable(scope, 10));
    expect(rows).toHaveLength(1);
    const q = client.statements.find((s) => /task_state = 'OPEN'/.test(s.text));
    expect(q?.values?.slice(1, 6)).toEqual([
      scope.roles,
      scope.organisation_ids,
      scope.office_ids,
      scope.jurisdiction_ids,
      scope.service_scope_ids,
    ]);

    client.results = [[]];
    const assignment = {
      role_code: 'SCRUTINY_OFFICER',
      organisation_id: uuid(11),
      office_id: null,
      jurisdiction_id: uuid(31),
      service_scope_id: null,
    };
    await expect(
      repo.write(ctx, (tx) =>
        tx.updateTask(uuid(7), {
          task_state: 'CLAIMED',
          assignment,
          claimed_principal_id: OFFICER_1,
          claimed_at: null,
          outcome: null,
          expected_version: 9,
          now: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'SF-APP-001' });

    client.results = [];
    await repo.write(ctx, (tx) =>
      tx.insertOutbox(
        {
          event_id: uuid(5),
          event_type: 'HumanTaskClaimed',
          schema_version: 1,
          tenant_id: TENANT_A,
          cell_id: 'cell-01',
          aggregate_type: 'HumanTask',
          aggregate_id: uuid(7),
          aggregate_version: 2,
          occurred_at: new Date().toISOString(),
          correlation_id: uuid(9),
          actor: { type: 'OFFICER', id: OFFICER_1 },
          data: {},
        },
        'sf.tasks.events.v1',
      ),
    );
    const ob = client.statements.find((s) => /INSERT INTO sf_tasks\.outbox_event/.test(s.text));
    expect(ob?.values?.[3]).toBe(uuid(7));
  });

  it('row mappers normalise driver values', () => {
    expect(
      toTask({
        ...taskRow,
        claimed_at: null,
        outcome: 'X_Y',
        service_scope_id: uuid(41),
        office_id: uuid(21),
      }),
    ).toMatchObject({
      outcome: 'X_Y',
      assignment: { office_id: uuid(21), service_scope_id: uuid(41) },
      claimed_at: null,
    });
    expect(
      toHistory({
        history_id: uuid(1),
        task_id: uuid(7),
        seq: '3',
        operation: 'CREATE',
        from_state: null,
        to_state: 'OPEN',
        actor_type: 'SYSTEM',
        actor_id: uuid(104),
        role_code: 'R_X',
        organisation_id: uuid(11),
        office_id: null,
        jurisdiction_id: uuid(31),
        service_scope_id: null,
        claimed_principal_id: null,
        outcome: null,
        authz_decision_id: uuid(2),
        policy_revision: 'r',
        target_authz_decision_id: uuid(3),
        idempotency_key: 'k-00000001',
        correlation_id: uuid(9),
        occurred_at: '2026-10-05T12:00:00.000Z',
      }),
    ).toMatchObject({ seq: 3, from_state: null, target_authz_decision_id: uuid(3) });
  });
});
