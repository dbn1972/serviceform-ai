import { randomUUID } from 'node:crypto';
import { authorizeAction, type AuthzOutcome, type CaseResourceAttributes } from './authz.js';
import { assertPortAllowed, loadConfig, type Cmp015Config } from './config.js';
import { requireTenantContext } from './context.js';
import {
  assertDecisionBoundary,
  parseDecision,
  type DecisionAttestation,
} from './domain/decision-boundary.js';
import {
  DECISION_COMMANDS,
  REQUEST_STATUSES,
  isRequestStatusChangeLegal,
  isTransitionCommand,
  requestKindFor,
  requestSources,
  type RequestKind,
  type RequestStatus,
  type TransitionCommand,
} from './domain/model.js';
import { parsePinGraph, pinGraphHash, versionPinningRecord, type PinGraph } from './domain/pins.js';
import {
  parseExpectedState,
  parseExpectedVersion,
  planTransition,
} from './domain/state-machine.js';
import {
  IDEMPOTENCY_KEY_RE,
  isCode,
  isUuid,
  sha256Of,
  type TenantRequestContext,
} from './domain/validate.js';
import { Cmp015Error, detail } from './errors.js';
import { auditEnvelope, envelopeOf, EVENT_TYPES, TOPIC_AUDIT, TOPIC_DOMAIN } from './events.js';
import { CommandPipeline, WorkflowAdvanceGate } from './pipeline.js';
import type { AuthorizationPort } from './ports/authorization.js';
import {
  unconfiguredDigiLockerPort,
  unconfiguredNotificationPort,
  unconfiguredPaymentPort,
  type DigiLockerPort,
  type NotificationPort,
  type PaymentPort,
} from './ports/external.js';
import type { PublishedBindingPort } from './ports/published-binding.js';
import type { ServicePolicyPort } from './ports/service-policy.js';
import { OutboxOnlyWorkflowAdvance, type WorkflowAdvancePort } from './ports/workflow-advance.js';
import type {
  CaseRow,
  CaseStore,
  CaseTx,
  DbSession,
  IdempotencyKeyRef,
  RequestRow,
  StoredResponse,
  TransitionRow,
} from './store/types.js';
import { guardOutboundPort, runInDomainTransaction } from './tx-scope.js';

export const ENDPOINTS = {
  createDraft: 'POST /v1/applications',
  command: 'POST /v1/applications/{application_id}/commands',
  request: 'POST /v1/applications/{application_id}/requests',
  requestStatus: 'POST /v1/applications/{application_id}/requests/{request_id}/status',
} as const;

export interface ApplicationCaseDeps {
  store: CaseStore;
  authorizer: AuthorizationPort;
  bindings: PublishedBindingPort;
  servicePolicy: ServicePolicyPort;
  workflow?: WorkflowAdvancePort;
  payment?: PaymentPort;
  notification?: NotificationPort;
  digilocker?: DigiLockerPort;
  config?: Cmp015Config;
  clock?: () => Date;
}

export interface OutboundPorts {
  authorizer: AuthorizationPort;
  bindings: PublishedBindingPort;
  servicePolicy: ServicePolicyPort;
  workflow: WorkflowAdvancePort;
  payment: PaymentPort;
  notification: NotificationPort;
  digilocker: DigiLockerPort;
}

export interface ServiceResult extends StoredResponse {
  replayed: boolean;
}

export interface CaseView {
  application_id: string;
  service_id: string;
  state: CaseRow['state'];
  aggregate_version: number;
  pins: PinGraph;
  pin_graph_hash: string;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}

export function caseView(row: CaseRow): CaseView {
  return {
    application_id: row.application_id,
    service_id: row.service_id,
    state: row.state,
    aggregate_version: row.aggregate_version,
    pins: { ...row.pins },
    pin_graph_hash: row.pin_graph_hash,
    created_at: row.created_at,
    updated_at: row.updated_at,
    submitted_at: row.submitted_at,
  };
}

function transitionView(row: TransitionRow): Omit<TransitionRow, 'tenant_id' | 'actor_id'> {
  const { tenant_id: _t, actor_id: _a, ...rest } = row;
  return rest;
}

function requestView(row: RequestRow): Omit<RequestRow, 'tenant_id' | 'created_by'> {
  const { tenant_id: _t, created_by: _c, ...rest } = row;
  return rest;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw new Cmp015Error('SF-SYS-003', { details: detail('UNKNOWN_FIELD', `/${key}`) });
    }
  }
}

function requireBody(body: unknown): Record<string, unknown> {
  if (!isPlainObject(body))
    throw new Cmp015Error('SF-SYS-003', { details: detail('BODY_REQUIRED') });
  return body;
}

export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_RE.test(value)) {
    throw new Cmp015Error('SF-SYS-003', { details: detail('IDEMPOTENCY_KEY_REQUIRED') });
  }
  return value;
}

function requireId(value: unknown, pointer: string): string {
  if (!isUuid(value))
    throw new Cmp015Error('SF-SYS-003', { details: detail('ID_INVALID', pointer) });
  return value.toLowerCase();
}

function optionalId(value: unknown, pointer: string): string | null {
  if (value === undefined || value === null) return null;
  return requireId(value, pointer);
}

function optionalCode(value: unknown, pointer: string): string | null {
  if (value === undefined || value === null) return null;
  if (!isCode(value))
    throw new Cmp015Error('SF-SYS-003', { details: detail('CODE_INVALID', pointer) });
  return value;
}

interface CommandInput {
  command: TransitionCommand;
  expected_state: CaseRow['state'];
  expected_version: number;
  reason_code: string | null;
  request_id: string | null;
  decision: DecisionAttestation | undefined;
}

export function parseCommandBody(raw: unknown): CommandInput {
  const body = requireBody(raw);
  assertOnlyKeys(body, [
    'command',
    'expected_state',
    'expected_version',
    'reason_code',
    'request_id',
    'decision',
  ]);
  if (!isTransitionCommand(body['command'])) {
    throw new Cmp015Error('SF-SYS-003', { details: detail('COMMAND_INVALID', '/command') });
  }
  return {
    command: body['command'],
    expected_state: parseExpectedState(body['expected_state']),
    expected_version: parseExpectedVersion(body['expected_version']),
    reason_code: optionalCode(body['reason_code'], '/reason_code'),
    request_id: optionalId(body['request_id'], '/request_id'),
    decision: parseDecision(body['decision']),
  };
}

export class ApplicationCaseService {
  readonly ports: OutboundPorts;
  readonly config: Cmp015Config;
  private readonly store: CaseStore;
  private readonly clock: () => Date;
  private readonly gate: WorkflowAdvanceGate;

  constructor(deps: ApplicationCaseDeps) {
    this.config = deps.config ?? loadConfig();
    this.store = deps.store;
    this.clock = deps.clock ?? (() => new Date());
    const raw: OutboundPorts = {
      authorizer: deps.authorizer,
      bindings: deps.bindings,
      servicePolicy: deps.servicePolicy,
      workflow: deps.workflow ?? new OutboxOnlyWorkflowAdvance(),
      payment: deps.payment ?? unconfiguredPaymentPort,
      notification: deps.notification ?? unconfiguredNotificationPort,
      digilocker: deps.digilocker ?? unconfiguredDigiLockerPort,
    };
    for (const [label, port] of Object.entries(raw)) {
      assertPortAllowed(port, this.config.environment, label.toUpperCase());
    }
    this.ports = {
      authorizer: guardOutboundPort('authorizer', raw.authorizer),
      bindings: guardOutboundPort('published-binding', raw.bindings),
      servicePolicy: guardOutboundPort('service-policy', raw.servicePolicy),
      workflow: guardOutboundPort('workflow-advance', raw.workflow),
      payment: guardOutboundPort('payment', raw.payment),
      notification: guardOutboundPort('notification', raw.notification),
      digilocker: guardOutboundPort('digilocker', raw.digilocker),
    };
    this.gate = new WorkflowAdvanceGate(this.ports.workflow);
  }

  private session(ctx: TenantRequestContext): DbSession {
    return {
      tenantId: ctx.tenant_id,
      cellId: ctx.cell_id,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      correlationId: ctx.correlation_id,
    };
  }

  /** The only way CMP-015 opens an authoritative transaction; outbound ports are refused inside. */
  private domainTx<T>(ctx: TenantRequestContext, fn: (tx: CaseTx) => Promise<T>): Promise<T> {
    return runInDomainTransaction(() => this.store.withTx(this.session(ctx), fn));
  }

  private async authorize(
    ctx: TenantRequestContext,
    action: string,
    resource: CaseResourceAttributes,
  ): Promise<AuthzOutcome> {
    try {
      return await authorizeAction(this.ports.authorizer, ctx, action, resource, this.clock());
    } catch (err) {
      if (err instanceof Cmp015Error && err.code === 'SF-AUTH-002') {
        await this.auditDenied(ctx, action, resource.applicationId ?? resource.serviceId ?? 'new');
      }
      throw err;
    }
  }

  private async auditDenied(
    ctx: TenantRequestContext,
    action: string,
    resourceId: string,
  ): Promise<void> {
    try {
      const env = auditEnvelope(ctx, {
        action,
        actionClass: 'WRITE',
        resourceId,
        result: 'DENIED',
        occurredAt: this.clock().toISOString(),
      });
      await this.domainTx(ctx, (tx) => tx.insertOutbox(env, TOPIC_AUDIT));
    } catch {
      /* the denial is still returned; OPA decision logs remain the primary deny record */
    }
  }

  private resourceOf(row: CaseRow): CaseResourceAttributes {
    return {
      applicationId: row.application_id,
      ownerId: row.applicant_id,
      serviceId: row.service_id,
      organisationId: row.organisation_id,
      jurisdictionId: row.jurisdiction_id,
    };
  }

  private assertPinIntegrity(row: CaseRow): void {
    if (pinGraphHash(row.pins) !== row.pin_graph_hash) {
      throw new Cmp015Error('SF-SYS-001', { details: detail('PIN_GRAPH_INTEGRITY') });
    }
  }

  async createDraft(rawCtx: unknown, rawBody: unknown, rawKey: unknown): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const key = parseIdempotencyKey(rawKey);
    const body = requireBody(rawBody);
    assertOnlyKeys(body, ['tenant_service_binding_id', 'organisation_id', 'jurisdiction_id']);
    const tsbId = requireId(body['tenant_service_binding_id'], '/tenant_service_binding_id');
    const organisationId = optionalId(body['organisation_id'], '/organisation_id');
    const jurisdictionId = optionalId(body['jurisdiction_id'], '/jurisdiction_id');

    const binding = await this.ports.bindings.resolve({
      tenant_id: ctx.tenant_id,
      tenant_service_binding_id: tsbId,
    });
    if (!binding || binding.status !== 'PUBLISHED' || binding.tenant_service_binding_id !== tsbId) {
      throw new Cmp015Error('SF-FORM-001', {
        details: detail('BINDING_NOT_PUBLISHED', '/tenant_service_binding_id'),
      });
    }
    const pins = parsePinGraph(binding.pins);
    if (pins.tenant_service_binding_id !== tsbId || !isUuid(binding.service_id)) {
      throw new Cmp015Error('SF-FORM-001', { details: detail('BINDING_PIN_MISMATCH') });
    }

    const authz = await this.authorize(ctx, 'APPLICATION_CREATE_DRAFT', {
      ownerId: ctx.actor.id,
      serviceId: binding.service_id,
      organisationId,
      jurisdictionId,
    });

    const ref: IdempotencyKeyRef = {
      principalId: ctx.actor.id,
      endpoint: ENDPOINTS.createDraft,
      key,
    };
    const fingerprint = sha256Of({ tsbId, organisationId, jurisdictionId });
    const now = this.clock();
    const nowIso = now.toISOString();

    const outcome = await this.domainTx(ctx, async (tx) => {
      const claim = await tx.claimIdempotency({ ...ref, fingerprint, now });
      if (claim !== 'claimed') return { replay: claim };
      const applicationId = randomUUID();
      const row: CaseRow = {
        application_id: applicationId,
        tenant_id: ctx.tenant_id,
        cell_id: ctx.cell_id,
        service_id: binding.service_id.toLowerCase(),
        applicant_id: ctx.actor.id,
        organisation_id: organisationId,
        jurisdiction_id: jurisdictionId,
        state: 'DRAFT',
        aggregate_version: 1,
        pins,
        pin_graph_hash: pinGraphHash(pins),
        created_by: ctx.actor.id,
        created_at: nowIso,
        updated_at: nowIso,
        submitted_at: null,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.insertCase(row);
      const transition: TransitionRow = {
        transition_id: randomUUID(),
        tenant_id: ctx.tenant_id,
        application_id: applicationId,
        command: 'CREATE_DRAFT',
        from_state: null,
        to_state: 'DRAFT',
        transition_key: null,
        transition_class: null,
        aggregate_version: 1,
        idempotency_key: key,
        authz_decision_id: authz.decisionId,
        authz_policy_revision: authz.policyRevision,
        correlation_id: ctx.correlation_id,
        actor_type: ctx.actor.type,
        actor_id: ctx.actor.id,
        reason_code: null,
        request_id: null,
        policy_ref: null,
        occurred_at: nowIso,
      };
      await tx.insertTransition(transition);
      await tx.insertOutbox(
        envelopeOf({
          eventType: EVENT_TYPES.draftCreated,
          ctx,
          aggregateId: applicationId,
          aggregateVersion: 1,
          occurredAt: nowIso,
          data: {
            application_id: applicationId,
            service_id: row.service_id,
            state: 'DRAFT',
            aggregate_version: 1,
            tenant_service_binding_id: pins.tenant_service_binding_id,
            workflow_version_id: pins.workflow_version_id,
            pin_graph_hash: row.pin_graph_hash,
            authz_decision_id: authz.decisionId,
            authz_policy_revision: authz.policyRevision,
          },
        }),
        TOPIC_DOMAIN,
      );
      await tx.insertOutbox(
        auditEnvelope(ctx, {
          action: 'APPLICATION_CREATE_DRAFT',
          actionClass: 'WRITE',
          resourceId: applicationId,
          result: 'SUCCESS',
          occurredAt: nowIso,
          afterRef: `case_transition:${transition.transition_id}`,
        }),
        TOPIC_AUDIT,
      );
      const response: StoredResponse = {
        status: 201,
        body: {
          application: caseView(row),
          version_pinning: versionPinningRecord({
            tenantId: ctx.tenant_id,
            applicationId,
            pins,
            policyRevision: authz.policyRevision,
            decisionId: authz.decisionId,
          }),
        },
      };
      await tx.completeIdempotency({ ...ref, response });
      return { response };
    });
    if ('replay' in outcome) return { ...outcome.replay, replayed: true };
    return { ...outcome.response, replayed: false };
  }

  async executeCommand(
    rawCtx: unknown,
    rawApplicationId: unknown,
    rawBody: unknown,
    rawKey: unknown,
  ): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const applicationId = requireId(rawApplicationId, '/application_id');
    const key = parseIdempotencyKey(rawKey);
    const input = parseCommandBody(rawBody);
    assertDecisionBoundary(ctx.actor, input.decision, DECISION_COMMANDS.has(input.command));

    const ref: IdempotencyKeyRef = { principalId: ctx.actor.id, endpoint: ENDPOINTS.command, key };
    const fingerprint = sha256Of({ applicationId, ...input });

    const pre = await this.domainTx(ctx, async (tx) => ({
      row: await tx.getCase(applicationId),
      idem: await tx.lookupIdempotency(ref),
      request: input.request_id ? await tx.getRequest(input.request_id) : null,
    }));
    if (!pre.row) throw new Cmp015Error('SF-SYS-002');
    const before = pre.row;

    const pipeline = new CommandPipeline({
      tenantId: ctx.tenant_id,
      applicationId,
      commandType: input.command,
      idempotencyKey: key,
      correlationId: ctx.correlation_id,
    });
    const authz = await this.authorize(
      ctx,
      `APPLICATION_${input.command}`,
      this.resourceOf(before),
    );
    pipeline.authorized(authz.decisionId, authz.policyRevision);

    if (pre.idem.state !== 'absent' && pre.idem.fingerprint !== fingerprint) {
      throw new Cmp015Error('SF-APP-002');
    }
    if (pre.idem.state === 'completed') return { ...pre.idem.response, replayed: true };

    this.assertPinIntegrity(before);
    if (pre.request && pre.request.application_id !== applicationId) {
      throw new Cmp015Error('SF-SYS-002', { details: detail('REQUEST_NOT_FOUND', '/request_id') });
    }
    const preConstruct =
      pre.request && pre.request.consumed_at_version === null
        ? { kind: pre.request.kind, status: pre.request.status }
        : null;
    const prePlan = planTransition({
      command: input.command,
      expectedState: input.expected_state,
      expectedVersion: input.expected_version,
      currentState: before.state,
      currentVersion: before.aggregate_version,
      requestConstruct: preConstruct,
    });
    let policyRef: string | null = null;
    if (requestKindFor(prePlan.def.cls)) {
      const decision = await this.ports.servicePolicy.evaluateTransition({
        tenant_id: ctx.tenant_id,
        application_id: applicationId,
        transition_key: prePlan.def.key,
        from_state: prePlan.def.from,
        pins: before.pins,
      });
      if (decision.permitted !== true) {
        throw new Cmp015Error('SF-APP-001', { details: detail('SERVICE_POLICY_DENIED') });
      }
      policyRef = decision.policy_ref;
    }
    pipeline.validated(before.state, before.pins);

    const now = this.clock();
    const nowIso = now.toISOString();
    const outcome = await this.domainTx(ctx, async (tx) => {
      pipeline.domainTxnOpened();
      const claim = await tx.claimIdempotency({ ...ref, fingerprint, now });
      if (claim !== 'claimed') return { replay: claim };
      const locked = await tx.getCase(applicationId, { forUpdate: true });
      if (!locked) throw new Cmp015Error('SF-SYS-002');
      if (locked.pin_graph_hash !== before.pin_graph_hash) {
        throw new Cmp015Error('SF-APP-001', { details: detail('SILENT_REPOINT_FORBIDDEN') });
      }
      const lockedRequest = input.request_id
        ? await tx.getRequest(input.request_id, { forUpdate: true })
        : null;
      const plan = planTransition({
        command: input.command,
        expectedState: input.expected_state,
        expectedVersion: input.expected_version,
        currentState: locked.state,
        currentVersion: locked.aggregate_version,
        requestConstruct:
          lockedRequest &&
          lockedRequest.application_id === applicationId &&
          lockedRequest.consumed_at_version === null
            ? { kind: lockedRequest.kind, status: lockedRequest.status }
            : null,
      });
      const kind = requestKindFor(plan.def.cls);
      if (kind && lockedRequest) {
        const consumed = await tx.consumeRequest({
          requestId: lockedRequest.request_id,
          atVersion: plan.toVersion,
          updatedAt: nowIso,
          correlationId: ctx.correlation_id,
        });
        if (!consumed)
          throw new Cmp015Error('SF-APP-001', { details: detail('REQUEST_NOT_COMMITTED') });
      }
      const updated = await tx.updateCaseState({
        applicationId,
        fromState: plan.def.from,
        toState: plan.def.to,
        fromVersion: plan.fromVersion,
        updatedAt: nowIso,
        submittedAt: plan.def.to === 'SUBMITTED' ? nowIso : null,
        correlationId: ctx.correlation_id,
      });
      if (!updated)
        throw new Cmp015Error('SF-APP-001', {
          details: detail('STALE_VERSION', '/expected_version'),
        });
      const transition: TransitionRow = {
        transition_id: randomUUID(),
        tenant_id: ctx.tenant_id,
        application_id: applicationId,
        command: plan.def.command,
        from_state: plan.def.from,
        to_state: plan.def.to,
        transition_key: plan.def.key,
        transition_class: plan.def.cls,
        aggregate_version: plan.toVersion,
        idempotency_key: key,
        authz_decision_id: authz.decisionId,
        authz_policy_revision: authz.policyRevision,
        correlation_id: ctx.correlation_id,
        actor_type: ctx.actor.type,
        actor_id: ctx.actor.id,
        reason_code: input.reason_code,
        request_id: kind ? (lockedRequest?.request_id ?? null) : null,
        policy_ref: policyRef,
        occurred_at: nowIso,
      };
      await tx.insertTransition(transition);
      pipeline.caseMutated();

      const after: CaseRow = {
        ...locked,
        state: plan.def.to,
        aggregate_version: plan.toVersion,
        updated_at: nowIso,
        submitted_at: plan.def.to === 'SUBMITTED' ? nowIso : locked.submitted_at,
        last_correlation_id: ctx.correlation_id,
      };
      const data: Record<string, unknown> = {
        application_id: applicationId,
        command: plan.def.command,
        from_state: plan.def.from,
        to_state: plan.def.to,
        transition_key: plan.def.key,
        transition_class: plan.def.cls,
        aggregate_version: plan.toVersion,
        authz_decision_id: authz.decisionId,
        authz_policy_revision: authz.policyRevision,
        tenant_service_binding_id: locked.pins.tenant_service_binding_id,
        workflow_version_id: locked.pins.workflow_version_id,
      };
      if (transition.request_id) data['request_id'] = transition.request_id;
      if (input.reason_code) data['reason_code'] = input.reason_code;
      if (input.decision) {
        data['decision_maker'] = input.decision.decision_maker;
        data['ai_assisted'] = input.decision.ai_assisted === true;
      }
      await tx.insertOutbox(
        envelopeOf({
          eventType: EVENT_TYPES.stateChanged,
          ctx,
          aggregateId: applicationId,
          aggregateVersion: plan.toVersion,
          occurredAt: nowIso,
          data,
        }),
        TOPIC_DOMAIN,
      );
      const isDecision = DECISION_COMMANDS.has(plan.def.command) || kind !== null;
      await tx.insertOutbox(
        auditEnvelope(ctx, {
          action: `APPLICATION_${plan.def.command}`,
          actionClass: isDecision ? 'DECISION' : 'WRITE',
          resourceId: applicationId,
          result: 'SUCCESS',
          occurredAt: nowIso,
          ...(isDecision ? { reason: input.reason_code ?? plan.def.command } : {}),
          afterRef: `case_transition:${transition.transition_id}`,
        }),
        TOPIC_AUDIT,
      );
      pipeline.outboxWritten();
      const response: StoredResponse = {
        status: 200,
        body: { application: caseView(after), transition: transitionView(transition) },
      };
      await tx.completeIdempotency({ ...ref, response });
      return { response, plan, transition };
    });
    if ('replay' in outcome) return { ...outcome.replay, replayed: true };

    const receipt = pipeline.committed(outcome.plan.toVersion);
    const workflowAdvance = await this.gate.advance(pipeline, receipt, {
      to_state: outcome.plan.def.to,
      transition_key: outcome.plan.def.key,
      workflow_version_id: before.pins.workflow_version_id,
      idempotency_key: `${applicationId}:${outcome.plan.toVersion}`,
      correlation_id: ctx.correlation_id,
    });
    return {
      status: outcome.response.status,
      body: {
        ...(outcome.response.body as Record<string, unknown>),
        workflow_advance: workflowAdvance,
        command_transition: pipeline.record(),
      },
      replayed: false,
    };
  }

  async registerRequest(
    rawCtx: unknown,
    rawApplicationId: unknown,
    rawBody: unknown,
    rawKey: unknown,
  ): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const applicationId = requireId(rawApplicationId, '/application_id');
    const key = parseIdempotencyKey(rawKey);
    const body = requireBody(rawBody);
    assertOnlyKeys(body, ['kind', 'workflow_ref']);
    if (body['kind'] !== 'WITHDRAWAL' && body['kind'] !== 'CANCELLATION') {
      throw new Cmp015Error('SF-SYS-003', { details: detail('REQUEST_KIND_INVALID', '/kind') });
    }
    const kind: RequestKind = body['kind'];
    const workflowRef = body['workflow_ref'];
    if (
      workflowRef !== undefined &&
      (typeof workflowRef !== 'string' || workflowRef.length < 1 || workflowRef.length > 200)
    ) {
      throw new Cmp015Error('SF-SYS-003', {
        details: detail('WORKFLOW_REF_INVALID', '/workflow_ref'),
      });
    }

    const pre = await this.domainTx(ctx, (tx) => tx.getCase(applicationId));
    if (!pre) throw new Cmp015Error('SF-SYS-002');
    const authz = await this.authorize(ctx, `APPLICATION_REQUEST_${kind}`, this.resourceOf(pre));

    const ref: IdempotencyKeyRef = { principalId: ctx.actor.id, endpoint: ENDPOINTS.request, key };
    const fingerprint = sha256Of({ applicationId, kind, workflowRef: workflowRef ?? null });
    const now = this.clock();
    const nowIso = now.toISOString();
    const outcome = await this.domainTx(ctx, async (tx) => {
      const claim = await tx.claimIdempotency({ ...ref, fingerprint, now });
      if (claim !== 'claimed') return { replay: claim };
      const locked = await tx.getCase(applicationId, { forUpdate: true });
      if (!locked) throw new Cmp015Error('SF-SYS-002');
      if (!requestSources(kind).includes(locked.state)) {
        throw new Cmp015Error('SF-APP-001', {
          details: detail('REQUEST_NOT_AVAILABLE_IN_STATE', '/kind'),
        });
      }
      const row: RequestRow = {
        request_id: randomUUID(),
        tenant_id: ctx.tenant_id,
        application_id: applicationId,
        kind,
        status: 'SUBMITTED',
        workflow_ref: typeof workflowRef === 'string' ? workflowRef : null,
        status_reason_code: null,
        case_state_at_request: locked.state,
        consumed_at_version: null,
        created_by: ctx.actor.id,
        created_at: nowIso,
        updated_at: nowIso,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.insertRequest(row);
      await tx.insertOutbox(
        envelopeOf({
          eventType: EVENT_TYPES.requestRecorded,
          ctx,
          aggregateType: 'ApplicationCaseRequest',
          aggregateId: row.request_id,
          aggregateVersion: 1,
          occurredAt: nowIso,
          data: {
            request_id: row.request_id,
            application_id: applicationId,
            kind,
            status: row.status,
            case_state: locked.state,
            case_aggregate_version: locked.aggregate_version,
            authz_decision_id: authz.decisionId,
            authz_policy_revision: authz.policyRevision,
          },
        }),
        TOPIC_DOMAIN,
      );
      await tx.insertOutbox(
        auditEnvelope(ctx, {
          action: `APPLICATION_REQUEST_${kind}`,
          actionClass: 'WRITE',
          resourceId: applicationId,
          result: 'SUCCESS',
          occurredAt: nowIso,
          afterRef: `case_request_reference:${row.request_id}`,
        }),
        TOPIC_AUDIT,
      );
      const response: StoredResponse = {
        status: 201,
        body: { request: requestView(row), application: caseView(locked) },
      };
      await tx.completeIdempotency({ ...ref, response });
      return { response };
    });
    if ('replay' in outcome) return { ...outcome.replay, replayed: true };
    return { ...outcome.response, replayed: false };
  }

  async updateRequestStatus(
    rawCtx: unknown,
    rawApplicationId: unknown,
    rawRequestId: unknown,
    rawBody: unknown,
    rawKey: unknown,
  ): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const applicationId = requireId(rawApplicationId, '/application_id');
    const requestId = requireId(rawRequestId, '/request_id');
    const key = parseIdempotencyKey(rawKey);
    const body = requireBody(rawBody);
    assertOnlyKeys(body, ['status', 'expected_status', 'reason_code', 'decision']);
    const isStatus = (v: unknown): v is RequestStatus =>
      (REQUEST_STATUSES as readonly unknown[]).includes(v);
    if (!isStatus(body['status']) || body['status'] === 'SUBMITTED') {
      throw new Cmp015Error('SF-SYS-003', { details: detail('REQUEST_STATUS_INVALID', '/status') });
    }
    if (!isStatus(body['expected_status'])) {
      throw new Cmp015Error('SF-SYS-003', {
        details: detail('EXPECTED_STATUS_INVALID', '/expected_status'),
      });
    }
    const status = body['status'];
    const expectedStatus = body['expected_status'];
    const reasonCode = optionalCode(body['reason_code'], '/reason_code');
    const decision = parseDecision(body['decision']);
    const isDecision = status === 'COMMITTED' || status === 'REJECTED';
    assertDecisionBoundary(ctx.actor, decision, isDecision);

    const pre = await this.domainTx(ctx, async (tx) => ({
      row: await tx.getCase(applicationId),
      request: await tx.getRequest(requestId),
    }));
    if (!pre.row || !pre.request || pre.request.application_id !== applicationId) {
      throw new Cmp015Error('SF-SYS-002');
    }
    const authz = await this.authorize(
      ctx,
      `APPLICATION_REQUEST_${status}`,
      this.resourceOf(pre.row),
    );

    const ref: IdempotencyKeyRef = {
      principalId: ctx.actor.id,
      endpoint: ENDPOINTS.requestStatus,
      key,
    };
    const fingerprint = sha256Of({
      applicationId,
      requestId,
      status,
      expectedStatus,
      reasonCode,
      decision,
    });
    const now = this.clock();
    const nowIso = now.toISOString();
    const outcome = await this.domainTx(ctx, async (tx) => {
      const claim = await tx.claimIdempotency({ ...ref, fingerprint, now });
      if (claim !== 'claimed') return { replay: claim };
      const locked = await tx.getRequest(requestId, { forUpdate: true });
      if (!locked || locked.application_id !== applicationId) throw new Cmp015Error('SF-SYS-002');
      if (locked.status !== expectedStatus) {
        throw new Cmp015Error('SF-APP-001', {
          details: detail('STALE_REQUEST_STATUS', '/expected_status'),
        });
      }
      if (!isRequestStatusChangeLegal(locked.status, status)) {
        throw new Cmp015Error('SF-APP-001', {
          details: detail('ILLEGAL_REQUEST_STATUS_CHANGE', '/status'),
        });
      }
      const ok = await tx.updateRequestStatus({
        requestId,
        fromStatus: locked.status,
        toStatus: status,
        reasonCode,
        updatedAt: nowIso,
        correlationId: ctx.correlation_id,
      });
      if (!ok) throw new Cmp015Error('SF-APP-001', { details: detail('STALE_REQUEST_STATUS') });
      const after: RequestRow = {
        ...locked,
        status,
        status_reason_code: reasonCode,
        updated_at: nowIso,
        last_correlation_id: ctx.correlation_id,
      };
      const data: Record<string, unknown> = {
        request_id: requestId,
        application_id: applicationId,
        kind: locked.kind,
        from_status: locked.status,
        to_status: status,
        authz_decision_id: authz.decisionId,
        authz_policy_revision: authz.policyRevision,
      };
      if (reasonCode) data['reason_code'] = reasonCode;
      if (decision) data['decision_maker'] = decision.decision_maker;
      await tx.insertOutbox(
        envelopeOf({
          eventType: EVENT_TYPES.requestStatusChanged,
          ctx,
          aggregateType: 'ApplicationCaseRequest',
          aggregateId: requestId,
          aggregateVersion: locked.status === 'SUBMITTED' ? 2 : 3,
          occurredAt: nowIso,
          data,
        }),
        TOPIC_DOMAIN,
      );
      await tx.insertOutbox(
        auditEnvelope(ctx, {
          action: `APPLICATION_REQUEST_${status}`,
          actionClass: isDecision ? 'DECISION' : 'WRITE',
          resourceId: applicationId,
          result: 'SUCCESS',
          occurredAt: nowIso,
          ...(isDecision ? { reason: reasonCode ?? `REQUEST_${status}` } : {}),
          afterRef: `case_request_reference:${requestId}`,
        }),
        TOPIC_AUDIT,
      );
      const response: StoredResponse = { status: 200, body: { request: requestView(after) } };
      await tx.completeIdempotency({ ...ref, response });
      return { response };
    });
    if ('replay' in outcome) return { ...outcome.replay, replayed: true };
    return { ...outcome.response, replayed: false };
  }

  async getApplication(rawCtx: unknown, rawApplicationId: unknown): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const applicationId = requireId(rawApplicationId, '/application_id');
    const row = await this.domainTx(ctx, (tx) => tx.getCase(applicationId));
    if (!row) throw new Cmp015Error('SF-SYS-002');
    await this.authorize(ctx, 'APPLICATION_READ', this.resourceOf(row));
    return { status: 200, body: { application: caseView(row) }, replayed: false };
  }

  async listTransitions(rawCtx: unknown, rawApplicationId: unknown): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const applicationId = requireId(rawApplicationId, '/application_id');
    const found = await this.domainTx(ctx, async (tx) => {
      const row = await tx.getCase(applicationId);
      return row ? { row, transitions: await tx.listTransitions(applicationId) } : null;
    });
    if (!found) throw new Cmp015Error('SF-SYS-002');
    await this.authorize(ctx, 'APPLICATION_TRANSITIONS_READ', this.resourceOf(found.row));
    return {
      status: 200,
      body: { application_id: applicationId, transitions: found.transitions.map(transitionView) },
      replayed: false,
    };
  }
}
