import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@serviceform/contracts';
import type { WorkflowContextLike } from './workflow.js';

/**
 * SF-46 SAMPLE_LAB: CMP-016 HumanTaskPort → CMP-017 TaskService, plus a PrincipalScopePort that
 * widens TENANT_WIDE desk officers to the lab organisation/jurisdiction used on HUMAN_TASK
 * assignments. Host composition only — no domain logic, no cross-component SQL.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface LabTaskAssignmentScope {
  organisation_id: string;
  jurisdiction_id: string;
}

export interface TaskServiceLike {
  createTask(
    ctx: RequestContext,
    body: unknown,
    idem: { key: string; endpoint: string; fingerprint: string },
  ): Promise<{ status: number; body: unknown }>;
  cancelCloseTask(
    ctx: RequestContext,
    taskId: string,
    body: unknown,
    idem: { key: string; endpoint: string; fingerprint: string },
  ): Promise<{ status: number; body: unknown }>;
  findActiveByNode(
    ctx: RequestContext,
    applicationId: string,
    workflowNodeId: string,
  ): Promise<{ task_id: string; task_state: string } | null>;
}

export interface Cmp017Module {
  TaskService: new (deps: {
    repo: unknown;
    authz: { decide(input: unknown): Promise<unknown> };
    scopes: { extend(ctx: RequestContext): Promise<Record<string, string[]>> };
  }) => TaskServiceLike;
  PgTaskRepository: new (pool: unknown) => unknown;
  contextOnlyScope: { extend(ctx: RequestContext): Promise<Record<string, string[]>> };
}

/** Desk roles that cover SAMPLE_LAB HUMAN_TASK assignment org/jurisdiction (TENANT_WIDE). */
const LAB_DESK_ROLES = new Set([
  'SAMPLE_LAB_CASE_OFFICER',
  'SAMPLE_LAB_SCRUTINY_OFFICER',
  'SAMPLE_LAB_APPROVING_AUTHORITY',
]);

/**
 * Widens officer scope with the lab organisation and jurisdiction when they hold a desk role.
 * CMP-004 sessions do not yet carry org/jurisdiction; assignment resolution still fails closed
 * for officers without a matching desk role.
 */
export function labPrincipalScopePort(scope: LabTaskAssignmentScope): {
  extend(ctx: RequestContext): Promise<{
    organisation_ids?: string[];
    jurisdiction_ids?: string[];
  }>;
} {
  if (!UUID.test(scope.organisation_id) || !UUID.test(scope.jurisdiction_id)) {
    throw new Error('SF-M10: lab task assignment scope must be UUIDs');
  }
  return {
    async extend(ctx) {
      if (ctx.actor.type !== 'OFFICER') return {};
      if (!ctx.roles.some((r) => LAB_DESK_ROLES.has(r))) return {};
      return {
        organisation_ids: [scope.organisation_id],
        jurisdiction_ids: [scope.jurisdiction_id],
      };
    },
  };
}

function workflowToRequestContext(
  ctx: WorkflowContextLike,
  roles: readonly string[],
): RequestContext {
  return {
    tenant_id: ctx.tenant_id,
    cell_id: ctx.cell_id,
    actor: { type: ctx.actor.type, id: ctx.actor.id },
    roles: [...roles],
    jurisdiction_ids: [],
    auth_assurance: 'WORKLOAD_IDENTITY',
    correlation_id: ctx.correlation_id,
    trace_id: ctx.trace_id,
  };
}

function idem(key: string, endpoint: string) {
  return { key, endpoint, fingerprint: key };
}

/**
 * CMP-016 HumanTaskPort backed by CMP-017. Create uses TASK_CREATE (SYSTEM sequencer). Cancel-close
 * looks up the active task by application + node; already-terminal is a no-op (idempotent leave).
 */
export function labHumanTaskPort(deps: {
  service: () => TaskServiceLike;
  workloadRoles: readonly string[];
  refuse: (code: string) => Error;
}): {
  create(
    ctx: WorkflowContextLike,
    request: {
      application_id: string;
      workflow_node_id: string;
      assignment: Record<string, unknown>;
      idempotency_key: string;
    },
  ): Promise<void>;
  cancelClose(
    ctx: WorkflowContextLike,
    request: { application_id: string; workflow_node_id: string; idempotency_key: string },
  ): Promise<void>;
} {
  return {
    async create(ctx, request) {
      const rc = workflowToRequestContext(ctx, deps.workloadRoles);
      const res = await deps.service().createTask(
        rc,
        {
          application_id: request.application_id,
          workflow_node_id: request.workflow_node_id,
          assignment: request.assignment,
        },
        idem(request.idempotency_key, 'POST /v1/tasks'),
      );
      if (res.status !== 201 && res.status !== 200) {
        throw deps.refuse('HUMAN_TASK_CREATE_FAILED');
      }
    },
    async cancelClose(ctx, request) {
      const rc = workflowToRequestContext(ctx, deps.workloadRoles);
      const active = await deps
        .service()
        .findActiveByNode(rc, request.application_id, request.workflow_node_id);
      if (!active) return;
      const res = await deps
        .service()
        .cancelCloseTask(
          rc,
          active.task_id,
          { outcome: 'WORKFLOW_NODE_LEFT' },
          idem(request.idempotency_key, `POST /v1/tasks/${active.task_id}/cancel`),
        );
      if (res.status !== 200) {
        throw deps.refuse('HUMAN_TASK_CANCEL_FAILED');
      }
    },
  };
}

export function readLabAssignmentScope(raw: unknown): LabTaskAssignmentScope {
  const obj = raw as { lab_assignment?: { organisation_id?: unknown; jurisdiction_id?: unknown } };
  const org = obj?.lab_assignment?.organisation_id;
  const jur = obj?.lab_assignment?.jurisdiction_id;
  if (typeof org !== 'string' || typeof jur !== 'string' || !UUID.test(org) || !UUID.test(jur)) {
    throw new Error(
      'SF-M10: officers.json lab_assignment organisation_id/jurisdiction_id required',
    );
  }
  return { organisation_id: org, jurisdiction_id: jur };
}

export function newCorrelation(): { correlation_id: string; trace_id: string } {
  const correlation_id = randomUUID();
  return { correlation_id, trace_id: correlation_id.replace(/-/g, '') };
}
