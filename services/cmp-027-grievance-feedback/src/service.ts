import { randomUUID } from 'node:crypto';
import { authorizeAction, type AuthzOutcome } from './authz.js';
import { assertPortAllowed, loadConfig, type Cmp027Config } from './config.js';
import { requireTenantContext } from './context.js';
import {
  assertAiAssistAllowed,
  assertStatutoryClose,
  isCommand,
  parseAssignment,
  planTransition,
  type Assignment,
  type GrievanceKind,
  type GrievanceStatus,
  type TransitionCommand,
} from './domain/model.js';
import {
  BODY_REF_RE,
  IDEMPOTENCY_KEY_RE,
  isCode,
  isUuid,
  isPlainObject,
  sha256Of,
  type TenantRequestContext,
} from './domain/validate.js';
import { Cmp027Error, detail } from './errors.js';
import { auditEnvelope, envelopeOf, EVENT_TYPES, TOPIC_AUDIT, TOPIC_DOMAIN } from './events.js';
import type { AuthorizationPort } from './ports/authorization.js';
import {
  AllowLinkagePolicyPort,
  DenyRoutingPolicyPort,
  NoopHumanTaskPort,
  OutboxOnlyWorkflowAdvance,
  unconfiguredNotificationPort,
  type HumanTaskPort,
  type LinkagePolicyPort,
  type NotificationPort,
  type RoutingPolicyPort,
  type WorkflowAdvancePort,
} from './ports/external.js';
import type {
  AssignmentRequestRow,
  DbSession,
  GrievanceRow,
  GrievanceStore,
  GrievanceTx,
  IdempotencyKeyRef,
  ResponseRow,
  StoredResponse,
  TransitionRow,
} from './store/types.js';
import { guardOutboundPort, runInDomainTransaction } from './tx-scope.js';
import { assertNoOpenDomainTransaction } from './tx-scope.js';

export const ENDPOINTS = {
  file: 'POST /v1/grievances',
  feedback: 'POST /v1/feedback',
  command: 'POST /v1/grievances/{grievance_id}/commands',
  aiAssist: 'POST /v1/grievances/{grievance_id}/ai-assist',
} as const;

export interface GrievanceServiceDeps {
  store: GrievanceStore;
  authorizer: AuthorizationPort;
  routing?: RoutingPolicyPort;
  linkage?: LinkagePolicyPort;
  workflow?: WorkflowAdvancePort;
  tasks?: HumanTaskPort;
  notification?: NotificationPort;
  config?: Cmp027Config;
  clock?: () => Date;
}

export interface ServiceResult extends StoredResponse {
  replayed: boolean;
}

function sessionOf(ctx: TenantRequestContext): DbSession {
  return {
    tenantId: ctx.tenant_id,
    cellId: ctx.cell_id,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    correlationId: ctx.correlation_id,
  };
}

function assertOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw new Cmp027Error('SF-SYS-003', { details: detail('UNKNOWN_FIELD', `/${key}`) });
    }
  }
}

function requireBody(body: unknown): Record<string, unknown> {
  if (!isPlainObject(body))
    throw new Cmp027Error('SF-SYS-003', { details: detail('BODY_REQUIRED') });
  return body;
}

export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_RE.test(value)) {
    throw new Cmp027Error('SF-SYS-003', { details: detail('IDEMPOTENCY_KEY_REQUIRED') });
  }
  return value;
}

function requireId(value: unknown, pointer: string): string {
  if (!isUuid(value))
    throw new Cmp027Error('SF-SYS-003', { details: detail('ID_INVALID', pointer) });
  return value.toLowerCase();
}

function optionalId(value: unknown, pointer: string): string | null {
  if (value === undefined || value === null) return null;
  return requireId(value, pointer);
}

function optionalCode(value: unknown, pointer: string): string | null {
  if (value === undefined || value === null) return null;
  if (!isCode(value))
    throw new Cmp027Error('SF-SYS-003', { details: detail('CODE_INVALID', pointer) });
  return value;
}

function referenceCode(id: string): string {
  return `GF-${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

function view(row: GrievanceRow): Record<string, unknown> {
  return {
    grievance_id: row.grievance_id,
    kind: row.kind,
    status: row.status,
    aggregate_version: row.aggregate_version,
    reference_code: row.reference_code,
    category_code: row.category_code,
    service_id: row.service_id,
    application_id: row.application_id,
    organisation_id: row.organisation_id,
    jurisdiction_id: row.jurisdiction_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class GrievanceFeedbackService {
  readonly ports: {
    authorizer: AuthorizationPort;
    routing: RoutingPolicyPort;
    linkage: LinkagePolicyPort;
    workflow: WorkflowAdvancePort;
    tasks: HumanTaskPort;
    notification: NotificationPort;
  };
  private readonly store: GrievanceStore;
  private readonly authorizer: AuthorizationPort;
  private readonly routing: RoutingPolicyPort;
  private readonly linkage: LinkagePolicyPort;
  private readonly workflow: WorkflowAdvancePort;
  private readonly tasks: HumanTaskPort;
  private readonly notification: NotificationPort;
  private readonly config: Cmp027Config;
  private readonly clock: () => Date;

  constructor(deps: GrievanceServiceDeps) {
    this.store = deps.store;
    this.config = deps.config ?? loadConfig();
    this.clock = deps.clock ?? (() => new Date());
    this.authorizer = guardOutboundPort('authorization', deps.authorizer);
    this.routing = guardOutboundPort('routing', deps.routing ?? new DenyRoutingPolicyPort());
    this.linkage = guardOutboundPort('linkage', deps.linkage ?? new AllowLinkagePolicyPort());
    this.workflow = guardOutboundPort('workflow', deps.workflow ?? new OutboxOnlyWorkflowAdvance());
    this.tasks = guardOutboundPort('tasks', deps.tasks ?? new NoopHumanTaskPort());
    this.notification = guardOutboundPort(
      'notification',
      deps.notification ?? unconfiguredNotificationPort,
    );
    this.ports = {
      authorizer: this.authorizer,
      routing: this.routing,
      linkage: this.linkage,
      workflow: this.workflow,
      tasks: this.tasks,
      notification: this.notification,
    };
    assertPortAllowed(this.linkage, this.config.environment, 'LINKAGE');
  }

  async file(
    rawCtx: unknown,
    rawBody: unknown,
    rawKey: unknown,
    kind: GrievanceKind,
  ): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const key = parseIdempotencyKey(rawKey);
    const body = requireBody(rawBody);
    assertOnlyKeys(body, ['service_id', 'application_id', 'jurisdiction_id', 'organisation_id']);
    const serviceId = optionalId(body['service_id'], '/service_id');
    const applicationId = optionalId(body['application_id'], '/application_id');
    const jurisdictionId =
      optionalId(body['jurisdiction_id'], '/jurisdiction_id') ?? ctx.jurisdiction_ids[0] ?? null;
    const organisationId =
      optionalId(body['organisation_id'], '/organisation_id') ?? ctx.organisation_id ?? null;
    const now = this.clock();
    const action = kind === 'GRIEVANCE' ? 'GRIEVANCE_FILE' : 'FEEDBACK_RECORD';
    const authz = await authorizeAction(
      this.authorizer,
      ctx,
      action,
      { ownerId: ctx.actor.id, serviceId, organisationId, jurisdictionId },
      now,
    );
    const allowed = await this.linkage.allow(ctx, {
      service_id: serviceId,
      application_id: applicationId,
    });
    if (!allowed) {
      throw new Cmp027Error('SF-AUTH-002', { details: detail('LINKAGE_NOT_PERMITTED') });
    }
    const id = randomUUID();
    const occurred = now.toISOString();
    const row: GrievanceRow = {
      grievance_id: id,
      tenant_id: ctx.tenant_id,
      cell_id: ctx.cell_id,
      kind,
      status: 'FILED',
      aggregate_version: 1,
      reference_code: referenceCode(id),
      category_code: null,
      filer_id: ctx.actor.id,
      organisation_id: organisationId,
      jurisdiction_id: jurisdictionId,
      office_id: ctx.office_id ?? null,
      service_id: serviceId,
      application_id: applicationId,
      workflow_version_id: null,
      created_by: ctx.actor.id,
      created_at: occurred,
      updated_at: occurred,
      last_correlation_id: ctx.correlation_id,
    };
    const result = await this.mutate(ctx, {
      endpoint: kind === 'GRIEVANCE' ? ENDPOINTS.file : ENDPOINTS.feedback,
      key,
      fingerprint: sha256Of({ kind, serviceId, applicationId }),
      now,
      write: async (tx) => {
        await tx.insertGrievance(row);
        await tx.insertTransition(this.fileTransition(row, authz, ctx, key, occurred));
        await this.emit(tx, ctx, row, EVENT_TYPES.filed, action, 'WRITE', occurred, {
          kind,
          reference_code: row.reference_code,
          status: row.status,
        });
        return { status: 201, body: { grievance: view(row) } };
      },
    });
    if (!result.replayed) await this.afterCommit(ctx, row, key);
    return result;
  }

  async get(rawCtx: unknown, grievanceId: unknown): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(grievanceId, '/grievance_id');
    await authorizeAction(
      this.authorizer,
      ctx,
      'GRIEVANCE_READ',
      { grievanceId: id },
      this.clock(),
    );
    const row = await this.store.withTx(sessionOf(ctx), (tx) => tx.getGrievance(id));
    if (!row) throw new Cmp027Error('SF-SYS-002');
    return { status: 200, body: { grievance: view(row) }, replayed: false };
  }

  async listTransitions(rawCtx: unknown, grievanceId: unknown): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(grievanceId, '/grievance_id');
    await authorizeAction(
      this.authorizer,
      ctx,
      'GRIEVANCE_READ',
      { grievanceId: id },
      this.clock(),
    );
    const rows = await this.store.withTx(sessionOf(ctx), (tx) => tx.listTransitions(id));
    return {
      status: 200,
      body: {
        transitions: rows.map(({ tenant_id: _t, actor_id: _a, ...rest }) => rest),
      },
      replayed: false,
    };
  }

  async listResponses(rawCtx: unknown, grievanceId: unknown): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(grievanceId, '/grievance_id');
    await authorizeAction(
      this.authorizer,
      ctx,
      'GRIEVANCE_READ',
      { grievanceId: id },
      this.clock(),
    );
    const rows = await this.store.withTx(sessionOf(ctx), (tx) => tx.listResponses(id));
    return {
      status: 200,
      body: { responses: rows.map(({ tenant_id: _t, author_id: _a, ...rest }) => rest) },
      replayed: false,
    };
  }

  async executeCommand(
    rawCtx: unknown,
    grievanceId: unknown,
    rawBody: unknown,
    rawKey: unknown,
  ): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(grievanceId, '/grievance_id');
    const key = parseIdempotencyKey(rawKey);
    const body = requireBody(rawBody);
    assertOnlyKeys(body, [
      'command',
      'expected_status',
      'expected_version',
      'category_code',
      'assignment',
      'body_ref',
      'reason_code',
      'workflow_version_id',
    ]);
    if (!isCommand(body['command'])) {
      throw new Cmp027Error('SF-SYS-003', { details: detail('COMMAND_INVALID', '/command') });
    }
    const command = body['command'];
    if (!isStatusExpect(body['expected_status'])) {
      throw new Cmp027Error('SF-SYS-003', {
        details: detail('EXPECTED_STATUS_INVALID', '/expected_status'),
      });
    }
    const expectedStatus = body['expected_status'];
    const expectedVersion = body['expected_version'];
    if (
      typeof expectedVersion !== 'number' ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 1
    ) {
      throw new Cmp027Error('SF-SYS-003', {
        details: detail('EXPECTED_VERSION_INVALID', '/expected_version'),
      });
    }
    const categoryCode = optionalCode(body['category_code'], '/category_code');
    const reasonCode = optionalCode(body['reason_code'], '/reason_code');
    const workflowVersionId = optionalId(body['workflow_version_id'], '/workflow_version_id');
    const now = this.clock();
    const snapshot = await this.store.withTx(sessionOf(ctx), (tx) => tx.getGrievance(id));
    if (!snapshot) throw new Cmp027Error('SF-SYS-002');
    assertStatutoryClose({
      kind: snapshot.kind,
      command,
      actorType: ctx.actor.type,
    });
    if (
      command === 'WITHDRAW' &&
      ctx.actor.id !== snapshot.filer_id &&
      ctx.actor.type !== 'OFFICER'
    ) {
      throw new Cmp027Error('SF-AUTH-002');
    }
    planTransition({
      command,
      from: snapshot.status,
      expectedStatus,
      expectedVersion,
      currentVersion: snapshot.aggregate_version,
    });
    if (command === 'CATEGORISE' && !categoryCode) {
      throw new Cmp027Error('SF-SYS-003', {
        details: detail('CATEGORY_REQUIRED', '/category_code'),
      });
    }
    let assignment: Assignment | null = null;
    if (command === 'REQUEST_ASSIGNMENT') {
      assignment =
        body['assignment'] !== undefined
          ? parseAssignment(body['assignment'])
          : await this.routing.resolve(ctx, {
              category_code: snapshot.category_code ?? categoryCode ?? 'UNSPECIFIED',
              kind: snapshot.kind,
              organisation_id: snapshot.organisation_id,
              jurisdiction_id: snapshot.jurisdiction_id,
              service_scope_id: snapshot.service_id,
            });
    }
    let bodyRef: string | null = null;
    if (command === 'RECORD_RESPONSE') {
      if (typeof body['body_ref'] !== 'string' || !BODY_REF_RE.test(body['body_ref'])) {
        throw new Cmp027Error('SF-SYS-003', { details: detail('BODY_REF_INVALID', '/body_ref') });
      }
      bodyRef = body['body_ref'];
    }
    const authz = await authorizeAction(
      this.authorizer,
      ctx,
      `GRIEVANCE_${command}`,
      {
        grievanceId: id,
        ownerId: snapshot.filer_id,
        serviceId: snapshot.service_id,
        organisationId: snapshot.organisation_id,
        jurisdictionId: snapshot.jurisdiction_id,
      },
      now,
    );
    const occurred = now.toISOString();
    const result = await this.mutate(ctx, {
      endpoint: ENDPOINTS.command,
      key,
      fingerprint: sha256Of({ id, command, expectedStatus, expectedVersion, categoryCode }),
      now,
      write: async (tx) => {
        const locked = await tx.getGrievance(id, { forUpdate: true });
        if (!locked) throw new Cmp027Error('SF-SYS-002');
        const again = planTransition({
          command,
          from: locked.status,
          expectedStatus,
          expectedVersion,
          currentVersion: locked.aggregate_version,
        });
        const ok = await tx.updateGrievance({
          grievanceId: id,
          fromStatus: locked.status,
          toStatus: again.to,
          fromVersion: locked.aggregate_version,
          categoryCode,
          organisationId: assignment?.organisation_id ?? null,
          jurisdictionId: assignment?.jurisdiction_id ?? null,
          officeId: assignment?.office_id ?? null,
          workflowVersionId,
          updatedAt: occurred,
          correlationId: ctx.correlation_id,
        });
        if (!ok) throw new Cmp027Error('SF-APP-001', { details: detail('STALE_VERSION') });
        const next: GrievanceRow = {
          ...locked,
          status: again.to,
          aggregate_version: again.nextVersion,
          category_code: categoryCode ?? locked.category_code,
          organisation_id: assignment?.organisation_id ?? locked.organisation_id,
          jurisdiction_id: assignment?.jurisdiction_id ?? locked.jurisdiction_id,
          office_id: assignment?.office_id ?? locked.office_id,
          workflow_version_id: workflowVersionId ?? locked.workflow_version_id,
          updated_at: occurred,
          last_correlation_id: ctx.correlation_id,
        };
        await tx.insertTransition(
          this.transitionRow(next, locked.status, command, authz, ctx, key, occurred, reasonCode),
        );
        if (command === 'RECORD_RESPONSE' && bodyRef) {
          const resp: ResponseRow = {
            response_id: randomUUID(),
            tenant_id: ctx.tenant_id,
            grievance_id: id,
            author_actor_type: ctx.actor.type,
            author_id: ctx.actor.id,
            body_ref: bodyRef,
            created_at: occurred,
            correlation_id: ctx.correlation_id,
          };
          await tx.insertResponse(resp);
          await tx.insertOutbox(
            envelopeOf({
              eventType: EVENT_TYPES.responseRecorded,
              ctx,
              aggregateId: id,
              aggregateVersion: next.aggregate_version,
              occurredAt: occurred,
              data: { response_id: resp.response_id, body_ref: bodyRef },
            }),
            TOPIC_DOMAIN,
          );
        }
        let assignmentRow: AssignmentRequestRow | null = null;
        if (command === 'REQUEST_ASSIGNMENT' && assignment) {
          assignmentRow = {
            request_id: randomUUID(),
            tenant_id: ctx.tenant_id,
            grievance_id: id,
            assignment,
            status: 'REQUESTED',
            created_at: occurred,
            correlation_id: ctx.correlation_id,
          };
          await tx.insertAssignmentRequest(assignmentRow);
          await tx.insertOutbox(
            envelopeOf({
              eventType: EVENT_TYPES.assignmentRequested,
              ctx,
              aggregateId: id,
              aggregateVersion: next.aggregate_version,
              occurredAt: occurred,
              data: { assignment, request_id: assignmentRow.request_id },
            }),
            TOPIC_DOMAIN,
          );
        }
        await this.emit(
          tx,
          ctx,
          next,
          EVENT_TYPES.statusChanged,
          `GRIEVANCE_${command}`,
          command === 'RESOLVE' || command === 'CLOSE' ? 'DECISION' : 'WRITE',
          occurred,
          {
            command,
            from_status: locked.status,
            to_status: next.status,
            authz_policy_revision: authz.policyRevision,
          },
        );
        return {
          status: 200,
          body: { grievance: view(next), assignment: assignmentRow?.assignment ?? null },
        };
      },
    });
    if (!result.replayed) {
      const after = (result.body as { grievance: { grievance_id: string } }).grievance;
      const latest = await this.store.withTx(sessionOf(ctx), (tx) =>
        tx.getGrievance(after.grievance_id),
      );
      if (latest) await this.afterCommit(ctx, latest, key, assignment);
    }
    return result;
  }

  async recordAiAssist(
    rawCtx: unknown,
    grievanceId: unknown,
    rawBody: unknown,
    rawKey: unknown,
  ): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(grievanceId, '/grievance_id');
    const key = parseIdempotencyKey(rawKey);
    const body = requireBody(rawBody);
    assertOnlyKeys(body, ['kind', 'suggestion_code', 'duplicate_of_id']);
    if (typeof body['kind'] !== 'string') {
      throw new Cmp027Error('SF-SYS-003', { details: detail('AI_ASSIST_KIND_INVALID', '/kind') });
    }
    assertAiAssistAllowed(body['kind']);
    const suggestion = optionalCode(body['suggestion_code'], '/suggestion_code');
    const duplicateOf = optionalId(body['duplicate_of_id'], '/duplicate_of_id');
    const now = this.clock();
    const snapshot = await this.store.withTx(sessionOf(ctx), (tx) => tx.getGrievance(id));
    if (!snapshot) throw new Cmp027Error('SF-SYS-002');
    await authorizeAction(
      this.authorizer,
      ctx,
      'GRIEVANCE_AI_ASSIST',
      { grievanceId: id, ownerId: snapshot.filer_id },
      now,
    );
    const occurred = now.toISOString();
    const assistId = randomUUID();
    return this.mutate(ctx, {
      endpoint: ENDPOINTS.aiAssist,
      key,
      fingerprint: sha256Of({ id, kind: body['kind'], suggestion, duplicateOf }),
      now,
      write: async (tx) => {
        const locked = await tx.getGrievance(id, { forUpdate: true });
        if (!locked) throw new Cmp027Error('SF-SYS-002');
        if (locked.status === 'CLOSED' || locked.status === 'RESOLVED') {
          throw new Cmp027Error('SF-AUTH-002', {
            details: detail('AI_CANNOT_ALTER_DISPOSITION'),
          });
        }
        await tx.insertAiAssist({
          assist_id: assistId,
          tenant_id: ctx.tenant_id,
          grievance_id: id,
          kind: body['kind'] as string,
          suggestion_code: suggestion,
          duplicate_of_id: duplicateOf,
          created_at: occurred,
          correlation_id: ctx.correlation_id,
        });
        await tx.insertOutbox(
          envelopeOf({
            eventType: EVENT_TYPES.aiAssistRecorded,
            ctx,
            aggregateId: id,
            aggregateVersion: locked.aggregate_version,
            occurredAt: occurred,
            data: {
              assist_id: assistId,
              kind: body['kind'],
              suggestion_code: suggestion,
              duplicate_of_id: duplicateOf,
              status_unchanged: locked.status,
            },
          }),
          TOPIC_DOMAIN,
        );
        await tx.insertOutbox(
          auditEnvelope(ctx, {
            action: 'GRIEVANCE_AI_ASSIST',
            actionClass: 'WRITE',
            resourceId: id,
            result: 'SUCCESS',
            occurredAt: occurred,
            afterRef: assistId,
          }),
          TOPIC_AUDIT,
        );
        return {
          status: 202,
          body: {
            assist_id: assistId,
            kind: body['kind'],
            grievance_status: locked.status,
            advisory_only: true,
          },
        };
      },
    });
  }

  private fileTransition(
    row: GrievanceRow,
    authz: AuthzOutcome,
    ctx: TenantRequestContext,
    key: string,
    occurred: string,
  ): TransitionRow {
    return {
      transition_id: randomUUID(),
      tenant_id: ctx.tenant_id,
      grievance_id: row.grievance_id,
      command: row.kind === 'GRIEVANCE' ? 'FILE' : 'RECORD_FEEDBACK',
      from_status: null,
      to_status: 'FILED',
      aggregate_version: 1,
      idempotency_key: key,
      authz_decision_id: authz.decisionId,
      authz_policy_revision: authz.policyRevision,
      correlation_id: ctx.correlation_id,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      reason_code: null,
      policy_ref: null,
      occurred_at: occurred,
    };
  }

  private transitionRow(
    row: GrievanceRow,
    from: GrievanceStatus,
    command: TransitionCommand,
    authz: AuthzOutcome,
    ctx: TenantRequestContext,
    key: string,
    occurred: string,
    reasonCode: string | null,
  ): TransitionRow {
    return {
      transition_id: randomUUID(),
      tenant_id: ctx.tenant_id,
      grievance_id: row.grievance_id,
      command,
      from_status: from,
      to_status: row.status,
      aggregate_version: row.aggregate_version,
      idempotency_key: key,
      authz_decision_id: authz.decisionId,
      authz_policy_revision: authz.policyRevision,
      correlation_id: ctx.correlation_id,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      reason_code: reasonCode,
      policy_ref: null,
      occurred_at: occurred,
    };
  }

  private async emit(
    tx: GrievanceTx,
    ctx: TenantRequestContext,
    row: GrievanceRow,
    eventType: string,
    action: string,
    actionClass: 'WRITE' | 'DECISION',
    occurred: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await tx.insertOutbox(
      envelopeOf({
        eventType,
        ctx,
        aggregateId: row.grievance_id,
        aggregateVersion: row.aggregate_version,
        occurredAt: occurred,
        data,
      }),
      TOPIC_DOMAIN,
    );
    const audit = auditEnvelope(ctx, {
      action,
      actionClass,
      resourceId: row.grievance_id,
      result: 'SUCCESS',
      occurredAt: occurred,
      afterRef: row.reference_code,
      ...(actionClass === 'DECISION' ? { reason: action } : {}),
    });
    await tx.insertOutbox(audit, TOPIC_AUDIT);
  }

  private async mutate(
    ctx: TenantRequestContext,
    params: {
      endpoint: string;
      key: string;
      fingerprint: string;
      now: Date;
      write: (tx: GrievanceTx) => Promise<StoredResponse>;
    },
  ): Promise<ServiceResult> {
    const ref: IdempotencyKeyRef = {
      principalId: ctx.actor.id,
      endpoint: params.endpoint,
      key: params.key,
    };
    return this.store.withTx(sessionOf(ctx), (tx) =>
      runInDomainTransaction(async () => {
        const claimed = await tx.claimIdempotency({
          ...ref,
          fingerprint: params.fingerprint,
          now: params.now,
        });
        if (claimed !== 'claimed') {
          return { ...claimed, replayed: true };
        }
        const stored = await params.write(tx);
        await tx.completeIdempotency({ ...ref, response: stored });
        return { ...stored, replayed: false };
      }),
    );
  }

  private async afterCommit(
    ctx: TenantRequestContext,
    row: GrievanceRow,
    key: string,
    assignment?: Assignment | null,
  ): Promise<void> {
    assertNoOpenDomainTransaction('after-commit');
    try {
      await this.workflow.advance({
        tenant_id: ctx.tenant_id,
        grievance_id: row.grievance_id,
        aggregate_version: row.aggregate_version,
        to_status: row.status,
        workflow_version_id: row.workflow_version_id,
        idempotency_key: key,
        correlation_id: ctx.correlation_id,
      });
    } catch {
      /* durable outbox remains the trigger */
    }
    if (assignment && row.application_id) {
      try {
        await this.tasks.create(ctx, {
          application_id: row.application_id,
          workflow_node_id: 'GRIEVANCE_ASSIGN',
          assignment,
          idempotency_key: key,
        });
      } catch {
        /* outbox assignment event remains */
      }
    }
    if (row.status === 'FILED' || row.status === 'RESOLVED' || row.status === 'CLOSED') {
      try {
        await this.notification.requestNotification({
          tenant_id: ctx.tenant_id,
          grievance_id: row.grievance_id,
          template_ref: `GRIEVANCE_${row.status}`,
          idempotency_key: key,
        });
      } catch {
        /* M06 port optional until host wires it */
      }
    }
  }
}

function isStatusExpect(value: unknown): value is GrievanceStatus {
  return (
    typeof value === 'string' &&
    [
      'FILED',
      'CATEGORISED',
      'ROUTED',
      'OPEN',
      'PENDING_RESPONSE',
      'RESOLVED',
      'CLOSED',
      'WITHDRAWN',
    ].includes(value)
  );
}
