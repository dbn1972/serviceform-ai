import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import {
  authzInput,
  decide,
  type AuthorizationPort,
  type AuthzRecord,
  type TaskResource,
} from '../authz.js';
import type { TenantContext } from '../context.js';
import {
  parseAssignment,
  rejectNamedOfficer,
  sameAssignment,
  type Assignment,
} from '../domain/assignment.js';
import { mismatches, scopeFromContext, type PrincipalScope } from '../domain/resolution.js';
import {
  AUTHZ_ACTION,
  EVENT_TYPE,
  canApply,
  isTerminal,
  targetState,
  type Operation,
} from '../domain/states.js';
import {
  assertOnlyKeys,
  codeField,
  invalid,
  NODE_ID,
  requireRecord,
  uuidField,
} from '../domain/validate.js';
import { Cmp017Error, detail } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN } from '../outbox.js';
import type { PrincipalScopePort } from '../ports/principal-scope.js';
import type { TaskPatch, TaskRepository, TaskRow, TaskWriteTx } from '../repo/types.js';
import {
  historyView,
  humanTaskContract,
  taskView,
  type HistoryView,
  type TaskView,
} from './views.js';

export interface Idempotency {
  key: string;
  endpoint: string;
  fingerprint: string;
}

export interface ServiceResult<T = unknown> {
  status: number;
  body: T;
}

export interface TaskServiceDeps {
  repo: TaskRepository;
  authz: AuthorizationPort;
  scopes: PrincipalScopePort;
  clock?: () => Date;
  newId?: () => string;
}

export const MAX_PAGE = 200;
export const DEFAULT_PAGE = 50;

const FORCE_UNCLAIM = 'TASK_FORCE_UNCLAIM';

interface MutationPlan {
  operation: Exclude<Operation, 'CREATE'>;
  taskId: string;
  idem: Idempotency;
  outcome?: string;
  target?: Assignment;
}

export class TaskService {
  private readonly clock: () => Date;
  private readonly newId: () => string;

  constructor(private readonly deps: TaskServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.newId = deps.newId ?? randomUUID;
  }

  /** Parses and validates a create request; tenant and claim identity are never accepted here. */
  static parseCreate(body: unknown): {
    application_id: string;
    workflow_node_id: string | null;
    assignment: Assignment;
  } {
    const obj = requireRecord(body, '');
    rejectNamedOfficerOnTop(obj);
    assertOnlyKeys(obj, ['application_id', 'workflow_node_id', 'assignment'], '');
    const node = obj['workflow_node_id'];
    if (node !== undefined && (typeof node !== 'string' || !NODE_ID.test(node))) {
      throw invalid('/workflow_node_id');
    }
    return {
      application_id: uuidField(obj, 'application_id', ''),
      workflow_node_id: node === undefined ? null : (node as string),
      assignment: parseAssignment(obj['assignment']),
    };
  }

  async createTask(
    ctx: TenantContext,
    body: unknown,
    idem: Idempotency,
  ): Promise<ServiceResult<TaskView>> {
    this.guard(ctx);
    const input = TaskService.parseCreate(body);
    const taskId = this.newId();
    const resource: TaskResource = {
      task_id: taskId,
      application_id: input.application_id,
      workflow_node_id: input.workflow_node_id,
      assignment: input.assignment,
    };
    const authz = await this.authorize(ctx, AUTHZ_ACTION.CREATE, resource, taskId);
    const now = this.clock();

    return this.deps.repo.write(ctx, async (tx) => {
      const replay = await this.claimIdempotency(tx, ctx, idem, now);
      if (replay) return replay as ServiceResult<TaskView>;
      const row = await tx.insertTask({
        task_id: taskId,
        application_id: input.application_id,
        workflow_node_id: input.workflow_node_id,
        cell_id: ctx.cell_id,
        assignment: input.assignment,
        created_by: ctx.actor.id,
        correlation_id: ctx.correlation_id,
        now,
      });
      const result: ServiceResult<TaskView> = { status: 201, body: taskView(row) };
      await this.recordTransition(tx, ctx, {
        action: AUTHZ_ACTION.CREATE,
        operation: 'CREATE',
        before: null,
        after: row,
        authz,
        targetAuthz: null,
        idem,
        now,
      });
      await this.finishIdempotency(tx, ctx, idem, result);
      return result;
    });
  }

  async claimTask(ctx: TenantContext, taskId: string, idem: Idempotency) {
    return this.mutate(ctx, { operation: 'CLAIM', taskId, idem });
  }

  async unclaimTask(ctx: TenantContext, taskId: string, idem: Idempotency) {
    return this.mutate(ctx, { operation: 'UNCLAIM', taskId, idem });
  }

  async reassignTask(ctx: TenantContext, taskId: string, body: unknown, idem: Idempotency) {
    const obj = requireRecord(body, '');
    rejectNamedOfficerOnTop(obj);
    assertOnlyKeys(obj, ['assignment'], '');
    const target = parseAssignment(obj['assignment']);
    return this.mutate(ctx, { operation: 'REASSIGN', taskId, idem, target });
  }

  async completeTask(ctx: TenantContext, taskId: string, body: unknown, idem: Idempotency) {
    const outcome = parseOutcome(body);
    return this.mutate(ctx, { operation: 'COMPLETE', taskId, idem, outcome });
  }

  async cancelCloseTask(ctx: TenantContext, taskId: string, body: unknown, idem: Idempotency) {
    const outcome = parseOutcome(body);
    return this.mutate(ctx, { operation: 'CANCEL_CLOSE', taskId, idem, outcome });
  }

  async getTask(ctx: TenantContext, taskId: string): Promise<TaskView> {
    const task = await this.load(ctx, taskId);
    await this.authorize(ctx, 'TASK_READ', resourceOf(task), task.task_id);
    return taskView(task);
  }

  async getHistory(ctx: TenantContext, taskId: string): Promise<{ items: HistoryView[] }> {
    const task = await this.load(ctx, taskId);
    await this.authorize(ctx, 'TASK_READ_HISTORY', resourceOf(task), task.task_id);
    const rows = await this.deps.repo.read(ctx, (tx) => tx.listHistory(taskId));
    return { items: rows.map(historyView) };
  }

  /** Open tasks whose assignment criteria the caller currently satisfies. */
  async listAvailable(ctx: TenantContext, limit = DEFAULT_PAGE): Promise<{ items: TaskView[] }> {
    this.guard(ctx);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw invalid('/limit');
    await this.authorize(ctx, 'TASK_LIST', {}, 'availability');
    const scope = await this.scopeOf(ctx);
    const rows = await this.deps.repo.read(ctx, (tx) => tx.listAvailable(scope, limit));
    return { items: rows.map(taskView) };
  }

  private async scopeOf(ctx: TenantContext): Promise<PrincipalScope> {
    return scopeFromContext(ctx, await this.deps.scopes.extend(ctx));
  }

  private guard(ctx: TenantContext): void {
    if (ctx.tenant_id === null || ctx.tenant_id === undefined) {
      throw new Cmp017Error('SF-TEN-001', { statusCode: 401 });
    }
  }

  private async load(ctx: TenantContext, taskId: string): Promise<TaskRow> {
    this.guard(ctx);
    if (!/^[0-9a-f-]{36}$/.test(taskId)) throw invalid('/task_id');
    const task = await this.deps.repo.read(ctx, (tx) => tx.getTask(taskId));
    if (!task) throw new Cmp017Error('SF-SYS-002');
    return task;
  }

  /**
   * Protected mutation. Order: server tenant context -> read snapshot (RLS) -> OPA decision on the
   * current effective policy (ADR-0005) -> assignment resolution -> one short write transaction.
   * No network call (OPA, scope lookup) happens while the transaction is open.
   */
  private async mutate(ctx: TenantContext, plan: MutationPlan): Promise<ServiceResult<TaskView>> {
    const snapshot = await this.load(ctx, plan.taskId);
    const action = this.actionFor(ctx, plan.operation, snapshot);

    const authz = await this.authorize(ctx, action, resourceOf(snapshot), snapshot.task_id);
    let targetAuthz: AuthzRecord | null = null;
    if (plan.operation === 'REASSIGN' && plan.target) {
      targetAuthz = await this.authorize(
        ctx,
        action,
        { ...resourceOf(snapshot), assignment: plan.target },
        snapshot.task_id,
      );
    }
    if (isTerminal(snapshot.task_state)) {
      throw new Cmp017Error('SF-APP-001', detail('TASK_TERMINAL'));
    }
    if (plan.operation === 'CLAIM' || plan.operation === 'COMPLETE') {
      const miss = mismatches(snapshot.assignment, await this.scopeOf(ctx));
      if (miss.length > 0) {
        await this.auditDenied(
          ctx,
          action,
          snapshot,
          authz,
          `assignment_mismatch=${miss.join(',')}`,
        );
        throw new Cmp017Error('SF-AUTH-002', detail('ASSIGNMENT_MISMATCH'));
      }
    }

    if (plan.operation === 'COMPLETE' && snapshot.claimed_principal_id !== ctx.actor.id) {
      await this.auditDenied(ctx, action, snapshot, authz, 'not_claimant');
      throw new Cmp017Error('SF-AUTH-002', detail('NOT_CLAIMANT'));
    }

    const now = this.clock();
    return this.deps.repo.write(ctx, async (tx) => {
      const replay = await this.claimIdempotency(tx, ctx, plan.idem, now);
      if (replay) return replay as ServiceResult<TaskView>;

      const locked = await tx.lockTask(plan.taskId);
      if (!locked) throw new Cmp017Error('SF-SYS-002');
      if (locked.aggregate_version !== snapshot.aggregate_version) {
        throw new Cmp017Error('SF-APP-001', detail('STALE_TASK_VERSION'));
      }
      if (isTerminal(locked.task_state)) {
        throw new Cmp017Error('SF-APP-001', detail('TASK_TERMINAL'));
      }
      if (!canApply(plan.operation, locked.task_state)) {
        throw new Cmp017Error('SF-APP-001', detail('TASK_STATE_CONFLICT'));
      }
      if (plan.operation === 'COMPLETE' && locked.claimed_principal_id !== ctx.actor.id) {
        throw new Cmp017Error('SF-AUTH-002', detail('NOT_CLAIMANT'));
      }
      if (
        plan.operation === 'REASSIGN' &&
        plan.target &&
        sameAssignment(plan.target, locked.assignment)
      ) {
        throw new Cmp017Error('SF-APP-001', detail('ASSIGNMENT_UNCHANGED'));
      }

      const after = await tx.updateTask(plan.taskId, this.patchFor(ctx, plan, locked, now));
      await this.recordTransition(tx, ctx, {
        action,
        operation: plan.operation,
        before: locked,
        after,
        authz,
        targetAuthz,
        idem: plan.idem,
        now,
      });
      const result: ServiceResult<TaskView> = { status: 200, body: taskView(after) };
      await this.finishIdempotency(tx, ctx, plan.idem, result);
      return result;
    });
  }

  private actionFor(ctx: TenantContext, operation: Operation, task: TaskRow): string {
    if (
      operation === 'UNCLAIM' &&
      task.claimed_principal_id !== null &&
      task.claimed_principal_id !== ctx.actor.id
    ) {
      return FORCE_UNCLAIM;
    }
    return AUTHZ_ACTION[operation];
  }

  private patchFor(ctx: TenantContext, plan: MutationPlan, row: TaskRow, now: Date): TaskPatch {
    const base: TaskPatch = {
      task_state: targetState(plan.operation),
      assignment: row.assignment,
      claimed_principal_id: null,
      claimed_at: null,
      outcome: row.outcome,
      expected_version: row.aggregate_version,
      now,
    };
    switch (plan.operation) {
      case 'CLAIM':
        // The runtime principal who claimed is recorded here; it is not published metadata.
        return { ...base, claimed_principal_id: ctx.actor.id, claimed_at: now };
      case 'UNCLAIM':
        return base;
      case 'REASSIGN':
        return { ...base, assignment: plan.target ?? row.assignment };
      case 'COMPLETE':
        return {
          ...base,
          claimed_principal_id: row.claimed_principal_id,
          claimed_at: row.claimed_at ? new Date(row.claimed_at) : null,
          outcome: plan.outcome ?? null,
        };
      case 'CANCEL_CLOSE':
        return { ...base, outcome: plan.outcome ?? null };
    }
  }

  private async authorize(
    ctx: TenantContext,
    action: string,
    resource: TaskResource,
    resourceId: string,
  ): Promise<AuthzRecord> {
    const record = await decide(this.deps.authz, authzInput(ctx, action, resource));
    if (!record.allow) {
      await this.auditDeniedByResource(ctx, action, resource, resourceId, record);
      throw new Cmp017Error('SF-AUTH-002', detail('POLICY_DENIED'));
    }
    return record;
  }

  private async auditDeniedByResource(
    ctx: TenantContext,
    action: string,
    resource: TaskResource,
    resourceId: string,
    authz: AuthzRecord,
  ): Promise<void> {
    await this.writeDeniedAudit(ctx, {
      action,
      resourceId,
      authz,
      organisationId: resource.assignment?.organisation_id,
      jurisdictionId: resource.assignment?.jurisdiction_id,
    });
  }

  private async auditDenied(
    ctx: TenantContext,
    action: string,
    task: TaskRow,
    authz: AuthzRecord,
    reason: string,
  ): Promise<void> {
    await this.writeDeniedAudit(ctx, {
      action,
      resourceId: task.task_id,
      authz,
      reason,
      organisationId: task.assignment.organisation_id,
      jurisdictionId: task.assignment.jurisdiction_id,
    });
  }

  /** A failed audit write never turns a denial into an allow. */
  private async writeDeniedAudit(
    ctx: TenantContext,
    p: {
      action: string;
      resourceId: string;
      authz: AuthzRecord;
      reason?: string;
      organisationId: string | undefined;
      jurisdictionId: string | undefined;
    },
  ): Promise<void> {
    try {
      const now = this.clock();
      await this.deps.repo.write(ctx, (tx) =>
        appendAudit(tx, ctx, {
          action: p.action,
          actionClass: 'WRITE',
          resourceId: p.resourceId,
          result: 'DENIED',
          authz: p.authz,
          ...(p.reason ? { reason: p.reason } : {}),
          ...(p.organisationId ? { organisationId: p.organisationId } : {}),
          ...(p.jurisdictionId ? { jurisdictionId: p.jurisdictionId } : {}),
          now,
        }),
      );
    } catch {
      // Denial stands; the audit outage is surfaced by platform observability, not by allowing.
    }
  }

  private async claimIdempotency(
    tx: TaskWriteTx,
    ctx: TenantContext,
    idem: Idempotency,
    now: Date,
  ): Promise<ServiceResult | null> {
    const claimed = await tx.claimIdempotency({
      principalId: ctx.actor.id,
      endpoint: idem.endpoint,
      key: idem.key,
      fingerprint: idem.fingerprint,
      now,
    });
    return claimed === 'claimed' ? null : { status: claimed.status, body: claimed.body };
  }

  private async finishIdempotency(
    tx: TaskWriteTx,
    ctx: TenantContext,
    idem: Idempotency,
    result: ServiceResult,
  ): Promise<void> {
    await tx.completeIdempotency({
      principalId: ctx.actor.id,
      endpoint: idem.endpoint,
      key: idem.key,
      status: result.status,
      body: result.body,
    });
  }

  private async recordTransition(
    tx: TaskWriteTx,
    ctx: TenantContext,
    p: {
      action: string;
      operation: Operation;
      before: TaskRow | null;
      after: TaskRow;
      authz: AuthzRecord;
      targetAuthz: AuthzRecord | null;
      idem: Idempotency;
      now: Date;
    },
  ): Promise<void> {
    await tx.insertHistory({
      history_id: this.newId(),
      task_id: p.after.task_id,
      operation: p.operation,
      from_state: p.before ? p.before.task_state : null,
      to_state: p.after.task_state,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      assignment: p.after.assignment,
      claimed_principal_id: p.after.claimed_principal_id,
      outcome: p.after.outcome,
      authz_decision_id: p.authz.decision_id,
      policy_revision: p.authz.policy_revision,
      target_authz_decision_id: p.targetAuthz ? p.targetAuthz.decision_id : null,
      idempotency_key: p.idem.key,
      correlation_id: ctx.correlation_id,
      now: p.now,
    });
    const data = humanTaskContract({
      operation: p.operation,
      task: p.after,
      authzDecisionId: p.authz.decision_id,
      idempotencyKey: p.idem.key,
      correlationId: ctx.correlation_id,
    });
    await tx.insertOutbox(
      envelopeOf({
        eventType: EVENT_TYPE[p.operation],
        tenantId: ctx.tenant_id,
        cellId: ctx.cell_id,
        aggregateType: 'HumanTask',
        aggregateId: p.after.task_id,
        aggregateVersion: p.after.aggregate_version,
        occurredAt: p.now.toISOString(),
        correlationId: ctx.correlation_id,
        actor: ctx.actor,
        data,
      }),
      TOPIC_DOMAIN,
    );
    await appendAudit(tx, ctx, {
      action: p.action,
      actionClass: 'WRITE',
      resourceId: p.after.task_id,
      result: 'SUCCESS',
      authz: p.authz,
      organisationId: p.after.assignment.organisation_id,
      jurisdictionId: p.after.assignment.jurisdiction_id,
      afterRef: `task:${p.after.task_id}@v${p.after.aggregate_version}`,
      now: p.now,
    });
  }
}

function resourceOf(task: TaskRow): TaskResource {
  return {
    task_id: task.task_id,
    application_id: task.application_id,
    workflow_node_id: task.workflow_node_id,
    task_state: task.task_state,
    owner_id: task.claimed_principal_id,
    assignment: task.assignment,
  };
}

function parseOutcome(body: unknown): string {
  const obj = requireRecord(body, '');
  rejectNamedOfficerOnTop(obj);
  assertOnlyKeys(obj, ['outcome'], '');
  return codeField(obj, 'outcome', '');
}

/** Top-level body keys that try to smuggle a tenant or a person are refused with specific codes. */
function rejectNamedOfficerOnTop(obj: Record<string, unknown>): void {
  if ('tenant_id' in obj) throw new Cmp017Error('SF-TEN-002');
  rejectNamedOfficer(obj, '');
}
