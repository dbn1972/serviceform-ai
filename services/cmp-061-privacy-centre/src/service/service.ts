import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import { authorize, authzInput, type AuthorizationPort } from '../authz.js';
import { collectionResourceId } from '../domain/ids.js';
import {
  allOwnerOutcomesReceived,
  canTransition,
  countTasks,
  REQUEST_RESOURCE_TYPE,
  TASK_RESOURCE_TYPE,
  toContract,
  type FulfilmentTaskRecord,
  type LifecycleStatus,
  type PrivacyRequestRecord,
  type ScopeItem,
} from '../domain/request.js';
import { Cmp061Error, detail, type ErrorCode } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN, type DomainEventType } from '../outbox.js';
import type { DecisionLogRow, PrivacyRepository, PrivacyTx } from '../repo/types.js';
import type { TenantContext } from '../types.js';
import type { DenyRequestInput, SubmitRequestInput, TaskOutcomeInput } from './input.js';

export interface PrivacyServiceDeps {
  repo: PrivacyRepository;
  authorizer: AuthorizationPort;
  clock: () => Date;
}

export interface Idempotency {
  key: string;
  fingerprint: string;
  endpoint: string;
}

export interface CommandResult {
  status: number;
  body: unknown;
}

type ActorType = TenantContext['actor']['type'];
const CITIZEN_ACTORS: readonly ActorType[] = ['CITIZEN'];
const OWNER_ACTORS: readonly ActorType[] = ['SYSTEM', 'INTEGRATION', 'OFFICER', 'PRIVILEGED_ADMIN'];
const STAFF_OR_SYSTEM: readonly ActorType[] = [
  'OFFICER',
  'PRIVILEGED_ADMIN',
  'SYSTEM',
  'INTEGRATION',
];

export const ACTIONS = {
  meRead: 'PRIVACY_ME_READ',
  requestSubmit: 'PRIVACY_REQUEST_SUBMIT',
  requestRead: 'PRIVACY_REQUEST_READ',
  requestWithdraw: 'PRIVACY_REQUEST_WITHDRAW',
  requestDeny: 'PRIVACY_REQUEST_DENY',
  tasksRequest: 'PRIVACY_TASKS_REQUEST',
  taskOutcome: 'PRIVACY_TASK_OUTCOME',
  requestComplete: 'PRIVACY_REQUEST_COMPLETE',
} as const;

class AuditedRefusal extends Cmp061Error {
  constructor(
    code: ErrorCode,
    readonly reason: string,
    readonly action: string,
    readonly resourceType: string,
    readonly resourceId: string,
  ) {
    super(code, detail(reason));
  }
}

export function requestView(
  row: PrivacyRequestRecord,
  scope: readonly ScopeItem[],
  tasks: readonly FulfilmentTaskRecord[],
): Record<string, unknown> {
  return {
    request: toContract(row),
    scope,
    tasks: tasks.map((t) => ({
      task_id: t.task_id,
      scope_seq: t.scope_seq,
      owner_component: t.owner_component,
      task_status: t.task_status,
      evidence_ref: t.evidence_ref,
      legal_basis_or_exception_ref: t.legal_basis_or_exception_ref,
      exception_authority_ref: t.exception_authority_ref,
      task_version: t.task_version,
    })),
    task_counts: countTasks(tasks),
    cross_component_direct_mutation_forbidden: true,
    owner_task_orchestration_only: true,
    invented_statutory_policy_forbidden: true,
  };
}

export class PrivacyCentreService {
  constructor(private readonly deps: PrivacyServiceDeps) {}

  private assertNotInTx(): void {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp061Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
  }

  private assertActor(ctx: TenantContext, allowed: readonly ActorType[]): void {
    if (!allowed.includes(ctx.actor.type)) {
      throw new Cmp061Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
    }
  }

  private async guard(
    ctx: TenantContext,
    action: string,
    resourceType: string,
    resourceId: string,
    actors: readonly ActorType[],
  ): Promise<void> {
    this.assertNotInTx();
    this.assertActor(ctx, actors);
    try {
      await authorize(this.deps.authorizer, authzInput(ctx, action, resourceType));
    } catch (err) {
      if (err instanceof Cmp061Error && err.code === 'SF-AUTH-002') {
        await this.auditOutcome(ctx, action, resourceType, resourceId, 'DENIED');
      }
      throw err;
    }
  }

  private async auditOutcome(
    ctx: TenantContext,
    action: string,
    resourceType: string,
    resourceId: string,
    result: 'DENIED' | 'FAILED',
    reason?: string,
  ): Promise<void> {
    const now = this.deps.clock();
    await this.deps.repo.withTx(ctx, (tx) =>
      appendAudit(tx, ctx, {
        action,
        actionClass: action.endsWith('_READ') ? 'READ' : 'WRITE',
        resourceType,
        resourceId,
        result,
        ...(reason === undefined ? {} : { reason }),
        now,
      }),
    );
  }

  private async command(
    ctx: TenantContext,
    idem: Idempotency,
    run: (tx: PrivacyTx, now: Date) => Promise<CommandResult>,
  ): Promise<CommandResult> {
    const now = this.deps.clock();
    try {
      return await this.deps.repo.withTx(ctx, async (tx) => {
        const claim = await tx.claimIdempotency({
          principalId: ctx.actor.id,
          endpoint: idem.endpoint,
          key: idem.key,
          fingerprint: idem.fingerprint,
          now,
        });
        if (claim !== 'claimed') return claim;
        const result = await run(tx, now);
        await tx.completeIdempotency({
          principalId: ctx.actor.id,
          endpoint: idem.endpoint,
          key: idem.key,
          status: result.status,
          body: result.body,
        });
        return result;
      });
    } catch (err) {
      if (err instanceof AuditedRefusal) {
        await this.auditOutcome(
          ctx,
          err.action,
          err.resourceType,
          err.resourceId,
          'FAILED',
          err.reason,
        );
      }
      throw err;
    }
  }

  private async emit(
    tx: PrivacyTx,
    ctx: TenantContext,
    p: {
      eventType: DomainEventType;
      aggregateType: string;
      aggregateId: string;
      aggregateVersion: number;
      now: Date;
      data: object;
    },
  ): Promise<void> {
    const env = envelopeOf({
      eventType: p.eventType,
      tenantId: ctx.tenant_id,
      cellId: ctx.cell_id,
      aggregateType: p.aggregateType,
      aggregateId: p.aggregateId,
      aggregateVersion: p.aggregateVersion,
      occurredAt: p.now.toISOString(),
      correlationId: ctx.correlation_id,
      actor: ctx.actor,
      data: {
        ...p.data,
        cross_component_direct_mutation_forbidden: true,
        owner_task_orchestration_only: true,
        invented_statutory_policy_forbidden: true,
      },
    });
    await tx.insertOutbox(env, TOPIC_DOMAIN);
  }

  private async decide(
    tx: PrivacyTx,
    ctx: TenantContext,
    row: PrivacyRequestRecord,
    from: LifecycleStatus | null,
    to: LifecycleStatus,
    now: Date,
    legalBasis: string | null,
  ): Promise<void> {
    const decision: DecisionLogRow = {
      tenant_id: ctx.tenant_id,
      decision_id: randomUUID(),
      request_id: row.request_id,
      from_status: from,
      to_status: to,
      legal_basis_or_exception_ref: legalBasis,
      request_version: row.request_version,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      correlation_id: ctx.correlation_id,
      decided_at: now.toISOString(),
    };
    await tx.insertDecision(decision);
  }

  private async loadView(
    tx: PrivacyTx,
    requestId: string,
  ): Promise<{
    row: PrivacyRequestRecord;
    scope: ScopeItem[];
    tasks: FulfilmentTaskRecord[];
  }> {
    const row = await tx.getRequest(requestId);
    if (!row) throw new Cmp061Error('SF-SYS-002', detail('REQUEST_NOT_FOUND'));
    const scope = await tx.listScope(requestId);
    const tasks = await tx.listTasks(requestId);
    return { row, scope, tasks };
  }

  /** Citizen privacy centre landing: own requests only; no foreign-component data. */
  async getMe(ctx: TenantContext): Promise<CommandResult> {
    const collectionId = collectionResourceId(ctx.tenant_id, 'me');
    await this.guard(ctx, ACTIONS.meRead, 'PrivacyCentre', collectionId, [
      ...CITIZEN_ACTORS,
      ...STAFF_OR_SYSTEM,
    ]);
    return this.deps.repo.withTx(ctx, async (tx) => {
      const subjectId =
        ctx.actor.type === 'CITIZEN' ? ctx.actor.id : await this.requireSubjectFilter(ctx);
      const rows = await tx.listRequestsForSubject(subjectId);
      await appendAudit(tx, ctx, {
        action: ACTIONS.meRead,
        actionClass: 'READ',
        resourceType: 'PrivacyCentre',
        resourceId: collectionId,
        result: 'SUCCESS',
        now: this.deps.clock(),
      });
      return {
        status: 200,
        body: {
          subject_actor_id: subjectId,
          requests: rows.map((r) => toContract(r)),
          consents: [],
          consent_source: 'OWNER_PORT_REQUIRED',
          note: 'Consent history is owned by CMP-030; CMP-061 orchestrates rights requests only.',
          cross_component_direct_mutation_forbidden: true,
          owner_task_orchestration_only: true,
          invented_statutory_policy_forbidden: true,
        },
      };
    });
  }

  private async requireSubjectFilter(ctx: TenantContext): Promise<string> {
    // Staff may only list their own actor id unless a dedicated subject query is added later.
    return ctx.actor.id;
  }

  async getConsents(ctx: TenantContext): Promise<CommandResult> {
    return this.getMe(ctx).then((r) => ({
      status: 200,
      body: {
        subject_actor_id: (r.body as { subject_actor_id: string }).subject_actor_id,
        consents: [],
        consent_source: 'OWNER_PORT_REQUIRED',
        note: 'CMP-061 does not query CMP-030 tables; host binds a consent summary port.',
        cross_component_direct_mutation_forbidden: true,
        owner_task_orchestration_only: true,
      },
    }));
  }

  async submitRequest(
    ctx: TenantContext,
    input: SubmitRequestInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const collectionId = collectionResourceId(ctx.tenant_id, 'requests');
    await this.guard(ctx, ACTIONS.requestSubmit, REQUEST_RESOURCE_TYPE, collectionId, [
      ...CITIZEN_ACTORS,
      ...STAFF_OR_SYSTEM,
    ]);
    if (ctx.actor.type === 'CITIZEN' && ctx.auth_assurance === 'NONE') {
      throw new Cmp061Error('SF-AUTH-002', detail('SUBMIT_ASSURANCE_REQUIRED'));
    }

    return this.command(ctx, idem, async (tx, now) => {
      const requestId = randomUUID();
      const iso = now.toISOString();
      const row: PrivacyRequestRecord = {
        tenant_id: ctx.tenant_id,
        request_id: requestId,
        subject_actor_id: ctx.actor.id,
        request_type: input.request_type,
        lifecycle_status: 'SUBMITTED',
        legal_basis_or_exception_ref: null,
        submit_assurance: input.submit_assurance,
        idempotency_key: idem.key,
        request_version: 1,
        scope_count: input.scope.length,
        correlation_id: ctx.correlation_id,
        created_at: iso,
        updated_at: iso,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.insertRequest(row);
      await tx.insertScope(ctx.tenant_id, requestId, input.scope, iso);
      await this.decide(tx, ctx, row, null, 'SUBMITTED', now, null);
      await this.emit(tx, ctx, {
        eventType: 'PrivacyRequestSubmitted',
        aggregateType: 'PrivacyRequest',
        aggregateId: requestId,
        aggregateVersion: 1,
        now,
        data: {
          request_id: requestId,
          request_type: row.request_type,
          lifecycle_status: row.lifecycle_status,
          scope_count: row.scope_count,
          subject_actor_id: row.subject_actor_id,
        },
      });
      if (row.request_type === 'CONSENT_WITHDRAWAL') {
        await this.emit(tx, ctx, {
          eventType: 'ConsentWithdrawalRequested',
          aggregateType: 'PrivacyRequest',
          aggregateId: requestId,
          aggregateVersion: 1,
          now,
          data: {
            request_id: requestId,
            subject_actor_id: row.subject_actor_id,
            scope: input.scope,
          },
        });
      }
      await appendAudit(tx, ctx, {
        action: ACTIONS.requestSubmit,
        actionClass: 'WRITE',
        resourceType: REQUEST_RESOURCE_TYPE,
        resourceId: requestId,
        result: 'SUCCESS',
        now,
      });
      const view = await this.loadView(tx, requestId);
      return { status: 201, body: requestView(view.row, view.scope, view.tasks) };
    });
  }

  async getRequest(ctx: TenantContext, requestId: string): Promise<CommandResult> {
    await this.guard(ctx, ACTIONS.requestRead, REQUEST_RESOURCE_TYPE, requestId, [
      ...CITIZEN_ACTORS,
      ...STAFF_OR_SYSTEM,
    ]);
    return this.deps.repo.withTx(ctx, async (tx) => {
      const view = await this.loadView(tx, requestId);
      if (ctx.actor.type === 'CITIZEN' && view.row.subject_actor_id !== ctx.actor.id) {
        throw new Cmp061Error('SF-AUTH-002', detail('NOT_SUBJECT'));
      }
      await appendAudit(tx, ctx, {
        action: ACTIONS.requestRead,
        actionClass: 'READ',
        resourceType: REQUEST_RESOURCE_TYPE,
        resourceId: requestId,
        result: 'SUCCESS',
        now: this.deps.clock(),
      });
      return { status: 200, body: requestView(view.row, view.scope, view.tasks) };
    });
  }

  /** Advance SUBMITTED -> TASKS_REQUESTED and emit one PrivacyTaskRequested per scope item. */
  async requestOwnerTasks(
    ctx: TenantContext,
    requestId: string,
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(ctx, ACTIONS.tasksRequest, REQUEST_RESOURCE_TYPE, requestId, STAFF_OR_SYSTEM);
    return this.command(ctx, idem, async (tx, now) => {
      const current = await tx.getRequest(requestId, true);
      if (!current) throw new Cmp061Error('SF-SYS-002', detail('REQUEST_NOT_FOUND'));
      if (!canTransition(current.lifecycle_status, 'TASKS_REQUESTED')) {
        throw new AuditedRefusal(
          'SF-APP-001',
          'INVALID_TRANSITION',
          ACTIONS.tasksRequest,
          REQUEST_RESOURCE_TYPE,
          requestId,
        );
      }
      const scope = await tx.listScope(requestId);
      const iso = now.toISOString();
      const next: PrivacyRequestRecord = {
        ...current,
        lifecycle_status: 'TASKS_REQUESTED',
        request_version: current.request_version + 1,
        updated_at: iso,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.updateRequest(next);
      await this.decide(tx, ctx, next, current.lifecycle_status, 'TASKS_REQUESTED', now, null);

      for (const item of scope) {
        const task: FulfilmentTaskRecord = {
          tenant_id: ctx.tenant_id,
          task_id: randomUUID(),
          request_id: requestId,
          scope_seq: item.scope_seq,
          owner_component: item.owner_component,
          task_status: 'REQUESTED',
          evidence_ref: null,
          legal_basis_or_exception_ref: null,
          exception_authority_ref: null,
          task_version: 1,
          created_at: iso,
          updated_at: iso,
          last_correlation_id: ctx.correlation_id,
        };
        await tx.insertTask(task);
        await this.emit(tx, ctx, {
          eventType: 'PrivacyTaskRequested',
          aggregateType: 'PrivacyFulfilmentTask',
          aggregateId: task.task_id,
          aggregateVersion: 1,
          now,
          data: {
            request_id: requestId,
            task_id: task.task_id,
            scope_seq: item.scope_seq,
            owner_component: item.owner_component,
            scope_ref: item.scope_ref,
            request_type: current.request_type,
          },
        });
      }

      await appendAudit(tx, ctx, {
        action: ACTIONS.tasksRequest,
        actionClass: 'WRITE',
        resourceType: REQUEST_RESOURCE_TYPE,
        resourceId: requestId,
        result: 'SUCCESS',
        now,
      });
      const view = await this.loadView(tx, requestId);
      return { status: 200, body: requestView(view.row, view.scope, view.tasks) };
    });
  }

  async recordTaskOutcome(
    ctx: TenantContext,
    taskId: string,
    input: TaskOutcomeInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(ctx, ACTIONS.taskOutcome, TASK_RESOURCE_TYPE, taskId, OWNER_ACTORS);
    return this.command(ctx, idem, async (tx, now) => {
      const task = await tx.getTask(taskId, true);
      if (!task) throw new Cmp061Error('SF-SYS-002', detail('TASK_NOT_FOUND'));
      if (task.task_status !== 'REQUESTED') {
        throw new AuditedRefusal(
          'SF-APP-001',
          'TASK_ALREADY_RESOLVED',
          ACTIONS.taskOutcome,
          TASK_RESOURCE_TYPE,
          taskId,
        );
      }
      const iso = now.toISOString();
      const next: FulfilmentTaskRecord = {
        ...task,
        task_status: input.outcome,
        evidence_ref: input.evidence_ref ?? null,
        legal_basis_or_exception_ref: input.legal_basis_or_exception_ref ?? null,
        exception_authority_ref: input.exception_authority_ref ?? null,
        task_version: task.task_version + 1,
        updated_at: iso,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.updateTask(next);
      await this.emit(tx, ctx, {
        eventType: 'PrivacyTaskOutcomeRecorded',
        aggregateType: 'PrivacyFulfilmentTask',
        aggregateId: taskId,
        aggregateVersion: next.task_version,
        now,
        data: {
          request_id: task.request_id,
          task_id: taskId,
          owner_component: task.owner_component,
          task_status: next.task_status,
          evidence_ref: next.evidence_ref,
          legal_basis_or_exception_ref: next.legal_basis_or_exception_ref,
        },
      });
      await appendAudit(tx, ctx, {
        action: ACTIONS.taskOutcome,
        actionClass: 'WRITE',
        resourceType: TASK_RESOURCE_TYPE,
        resourceId: taskId,
        result: 'SUCCESS',
        now,
      });
      const view = await this.loadView(tx, task.request_id);
      return { status: 200, body: requestView(view.row, view.scope, view.tasks) };
    });
  }

  async completeRequest(
    ctx: TenantContext,
    requestId: string,
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(
      ctx,
      ACTIONS.requestComplete,
      REQUEST_RESOURCE_TYPE,
      requestId,
      STAFF_OR_SYSTEM,
    );
    return this.command(ctx, idem, async (tx, now) => {
      const current = await tx.getRequest(requestId, true);
      if (!current) throw new Cmp061Error('SF-SYS-002', detail('REQUEST_NOT_FOUND'));
      const tasks = await tx.listTasks(requestId);
      if (!allOwnerOutcomesReceived(tasks)) {
        throw new AuditedRefusal(
          'SF-APP-001',
          'SF_TASKS_OPEN',
          ACTIONS.requestComplete,
          REQUEST_RESOURCE_TYPE,
          requestId,
        );
      }
      if (!canTransition(current.lifecycle_status, 'COMPLETED')) {
        throw new AuditedRefusal(
          'SF-APP-001',
          'INVALID_TRANSITION',
          ACTIONS.requestComplete,
          REQUEST_RESOURCE_TYPE,
          requestId,
        );
      }
      const next: PrivacyRequestRecord = {
        ...current,
        lifecycle_status: 'COMPLETED',
        request_version: current.request_version + 1,
        updated_at: now.toISOString(),
        last_correlation_id: ctx.correlation_id,
      };
      await tx.updateRequest(next);
      await this.decide(tx, ctx, next, current.lifecycle_status, 'COMPLETED', now, null);
      await this.emit(tx, ctx, {
        eventType: 'PrivacyRequestCompleted',
        aggregateType: 'PrivacyRequest',
        aggregateId: requestId,
        aggregateVersion: next.request_version,
        now,
        data: {
          request_id: requestId,
          lifecycle_status: 'COMPLETED',
          task_counts: countTasks(tasks),
        },
      });
      await appendAudit(tx, ctx, {
        action: ACTIONS.requestComplete,
        actionClass: 'WRITE',
        resourceType: REQUEST_RESOURCE_TYPE,
        resourceId: requestId,
        result: 'SUCCESS',
        now,
      });
      const view = await this.loadView(tx, requestId);
      return { status: 200, body: requestView(view.row, view.scope, view.tasks) };
    });
  }

  async withdrawRequest(
    ctx: TenantContext,
    requestId: string,
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(ctx, ACTIONS.requestWithdraw, REQUEST_RESOURCE_TYPE, requestId, [
      ...CITIZEN_ACTORS,
      ...STAFF_OR_SYSTEM,
    ]);
    return this.command(ctx, idem, async (tx, now) => {
      const current = await tx.getRequest(requestId, true);
      if (!current) throw new Cmp061Error('SF-SYS-002', detail('REQUEST_NOT_FOUND'));
      if (ctx.actor.type === 'CITIZEN' && current.subject_actor_id !== ctx.actor.id) {
        throw new Cmp061Error('SF-AUTH-002', detail('NOT_SUBJECT'));
      }
      if (!canTransition(current.lifecycle_status, 'WITHDRAWN')) {
        throw new AuditedRefusal(
          'SF-APP-001',
          'INVALID_TRANSITION',
          ACTIONS.requestWithdraw,
          REQUEST_RESOURCE_TYPE,
          requestId,
        );
      }
      const tasks = await tx.listTasks(requestId);
      const iso = now.toISOString();
      for (const task of tasks) {
        if (task.task_status !== 'REQUESTED') continue;
        const cancelled: FulfilmentTaskRecord = {
          ...task,
          task_status: 'CANCELLED',
          task_version: task.task_version + 1,
          updated_at: iso,
          last_correlation_id: ctx.correlation_id,
        };
        await tx.updateTask(cancelled);
        await this.emit(tx, ctx, {
          eventType: 'PrivacyTaskCancelled',
          aggregateType: 'PrivacyFulfilmentTask',
          aggregateId: task.task_id,
          aggregateVersion: cancelled.task_version,
          now,
          data: { request_id: requestId, task_id: task.task_id, reason: 'REQUEST_WITHDRAWN' },
        });
      }
      const next: PrivacyRequestRecord = {
        ...current,
        lifecycle_status: 'WITHDRAWN',
        request_version: current.request_version + 1,
        updated_at: iso,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.updateRequest(next);
      await this.decide(tx, ctx, next, current.lifecycle_status, 'WITHDRAWN', now, null);
      await this.emit(tx, ctx, {
        eventType: 'PrivacyRequestWithdrawn',
        aggregateType: 'PrivacyRequest',
        aggregateId: requestId,
        aggregateVersion: next.request_version,
        now,
        data: { request_id: requestId, lifecycle_status: 'WITHDRAWN' },
      });
      await appendAudit(tx, ctx, {
        action: ACTIONS.requestWithdraw,
        actionClass: 'WRITE',
        resourceType: REQUEST_RESOURCE_TYPE,
        resourceId: requestId,
        result: 'SUCCESS',
        now,
      });
      const view = await this.loadView(tx, requestId);
      return { status: 200, body: requestView(view.row, view.scope, view.tasks) };
    });
  }

  async denyRequest(
    ctx: TenantContext,
    requestId: string,
    input: DenyRequestInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(ctx, ACTIONS.requestDeny, REQUEST_RESOURCE_TYPE, requestId, STAFF_OR_SYSTEM);
    return this.command(ctx, idem, async (tx, now) => {
      const current = await tx.getRequest(requestId, true);
      if (!current) throw new Cmp061Error('SF-SYS-002', detail('REQUEST_NOT_FOUND'));
      if (!canTransition(current.lifecycle_status, 'DENIED_WITH_BASIS_REF')) {
        throw new AuditedRefusal(
          'SF-APP-001',
          'INVALID_TRANSITION',
          ACTIONS.requestDeny,
          REQUEST_RESOURCE_TYPE,
          requestId,
        );
      }
      const tasks = await tx.listTasks(requestId);
      const iso = now.toISOString();
      for (const task of tasks) {
        if (task.task_status !== 'REQUESTED') continue;
        const cancelled: FulfilmentTaskRecord = {
          ...task,
          task_status: 'CANCELLED',
          task_version: task.task_version + 1,
          updated_at: iso,
          last_correlation_id: ctx.correlation_id,
        };
        await tx.updateTask(cancelled);
        await this.emit(tx, ctx, {
          eventType: 'PrivacyTaskCancelled',
          aggregateType: 'PrivacyFulfilmentTask',
          aggregateId: task.task_id,
          aggregateVersion: cancelled.task_version,
          now,
          data: { request_id: requestId, task_id: task.task_id, reason: 'REQUEST_DENIED' },
        });
      }
      const next: PrivacyRequestRecord = {
        ...current,
        lifecycle_status: 'DENIED_WITH_BASIS_REF',
        legal_basis_or_exception_ref: input.legal_basis_or_exception_ref,
        request_version: current.request_version + 1,
        updated_at: iso,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.updateRequest(next);
      await this.decide(
        tx,
        ctx,
        next,
        current.lifecycle_status,
        'DENIED_WITH_BASIS_REF',
        now,
        input.legal_basis_or_exception_ref,
      );
      await this.emit(tx, ctx, {
        eventType: 'PrivacyRequestDenied',
        aggregateType: 'PrivacyRequest',
        aggregateId: requestId,
        aggregateVersion: next.request_version,
        now,
        data: {
          request_id: requestId,
          lifecycle_status: 'DENIED_WITH_BASIS_REF',
          legal_basis_or_exception_ref: input.legal_basis_or_exception_ref,
        },
      });
      await appendAudit(tx, ctx, {
        action: ACTIONS.requestDeny,
        actionClass: 'DECISION',
        resourceType: REQUEST_RESOURCE_TYPE,
        resourceId: requestId,
        result: 'SUCCESS',
        now,
      });
      const view = await this.loadView(tx, requestId);
      return { status: 200, body: requestView(view.row, view.scope, view.tasks) };
    });
  }
}
