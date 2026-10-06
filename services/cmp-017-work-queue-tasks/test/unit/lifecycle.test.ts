import { describe, expect, it } from 'vitest';
import type { TaskView } from '../../src/service/views.js';
import { TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/outbox.js';
import {
  ctxFor,
  createBody,
  OFFICER_1,
  OFFICER_2,
  ORG_2,
  SCRUTINY_ASSIGNMENT,
  SUPERVISOR,
  WORKFLOW_SYSTEM,
  JUR_1,
  OFFICE_2,
  SCOPE_1,
} from '../doubles/fixtures.js';
import { idem, makeService, type Ctx } from '../doubles/harness.js';

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
const officer1 = ctxFor(OFFICER_1) as Ctx;
const officer2 = ctxFor(OFFICER_2) as Ctx;
const supervisor = ctxFor(SUPERVISOR, { roles: ['SUPERVISOR'] }) as Ctx;

async function created() {
  const h = makeService();
  const res = await h.service.createTask(
    system,
    createBody(),
    idem('POST /v1/tasks', createBody()),
  );
  return { ...h, task: res.body };
}

describe('create', () => {
  it('creates an OPEN, unclaimed task with criteria only and emits event + audit via outbox', async () => {
    const { task, repo } = await created();
    expect(task.task_state).toBe('OPEN');
    expect(task.assignment).toEqual({ ...SCRUTINY_ASSIGNMENT });
    expect(task.assignment.claimed_principal_id).toBeUndefined();
    const events = repo.outboxOf(TOPIC_DOMAIN);
    expect(events.map((e) => e.event_type)).toEqual(['HumanTaskCreated']);
    expect(repo.outboxOf(TOPIC_AUDIT)).toHaveLength(1);
    expect(repo.state.history).toHaveLength(1);
  });

  it('refuses a second active task for the same application node', async () => {
    const { service } = await created();
    await expect(
      service.createTask(system, createBody(), idem('POST /v1/tasks', createBody())),
    ).rejects.toMatchObject({ code: 'SF-APP-002' });
  });

  it('rejects client-supplied tenant and extra fields', async () => {
    const { service } = makeService();
    await expect(
      service.createTask(
        system,
        createBody({ tenant_id: '00000000-0000-4000-8000-000000000009' }),
        idem('POST /v1/tasks'),
      ),
    ).rejects.toMatchObject({ code: 'SF-TEN-002' });
    await expect(
      service.createTask(system, createBody({ extra: 1 }), idem('POST /v1/tasks')),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
    await expect(
      service.createTask(
        system,
        createBody({ workflow_node_id: 'bad node' }),
        idem('POST /v1/tasks'),
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
  });
});

describe('claim / unclaim / complete', () => {
  it('walks OPEN -> CLAIMED -> OPEN -> CLAIMED -> COMPLETED with history and runtime claim record', async () => {
    const { service, task, repo } = await created();
    const id = task.task_id;
    const claimed = await service.claimTask(officer1, id, idem('POST /v1/tasks/{task_id}/claim'));
    expect(claimed.body.task_state).toBe('CLAIMED');
    expect(claimed.body.assignment.claimed_principal_id).toBe(OFFICER_1);

    const released = await service.unclaimTask(
      officer1,
      id,
      idem('POST /v1/tasks/{task_id}/unclaim'),
    );
    expect(released.body.task_state).toBe('OPEN');
    expect(released.body.assignment.claimed_principal_id).toBeUndefined();

    await service.claimTask(officer2, id, idem('POST /v1/tasks/{task_id}/claim'));
    const done = await service.completeTask(
      officer2,
      id,
      { outcome: 'FORWARD_TO_APPROVAL' },
      idem('POST /v1/tasks/{task_id}/complete'),
    );
    expect(done.body.task_state).toBe('COMPLETED');
    expect(done.body.outcome).toBe('FORWARD_TO_APPROVAL');

    const history = await service.getHistory(officer1, id);
    expect(history.items.map((h) => h.operation)).toEqual([
      'CREATE',
      'CLAIM',
      'UNCLAIM',
      'CLAIM',
      'COMPLETE',
    ]);
    expect(history.items.every((h) => h.policy_revision === 'rev-1')).toBe(true);
    expect(repo.outboxOf(TOPIC_DOMAIN).map((e) => e.event_type)).toEqual([
      'HumanTaskCreated',
      'HumanTaskClaimed',
      'HumanTaskUnclaimed',
      'HumanTaskClaimed',
      'HumanTaskCompleted',
    ]);
  });

  it('is idempotent: replaying a key returns the stored response without a second transition', async () => {
    const { service, task, repo } = await created();
    const i = idem('POST /v1/tasks/{task_id}/claim', null, 'claim-key-0001');
    const first = await service.claimTask(officer1, task.task_id, i);
    const replay = await service.claimTask(officer1, task.task_id, i);
    expect(replay).toEqual(first);
    expect(repo.state.history.filter((h) => h.operation === 'CLAIM')).toHaveLength(1);
    const reused = idem('POST /v1/tasks/{task_id}/claim', { other: 1 }, 'claim-key-0001');
    await expect(service.claimTask(officer1, task.task_id, reused)).rejects.toMatchObject({
      code: 'SF-APP-002',
    });
  });

  it('lets a supervisor release another officer claim only through TASK_FORCE_UNCLAIM', async () => {
    const { service, task, authz } = await created();
    await service.claimTask(officer1, task.task_id, idem('POST /v1/tasks/{task_id}/claim'));
    authz.calls.length = 0;
    await service.unclaimTask(supervisor, task.task_id, idem('POST /v1/tasks/{task_id}/unclaim'));
    expect(authz.calls.map((c) => c.action)).toEqual(['TASK_FORCE_UNCLAIM']);
    expect(authz.calls[0]?.resource.owner_id).toBe(OFFICER_1);
  });

  it('sends role, organisation, jurisdiction and task state to OPA and records ADR-0005 policy_revision', async () => {
    const { service, task, authz, repo } = await created();
    authz.policyRevision = 'rev-77';
    authz.calls.length = 0;
    await service.claimTask(officer1, task.task_id, idem('POST /v1/tasks/{task_id}/claim'));
    const call = authz.calls[0];
    expect(call?.action).toBe('TASK_CLAIM');
    expect(call?.resource).toMatchObject({
      resource_type: 'HumanTask',
      tenant_id: officer1.tenant_id,
      organisation_id: SCRUTINY_ASSIGNMENT.organisation_id,
      jurisdiction_id: JUR_1,
    });
    expect(call?.workflow_context).toMatchObject({
      required_role: 'SCRUTINY_OFFICER',
      task_state: 'OPEN',
      workflow_node_id: 'SCRUTINY',
    });
    const last = repo.state.history.at(-1);
    expect(last?.policy_revision).toBe('rev-77');
    const audit = repo.outboxOf(TOPIC_AUDIT).at(-1)?.data as { reason: string; result: string };
    expect(audit.result).toBe('SUCCESS');
    expect(audit.reason).toContain('policy_revision=rev-77');
  });
});

describe('reassign and cancel/close', () => {
  it('reassigns by criteria, clears the runtime claim and returns the task to OPEN', async () => {
    const { service, task, authz } = await created();
    await service.claimTask(officer1, task.task_id, idem('POST /v1/tasks/{task_id}/claim'));
    authz.calls.length = 0;
    const target = {
      role_code: 'SCRUTINY_OFFICER',
      organisation_id: ORG_2,
      office_id: OFFICE_2,
      jurisdiction_id: JUR_1,
      service_scope_id: SCOPE_1,
    };
    const res = await service.reassignTask(
      supervisor,
      task.task_id,
      { assignment: target },
      idem('POST /v1/tasks/{task_id}/reassign'),
    );
    expect(res.body.task_state).toBe('OPEN');
    expect(res.body.assignment).toEqual(target);
    expect(authz.calls).toHaveLength(2);
    expect(authz.calls[1]?.resource.organisation_id).toBe(ORG_2);
    const hist = await service.getHistory(supervisor, task.task_id);
    expect(hist.items.at(-1)?.operation).toBe('REASSIGN');
  });

  it('rejects reassignment to identical criteria and to a named officer', async () => {
    const { service, task } = await created();
    await expect(
      service.reassignTask(
        supervisor,
        task.task_id,
        { assignment: { ...SCRUTINY_ASSIGNMENT } },
        idem('POST /v1/tasks/{task_id}/reassign'),
      ),
    ).rejects.toMatchObject({ code: 'SF-APP-001' });
    await expect(
      service.reassignTask(
        supervisor,
        task.task_id,
        { assignment: { ...SCRUTINY_ASSIGNMENT, assignee: 'a person' } },
        idem('POST /v1/tasks/{task_id}/reassign'),
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
    await expect(
      service.reassignTask(
        supervisor,
        task.task_id,
        { assignee_id: OFFICER_2 },
        idem('POST /v1/tasks/{task_id}/reassign'),
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
  });

  it('cancels/closes OPEN and CLAIMED tasks with an outcome code', async () => {
    const { service, task } = await created();
    const closed = await service.cancelCloseTask(
      system,
      task.task_id,
      { outcome: 'CASE_WITHDRAWN' },
      idem('POST /v1/tasks/{task_id}/cancel'),
    );
    expect(closed.body.task_state).toBe('CANCELLED_CLOSED');
    await expect(
      service.cancelCloseTask(system, task.task_id, {}, idem('POST /v1/tasks/{task_id}/cancel')),
    ).rejects.toMatchObject({ code: 'SF-SYS-003' });
  });
});

describe('availability', () => {
  it('lists only OPEN tasks the caller currently covers', async () => {
    const { service, task } = await created();
    await service.createTask(
      system,
      createBody({
        application_id: '00000000-0000-4000-8000-000000000052',
        workflow_node_id: 'APPROVAL',
        assignment: { ...SCRUTINY_ASSIGNMENT, role_code: 'APPROVING_AUTHORITY' },
      }),
      idem('POST /v1/tasks'),
    );
    const mine = await service.listAvailable(officer1);
    expect(mine.items.map((t: TaskView) => t.task_id)).toEqual([task.task_id]);
    const elsewhere = await service.listAvailable(
      ctxFor(OFFICER_2, { organisation_id: ORG_2 }) as Ctx,
    );
    expect(elsewhere.items).toEqual([]);
    await service.claimTask(officer1, task.task_id, idem('POST /v1/tasks/{task_id}/claim'));
    expect((await service.listAvailable(officer1)).items).toEqual([]);
    await expect(service.listAvailable(officer1, 0)).rejects.toMatchObject({ code: 'SF-SYS-003' });
    await expect(service.listAvailable(officer1, 201)).rejects.toMatchObject({
      code: 'SF-SYS-003',
    });
  });
});
