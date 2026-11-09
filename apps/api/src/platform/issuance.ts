import { createHash, randomUUID } from 'node:crypto';
import type { RequestContext } from '@serviceform/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * SF-M10-B-3 (CCR-M10-003) SAMPLE_LAB post-approval issuance on the platform host.
 *
 * After a HUMAN officer records APPROVED on CMP-015, this sequences, as a tenant SYSTEM workload:
 * CMP-015 ENTER_SIGNING_PENDING → CMP-022 issue (SIMULATED render + INT-013 SIMULATED eSign, CMP-024
 * registration) → CMP-015 RECORD_ISSUED → CMP-012 SIMULATED DigiLocker publish → CMP-022 downstream
 * outcome. It stands in for CMP-016 sequencing on this path and decides nothing: approval is read
 * from CMP-015, every step is the owning component's own command (OPA, RLS, idempotency, audit),
 * and a publish failure never reverses issuance. Every key is derived from the application or
 * credential id, so a retried call resumes instead of duplicating. LOCAL/CI only.
 */

export const ISSUANCE_ENVIRONMENTS: readonly string[] = ['LOCAL', 'CI'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_REF = /^[A-Za-z0-9_.:-]{1,128}$/;
const PURPOSE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const ROLE = /^[A-Z][A-Z0-9_]{1,63}$/;

const POST_APPROVAL_STATES = new Set(['APPROVED', 'SIGNING_PENDING', 'ISSUED', 'CLOSED']);

export interface CredentialTemplatePin {
  tenant_service_binding_id: string;
  credential_template_version_id: string;
  credential_template_id: string;
  credential_template_version: number;
  service_version_id: string;
}

export interface LabIssuanceConfig {
  tenant_id: string;
  environment: 'LOCAL' | 'CI';
  test_run_id: string;
  workload: { actor_id: string; roles: string[] };
  issuer_ref: string;
  esign_binding_id: string;
  digilocker_binding_id: string;
  publish: { consent_ref: string; purpose_code: string; document_type_ref: string };
  templates: CredentialTemplatePin[];
}

function fail(field: string): never {
  throw new Error(`SF-M10-B-3: invalid issuance fixture: ${field}`);
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) fail(field);
  return value.toLowerCase();
}

function ref(value: unknown, field: string, re = OPAQUE_REF): string {
  if (typeof value !== 'string' || !re.test(value)) fail(field);
  return value;
}

/**
 * Reads the SAMPLE_LAB issuance fixture for one tenant. The fixture must be labelled SIMULATED;
 * the consent reference is a synthetic CMP-030 stand-in until the B-2d profile/consent path exists.
 */
export function parseIssuanceFixture(
  raw: unknown,
  tenantId: string,
  environment: string,
  testRunId: string,
): LabIssuanceConfig {
  if (!ISSUANCE_ENVIRONMENTS.includes(environment)) {
    throw new Error(`SF-M10-B-3: SIMULATED issuance is refused in ${environment}`);
  }
  const doc = raw as Record<string, unknown> | null;
  if (!doc || doc['simulation'] !== 'SIMULATED') fail('simulation');
  const workload = doc['workload'] as Record<string, unknown> | undefined;
  const roles = workload?.['roles'];
  if (!Array.isArray(roles) || roles.length === 0 || !roles.every((r) => ROLE.test(String(r)))) {
    fail('workload.roles');
  }
  const tenants = Array.isArray(doc['tenants']) ? (doc['tenants'] as unknown[]) : [];
  const tenant = tenants.find(
    (t) => (t as Record<string, unknown> | null)?.['tenant_id'] === tenantId,
  ) as Record<string, unknown> | undefined;
  if (!tenant) fail('tenants[tenant_id]');
  const publish = tenant['digilocker_publish'] as Record<string, unknown> | undefined;
  const bindings = tenant['connector_bindings'] as Record<string, unknown> | undefined;
  const templates = Array.isArray(tenant['credential_templates'])
    ? (tenant['credential_templates'] as Record<string, unknown>[])
    : [];
  if (templates.length === 0) fail('credential_templates');
  return {
    tenant_id: uuid(tenantId, 'tenant_id'),
    environment: environment as 'LOCAL' | 'CI',
    test_run_id: ref(testRunId, 'test_run_id'),
    workload: { actor_id: uuid(workload?.['actor_id'], 'workload.actor_id'), roles: [...roles] },
    issuer_ref: ref(tenant['issuer_ref'], 'issuer_ref'),
    esign_binding_id: uuid(bindings?.['esign'], 'connector_bindings.esign'),
    digilocker_binding_id: uuid(bindings?.['digilocker'], 'connector_bindings.digilocker'),
    publish: {
      consent_ref: uuid(publish?.['consent_ref'], 'digilocker_publish.consent_ref'),
      purpose_code: ref(publish?.['purpose_code'], 'digilocker_publish.purpose_code', PURPOSE_CODE),
      document_type_ref: ref(
        publish?.['document_type_ref'],
        'digilocker_publish.document_type_ref',
      ),
    },
    templates: templates.map((t, i) => {
      const version = t['credential_template_version'];
      if (!Number.isSafeInteger(version) || (version as number) < 1) {
        fail(`credential_templates[${i}].credential_template_version`);
      }
      return {
        tenant_service_binding_id: uuid(
          t['tenant_service_binding_id'],
          `credential_templates[${i}]`,
        ),
        credential_template_version_id: uuid(
          t['credential_template_version_id'],
          `credential_templates[${i}]`,
        ),
        credential_template_id: uuid(t['credential_template_id'], `credential_templates[${i}]`),
        credential_template_version: version as number,
        service_version_id: uuid(t['service_version_id'], `credential_templates[${i}]`),
      };
    }),
  };
}

export function workloadContext(cfg: LabIssuanceConfig, cellId: string): RequestContext {
  const correlation_id = randomUUID();
  return {
    tenant_id: cfg.tenant_id,
    cell_id: cellId,
    actor: { type: 'SYSTEM', id: cfg.workload.actor_id },
    roles: [...cfg.workload.roles],
    jurisdiction_ids: [],
    auth_assurance: 'WORKLOAD_IDENTITY',
    correlation_id,
    trace_id: correlation_id.replace(/-/g, ''),
  };
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

// ── Component seams (structural; the host never imports component internals) ─────────────────

export interface ServiceResultLike {
  status: number;
  body: unknown;
}

/** Structural subset of the CMP-015 ApplicationCaseService. */
export interface CaseServiceLike {
  getApplication(ctx: unknown, applicationId: unknown): Promise<ServiceResultLike>;
  listTransitions(ctx: unknown, applicationId: unknown): Promise<ServiceResultLike>;
  executeCommand(
    ctx: unknown,
    applicationId: unknown,
    body: unknown,
    key: unknown,
  ): Promise<ServiceResultLike>;
}

/** Transport-neutral component API (`create*Api(...).handle`). */
export interface NeutralApiLike {
  handle(req: {
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    query?: Record<string, string>;
    body?: unknown;
  }): Promise<{ status: number; body: unknown }>;
}

export type NeutralFactory = (opts: {
  service: unknown;
  resolveContext: () => Promise<RequestContext | null>;
}) => NeutralApiLike;

interface CaseView {
  application_id: string;
  state: string;
  aggregate_version: number;
  pins: { tenant_service_binding_id: string; credential_template_version_id?: string | null };
}

interface TransitionView {
  transition_id: string;
  command: string;
  to_state: string;
  actor_type: string;
}

/**
 * CMP-022 CaseIssuancePinsPort over CMP-015. Pins come from the case's pin graph plus the
 * SAMPLE_LAB credential-template fixture; the approval reference is the CMP-015 transition that
 * recorded APPROVED, and only an OFFICER (HUMAN attestation) transition counts.
 */
export class CaseIssuancePinsBridge {
  constructor(
    private readonly cases: CaseServiceLike,
    private readonly templates: readonly CredentialTemplatePin[],
  ) {}

  async getIssuancePins(ctx: unknown, applicationId: string) {
    let app: ServiceResultLike;
    try {
      app = await this.cases.getApplication(ctx, applicationId);
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'SF-SYS-002') return null;
      throw err;
    }
    if (app.status !== 200) return null;
    const view = (app.body as { application: CaseView }).application;
    const tr = await this.cases.listTransitions(ctx, applicationId);
    const transitions = (tr.body as { transitions?: TransitionView[] }).transitions ?? [];
    const approval = transitions.find(
      (t) =>
        t.command === 'RECORD_APPROVED' && t.to_state === 'APPROVED' && t.actor_type === 'OFFICER',
    );
    const template = this.templates.find(
      (t) =>
        t.tenant_service_binding_id === view.pins.tenant_service_binding_id &&
        t.credential_template_version_id === view.pins.credential_template_version_id,
    );
    return {
      application_id: view.application_id,
      tenant_service_binding_id: view.pins.tenant_service_binding_id,
      service_version_id: template?.service_version_id ?? '',
      credential_template_id: template?.credential_template_id ?? null,
      credential_template_version: template?.credential_template_version ?? null,
      approval_decision_ref:
        approval && POST_APPROVAL_STATES.has(view.state)
          ? `cmp015.transition:${approval.transition_id}`
          : null,
    };
  }
}

/** SIMULATED CMP-032/033 render: a stored-artifact reference and digest only, never bytes. */
export class SimulatedRenderBridge {
  render(ctx: RequestContext, req: { credential_id: string; idempotency_key: string }) {
    return Promise.resolve({
      storage_key: `sample-lab/${ctx.tenant_id}/credentials/${req.credential_id}/render`,
      sha256: sha256(`sample-lab.render:${req.idempotency_key}`),
    });
  }
}

/** INT-013 SIMULATED eSign. Carries the simulation marker CMP-022 requires in LOCAL/CI. */
export class SimulatedEsignBridge {
  constructor(private readonly cfg: LabIssuanceConfig) {}

  sign(
    _ctx: RequestContext,
    req: { credential_id: string; attempt_number: number; idempotency_key: string },
  ) {
    return Promise.resolve({
      connector_binding_id: this.cfg.esign_binding_id,
      integration_contract: 'INT-013' as const,
      connector_mode: 'SIMULATED' as const,
      simulation_marker: {
        simulation: true as const,
        scenario: 'esign_success',
        test_run_id: this.cfg.test_run_id,
        connector_binding_id: this.cfg.esign_binding_id,
        environment: this.cfg.environment,
      },
      signing_result: 'SIGNED' as const,
      signature_ref: `sample-lab/${req.credential_id}/signed`,
      signed_artifact_sha256: sha256(`sample-lab.signed:${req.idempotency_key}`),
      provider_transaction_ref: `sim-esign:${req.credential_id}:${req.attempt_number}`,
    });
  }
}

/**
 * CMP-022 → CMP-024 registration through CMP-024's own transport (it fingerprints and replays the
 * request). The issuing SYSTEM context is passed through: CMP-024 only accepts a SYSTEM registrar.
 */
export class RegistryBridge {
  constructor(
    private readonly registryApi: (ctx: RequestContext) => NeutralApiLike,
    private readonly cfg: LabIssuanceConfig,
  ) {}

  async register(
    ctx: RequestContext,
    req: { credential_id: string; idempotency_key: string },
  ): Promise<{ credential_id: string; current_status: string }> {
    const res = await this.registryApi(ctx).handle({
      method: 'POST',
      path: '/v1/credential-registry/credentials',
      headers: { 'idempotency-key': req.idempotency_key },
      body: { credential_id: req.credential_id, issuer_ref: this.cfg.issuer_ref },
    });
    if (res.status !== 200 && res.status !== 201) {
      const code = (res.body as { error_code?: string } | null)?.error_code ?? 'SF-SYS-004';
      throw new Error(`CMP-024 registration refused: ${code}`);
    }
    const status = (
      res.body as { credential_status: { credential_id: string; current_status: string } }
    ).credential_status;
    return { credential_id: status.credential_id, current_status: status.current_status };
  }
}

/** Structural subset of the CMP-022 CredentialService used to verify before publish. */
export interface CredentialReadLike {
  get(ctx: unknown, credentialId: string): Promise<ServiceResultLike>;
}

/** CMP-012 → CMP-022 verification: publish only an ISSUED, signed credential. */
export class CredentialVerificationBridge {
  constructor(
    private readonly credentials: CredentialReadLike,
    private readonly ctxFor: () => RequestContext,
  ) {}

  async verify(tenantId: string, credentialId: string) {
    const ctx = this.ctxFor();
    if (ctx.tenant_id !== tenantId)
      return { found: false, tenantId: null, lifecycle: null, signed: false };
    try {
      const res = await this.credentials.get(ctx, credentialId);
      const v = res.body as {
        tenant_id: string;
        lifecycle_status: string;
        artifacts: { artifact_kind: string }[];
      };
      return {
        found: true,
        tenantId: v.tenant_id,
        lifecycle: v.lifecycle_status,
        signed: v.artifacts.some((a) => a.artifact_kind === 'SIGNED_ARTIFACT'),
      };
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'SF-SYS-002') {
        return { found: false, tenantId: null, lifecycle: null, signed: false };
      }
      throw err;
    }
  }
}

/** CMP-037 stand-in: the tenant's SIMULATED, critical DigiLocker binding from the lab fixture. */
export class LabDigiLockerBinding {
  constructor(private readonly cfg: LabIssuanceConfig) {}

  private view(tenantId: string) {
    if (tenantId !== this.cfg.tenant_id) return null;
    return {
      connector_binding_id: this.cfg.digilocker_binding_id,
      tenant_id: this.cfg.tenant_id,
      connector_type: 'DIGILOCKER' as const,
      mode: 'SIMULATED' as const,
      environment: this.cfg.environment,
      critical: true,
      secret_ref: null,
      simulator_version: 'dl-publish-sim-1',
    };
  }

  resolve(tenantId: string, connectorBindingId: string) {
    const v = this.view(tenantId);
    return Promise.resolve(v && v.connector_binding_id === connectorBindingId ? v : null);
  }

  resolveDefault(tenantId: string) {
    return Promise.resolve(this.view(tenantId));
  }
}

// ── Coordinator ────────────────────────────────────────────────────────────────────────────

export type DigiLockerStatus =
  'NOT_REQUESTED' | 'PENDING' | 'PUBLISHED' | 'FAILED' | 'RETRY_SCHEDULED';

export interface IssuanceStatus {
  application_id: string;
  case_state: string;
  credential: { credential_id: string; lifecycle_status: string; issued_at?: string } | null;
  digilocker: {
    mode: 'SIMULATED' | 'SANDBOX' | 'REAL';
    status: DigiLockerStatus;
    publish_request_id?: string;
    provider_transaction_ref?: string;
    failure_code?: string;
  };
  simulation: true;
  g6_issued: false;
}

export interface IssuanceOutcome extends IssuanceStatus {
  issuance_error?: { error_code: string; step: string };
}

export class IssuanceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface PublishRecord {
  publish_request_id: string;
  credential_id: string;
  publish_status: DigiLockerStatus;
  connector_mode: 'SIMULATED' | 'SANDBOX' | 'REAL';
  provider_transaction_ref?: string;
  failure_code?: string;
}

interface CredentialView {
  credential_id: string;
  lifecycle_status: string;
  issued_at?: string;
}

function componentError(err: unknown): IssuanceError {
  const e = err as { code?: unknown; statusCode?: unknown; message?: unknown } | null;
  if (
    e &&
    typeof e.code === 'string' &&
    /^SF-[A-Z]+-\d{3}$/.test(e.code) &&
    typeof e.statusCode === 'number'
  ) {
    return new IssuanceError(
      e.statusCode,
      e.code,
      typeof e.message === 'string' ? e.message : 'Request denied',
    );
  }
  return new IssuanceError(503, 'SF-SYS-004', 'Service temporarily unavailable');
}

export class LabIssuanceCoordinator {
  constructor(
    private readonly deps: {
      config: LabIssuanceConfig;
      cases: CaseServiceLike;
      /** Neutral CMP-022 / CMP-012 APIs bound to the given (workload) context. */
      credentialApi: (ctx: RequestContext) => NeutralApiLike;
      digilockerApi: (ctx: RequestContext) => NeutralApiLike;
      workload: () => RequestContext;
    },
  ) {}

  private async caseFor(ctx: RequestContext, applicationId: string): Promise<CaseView> {
    let res: ServiceResultLike;
    try {
      res = await this.deps.cases.getApplication(ctx, applicationId);
    } catch (err) {
      throw componentError(err);
    }
    return (res.body as { application: CaseView }).application;
  }

  private async caseCommand(
    app: CaseView,
    command: 'ENTER_SIGNING_PENDING' | 'RECORD_ISSUED',
  ): Promise<CaseView> {
    const res = await this.deps.cases.executeCommand(
      this.deps.workload(),
      app.application_id,
      { command, expected_state: app.state, expected_version: app.aggregate_version },
      `sample-lab.issuance.${app.application_id}.${command}`,
    );
    return (res.body as { application: CaseView }).application;
  }

  private async credentialFor(applicationId: string): Promise<CredentialView | null> {
    const res = await this.deps.credentialApi(this.deps.workload()).handle({
      method: 'GET',
      path: `/v1/applications/${applicationId}/credentials`,
      headers: {},
    });
    if (res.status !== 200) throw new IssuanceError(503, 'SF-SYS-004', 'Credential read failed');
    const list = (res.body as { credentials?: CredentialView[] }).credentials ?? [];
    return list.find((c) => c.lifecycle_status === 'ISSUED') ?? list[0] ?? null;
  }

  private async publishRecords(credentialId: string): Promise<PublishRecord[]> {
    const res = await this.deps.digilockerApi(this.deps.workload()).handle({
      method: 'GET',
      path: '/v1/digilocker-publish',
      headers: {},
      query: { credential_id: credentialId },
    });
    if (res.status !== 200) throw new IssuanceError(503, 'SF-SYS-004', 'DigiLocker read failed');
    return (res.body as { publish_records?: PublishRecord[] }).publish_records ?? [];
  }

  private project(
    app: CaseView,
    credential: CredentialView | null,
    record: PublishRecord | undefined,
  ): IssuanceStatus {
    return {
      application_id: app.application_id,
      case_state: app.state,
      credential: credential
        ? {
            credential_id: credential.credential_id,
            lifecycle_status: credential.lifecycle_status,
            ...(credential.issued_at ? { issued_at: credential.issued_at } : {}),
          }
        : null,
      digilocker: record
        ? {
            mode: record.connector_mode,
            status: record.publish_status,
            publish_request_id: record.publish_request_id,
            ...(record.provider_transaction_ref
              ? { provider_transaction_ref: record.provider_transaction_ref }
              : {}),
            ...(record.failure_code ? { failure_code: record.failure_code } : {}),
          }
        : { mode: 'SIMULATED', status: 'NOT_REQUESTED' },
      simulation: true,
      g6_issued: false,
    };
  }

  /** Read projection. CMP-015 authorizes the caller (citizen owner or officer role) first. */
  async status(caller: RequestContext, applicationId: string): Promise<IssuanceStatus> {
    const app = await this.caseFor(caller, applicationId);
    if (!POST_APPROVAL_STATES.has(app.state)) return this.project(app, null, undefined);
    const credential = await this.credentialFor(app.application_id);
    const records = credential ? await this.publishRecords(credential.credential_id) : [];
    return this.project(app, credential, records[0]);
  }

  /**
   * Runs (or resumes) the post-approval sequence for a case an officer can read. A step failure
   * leaves every earlier, committed step in place and is reported, never compensated.
   */
  async issue(caller: RequestContext, applicationId: string): Promise<IssuanceOutcome> {
    if (caller.actor.type !== 'OFFICER') {
      throw new IssuanceError(403, 'SF-AUTH-002', 'Officer session required');
    }
    let app = await this.caseFor(caller, applicationId);
    if (!POST_APPROVAL_STATES.has(app.state)) {
      throw new IssuanceError(409, 'SF-APP-001', 'This case has no recorded approval');
    }
    let step = 'ENTER_SIGNING_PENDING';
    let credential: CredentialView | null = null;
    try {
      if (app.state === 'APPROVED') app = await this.caseCommand(app, 'ENTER_SIGNING_PENDING');

      step = 'CREDENTIAL_ISSUE';
      credential = await this.credentialFor(app.application_id);
      if (credential?.lifecycle_status !== 'ISSUED') {
        const issued = await this.deps.credentialApi(this.deps.workload()).handle({
          method: 'POST',
          path: '/v1/credentials',
          headers: { 'idempotency-key': `sample-lab.issuance.${app.application_id}.credential` },
          body: { application_id: app.application_id, issuance_key: `case.${app.application_id}` },
        });
        if (issued.status !== 200 && issued.status !== 201) {
          const code = (issued.body as { error_code?: string }).error_code ?? 'SF-CRED-001';
          return {
            ...this.project(app, credential, undefined),
            issuance_error: { error_code: code, step },
          };
        }
        credential = issued.body as CredentialView;
      }

      step = 'RECORD_ISSUED';
      if (app.state === 'SIGNING_PENDING') app = await this.caseCommand(app, 'RECORD_ISSUED');

      step = 'DIGILOCKER_PUBLISH';
      const records = await this.publishRecords(credential.credential_id);
      let latest = records[0];
      if (latest?.publish_status !== 'PUBLISHED') {
        const { publish } = this.deps.config;
        const res = await this.deps.digilockerApi(this.deps.workload()).handle({
          method: 'POST',
          path: '/v1/digilocker-publish',
          headers: {
            'idempotency-key': `sample-lab.publish.${credential.credential_id}.${records.length + 1}`,
          },
          body: {
            credential_id: credential.credential_id,
            consent_ref: publish.consent_ref,
            purpose_code: publish.purpose_code,
            document_type_ref: publish.document_type_ref,
            connector_binding_id: this.deps.config.digilocker_binding_id,
            test_run_id: this.deps.config.test_run_id,
          },
        });
        if (res.status !== 200 && res.status !== 201) {
          const code = (res.body as { error_code?: string }).error_code ?? 'SF-INT-001';
          return {
            ...this.project(app, credential, latest),
            issuance_error: { error_code: code, step },
          };
        }
        latest = res.body as PublishRecord;
        await this.recordOutcome(credential.credential_id, latest);
      }
      return this.project(app, credential, latest);
    } catch (err) {
      const mapped = err instanceof IssuanceError ? err : componentError(err);
      const current = await this.caseFor(caller, applicationId).catch(() => app);
      return {
        ...this.project(current, credential, undefined),
        issuance_error: { error_code: mapped.code, step },
      };
    }
  }

  /** Append-only CMP-022 record of the publish outcome; failing to record it changes nothing. */
  private async recordOutcome(credentialId: string, record: PublishRecord): Promise<void> {
    const succeeded = record.publish_status === 'PUBLISHED';
    await this.deps
      .credentialApi(this.deps.workload())
      .handle({
        method: 'POST',
        path: `/v1/credentials/${credentialId}/downstream-outcomes`,
        headers: { 'idempotency-key': `sample-lab.outcome.${record.publish_request_id}` },
        body: {
          channel: 'DIGILOCKER_PUBLISH',
          outcome: succeeded ? 'SUCCEEDED' : 'FAILED',
          outcome_ref: `cmp012.publish:${record.publish_request_id}`,
          ...(succeeded ? {} : { failure_code: record.failure_code ?? 'SF-INT-001' }),
        },
      })
      .catch(() => undefined);
  }
}

// ── Host routes ────────────────────────────────────────────────────────────────────────────

function errorBody(code: string, message: string, correlationId: string) {
  return { error_code: code, message, correlation_id: correlationId };
}

/**
 * `GET|POST /v1/applications/:applicationId/issuance` (CCR-M10-003, SAMPLE_LAB host only).
 * GET projects issuance + DigiLocker status for whoever CMP-015 lets read the case. POST runs the
 * post-approval sequence and is officer-only. Neither accepts a tenant, actor or step from the
 * client; the body of POST must be empty.
 */
export async function registerLabIssuanceRoutes(
  app: FastifyInstance,
  opts: {
    environment: string;
    coordinator: LabIssuanceCoordinator;
    resolveContext: (request: FastifyRequest) => Promise<RequestContext | null>;
  },
): Promise<void> {
  if (!ISSUANCE_ENVIRONMENTS.includes(opts.environment)) {
    throw new Error(`SF-M10-B-3: SIMULATED issuance is refused in ${opts.environment}`);
  }
  const route = '/v1/applications/:applicationId/issuance';
  const run = async (
    request: FastifyRequest<{ Params: { applicationId: string } }>,
    fn: (ctx: RequestContext, id: string) => Promise<unknown>,
  ) => {
    const ctx = await opts.resolveContext(request);
    if (!ctx) {
      return { status: 401, body: errorBody('SF-AUTH-001', 'Authentication required', request.id) };
    }
    const { applicationId } = request.params;
    if (!UUID.test(applicationId)) {
      return {
        status: 400,
        body: errorBody('SF-SYS-003', 'Request validation failed', request.id),
      };
    }
    try {
      return { status: 200, body: await fn(ctx, applicationId.toLowerCase()) };
    } catch (err) {
      const e = err instanceof IssuanceError ? err : componentError(err);
      return { status: e.statusCode, body: errorBody(e.code, e.message, ctx.correlation_id) };
    }
  };

  app.get<{ Params: { applicationId: string } }>(route, async (request, reply) => {
    const res = await run(request, (ctx, id) => opts.coordinator.status(ctx, id));
    return reply.code(res.status).header('cache-control', 'no-store').send(res.body);
  });

  app.post<{ Params: { applicationId: string }; Body: unknown }>(route, async (request, reply) => {
    const body = request.body;
    if (
      body !== undefined &&
      body !== null &&
      (typeof body !== 'object' || Object.keys(body).length > 0)
    ) {
      return reply.code(400).send(errorBody('SF-SYS-003', 'Request validation failed', request.id));
    }
    const res = await run(request, (ctx, id) => opts.coordinator.issue(ctx, id));
    return reply.code(res.status).header('cache-control', 'no-store').send(res.body);
  });
}
