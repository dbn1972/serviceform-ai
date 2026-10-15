import { describe, expect, it } from 'vitest';
import { PrivacyCentreService } from '../../src/service/service.js';
import {
  allowAllAuthorizer,
  citizenCtx,
  denyAllAuthorizer,
  idem,
  officerCtx,
  SAMPLE_SCOPE,
  systemCtx,
  TENANT_B,
} from '../doubles/fixtures.js';
import { MemoryPrivacyRepository } from '../doubles/memory-repo.js';

function svc(repo = new MemoryPrivacyRepository(), authorizer = allowAllAuthorizer()) {
  return {
    repo,
    service: new PrivacyCentreService({
      repo,
      authorizer,
      clock: () => new Date('2026-10-15T12:00:00.000Z'),
    }),
  };
}

const scope = SAMPLE_SCOPE.map((s, i) => ({ ...s, scope_seq: i + 1 }));

describe('PrivacyCentreService orchestration', () => {
  it('submits a request with FROZEN markers and emits PrivacyRequestSubmitted', async () => {
    const { repo, service } = svc();
    const result = await service.submitRequest(
      citizenCtx(),
      { request_type: 'ACCESS', submit_assurance: 'OTP', scope },
      idem(),
    );
    expect(result.status).toBe(201);
    const body = result.body as {
      request: {
        cross_component_direct_mutation_forbidden: boolean;
        owner_task_orchestration_only: boolean;
        lifecycle_status: string;
      };
    };
    expect(body.request.lifecycle_status).toBe('SUBMITTED');
    expect(body.request.cross_component_direct_mutation_forbidden).toBe(true);
    expect(body.request.owner_task_orchestration_only).toBe(true);
    const store = repo.tenant(citizenCtx().tenant_id);
    expect(store.outbox.some((e) => e.envelope.event_type === 'PrivacyRequestSubmitted')).toBe(
      true,
    );
  });

  it('orchestrates owner tasks without mutating foreign tables (events only)', async () => {
    const { repo, service } = svc();
    const submitted = await service.submitRequest(
      citizenCtx(),
      { request_type: 'ERASURE', submit_assurance: 'MFA', scope },
      idem('idem-submit-1'),
    );
    const requestId = (submitted.body as { request: { request_id: string } }).request.request_id;

    const tasked = await service.requestOwnerTasks(officerCtx(), requestId, idem('idem-tasks-1'));
    expect(
      (tasked.body as { request: { lifecycle_status: string } }).request.lifecycle_status,
    ).toBe('TASKS_REQUESTED');
    const store = repo.tenant(citizenCtx().tenant_id);
    const taskEvents = store.outbox.filter((e) => e.envelope.event_type === 'PrivacyTaskRequested');
    expect(taskEvents).toHaveLength(2);
    expect(
      taskEvents.every(
        (e) =>
          (e.envelope.data as { owner_component: string }).owner_component !== 'CMP-061' &&
          (e.envelope.data as { cross_component_direct_mutation_forbidden: boolean })
            .cross_component_direct_mutation_forbidden === true,
      ),
    ).toBe(true);

    const tasks = (tasked.body as { tasks: { task_id: string }[] }).tasks;
    for (const [i, t] of tasks.entries()) {
      await service.recordTaskOutcome(
        systemCtx(),
        t.task_id,
        { outcome: 'COMPLETED', evidence_ref: `owner.evidence.${i + 1}` },
        idem(`idem-outcome-${i}`),
      );
    }

    const completed = await service.completeRequest(
      officerCtx(),
      requestId,
      idem('idem-complete-1'),
    );
    expect(
      (completed.body as { request: { lifecycle_status: string } }).request.lifecycle_status,
    ).toBe('COMPLETED');
    expect(store.outbox.some((e) => e.envelope.event_type === 'PrivacyRequestCompleted')).toBe(
      true,
    );
  });

  it('emits ConsentWithdrawalRequested for CONSENT_WITHDRAWAL submissions', async () => {
    const { repo, service } = svc();
    await service.submitRequest(
      citizenCtx(),
      {
        request_type: 'CONSENT_WITHDRAWAL',
        submit_assurance: 'OTP',
        scope: [{ scope_seq: 1, owner_component: 'CMP-030', scope_ref: 'consent.purpose.x' }],
      },
      idem('idem-consent-1'),
    );
    const store = repo.tenant(citizenCtx().tenant_id);
    expect(store.outbox.some((e) => e.envelope.event_type === 'ConsentWithdrawalRequested')).toBe(
      true,
    );
  });

  it('refuses completion while owner tasks remain open', async () => {
    const { service } = svc();
    const submitted = await service.submitRequest(
      citizenCtx(),
      {
        request_type: 'ACCESS',
        submit_assurance: 'OTP',
        scope: [{ scope_seq: 1, owner_component: 'CMP-030', scope_ref: 'consent.x' }],
      },
      idem('idem-open-1'),
    );
    const requestId = (submitted.body as { request: { request_id: string } }).request.request_id;
    await service.requestOwnerTasks(officerCtx(), requestId, idem('idem-open-tasks'));
    await expect(
      service.completeRequest(officerCtx(), requestId, idem('idem-open-complete')),
    ).rejects.toMatchObject({ code: 'SF-APP-001' });
  });

  it('OPA deny fails closed (SF-AUTH-002)', async () => {
    const { service } = svc(new MemoryPrivacyRepository(), denyAllAuthorizer());
    await expect(
      service.submitRequest(
        citizenCtx(),
        {
          request_type: 'ACCESS',
          submit_assurance: 'OTP',
          scope: [{ scope_seq: 1, owner_component: 'CMP-030', scope_ref: 'x' }],
        },
        idem('idem-deny-1'),
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
  });

  it('tenant stores are partitioned (INT-011)', async () => {
    const { repo, service } = svc();
    await service.submitRequest(
      citizenCtx(),
      {
        request_type: 'ACCESS',
        submit_assurance: 'OTP',
        scope: [{ scope_seq: 1, owner_component: 'CMP-030', scope_ref: 'a' }],
      },
      idem('idem-t1'),
    );
    expect(repo.tenant(TENANT_B).requests.size).toBe(0);
    expect(repo.tenant(citizenCtx().tenant_id).requests.size).toBe(1);
  });

  it('withdraw cancels open owner tasks then terminates', async () => {
    const { service } = svc();
    const submitted = await service.submitRequest(
      citizenCtx(),
      {
        request_type: 'PORTABILITY',
        submit_assurance: 'OTP',
        scope: [{ scope_seq: 1, owner_component: 'CMP-032', scope_ref: 'docs' }],
      },
      idem('idem-wd-1'),
    );
    const requestId = (submitted.body as { request: { request_id: string } }).request.request_id;
    await service.requestOwnerTasks(officerCtx(), requestId, idem('idem-wd-tasks'));
    const withdrawn = await service.withdrawRequest(citizenCtx(), requestId, idem('idem-wd-2'));
    expect(
      (
        withdrawn.body as {
          request: { lifecycle_status: string };
          tasks: { task_status: string }[];
        }
      ).request.lifecycle_status,
    ).toBe('WITHDRAWN');
    expect(
      (withdrawn.body as { tasks: { task_status: string }[] }).tasks.every(
        (t) => t.task_status === 'CANCELLED',
      ),
    ).toBe(true);
  });

  it('deny requires opaque legal_basis_or_exception_ref (POLICY_INPUT_REQUIRED)', async () => {
    const { service } = svc();
    const submitted = await service.submitRequest(
      citizenCtx(),
      {
        request_type: 'RESTRICT',
        submit_assurance: 'OTP',
        scope: [{ scope_seq: 1, owner_component: 'CMP-030', scope_ref: 'r' }],
      },
      idem('idem-deny-req'),
    );
    const requestId = (submitted.body as { request: { request_id: string } }).request.request_id;
    const denied = await service.denyRequest(
      officerCtx(),
      requestId,
      { legal_basis_or_exception_ref: 'owner.exception.policy-ref-1' },
      idem('idem-deny-2'),
    );
    expect(
      (denied.body as { request: { lifecycle_status: string } }).request.lifecycle_status,
    ).toBe('DENIED_WITH_BASIS_REF');
  });
});
