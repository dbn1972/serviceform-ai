import { describe, expect, it } from 'vitest';
import { authzInput, decide } from '../../src/authz.js';
import { TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/outbox.js';
import {
  ctxFor,
  createBody,
  JUR_2,
  OFFICER_1,
  OFFICER_2,
  ORG_2,
  SCRUTINY_ASSIGNMENT,
  SUPERVISOR,
  TENANT_A,
  TENANT_B,
  WORKFLOW_SYSTEM,
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
const CLAIM = 'POST /v1/tasks/{task_id}/claim';

async function seeded() {
  const h = makeService();
  const res = await h.service.createTask(system, createBody(), idem('POST /v1/tasks'));
  return { ...h, id: res.body.task_id };
}

describe('wrong tenant is denied and leaks nothing (CROSS_TENANT_LEAKAGE=0)', () => {
  it('hides, refuses and never mutates tenant A tasks for tenant B principals', async () => {
    const { service, repo, id } = await seeded();
    const intruder = ctxFor(OFFICER_1, { tenant_id: TENANT_B }) as Ctx;
    let leakage = 0;
    const probe = async (fn: () => Promise<unknown>) => {
      try {
        const out = await fn();
        if (JSON.stringify(out).includes(id) || JSON.stringify(out).includes(TENANT_A))
          leakage += 1;
        leakage += 1;
      } catch (e) {
        expect((e as { code: string }).code).toBe('SF-SYS-002');
        expect(JSON.stringify(e)).not.toContain(TENANT_A);
      }
    };
    await probe(() => service.getTask(intruder, id));
    await probe(() => service.getHistory(intruder, id));
    await probe(() => service.claimTask(intruder, id, idem(CLAIM)));
    await probe(() => service.unclaimTask(intruder, id, idem(CLAIM)));
    await probe(() => service.completeTask(intruder, id, { outcome: 'DONE_X' }, idem(CLAIM)));
    await probe(() => service.cancelCloseTask(intruder, id, { outcome: 'DONE_X' }, idem(CLAIM)));
    await probe(() =>
      service.reassignTask(
        intruder,
        id,
        { assignment: { ...SCRUTINY_ASSIGNMENT, organisation_id: ORG_2 } },
        idem(CLAIM),
      ),
    );

    const listed = await service.listAvailable(intruder);
    expect(listed.items).toEqual([]);
    expect(leakage).toBe(0);
    expect(repo.state.tasks.get(`${TENANT_A}|${id}`)?.task_state).toBe('OPEN');
    expect(repo.state.history.filter((h) => h.tenant_id === TENANT_B)).toHaveLength(0);
  });

  it('a tenant-null or non-contract authorization request fails closed before the PDP', async () => {
    const { authz, service, id } = await seeded();
    authz.calls.length = 0;
    const nullTenant = { ...officer1, tenant_id: null } as unknown as Ctx;
    await expect(service.getTask(nullTenant, id)).rejects.toMatchObject({ code: 'SF-TEN-001' });
    await expect(service.listAvailable(nullTenant)).rejects.toMatchObject({ code: 'SF-TEN-001' });
    await expect(
      service.createTask(nullTenant, createBody(), idem('POST /v1/tasks')),
    ).rejects.toMatchObject({ code: 'SF-TEN-001' });
    expect(authz.calls).toHaveLength(0);
    const crossTenant = authzInput(officer1, 'TASK_READ');
    crossTenant.resource.tenant_id = TENANT_B;
    await expect(decide(authz, crossTenant)).rejects.toMatchObject({ code: 'SF-TEN-002' });
    expect(authz.calls).toHaveLength(0);
  });
});

describe('unauthorized claim is denied (OPA)', () => {
  it('denies, leaves the task OPEN, writes no history, and audits the denial with policy_revision', async () => {
    const { service, authz, repo, id } = await seeded();
    authz.denyActions.add('TASK_CLAIM');
    authz.policyRevision = 'rev-deny-9';
    await expect(service.claimTask(officer1, id, idem(CLAIM))).rejects.toMatchObject({
      code: 'SF-AUTH-002',
      statusCode: 403,
    });
    expect(repo.state.tasks.get(`${TENANT_A}|${id}`)?.task_state).toBe('OPEN');
    expect(repo.state.history.map((h) => h.operation)).toEqual(['CREATE']);
    const denial = repo.outboxOf(TOPIC_AUDIT).at(-1)?.data as { result: string; reason: string };
    expect(denial.result).toBe('DENIED');
    expect(denial.reason).toContain('policy_revision=rev-deny-9');
    expect(repo.outboxOf(TOPIC_DOMAIN).map((e) => e.event_type)).toEqual(['HumanTaskCreated']);
  });

  it('denies a principal outside the assignment even when OPA allows (assignment resolution)', async () => {
    const { service, repo, id } = await seeded();
    for (const stranger of [
      ctxFor(OFFICER_2, { roles: ['CLERK'] }),
      ctxFor(OFFICER_2, { organisation_id: ORG_2 }),
      ctxFor(OFFICER_2, { jurisdiction_ids: [JUR_2] }),
    ]) {
      await expect(service.claimTask(stranger as Ctx, id, idem(CLAIM))).rejects.toMatchObject({
        code: 'SF-AUTH-002',
        details: [{ code: 'ASSIGNMENT_MISMATCH' }],
      });
    }
    expect(repo.state.tasks.get(`${TENANT_A}|${id}`)?.task_state).toBe('OPEN');
  });

  it('an officer who lost the role mid-task is denied on the next action (ADR-0005)', async () => {
    const { service, authz, id } = await seeded();
    await service.claimTask(officer1, id, idem(CLAIM));
    authz.policyRevision = 'rev-2';
    authz.denyWhen = (input) => input.action === 'TASK_COMPLETE';
    await expect(
      service.completeTask(officer1, id, { outcome: 'FORWARD_TO_APPROVAL' }, idem(CLAIM)),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
  });

  it('only the claimant completes, even if OPA allows', async () => {
    const { service, id } = await seeded();
    await service.claimTask(officer1, id, idem(CLAIM));
    await expect(
      service.completeTask(officer2, id, { outcome: 'FORWARD_TO_APPROVAL' }, idem(CLAIM)),
    ).rejects.toMatchObject({ details: [{ code: 'NOT_CLAIMANT' }] });
  });

  it('a second officer cannot claim an already claimed task', async () => {
    const { service, id } = await seeded();
    await service.claimTask(officer1, id, idem(CLAIM));
    await expect(service.claimTask(officer2, id, idem(CLAIM))).rejects.toMatchObject({
      code: 'SF-APP-001',
    });
  });

  it('fails closed when the PDP is unavailable or returns a malformed decision', async () => {
    const { service, authz, id } = await seeded();
    authz.throws = true;
    await expect(service.claimTask(officer1, id, idem(CLAIM))).rejects.toMatchObject({
      code: 'SF-SYS-004',
    });
    authz.throws = false;
    authz.malformed = true;
    await expect(service.claimTask(officer1, id, idem(CLAIM))).rejects.toMatchObject({
      code: 'SF-AUTH-002',
    });
  });

  it('a denial stands even when the audit write fails', async () => {
    const { service, authz, repo, id } = await seeded();
    authz.denyActions.add('TASK_CLAIM');
    const original = repo.write.bind(repo);
    repo.write = (() => Promise.reject(new Error('audit down'))) as typeof repo.write;
    await expect(service.claimTask(officer1, id, idem(CLAIM))).rejects.toMatchObject({
      code: 'SF-AUTH-002',
    });
    repo.write = original;
  });
});

describe('unauthorized reassignment is denied', () => {
  const target = { ...SCRUTINY_ASSIGNMENT, organisation_id: ORG_2 };

  it('denies when OPA refuses the action', async () => {
    const { service, authz, repo, id } = await seeded();
    authz.denyActions.add('TASK_REASSIGN');
    await expect(
      service.reassignTask(officer1, id, { assignment: target }, idem(CLAIM)),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    expect(repo.state.tasks.get(`${TENANT_A}|${id}`)?.assignment.organisation_id).toBe(
      SCRUTINY_ASSIGNMENT.organisation_id,
    );
  });

  it('denies when OPA allows the source but refuses the target organisation', async () => {
    const { service, authz, repo, id } = await seeded();
    authz.denyWhen = (input) =>
      input.action === 'TASK_REASSIGN' && input.resource.organisation_id === ORG_2;
    await expect(
      service.reassignTask(supervisor, id, { assignment: target }, idem(CLAIM)),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    expect(repo.state.history.map((h) => h.operation)).toEqual(['CREATE']);
  });
});

describe('named officer in published assignment is rejected', () => {
  it.each([
    [
      'create',
      (s: ReturnType<typeof makeService>['service']) =>
        s.createTask(
          system,
          createBody({
            assignment: { ...SCRUTINY_ASSIGNMENT, named_officer: 'Permanent Assignee' },
          }),
          idem('POST /v1/tasks'),
        ),
    ],
    [
      'create top-level',
      (s: ReturnType<typeof makeService>['service']) =>
        s.createTask(system, createBody({ assignee_id: OFFICER_1 }), idem('POST /v1/tasks')),
    ],
  ])('on %s', async (_n, run) => {
    const { service } = makeService();
    await expect(run(service)).rejects.toMatchObject({
      details: [{ code: 'NAMED_OFFICER_FORBIDDEN' }],
    });
  });

  it('persists nothing and never calls the PDP for a rejected template', async () => {
    const { service, repo, authz } = makeService();
    await service
      .createTask(
        system,
        createBody({ assignment: { ...SCRUTINY_ASSIGNMENT, claimed_principal_id: OFFICER_1 } }),
        idem('POST /v1/tasks'),
      )
      .catch(() => undefined);
    expect(repo.state.tasks.size).toBe(0);
    expect(authz.calls).toHaveLength(0);
  });
});

describe('completed or closed tasks cannot be reclaimed', () => {
  async function terminal(kind: 'COMPLETED' | 'CANCELLED_CLOSED') {
    const h = await seeded();
    if (kind === 'COMPLETED') {
      await h.service.claimTask(officer1, h.id, idem(CLAIM));
      await h.service.completeTask(officer1, h.id, { outcome: 'FORWARD_TO_APPROVAL' }, idem(CLAIM));
    } else {
      await h.service.cancelCloseTask(system, h.id, { outcome: 'CASE_WITHDRAWN' }, idem(CLAIM));
    }
    return h;
  }

  it.each(['COMPLETED', 'CANCELLED_CLOSED'] as const)(
    '%s task refuses every further operation',
    async (kind) => {
      const { service, repo, id } = await terminal(kind);
      const before = structuredClone(repo.state.tasks.get(`${TENANT_A}|${id}`));
      const attempts = [
        () => service.claimTask(officer1, id, idem(CLAIM)),
        () => service.claimTask(officer2, id, idem(CLAIM)),
        () => service.unclaimTask(officer1, id, idem(CLAIM)),
        () => service.unclaimTask(supervisor, id, idem(CLAIM)),
        () =>
          service.reassignTask(
            supervisor,
            id,
            { assignment: { ...SCRUTINY_ASSIGNMENT, organisation_id: ORG_2 } },
            idem(CLAIM),
          ),
        () => service.completeTask(officer1, id, { outcome: 'FORWARD_TO_APPROVAL' }, idem(CLAIM)),
        () => service.cancelCloseTask(system, id, { outcome: 'CASE_WITHDRAWN' }, idem(CLAIM)),
      ];
      for (const attempt of attempts) {
        await expect(attempt()).rejects.toMatchObject({
          code: 'SF-APP-001',
          details: [{ code: 'TASK_TERMINAL' }],
        });
      }
      expect(repo.state.tasks.get(`${TENANT_A}|${id}`)).toEqual(before);
    },
  );

  it('a stale decision made before a concurrent claim cannot overwrite it', async () => {
    const { service, authz, id } = await seeded();
    let injected = false;
    authz.before = async () => {
      if (injected) return;
      injected = true;
      await service.claimTask(officer2, id, idem(CLAIM));
    };
    await expect(service.claimTask(officer1, id, idem(CLAIM))).rejects.toMatchObject({
      details: [{ code: 'STALE_TASK_VERSION' }],
    });
  });
});
