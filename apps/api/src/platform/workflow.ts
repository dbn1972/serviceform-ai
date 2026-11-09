import { createHash, randomUUID } from 'node:crypto';
import type {
  WorkflowAdvancePort,
  WorkflowAdvanceSignal,
} from '@serviceform/cmp-015-application-case';
import { assertSimulatorEnvironment } from './simulators.js';

/**
 * SF-M10-B-2c: CMP-016 sequencing on the SAMPLE_LAB platform host. CMP-015 stays the
 * authoritative case state; this module only forwards committed SF-CON-COMMAND-TRANSITION records
 * to CMP-016 (after the CMP-015 commit, never inside it) and composes the CMP-016 Temporal client
 * and worker. CMP-016 has no HTTP surface here. Host composition only: no domain logic.
 */

export type WorkflowActorType =
  'CITIZEN' | 'OFFICER' | 'SYSTEM' | 'INTEGRATION' | 'PRIVILEGED_ADMIN';

/** Structural subset of CMP-016 WorkflowContext. */
export interface WorkflowContextLike {
  tenant_id: string;
  cell_id: string;
  actor: { type: WorkflowActorType; id: string };
  correlation_id: string;
  trace_id: string;
}

export type WorkflowAuthorizeFn = (
  ctx: WorkflowContextLike,
  action: string,
  resource: { type: string; id?: string },
) => Promise<{ allow: boolean; decision_id: string; policy_revision: string }>;

interface ApprovalRequest {
  subject_type: 'WorkflowVersion' | 'WorkflowMigration';
  subject_id: string;
  content_hash: string;
  approval_ref: string;
}

/** Structural subset of CMP-016 WorkflowService used by the host. */
export interface WorkflowServiceLike {
  createDefinition(
    ctx: WorkflowContextLike,
    input: { definition_key: string },
  ): Promise<{ definition_id: string }>;
  createDraft(
    ctx: WorkflowContextLike,
    input: { definition_id: string; graph: unknown },
  ): Promise<{ version_id: string }>;
  publish(
    ctx: WorkflowContextLike,
    input: { version_id: string; approval_ref: string },
  ): Promise<{ version_id: string; status: string }>;
  startInstance(
    ctx: WorkflowContextLike,
    input: { application_id: string; workflow_version_id: string },
  ): Promise<{ instance_id: string; temporal_workflow_id: string }>;
  onCaseTransitionCommitted(
    ctx: WorkflowContextLike,
    record: unknown,
    outboxEventId: string,
  ): Promise<{ temporal_advanced: true; signal_id: string }>;
  recordProgress(ctx: WorkflowContextLike, input: unknown): Promise<void>;
}

export interface WorkflowServiceDepsLike {
  pool: unknown;
  authz: { authorize: WorkflowAuthorizeFn };
  approvals: {
    verify(
      ctx: WorkflowContextLike,
      request: ApprovalRequest,
    ): Promise<{ approved: boolean; approver_id: string }>;
  };
  temporal: unknown;
  newId?: () => string;
}

export interface Cmp016Module {
  WorkflowService: new (deps: WorkflowServiceDepsLike) => WorkflowServiceLike;
  TemporalSequencingAdapter: new (client: unknown, taskQueue: string) => unknown;
  Cmp016Error: new (code: string, details?: { code: string }[]) => Error;
  graphHash(graph: unknown): string;
  parseGraph(raw: unknown): unknown;
}

export interface TemporalClientLike {
  start(request: unknown): Promise<{ runId: string }>;
  signal(workflowId: string, signalName: string, payload: unknown): Promise<void>;
  close(): Promise<void>;
}

export interface WorkerLike {
  run(): Promise<void>;
  shutdown(): void;
  getState(): string;
}

export interface Cmp016SdkModule {
  connectTemporalClient(options: {
    address: string;
    namespace: string;
    taskQueue: string;
  }): Promise<TemporalClientLike>;
  connectCanonicalWorker(options: {
    address: string;
    namespace: string;
    taskQueue: string;
    activities: unknown;
  }): Promise<{ worker: WorkerLike; connection: { close(): Promise<void> } }>;
  createCanonicalActivities(deps: {
    ports: Record<string, unknown>;
    systemActorId: string;
    recordProgress: (ctx: WorkflowContextLike, input: unknown) => Promise<void>;
  }): unknown;
}

/** Structural subset of the OPA PDP client (SF-CON-AUTHZ-DECISION). */
export interface PdpLike {
  decide(input: unknown): Promise<{ allow: boolean; decision_id: string; policy_revision: string }>;
}

export interface LabWorkflowFixture {
  simulation: 'SIMULATED';
  workload: { actor_id: string; roles: string[] };
  publication: { author_id: string; approver_id: string };
  workflows: {
    catalogue_id: string;
    definition_key: string;
    approval_ref: string;
    graph_hash: string;
    graph: unknown;
  }[];
}

export interface PinnedWorkflow {
  tenant_id: string;
  catalogue_id: string;
  workflow_version_id: string;
}

export interface WorkflowLogger {
  warn(detail: Record<string, unknown>, message: string): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^[A-Za-z0-9.-]{1,253}:[0-9]{2,5}$/;
const NAMESPACE = /^[a-z0-9][a-z0-9._-]{0,62}$/;

export function assertTemporalAddress(value: string | undefined): string {
  if (!value || !ADDRESS.test(value))
    throw new Error('Invalid configuration for: SF_TEMPORAL_ADDRESS');
  return value;
}

export function assertTemporalNamespace(value: string | undefined): string {
  const ns = value ?? 'default';
  if (!NAMESPACE.test(ns)) throw new Error('Invalid configuration for: SF_TEMPORAL_NAMESPACE');
  return ns;
}

/** RFC 9562 name-based (v5) UUID; stable lab identifiers derived from tenant + key. */
export function nameUuid(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(ns).update(name, 'utf8').digest();
  h[6] = ((h[6] as number) & 0x0f) | 0x50;
  h[8] = ((h[8] as number) & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function errorCode(err: unknown): { name: string; code: string; detail: string | undefined } {
  const e = err as { name?: unknown; code?: unknown; details?: { code?: unknown }[] };
  return {
    name: typeof e?.name === 'string' ? e.name : '',
    code: typeof e?.code === 'string' ? e.code : '',
    detail: typeof e?.details?.[0]?.code === 'string' ? e.details[0].code : undefined,
  };
}

function isCmp016(err: unknown, code: string, detail?: string): boolean {
  const e = errorCode(err);
  return (
    e.name === 'Cmp016Error' && e.code === code && (detail === undefined || e.detail === detail)
  );
}

/**
 * CMP-016 AuthorizationPort over the OPA PDP. Only the configured workload identity carries the
 * SAMPLE_LAB sequencer roles; any other actor reaches OPA with no roles and is denied.
 */
export function opaWorkflowAuthorizer(
  pdp: PdpLike,
  workload: { actor_id: string; roles: readonly string[] },
  clock: () => Date = () => new Date(),
): { authorize: WorkflowAuthorizeFn } {
  return {
    async authorize(ctx, action, resource) {
      const isWorkload = ctx.actor.type === 'SYSTEM' && ctx.actor.id === workload.actor_id;
      const decision = await pdp.decide({
        subject: {
          user_id: ctx.actor.id,
          actor_type: ctx.actor.type,
          tenant_id: ctx.tenant_id,
          roles: isWorkload ? [...workload.roles] : [],
          jurisdiction_ids: [],
          assurance: 'WORKLOAD_IDENTITY',
        },
        resource: {
          resource_type: resource.type,
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
          ...(resource.type === 'Application' && resource.id && UUID.test(resource.id)
            ? { application_id: resource.id }
            : {}),
        },
        action,
        environment: { request_time: clock().toISOString(), trace_id: ctx.trace_id },
      });
      return {
        allow: decision.allow === true,
        decision_id: decision.decision_id,
        policy_revision: decision.policy_revision,
      };
    },
  };
}

const PUBLICATION_ACTIONS = new Set([
  'WORKFLOW_DEFINITION_CREATE',
  'WORKFLOW_VERSION_DRAFT',
  'WORKFLOW_VERSION_PUBLISH',
]);

/**
 * SIMULATED workflow publication (LOCAL/CI only; Studio -> CMP-052/CMP-051 replaces it in slice
 * B-4), the CMP-016 counterpart of the SIMULATED published-binding and published-form ports. It
 * drives the real CMP-016 publish path (validation, maker != checker, immutability triggers,
 * outbox, audit). The authorizer admits only the fixture author/approver for the three authoring
 * actions, and the approval is the recorded one: it approves only the pinned version, the fixture
 * approval_ref and the exact recorded graph_hash.
 */
export class SimulatedWorkflowPublication {
  readonly simulation = 'SIMULATED' as const;

  constructor(
    environment: string,
    private readonly fixture: LabWorkflowFixture,
  ) {
    assertSimulatorEnvironment(environment);
    if (fixture.simulation !== 'SIMULATED')
      throw new Error('SF-M10: workflow fixture must be SIMULATED');
    const { author_id, approver_id } = fixture.publication;
    if (!UUID.test(author_id) || !UUID.test(approver_id) || author_id === approver_id) {
      throw new Error('SF-M10: workflow publication needs distinct maker and checker');
    }
  }

  workflowFor(catalogueId: string): LabWorkflowFixture['workflows'][number] {
    const wf = this.fixture.workflows.find((w) => w.catalogue_id === catalogueId);
    if (!wf) throw new Error(`SF-M10: no SAMPLE_LAB workflow for ${catalogueId}`);
    return wf;
  }

  authorizer(): { authorize: WorkflowAuthorizeFn } {
    const { author_id, approver_id } = this.fixture.publication;
    return {
      authorize: async (ctx, action) => {
        const actor = action === 'WORKFLOW_VERSION_PUBLISH' ? approver_id : author_id;
        const allow =
          PUBLICATION_ACTIONS.has(action) && ctx.actor.type === 'SYSTEM' && ctx.actor.id === actor;
        return {
          allow,
          decision_id: randomUUID(),
          policy_revision: 'sample-lab-simulated-publication',
        };
      },
    };
  }

  approvals(pins: readonly PinnedWorkflow[]): WorkflowServiceDepsLike['approvals'] {
    const expected = new Map(
      pins.map((p) => [
        `${p.tenant_id}:${p.workflow_version_id}`,
        this.workflowFor(p.catalogue_id),
      ]),
    );
    const approver = this.fixture.publication.approver_id;
    return {
      async verify(ctx, request) {
        const wf = expected.get(`${ctx.tenant_id}:${request.subject_id}`);
        const approved =
          wf !== undefined &&
          request.subject_type === 'WorkflowVersion' &&
          request.approval_ref === wf.approval_ref &&
          request.content_hash === wf.graph_hash;
        return { approved, approver_id: approver };
      },
    };
  }
}

function systemCtx(
  tenantId: string,
  cellId: string,
  actorId: string,
  correlationId: string = randomUUID(),
): WorkflowContextLike {
  return {
    tenant_id: tenantId,
    cell_id: cellId,
    actor: { type: 'SYSTEM', id: actorId },
    correlation_id: correlationId,
    trace_id: correlationId.replace(/-/g, ''),
  };
}

/**
 * Ensures the pinned version is PUBLISHED through the CMP-016 service. Idempotent across host
 * restarts: an already published version is left untouched (published versions are immutable).
 */
export async function ensurePublishedWorkflow(params: {
  cmp016: Pick<Cmp016Module, 'WorkflowService'>;
  deps: Omit<WorkflowServiceDepsLike, 'authz' | 'approvals' | 'newId'>;
  publication: SimulatedWorkflowPublication;
  fixture: LabWorkflowFixture;
  pin: PinnedWorkflow;
  cellId: string;
}): Promise<'PUBLISHED' | 'ALREADY_PUBLISHED'> {
  const { cmp016, deps, publication, fixture, pin, cellId } = params;
  const wf = publication.workflowFor(pin.catalogue_id);
  const approvals = publication.approvals([pin]);
  const authz = publication.authorizer();
  const service = (newId?: () => string) =>
    new cmp016.WorkflowService({ ...deps, authz, approvals, ...(newId ? { newId } : {}) });
  const author = systemCtx(pin.tenant_id, cellId, fixture.publication.author_id);
  const approver = systemCtx(pin.tenant_id, cellId, fixture.publication.approver_id);
  const publish = () =>
    service().publish(approver, {
      version_id: pin.workflow_version_id,
      approval_ref: wf.approval_ref,
    });
  try {
    await publish();
    return 'PUBLISHED';
  } catch (err) {
    if (isCmp016(err, 'SF-WF-001', 'PUBLISHED_VERSION_IMMUTABLE')) return 'ALREADY_PUBLISHED';
    if (!isCmp016(err, 'SF-SYS-002')) throw err;
  }
  const definitionId = nameUuid(pin.tenant_id, wf.definition_key);
  try {
    await service(() => definitionId).createDefinition(author, {
      definition_key: wf.definition_key,
    });
  } catch (err) {
    if (!isCmp016(err, 'SF-APP-002')) throw err;
  }
  await service(() => pin.workflow_version_id).createDraft(author, {
    definition_id: definitionId,
    graph: wf.graph,
  });
  await publish();
  return 'PUBLISHED';
}

/**
 * Host bridge from CMP-015's post-commit WorkflowAdvancePort to CMP-016. It runs only after the
 * CMP-015 commit receipt exists (the CMP-015 gate enforces it) and resolves `undefined`
 * (SIGNALLED) only after CMP-016 delivered the signal to Temporal. Any failure propagates, so the
 * gate reports DEFERRED_TO_OUTBOX and the committed outbox event remains the durable trigger.
 */
export class LabWorkflowBridge implements WorkflowAdvancePort {
  constructor(
    private readonly deps: {
      service: () => WorkflowServiceLike;
      cellId: string;
      workloadActorId: string;
      logger?: WorkflowLogger;
    },
  ) {}

  private ctx(tenantId: string, correlationId: string): WorkflowContextLike {
    return systemCtx(
      tenantId,
      this.deps.cellId,
      this.deps.workloadActorId,
      UUID.test(correlationId) ? correlationId : randomUUID(),
    );
  }

  private async ensureStarted(
    ctx: WorkflowContextLike,
    applicationId: string,
    workflowVersionId: string,
  ): Promise<void> {
    try {
      await this.deps.service().startInstance(ctx, {
        application_id: applicationId,
        workflow_version_id: workflowVersionId,
      });
    } catch (err) {
      if (!isCmp016(err, 'SF-APP-002')) throw err;
    }
  }

  /** CREATE_DRAFT hook: called after the CMP-015 draft commit; failure never fails the draft. */
  async onDraftCreated(params: {
    tenant_id: string;
    application_id: string;
    workflow_version_id: string;
    correlation_id: string;
  }): Promise<'STARTED' | 'DEFERRED'> {
    try {
      await this.ensureStarted(
        this.ctx(params.tenant_id, params.correlation_id),
        params.application_id,
        params.workflow_version_id,
      );
      return 'STARTED';
    } catch (err) {
      this.deps.logger?.warn(
        { application_id: params.application_id, error: errorCode(err) },
        'CMP-016 instance start deferred',
      );
      return 'DEFERRED';
    }
  }

  async advance(signal: WorkflowAdvanceSignal): Promise<undefined> {
    const record = signal.command_transition;
    const ctx = this.ctx(signal.tenant_id, signal.correlation_id);
    const deliver = () =>
      this.deps.service().onCaseTransitionCommitted(ctx, record, signal.outbox_event_id);
    try {
      try {
        await deliver();
      } catch (err) {
        if (!isCmp016(err, 'SF-SYS-002')) throw err;
        await this.ensureStarted(ctx, signal.application_id, record.pin_set.workflow_version_id);
        await deliver();
      }
    } catch (err) {
      this.deps.logger?.warn(
        { application_id: signal.application_id, error: errorCode(err) },
        'CMP-016 advance deferred to outbox',
      );
      throw err;
    }
    return undefined;
  }
}

/** Ports the canonical lab graph never reaches; reaching one faults the instance (fail closed). */
export function unwiredActivityPorts(cmp016: Pick<Cmp016Module, 'Cmp016Error'>) {
  const refuse = (port: string) => async () => {
    throw new cmp016.Cmp016Error('SF-SYS-004', [{ code: `${port}_PORT_NOT_WIRED` }]);
  };
  return {
    humanTasks: { create: refuse('HUMAN_TASK'), cancelClose: refuse('HUMAN_TASK') },
    rules: { evaluate: refuse('RULE') },
    activities: { invoke: refuse('SERVICE_ACTIVITY') },
    processPorts: { invoke: refuse('PROCESS') },
    timers: { durationMs: refuse('TIMER_POLICY') },
  };
}

export interface LabWorkflow {
  bridge: LabWorkflowBridge;
  readinessChecks: { name: string; check(): Promise<void> }[];
  /** Connects Temporal, seeds the pinned published versions and starts the worker. */
  start(): Promise<void>;
  close(): Promise<void>;
}

const NO_RUNTIME_PUBLICATION: WorkflowServiceDepsLike['approvals'] = {
  async verify(_ctx, _request) {
    return { approved: false, approver_id: '' };
  },
};

async function withRetry<T>(fn: () => Promise<T>, attempts: number, delayMs: number): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

/**
 * Composes CMP-016 for the lab host. Nothing connects at build time; until `start()` resolves
 * every bridge call fails, so CMP-015 commands still commit and report DEFERRED_TO_OUTBOX.
 */
export function composeLabWorkflow(params: {
  environment: string;
  cmp016: Cmp016Module;
  sdk: Cmp016SdkModule;
  pool: unknown;
  pdp: PdpLike;
  fixture: LabWorkflowFixture;
  pins: readonly PinnedWorkflow[];
  cellId: string;
  temporal: { address: string; namespace: string; taskQueue: string };
  logger?: WorkflowLogger;
  connectAttempts?: number;
}): LabWorkflow {
  const { cmp016, sdk, fixture, temporal } = params;
  const publication = new SimulatedWorkflowPublication(params.environment, fixture);
  for (const pin of params.pins) {
    const wf = publication.workflowFor(pin.catalogue_id);
    if (wf.graph_hash !== cmp016.graphHash(cmp016.parseGraph(wf.graph))) {
      throw new Error(`SF-M10: workflow graph_hash mismatch for ${pin.catalogue_id}`);
    }
  }
  const authz = opaWorkflowAuthorizer(params.pdp, fixture.workload);
  let service: WorkflowServiceLike | undefined;
  let client: TemporalClientLike | undefined;
  let worker: WorkerLike | undefined;
  let workerConnection: { close(): Promise<void> } | undefined;
  let running: Promise<void> | undefined;

  const bridge = new LabWorkflowBridge({
    service: () => {
      if (!service)
        throw new cmp016.Cmp016Error('SF-SYS-004', [{ code: 'TEMPORAL_NOT_CONNECTED' }]);
      return service;
    },
    cellId: params.cellId,
    workloadActorId: fixture.workload.actor_id,
    ...(params.logger ? { logger: params.logger } : {}),
  });

  return {
    bridge,
    readinessChecks: [
      {
        name: 'cmp016-temporal-worker',
        async check() {
          if (!service || worker?.getState() !== 'RUNNING') throw new Error('worker not running');
        },
      },
    ],
    async start() {
      const connected = await withRetry(
        () => sdk.connectTemporalClient(temporal),
        params.connectAttempts ?? 20,
        500,
      );
      client = connected;
      const adapter = new cmp016.TemporalSequencingAdapter(connected, temporal.taskQueue);
      for (const pin of params.pins) {
        await ensurePublishedWorkflow({
          cmp016,
          deps: { pool: params.pool, temporal: adapter },
          publication,
          fixture,
          pin,
          cellId: params.cellId,
        });
      }
      const runtime = new cmp016.WorkflowService({
        pool: params.pool,
        authz,
        approvals: NO_RUNTIME_PUBLICATION,
        temporal: adapter,
      });
      const activities = sdk.createCanonicalActivities({
        ports: unwiredActivityPorts(cmp016),
        systemActorId: fixture.workload.actor_id,
        recordProgress: (ctx, input) => runtime.recordProgress(ctx, input),
      });
      const created = await sdk.connectCanonicalWorker({
        address: temporal.address,
        namespace: temporal.namespace,
        taskQueue: temporal.taskQueue,
        activities,
      });
      worker = created.worker;
      workerConnection = created.connection;
      running = worker.run().catch((err: unknown) => {
        params.logger?.warn({ error: errorCode(err) }, 'CMP-016 worker stopped');
      });
      service = runtime;
    },
    async close() {
      service = undefined;
      if (worker && worker.getState() === 'RUNNING') worker.shutdown();
      await running;
      await workerConnection?.close();
      await client?.close();
    },
  };
}
