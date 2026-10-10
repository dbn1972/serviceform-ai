import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import {
  authorize,
  authzInput,
  NOTIFICATION_ACTIONS,
  type AuthorizationPort,
  type NotificationAction,
} from '../authz.js';
import { DEFAULT_MAX_ATTEMPTS, type DeploymentEnvironment } from '../domain/model.js';
import {
  assertBindingPolicy,
  buildSimulationMarker,
  type ConnectorBindingView,
} from '../domain/simulation.js';
import { assertTemplateDefinition, renderTemplate } from '../domain/template.js';
import { Cmp025Error, detail } from '../errors.js';
import { NoopLogger, type SafeLogger } from '../logging.js';
import { envelopeOf, TOPIC_DOMAIN, type DomainEventType } from '../outbox.js';
import type { ChannelConnectorRegistry } from '../ports/channel-connector.js';
import type { ConnectorBindingPort } from '../ports/connector-binding-port.js';
import type { RecipientDirectoryPort } from '../ports/recipient-directory-port.js';
import type {
  DispatchRow,
  NotificationRepository,
  NotificationTx,
  TemplateRow,
} from '../repo/types.js';
import type { TenantContext } from '../types.js';
import type { DispatchInput, PublishTemplateInput, ReceiptInput } from './input.js';
import { dispatchView, templateView } from './view.js';

export interface NotificationServiceDeps {
  repo: NotificationRepository;
  authorizer: AuthorizationPort;
  bindings: ConnectorBindingPort;
  recipients: RecipientDirectoryPort;
  connectors: ChannelConnectorRegistry;
  /** Deployment environment of this runtime; a binding for another environment is refused. */
  environment: DeploymentEnvironment;
  /** Required to mint a SimulationMarker; absent outside simulation environments. */
  testRunId?: string;
  clock: () => Date;
  logger?: SafeLogger;
  sendTimeoutMs?: number;
  workerId?: string;
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

export class NotificationService {
  readonly logger: SafeLogger;

  constructor(readonly deps: NotificationServiceDeps) {
    this.logger = deps.logger ?? new NoopLogger();
  }

  async guard(
    ctx: TenantContext,
    action: NotificationAction,
    resourceType: 'NotificationDispatch' | 'NotificationTemplate',
    applicationId?: string,
  ): Promise<void> {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp025Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    await authorize(this.deps.authorizer, authzInput(ctx, action, resourceType, applicationId));
  }

  assertActor(ctx: TenantContext, allowed: ActorType[]): void {
    if (!allowed.includes(ctx.actor.type)) {
      throw new Cmp025Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
    }
  }

  /** Resolves and validates the connector binding outside any transaction (INT-013, fail-closed). */
  async resolveBinding(
    tenantId: string,
    bindingId: string,
    channel: DispatchInput['channel'],
  ): Promise<ConnectorBindingView> {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp025Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    let raw: ConnectorBindingView | null;
    try {
      raw = await this.deps.bindings.resolve(tenantId, bindingId);
    } catch (err) {
      if (err instanceof Cmp025Error) throw err;
      throw new Cmp025Error('SF-INT-001', detail('CONNECTOR_BINDING_UNAVAILABLE'));
    }
    const binding = assertBindingPolicy(raw, {
      tenantId,
      channel,
      runtimeEnvironment: this.deps.environment,
    });
    if (binding.connector_binding_id !== bindingId) {
      throw new Cmp025Error('SF-INT-001', detail('CONNECTOR_BINDING_MISMATCH'));
    }
    return binding;
  }

  private async idempotent(
    ctx: TenantContext,
    idem: Idempotency,
    fn: (tx: NotificationTx, now: Date) => Promise<CommandResult>,
  ): Promise<CommandResult> {
    const now = this.deps.clock();
    return this.deps.repo.withTx(ctx, async (tx) => {
      const claim = await tx.claimIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        fingerprint: idem.fingerprint,
        now,
      });
      if (claim !== 'claimed') return claim;
      const result = await fn(tx, now);
      await tx.completeIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        status: result.status,
        body: result.body,
      });
      return result;
    });
  }

  async emitDispatchEvent(
    tx: NotificationTx,
    ctx: TenantContext,
    row: DispatchRow,
    eventType: DomainEventType,
  ): Promise<void> {
    const env = envelopeOf({
      eventType,
      tenantId: ctx.tenant_id,
      cellId: ctx.cell_id,
      aggregateType: 'NotificationDispatch',
      aggregateId: row.dispatch_id,
      aggregateVersion: row.aggregate_version,
      occurredAt: row.updated_at,
      correlationId: ctx.correlation_id,
      actor: ctx.actor,
      data: {
        dispatch_id: row.dispatch_id,
        application_id: row.application_id,
        status: row.status,
        channel: row.channel,
        template_ref: row.template_ref,
        template_version: row.template_version,
        recipient_handle_class: row.recipient_handle_class,
        connector_mode: row.connector_mode,
        simulated: row.connector_mode === 'SIMULATED',
        attempts: row.attempts,
        error_code: row.last_error_code,
      },
    });
    await tx.insertOutbox(env, TOPIC_DOMAIN);
  }

  async dispatch(
    ctx: TenantContext,
    input: DispatchInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    this.assertActor(ctx, ['OFFICER', 'SYSTEM', 'INTEGRATION']);
    await this.guard(
      ctx,
      NOTIFICATION_ACTIONS.dispatch,
      'NotificationDispatch',
      input.application_id ?? undefined,
    );
    const binding = await this.resolveBinding(
      ctx.tenant_id,
      input.connector_binding_id,
      input.channel,
    );
    const marker = buildSimulationMarker(binding, input.channel, this.deps.testRunId);
    if (this.deps.connectors.forBinding(binding) === null) {
      throw new Cmp025Error('SF-INT-001', detail('CONNECTOR_NOT_BOUND'));
    }
    const result = await this.idempotent(ctx, idem, async (tx, now) => {
      const template = await tx.getTemplate(
        input.template_ref,
        input.channel,
        input.locale,
        input.template_version ?? undefined,
      );
      if (!template) throw new Cmp025Error('SF-SYS-002', detail('TEMPLATE_NOT_FOUND'));
      renderTemplate(template, input.template_params);
      const nowIso = now.toISOString();
      const row: DispatchRow = {
        tenant_id: ctx.tenant_id,
        dispatch_id: randomUUID(),
        application_id: input.application_id,
        cell_id: ctx.cell_id,
        template_ref: input.template_ref,
        template_version: template.template_version,
        channel: input.channel,
        locale: input.locale,
        recipient_handle_class: input.recipient_handle_class,
        recipient_handle_ref: input.recipient_handle_ref,
        template_params: input.template_params,
        connector_binding_id: binding.connector_binding_id,
        connector_mode: binding.mode,
        connector_environment: binding.environment,
        connector_critical: binding.critical,
        simulation_marker: marker,
        status: 'QUEUED',
        attempts: 0,
        max_attempts: DEFAULT_MAX_ATTEMPTS,
        next_attempt_at: nowIso,
        lease_owner: null,
        lease_expires_at: null,
        provider_message_ref: null,
        last_error_code: null,
        idempotency_key: idem.key,
        requested_by: ctx.actor.id,
        requested_at: nowIso,
        sent_at: null,
        delivered_at: null,
        correlation_id: ctx.correlation_id,
        aggregate_version: 1,
        created_at: nowIso,
        updated_at: nowIso,
      };
      await tx.insertDispatch(row);
      await this.emitDispatchEvent(tx, ctx, row, 'NotificationQueued');
      await appendAudit(tx, ctx, {
        action: 'NOTIFICATION_DISPATCH',
        actionClass: 'WRITE',
        resourceType: 'NotificationDispatch',
        resourceId: row.dispatch_id,
        result: 'SUCCESS',
        now,
      });
      return { status: 202, body: dispatchView(row) };
    });
    this.logger.info({
      event: 'notification.dispatch.accepted',
      tenant_id: ctx.tenant_id,
      correlation_id: ctx.correlation_id,
      channel: input.channel,
      connector_mode: binding.mode,
      status: String((result.body as { status?: string }).status ?? 'QUEUED'),
    });
    return result;
  }

  async get(ctx: TenantContext, dispatchId: string): Promise<CommandResult> {
    this.assertActor(ctx, ['OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN']);
    await this.guard(ctx, NOTIFICATION_ACTIONS.read, 'NotificationDispatch');
    return this.deps.repo.withTx(ctx, async (tx) => {
      const row = await tx.getDispatch(dispatchId);
      if (!row) throw new Cmp025Error('SF-SYS-002');
      return { status: 200, body: dispatchView(row, await tx.listAttempts(dispatchId)) };
    });
  }

  async recordReceipt(
    ctx: TenantContext,
    dispatchId: string,
    input: ReceiptInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    this.assertActor(ctx, ['INTEGRATION']);
    await this.guard(ctx, NOTIFICATION_ACTIONS.recordReceipt, 'NotificationDispatch');
    return this.idempotent(ctx, idem, async (tx, now) => {
      const existing = await tx.getDispatch(dispatchId);
      if (!existing) throw new Cmp025Error('SF-SYS-002');
      if (existing.status !== 'SENT') {
        throw new Cmp025Error('SF-APP-001', detail('ILLEGAL_TRANSITION'));
      }
      if (existing.provider_message_ref !== input.provider_message_ref) {
        throw new Cmp025Error(
          'SF-SYS-003',
          detail('PROVIDER_REF_MISMATCH', '/provider_message_ref'),
        );
      }
      const nowIso = now.toISOString();
      const row: DispatchRow = {
        ...existing,
        status: input.outcome,
        delivered_at: input.outcome === 'DELIVERED' ? nowIso : null,
        aggregate_version: existing.aggregate_version + 1,
        updated_at: nowIso,
      };
      await tx.updateDispatch(row);
      await this.emitDispatchEvent(
        tx,
        ctx,
        row,
        input.outcome === 'DELIVERED' ? 'NotificationDelivered' : 'NotificationUndelivered',
      );
      await appendAudit(tx, ctx, {
        action: 'NOTIFICATION_RECEIPT_RECORD',
        actionClass: 'WRITE',
        resourceType: 'NotificationDispatch',
        resourceId: row.dispatch_id,
        result: 'SUCCESS',
        now,
      });
      return { status: 200, body: dispatchView(row) };
    });
  }

  async publishTemplate(
    ctx: TenantContext,
    input: PublishTemplateInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    this.assertActor(ctx, ['OFFICER', 'PRIVILEGED_ADMIN']);
    await this.guard(ctx, NOTIFICATION_ACTIONS.publishTemplate, 'NotificationTemplate');
    assertTemplateDefinition(input);
    return this.idempotent(ctx, idem, async (tx, now) => {
      const latest = await tx.getTemplate(input.template_ref, input.channel, input.locale);
      const nowIso = now.toISOString();
      const row: TemplateRow = {
        template_ref: input.template_ref,
        template_version: (latest?.template_version ?? 0) + 1,
        channel: input.channel,
        locale: input.locale,
        subject_template: input.subject_template,
        body_template: input.body_template,
        allowed_params: input.allowed_params,
        published_by: ctx.actor.id,
        published_at: nowIso,
        correlation_id: ctx.correlation_id,
      };
      await tx.insertTemplate(row);
      const env = envelopeOf({
        eventType: 'NotificationTemplatePublished',
        tenantId: ctx.tenant_id,
        cellId: ctx.cell_id,
        aggregateType: 'NotificationTemplate',
        aggregateId: randomUUID(),
        aggregateVersion: row.template_version,
        occurredAt: nowIso,
        correlationId: ctx.correlation_id,
        actor: ctx.actor,
        data: {
          template_ref: row.template_ref,
          template_version: row.template_version,
          channel: row.channel,
          locale: row.locale,
        },
      });
      await tx.insertOutbox(env, TOPIC_DOMAIN);
      await appendAudit(tx, ctx, {
        action: 'NOTIFICATION_TEMPLATE_PUBLISH',
        actionClass: 'WRITE',
        resourceType: 'NotificationTemplate',
        resourceId: `${row.template_ref}@${String(row.template_version)}`,
        result: 'SUCCESS',
        now,
      });
      return { status: 201, body: templateView(row) };
    });
  }

  async listTemplateVersions(ctx: TenantContext, templateRef: string): Promise<CommandResult> {
    this.assertActor(ctx, ['OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN']);
    await this.guard(ctx, NOTIFICATION_ACTIONS.readTemplate, 'NotificationTemplate');
    return this.deps.repo.withTx(ctx, async (tx) => {
      const rows = await tx.listTemplateVersions(templateRef);
      if (rows.length === 0) throw new Cmp025Error('SF-SYS-002');
      return { status: 200, body: { template_ref: templateRef, versions: rows.map(templateView) } };
    });
  }
}
