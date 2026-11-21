import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestContext } from '@serviceform/contracts';
import type pg from 'pg';

/**
 * SAMPLE_LAB CMP-025/026 journey notifications (SF-55). Composition only:
 * SIMULATED SMS channel (same QUEUED→SENT state machine as REAL), official-notice
 * thread via CMP-026 SIM adapters. REAL SMS remains owner-held.
 * Catalogue mirrors packages/m10-sample-lab + fixtures/lab/platform/notification-catalogue.json.
 * CERTIFIED=false. G6=false.
 */

export type JourneyNotifyTrigger =
  | 'DEFICIENCY_OPENED'
  | 'DEFICIENCY_CLOSED'
  | 'APPLICATION_APPROVED'
  | 'APPLICATION_REJECTED'
  | 'CREDENTIAL_ISSUED';

export type LabNotificationTemplate = {
  template_ref: string;
  trigger: JourneyNotifyTrigger;
  subject_template: string | null;
  body_template: string;
  allowed_params: readonly string[];
};

export type LabNotificationCatalogue = {
  simulation: 'SIMULATED';
  locale: string;
  channel: 'SMS';
  sms_binding_id: string;
  recipient_handle_class: 'CITIZEN_HANDLE_REF';
  recipient_handle_ref: string;
  simulator_version: string;
  workload: {
    publisher_actor_id: string;
    publisher_roles: readonly string[];
    worker_actor_id: string;
    worker_roles: readonly string[];
  };
  templates: readonly LabNotificationTemplate[];
};

/** Fail-closed defaults — must stay aligned with fixtures/lab/platform/notification-catalogue.json. */
export const LAB_NOTIFY_DEFAULTS: LabNotificationCatalogue = {
  simulation: 'SIMULATED',
  locale: 'en-IN',
  channel: 'SMS',
  sms_binding_id: '0d15ba00-0c25-4000-8000-0d15ba000c25',
  recipient_handle_class: 'CITIZEN_HANDLE_REF',
  recipient_handle_ref: 'sample-lab.citizen.handle',
  simulator_version: 'sample-lab-notify-sim-1',
  workload: {
    publisher_actor_id: '0d15ba00-0025-4000-8000-0d15ba00025a',
    publisher_roles: ['SAMPLE_LAB_NOTIFY_OPERATOR'],
    worker_actor_id: '0d15ba00-0025-4000-8000-0d15ba00025b',
    worker_roles: ['SAMPLE_LAB_NOTIFY_WORKER'],
  },
  templates: [
    {
      template_ref: 'sample-lab.deficiency.opened.v1',
      trigger: 'DEFICIENCY_OPENED',
      subject_template: null,
      body_template:
        'Action needed on application {{application_ref}}. Additional documents requested. Open your portal to respond.',
      allowed_params: ['application_ref'],
    },
    {
      template_ref: 'sample-lab.deficiency.closed.v1',
      trigger: 'DEFICIENCY_CLOSED',
      subject_template: null,
      body_template:
        'Deficiency closed for application {{application_ref}}. Processing will continue.',
      allowed_params: ['application_ref'],
    },
    {
      template_ref: 'sample-lab.decision.approved.v1',
      trigger: 'APPLICATION_APPROVED',
      subject_template: null,
      body_template:
        'Decision recorded for application {{application_ref}}: approved. Credential issuance may follow.',
      allowed_params: ['application_ref'],
    },
    {
      template_ref: 'sample-lab.decision.rejected.v1',
      trigger: 'APPLICATION_REJECTED',
      subject_template: null,
      body_template:
        'Decision recorded for application {{application_ref}}: not approved. Check your portal for next steps.',
      allowed_params: ['application_ref'],
    },
    {
      template_ref: 'sample-lab.credential.issued.v1',
      trigger: 'CREDENTIAL_ISSUED',
      subject_template: null,
      body_template:
        'Credential issued for application {{application_ref}}. Available in your portal and DigiLocker (SIMULATED).',
      allowed_params: ['application_ref'],
    },
  ],
};

const BY_TRIGGER = new Map(LAB_NOTIFY_DEFAULTS.templates.map((t) => [t.trigger, t] as const));

export function templateForTrigger(
  trigger: JourneyNotifyTrigger,
): LabNotificationTemplate | undefined {
  return BY_TRIGGER.get(trigger);
}

export function deficiencyKindToTrigger(
  kind: 'DEFICIENCY_OPENED' | 'DEFICIENCY_RESPONDED' | 'DEFICIENCY_CLOSED',
): JourneyNotifyTrigger | null {
  if (kind === 'DEFICIENCY_OPENED') return 'DEFICIENCY_OPENED';
  if (kind === 'DEFICIENCY_CLOSED') return 'DEFICIENCY_CLOSED';
  return null;
}

type NotificationServiceLike = {
  publishTemplate(
    ctx: unknown,
    input: unknown,
    idem: { key: string; fingerprint: string; endpoint: string },
  ): Promise<{ status: number; body: unknown }>;
  dispatch(
    ctx: unknown,
    input: unknown,
    idem: { key: string; fingerprint: string; endpoint: string },
  ): Promise<{ status: number; body: unknown }>;
};

type DeliveryWorkerLike = {
  deliverDue(ctx: unknown, limit?: number): Promise<unknown>;
};

type MessagingServiceLike = {
  openThread(ctx: unknown, body: unknown, key: string): Promise<{ status: number; body: unknown }>;
  sendMessage(
    ctx: unknown,
    threadId: string,
    body: unknown,
    key: string,
  ): Promise<{ status: number; body: unknown }>;
};

type ConnectorBindingView = {
  connector_binding_id: string;
  tenant_id: string;
  connector_type: 'SMS' | 'EMAIL';
  mode: 'SIMULATED';
  environment: string;
  critical: boolean;
  secret_ref: null;
  simulator_version: string;
};

/** Lab fixture binding port (INT-013 SIMULATED SMS). */
export class LabNotificationBindings {
  constructor(
    private readonly catalogue: LabNotificationCatalogue,
    private readonly tenantId: string,
    private readonly environment: string,
  ) {}

  resolve(_tenantId: string, id: string): Promise<ConnectorBindingView | null> {
    if (id !== this.catalogue.sms_binding_id) return Promise.resolve(null);
    return Promise.resolve({
      connector_binding_id: this.catalogue.sms_binding_id,
      tenant_id: this.tenantId,
      connector_type: 'SMS',
      mode: 'SIMULATED',
      environment: this.environment,
      critical: true,
      secret_ref: null,
      simulator_version: this.catalogue.simulator_version,
    });
  }
}

/** Opaque handle → canary address (never logged by CMP-025). */
export class LabRecipientDirectory {
  constructor(
    private readonly catalogue: LabNotificationCatalogue,
    private readonly tenantId: string,
    private readonly canaryAddress = '+910000000000',
  ) {}

  resolve(lookup: { tenantId: string; handleRef: string }): Promise<{ address: string } | null> {
    if (lookup.tenantId !== this.tenantId) return Promise.resolve(null);
    if (lookup.handleRef !== this.catalogue.recipient_handle_ref) return Promise.resolve(null);
    return Promise.resolve({ address: this.canaryAddress });
  }
}

export function loadNotificationCatalogue(dir: string): LabNotificationCatalogue {
  try {
    const raw = JSON.parse(
      readFileSync(join(dir, 'notification-catalogue.json'), 'utf8'),
    ) as unknown;
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    if (
      obj['sms_binding_id'] !== LAB_NOTIFY_DEFAULTS.sms_binding_id ||
      obj['simulation'] !== 'SIMULATED'
    ) {
      return { ...LAB_NOTIFY_DEFAULTS };
    }
    return { ...LAB_NOTIFY_DEFAULTS };
  } catch {
    return { ...LAB_NOTIFY_DEFAULTS };
  }
}

export function notifyPublisherContext(
  catalogue: LabNotificationCatalogue,
  cellId: string,
  tenantId: string,
): RequestContext {
  const correlation_id = randomUUID();
  return {
    tenant_id: tenantId,
    cell_id: cellId,
    actor: { type: 'OFFICER', id: catalogue.workload.publisher_actor_id },
    roles: [...catalogue.workload.publisher_roles],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id,
    trace_id: correlation_id.replace(/-/g, ''),
  };
}

export function notifyWorkerContext(
  catalogue: LabNotificationCatalogue,
  cellId: string,
  tenantId: string,
): RequestContext {
  const correlation_id = randomUUID();
  return {
    tenant_id: tenantId,
    cell_id: cellId,
    actor: { type: 'SYSTEM', id: catalogue.workload.worker_actor_id },
    roles: [...catalogue.workload.worker_roles],
    jurisdiction_ids: [],
    auth_assurance: 'WORKLOAD_IDENTITY',
    correlation_id,
    trace_id: correlation_id.replace(/-/g, ''),
  };
}

function sha256Fingerprint(material: string): string {
  return `sha256:${createHash('sha256').update(material).digest('hex')}`;
}

function idem(endpoint: string, key: string, fingerprintMaterial: string) {
  return { key, fingerprint: sha256Fingerprint(fingerprintMaterial), endpoint };
}

function opaqueApplicationRef(applicationId: string): string {
  return `APP-${applicationId.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

export function journeyTriggerForCommand(command: string | null): JourneyNotifyTrigger | null {
  if (command === 'RECORD_APPROVED') return 'APPLICATION_APPROVED';
  if (command === 'RECORD_REJECTED') return 'APPLICATION_REJECTED';
  return null;
}

/**
 * Maps CMP-019 DeficiencyNotificationRequest → CMP-025 dispatch (post-commit).
 * Throws on hard failures so the reconciler can mark FAILED_RETRYABLE.
 */
export class LabDeficiencyNotificationPort {
  constructor(private readonly bridge: LabJourneyNotifyBridge) {}

  async requestNotification(request: {
    notification_port: 'M06_CMP025';
    tenant_id: string;
    application_id: string;
    deficiency_id: string;
    kind: 'DEFICIENCY_OPENED' | 'DEFICIENCY_RESPONDED' | 'DEFICIENCY_CLOSED';
    source_event_id: string;
  }): Promise<void> {
    const trigger = deficiencyKindToTrigger(request.kind);
    if (!trigger) return;
    await this.bridge.dispatchJourney({
      trigger,
      application_id: request.application_id,
      idempotency_key: `sample-lab.notify.def:${request.deficiency_id}:${request.kind}`,
      correlation_ref: request.source_event_id,
    });
  }
}

export class LabJourneyNotifyBridge {
  private seeded = false;
  private readonly threadByApplication = new Map<string, string>();

  constructor(
    private readonly notification: NotificationServiceLike,
    private readonly worker: DeliveryWorkerLike | null,
    private readonly messaging: MessagingServiceLike | null,
    private readonly catalogue: LabNotificationCatalogue,
    private readonly cellId: string,
    private readonly tenantId: string,
  ) {}

  publisherCtx(): RequestContext {
    return notifyPublisherContext(this.catalogue, this.cellId, this.tenantId);
  }

  workerCtx(): RequestContext {
    return notifyWorkerContext(this.catalogue, this.cellId, this.tenantId);
  }

  /** Idempotent publish of SAMPLE_LAB journey templates (fail-soft at lab start). */
  async ensureTemplatesPublished(): Promise<void> {
    if (this.seeded) return;
    const ctx = this.publisherCtx();
    for (const tpl of this.catalogue.templates) {
      await this.notification.publishTemplate(
        ctx,
        {
          template_ref: tpl.template_ref,
          channel: this.catalogue.channel,
          locale: this.catalogue.locale,
          subject_template: tpl.subject_template,
          body_template: tpl.body_template,
          allowed_params: [...tpl.allowed_params],
        },
        idem(
          'POST /v1/notification-templates',
          `sample-lab-tpl:${tpl.template_ref}`,
          `tpl:${tpl.template_ref}:${this.catalogue.channel}:${this.catalogue.locale}`,
        ),
      );
    }
    this.seeded = true;
  }

  /**
   * Dispatch journey SMS via CMP-025 then drain SIM delivery (fail-soft after accept).
   * Also posts a CMP-026 OFFICIAL_NOTICE when messaging is mounted (citizen_portal path).
   */
  async dispatchJourney(input: {
    trigger: JourneyNotifyTrigger;
    application_id: string;
    idempotency_key: string;
    correlation_ref?: string;
  }): Promise<{ dispatch_id: string | null; notification_ref: string }> {
    if (!this.seeded) {
      try {
        await this.ensureTemplatesPublished();
      } catch {
        // Seed retry on next event
      }
    }
    const tpl = templateForTrigger(input.trigger);
    if (!tpl) {
      return {
        dispatch_id: null,
        notification_ref: `lab-notify:missing-template:${input.trigger}`,
      };
    }
    const ctx = this.publisherCtx();
    const body = {
      application_id: input.application_id,
      template_ref: tpl.template_ref,
      channel: this.catalogue.channel,
      locale: this.catalogue.locale,
      recipient_handle_class: this.catalogue.recipient_handle_class,
      recipient_handle_ref: this.catalogue.recipient_handle_ref,
      connector_binding_id: this.catalogue.sms_binding_id,
      template_params: { application_ref: opaqueApplicationRef(input.application_id) },
    };
    const result = await this.notification.dispatch(
      ctx,
      body,
      idem('POST /v1/notifications', input.idempotency_key, `dispatch:${input.idempotency_key}`),
    );
    const dispatchId =
      typeof (result.body as { dispatch_id?: unknown })?.dispatch_id === 'string'
        ? String((result.body as { dispatch_id: string }).dispatch_id)
        : null;
    if (result.status !== 202 && result.status !== 200) {
      throw Object.assign(new Error('CMP-025 dispatch refused'), {
        code: 'SF-INT-001',
        statusCode: result.status,
      });
    }
    if (this.worker) {
      try {
        await this.worker.deliverDue(this.workerCtx(), 20);
      } catch {
        // Fail-soft: dispatch is durable QUEUED
      }
    }
    void this.postOfficialNotice(input.application_id, input.trigger, input.idempotency_key);
    return {
      dispatch_id: dispatchId,
      notification_ref: dispatchId
        ? `cmp025.dispatch:${dispatchId}`
        : `lab-notify:${input.trigger}:${input.application_id}`,
    };
  }

  /** Fail-soft CMP-026 OFFICIAL_NOTICE for the same journey event. */
  private async postOfficialNotice(
    applicationId: string,
    trigger: JourneyNotifyTrigger,
    idemKey: string,
  ): Promise<void> {
    if (!this.messaging) return;
    try {
      const ctx = this.publisherCtx();
      const openerRole = this.catalogue.workload.publisher_roles[0] ?? 'SAMPLE_LAB_NOTIFY_OPERATOR';
      let threadId = this.threadByApplication.get(applicationId);
      if (!threadId) {
        const opened = await this.messaging.openThread(
          ctx,
          {
            application_id: applicationId,
            subject_code: 'JOURNEY_NOTIFY',
            opener_role_code: openerRole,
            participants: [],
          },
          `sample-lab.thread:${applicationId}`,
        );
        const body = opened.body as { thread?: { thread_id?: string } };
        threadId = body.thread?.thread_id;
        if (!threadId || (opened.status !== 201 && opened.status !== 200)) return;
        this.threadByApplication.set(applicationId, threadId);
      }
      const tpl = templateForTrigger(trigger);
      const text = tpl
        ? tpl.body_template.replace('{{application_ref}}', opaqueApplicationRef(applicationId))
        : `Journey event ${trigger}`;
      await this.messaging.sendMessage(
        ctx,
        threadId,
        {
          kind: 'OFFICIAL_NOTICE',
          body: `[TEST/SIMULATED] ${text}`,
          ack_required: false,
        },
        `sample-lab.notice:${idemKey}`,
      );
    } catch {
      // Fail-soft
    }
  }

  /** After RECORD_APPROVED / RECORD_REJECTED — fail-soft so case response is never blocked. */
  async notifyAfterDecision(applicationId: string, command: string): Promise<void> {
    const kind = journeyTriggerForCommand(command);
    if (!kind) return;
    try {
      await this.dispatchJourney({
        trigger: kind,
        application_id: applicationId,
        idempotency_key: `sample-lab.notify.decision:${applicationId}:${kind}`,
      });
    } catch {
      // Fail-soft
    }
  }

  /** After credential ISSUED — returns notification_ref for CMP-022 downstream outcome. */
  async notifyCredentialIssued(
    applicationId: string,
    credentialId: string,
  ): Promise<{ notification_ref: string; dispatch_id: string | null }> {
    try {
      return await this.dispatchJourney({
        trigger: 'CREDENTIAL_ISSUED',
        application_id: applicationId,
        idempotency_key: `sample-lab.notify.credential:${credentialId}`,
      });
    } catch {
      return {
        dispatch_id: null,
        notification_ref: `lab-notify:failed:${credentialId}`,
      };
    }
  }
}

export type ComposeLabNotificationResult = {
  service: NotificationServiceLike;
  worker: DeliveryWorkerLike;
  messaging: MessagingServiceLike | null;
  bridge: LabJourneyNotifyBridge;
  deficiencyNotifier: LabDeficiencyNotificationPort;
  catalogue: LabNotificationCatalogue;
  registry: { simulatedConnector?(id: string): { sink: unknown[] } | undefined };
  m06: {
    notification: { service: unknown; resolveContext: (request: unknown) => Promise<unknown> };
    messaging?: { service: unknown; resolveContext: (request: unknown) => Promise<unknown> };
  };
};

type Cmp025Module = {
  buildNotificationService: (opts: Record<string, unknown>) => NotificationServiceLike;
  buildDeliveryWorker: (opts: Record<string, unknown>) => DeliveryWorkerLike;
  DefaultConnectorRegistry: new (opts: { simulation: { testRunId: string } }) => {
    forBinding: (b: ConnectorBindingView) => unknown;
    simulatedConnector?(id: string): { sink: unknown[] } | undefined;
  };
};

type Cmp026Module = {
  MessagingService: new (deps: Record<string, unknown>) => MessagingServiceLike;
  PgMessagingStore: new (pool: pg.Pool) => unknown;
  SimulatedCaseParticipation: new () => unknown;
  SimulatedAttachmentStorage: new () => unknown;
  loadConfig: (env: Record<string, string | undefined>) => unknown;
  OutboxOnlyWorkflowSignal: new () => unknown;
};

export function composeLabNotification(params: {
  pool: pg.Pool;
  messagingPool?: pg.Pool;
  authorizer: { decide: (input: unknown) => Promise<unknown> };
  resolveContext: (request: unknown) => Promise<unknown>;
  environment: string;
  testRunId: string;
  catalogue: LabNotificationCatalogue;
  cellId: string;
  tenantId: string;
  cmp025: Cmp025Module;
  cmp026?: Cmp026Module;
}): ComposeLabNotificationResult {
  const bindings = new LabNotificationBindings(
    params.catalogue,
    params.tenantId,
    params.environment,
  );
  const recipients = new LabRecipientDirectory(params.catalogue, params.tenantId);
  const registry = new params.cmp025.DefaultConnectorRegistry({
    simulation: { testRunId: params.testRunId },
  });
  const common = {
    pool: params.pool,
    authorizer: params.authorizer,
    bindings,
    recipients,
    connectors: registry,
    environment: params.environment,
    testRunId: params.testRunId,
    workerId: 'sample-lab-notify-worker',
  };
  const service = params.cmp025.buildNotificationService(common);
  const worker = params.cmp025.buildDeliveryWorker(common);

  let messaging: MessagingServiceLike | null = null;
  if (params.messagingPool && params.cmp026) {
    messaging = new params.cmp026.MessagingService({
      store: new params.cmp026.PgMessagingStore(params.messagingPool),
      authorizer: params.authorizer,
      participation: new params.cmp026.SimulatedCaseParticipation(),
      storage: new params.cmp026.SimulatedAttachmentStorage(),
      workflow: new params.cmp026.OutboxOnlyWorkflowSignal(),
      config: params.cmp026.loadConfig({ SF_ENVIRONMENT: params.environment }),
    });
  }

  const bridge = new LabJourneyNotifyBridge(
    service,
    worker,
    messaging,
    params.catalogue,
    params.cellId,
    params.tenantId,
  );

  return {
    service,
    worker,
    messaging,
    bridge,
    deficiencyNotifier: new LabDeficiencyNotificationPort(bridge),
    catalogue: params.catalogue,
    registry,
    m06: {
      notification: { service, resolveContext: params.resolveContext },
      ...(messaging
        ? { messaging: { service: messaging, resolveContext: params.resolveContext } }
        : {}),
    },
  };
}
