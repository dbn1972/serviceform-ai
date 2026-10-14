import {
  buildCredentialService,
  createCredentialApi,
  type CaseIssuancePins,
  type CredentialRegistryPort,
  type RegistrationAck,
  type RegistrationRequest,
  type SigningAdapterResult,
  type SigningRequest,
  type StoredArtifactRef,
} from '../../../../services/cmp-022-credential-engine/src/index.js';
import {
  buildCredentialRegistryService,
  createCredentialStatusReadPort,
  createRegistryApi,
} from '../../../../services/cmp-024-credential-registry/src/index.js';
import {
  buildQrVerificationService,
  createQrApi,
  type IssuedCredentialView,
  type RegistryStatusRecord,
} from '../../../../services/cmp-023-qr-verification/src/index.js';
import {
  buildDigiLockerService,
  createDigilockerApi,
  SimulatedDigiLockerConnector,
  type ConnectorBindingView,
  type DigiLockerApiPort,
  type DigiLockerPublishRequest,
  type DigiLockerPublishResult,
} from '../../../../services/cmp-012-digilocker/src/index.js';
import { MemoryCredentialRepository } from '../../../../services/cmp-022-credential-engine/test/doubles/memory-repo.js';
import { MemoryRegistryRepository } from '../../../../services/cmp-024-credential-registry/test/doubles/memory-repo.js';
import { MemoryQrRepository } from '../../../../services/cmp-023-qr-verification/test/doubles/memory-repo.js';
import { MemoryDigilockerRepository } from '../../../../services/cmp-012-digilocker/test/doubles/memory-repo.js';
import {
  APPROVAL_REF,
  Clock,
  ctxFor,
  DL_BINDING_ID,
  ESIGN_BINDING_ID,
  ISSUER_REF,
  QR_WORKLOAD,
  RecordingAuthorizer,
  sha256Hex,
  SVC_VERSION_ID,
  T1,
  T2,
  TEMPLATE_ID,
  TEST_RUN_ID,
  TSB_ID,
  type Ctx,
  type DeploymentEnvironment,
} from './fixtures.js';

/**
 * Independent M07 seam wiring (SF-M07-INT). Uses each owner's published factory, handler and
 * in-memory repository double unchanged. Everything in this file is the stitcher's own adapter
 * code for the cross-component ports; no owner production code is modified or copied.
 *
 * Connectors are SIMULATED (INT-013) unless a test overrides the mode explicitly.
 */

type Neutral = {
  handle(req: {
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    query?: Record<string, string>;
    body?: unknown;
  }): Promise<{ status: number; headers?: Record<string, string>; body: unknown }>;
};

/** Upstream CMP-015 case/approval double: pins plus the recorded workflow decision ref. */
export class UpstreamCasePins {
  readonly byTenant = new Map<string, Map<string, CaseIssuancePins>>();

  approve(tenantId: string, applicationId: string, approved = true): void {
    const m = this.byTenant.get(tenantId) ?? new Map<string, CaseIssuancePins>();
    m.set(applicationId, {
      application_id: applicationId,
      tenant_service_binding_id: TSB_ID,
      service_version_id: SVC_VERSION_ID,
      credential_template_id: TEMPLATE_ID,
      credential_template_version: 1,
      approval_decision_ref: approved ? APPROVAL_REF : null,
    });
    this.byTenant.set(tenantId, m);
  }

  getIssuancePins(ctx: Ctx, applicationId: string): Promise<CaseIssuancePins | null> {
    const pins = this.byTenant.get(ctx.tenant_id)?.get(applicationId);
    return Promise.resolve(pins ? { ...pins } : null);
  }
}

/** CMP-032/033 render double: returns a stored-artifact reference, never bytes. */
export class RenderDouble {
  calls = 0;
  render(
    ctx: Ctx,
    req: { credential_id: string; idempotency_key: string },
  ): Promise<StoredArtifactRef> {
    this.calls += 1;
    return Promise.resolve({
      storage_key: `tenant/${ctx.tenant_id}/credentials/${req.credential_id}/render.pdf`,
      sha256: sha256Hex(`render:${req.idempotency_key}`),
    });
  }
}

/** INT-013 eSign adapter double. Mode and marker environment are set per test. */
export class EsignSigner {
  mode: 'REAL' | 'SANDBOX' | 'SIMULATED' = 'SIMULATED';
  markerEnvironment: DeploymentEnvironment = 'CI';
  omitMarker = false;
  outcome: 'SIGNED' | 'FAILED' | 'THROW' = 'SIGNED';
  calls: SigningRequest[] = [];

  sign(_ctx: Ctx, req: SigningRequest): Promise<SigningAdapterResult> {
    this.calls.push(req);
    if (this.outcome === 'THROW') return Promise.reject(new Error('esign unavailable'));
    const base: SigningAdapterResult = {
      connector_binding_id: ESIGN_BINDING_ID,
      integration_contract: 'INT-013',
      connector_mode: this.mode,
      signing_result: this.outcome,
      provider_transaction_ref: `esign-txn-${req.attempt_number}`,
    };
    if (this.mode === 'SIMULATED' && !this.omitMarker) {
      base.simulation_marker = {
        simulation: true,
        scenario: this.outcome === 'SIGNED' ? 'esign_success' : 'esign_failure',
        test_run_id: TEST_RUN_ID,
        connector_binding_id: ESIGN_BINDING_ID,
        environment: this.markerEnvironment as 'CI',
      };
    }
    if (this.outcome === 'SIGNED') {
      base.signature_ref = `tenant/credentials/${req.credential_id}/signed.pdf`;
      base.signed_artifact_sha256 = sha256Hex(`signed:${req.idempotency_key}`);
    } else {
      base.failure_code = 'SF-CRED-001';
    }
    return Promise.resolve(base);
  }
}

type RegistryService = ReturnType<typeof buildCredentialRegistryService>;
type CredentialService = ReturnType<typeof buildCredentialService>;

/**
 * CMP-022 → CMP-024 registration bridge (stitcher-owned host adapter). Passes the issuing
 * context through unchanged and supplies issuer_ref from tenant metadata, because the CMP-022
 * RegistrationRequest carries no issuer_ref while CMP-024 requires one.
 */
export class RegistryBridge implements CredentialRegistryPort {
  down = false;
  calls = 0;
  constructor(
    private readonly registry: () => RegistryService,
    private readonly issuerRefs: Map<string, string>,
  ) {}

  async register(ctx: Ctx, req: RegistrationRequest): Promise<RegistrationAck> {
    this.calls += 1;
    if (this.down) throw new Error('registry unavailable');
    const issuerRef = this.issuerRefs.get(ctx.tenant_id);
    if (issuerRef === undefined) throw new Error('issuer metadata missing');
    const body = { credential_id: req.credential_id, issuer_ref: issuerRef };
    const res = await this.registry().register(ctx, body, {
      key: req.idempotency_key,
      endpoint: 'POST /v1/credential-registry/credentials',
      fingerprint: sha256Hex(JSON.stringify(body)),
    });
    const status = (
      res.body as { credential_status: { credential_id: string; current_status: string } }
    ).credential_status;
    return {
      credential_id: status.credential_id,
      current_status: status.current_status as RegistrationAck['current_status'],
    };
  }
}

function isNotFound(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'SF-SYS-002';
}

/** Workload principal the host uses for CMP-023's context-free read ports. */
function qrWorkloadCtx(tenantId: string): Ctx {
  return ctxFor(tenantId, 'SYSTEM', QR_WORKLOAD);
}

/** CMP-023 → CMP-022 read bridge over the published CredentialService.get. */
export class CredentialReadBridge {
  down = false;
  constructor(private readonly credentials: () => CredentialService) {}

  async getCredential(p: {
    tenantId: string;
    credentialId: string;
  }): Promise<IssuedCredentialView | null> {
    if (this.down) throw new Error('credential engine unavailable');
    try {
      const res = await this.credentials().get(qrWorkloadCtx(p.tenantId), p.credentialId);
      const v = res.body as IssuedCredentialView & {
        artifacts: Array<{ artifact_kind: string; sha256: string }>;
      };
      return {
        tenant_id: v.tenant_id,
        credential_id: v.credential_id,
        lifecycle_status: v.lifecycle_status,
        ...(v.issued_at === undefined ? {} : { issued_at: v.issued_at }),
        artifacts: v.artifacts.map((a) => ({
          artifact_kind: a.artifact_kind as 'UNSIGNED_RENDER' | 'SIGNED_ARTIFACT',
          sha256: a.sha256,
        })),
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
}

/** CMP-023 → CMP-024 read bridge over the published createCredentialStatusReadPort. */
export class RegistryStatusBridge {
  down = false;
  constructor(private readonly registry: () => RegistryService) {}

  async getStatus(p: {
    tenantId: string;
    credentialId: string;
  }): Promise<RegistryStatusRecord | null> {
    if (this.down) throw new Error('registry unavailable');
    const port = createCredentialStatusReadPort(this.registry());
    try {
      const res = await port.getStatus(qrWorkloadCtx(p.tenantId), p.credentialId);
      const s = (
        res.body as {
          credential_status: RegistryStatusRecord & { superseded_by_credential_id?: string };
        }
      ).credential_status;
      return {
        tenant_id: s.tenant_id,
        credential_id: s.credential_id,
        issuer_ref: s.issuer_ref,
        status_authority_cmp: s.status_authority_cmp,
        current_status: s.current_status,
        ...(s.superseded_by_credential_id === undefined
          ? {}
          : { superseded_by_credential_id: s.superseded_by_credential_id }),
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
}

/** CMP-037 connector-binding double for DigiLocker (tenant metadata). */
export class DigiLockerBindings {
  readonly byTenant = new Map<string, ConnectorBindingView | null>();
  down = false;
  constructor(private readonly environment: DeploymentEnvironment) {
    for (const t of [T1, T2]) this.byTenant.set(t, this.simulated(t));
  }

  simulated(
    tenantId: string,
    overrides: { [K in keyof ConnectorBindingView]?: ConnectorBindingView[K] | undefined } = {},
  ): ConnectorBindingView {
    const base: ConnectorBindingView = {
      connector_binding_id: DL_BINDING_ID,
      tenant_id: tenantId,
      connector_type: 'DIGILOCKER',
      mode: 'SIMULATED',
      environment: this.environment,
      critical: true,
      secret_ref: null,
      simulator_version: '1.0.0',
    };
    const merged = { ...base, ...overrides };
    return Object.fromEntries(
      Object.entries(merged).filter(([, v]) => v !== undefined),
    ) as unknown as ConnectorBindingView;
  }

  resolve(tenantId: string): Promise<ConnectorBindingView | null> {
    return this.resolveDefault(tenantId);
  }

  resolveDefault(tenantId: string): Promise<ConnectorBindingView | null> {
    if (this.down) return Promise.reject(new Error('binding registry unavailable'));
    return Promise.resolve(this.byTenant.get(tenantId) ?? null);
  }
}

/** Wraps the owner's SimulatedDigiLockerConnector so a test can force an outage. */
export class DigiLockerApi implements DigiLockerApiPort {
  outage = false;
  calls: DigiLockerPublishRequest[] = [];
  readonly mode: 'REAL' | 'SANDBOX' | 'SIMULATED';
  constructor(private readonly inner: DigiLockerApiPort) {
    this.mode = inner.mode;
  }
  publish(request: DigiLockerPublishRequest): Promise<DigiLockerPublishResult> {
    this.calls.push(request);
    if (this.outage) return Promise.reject(new Error('digilocker unavailable'));
    return this.inner.publish(request);
  }
}

export function simulatedDigiLocker(
  environment: DeploymentEnvironment,
  scenario = 'digilocker_publish',
): DigiLockerApi {
  return new DigiLockerApi(
    new SimulatedDigiLockerConnector({
      simulation: true,
      scenario,
      test_run_id: TEST_RUN_ID,
      connector_binding_id: DL_BINDING_ID,
      environment: environment as 'CI',
    }),
  );
}

export interface StackOptions {
  credentialEnvironment?: DeploymentEnvironment | 'DEFAULT';
  digilockerEnvironment?: DeploymentEnvironment | 'DEFAULT';
  digilockerApi?: DigiLockerApi;
}

export interface CallOpts {
  ctx?: Ctx | null;
  key?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export type Cmp = 'CMP-022' | 'CMP-024' | 'CMP-023' | 'CMP-012';

export function buildStack(opts: StackOptions = {}) {
  const clock = new Clock();
  const authorizer = new RecordingAuthorizer();
  const repos = {
    credential: new MemoryCredentialRepository(),
    registry: new MemoryRegistryRepository(),
    qr: new MemoryQrRepository(),
    digilocker: new MemoryDigilockerRepository(),
  };
  const casePins = new UpstreamCasePins();
  const renderer = new RenderDouble();
  const signer = new EsignSigner();
  const issuerRefs = new Map([
    [T1, ISSUER_REF],
    [T2, `${ISSUER_REF}-t2`],
  ]);

  const registryService = buildCredentialRegistryService({
    repository: repos.registry,
    authorizer,
    clock: clock.now,
  });
  const registryBridge = new RegistryBridge(() => registryService, issuerRefs);
  const credentialEnv = opts.credentialEnvironment ?? 'CI';
  const credentialService = buildCredentialService({
    repository: repos.credential,
    authorizer,
    casePins,
    renderer,
    signing: signer,
    registry: registryBridge,
    ...(credentialEnv === 'DEFAULT' ? {} : { environment: credentialEnv }),
    clock: clock.now,
  });
  const credentialRead = new CredentialReadBridge(() => credentialService);
  const statusRead = new RegistryStatusBridge(() => registryService);
  const qrService = buildQrVerificationService({
    repository: repos.qr,
    authorizer,
    registry: statusRead,
    credentials: credentialRead,
    clock: clock.now,
  });
  const dlEnv = opts.digilockerEnvironment ?? 'CI';
  const bindings = new DigiLockerBindings(dlEnv === 'DEFAULT' ? 'LOCAL' : dlEnv);
  const digilockerApi =
    opts.digilockerApi ?? simulatedDigiLocker(dlEnv === 'DEFAULT' ? 'LOCAL' : dlEnv);
  const digilockerService = buildDigiLockerService({
    repository: repos.digilocker,
    authorizer,
    connectorBinding: bindings,
    digilockerApi,
    ...(dlEnv === 'DEFAULT' ? {} : { runtimeEnvironment: dlEnv }),
    clock: clock.now,
  });

  const state: { ctx: Ctx | null } = { ctx: ctxFor(T1) };
  const resolveContext = () => Promise.resolve(state.ctx);
  const apis: Record<Cmp, Neutral> = {
    'CMP-022': createCredentialApi({ service: credentialService, resolveContext }) as Neutral,
    'CMP-024': createRegistryApi({ service: registryService, resolveContext }) as Neutral,
    'CMP-023': createQrApi({ service: qrService, resolveContext }) as Neutral,
    'CMP-012': createDigilockerApi({ service: digilockerService, resolveContext }) as Neutral,
  };

  let counter = 0;
  // Response bodies are heterogeneous component JSON; tests assert on them structurally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Body = any;
  async function call(
    cmp: Cmp,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    o: CallOpts = {},
  ): Promise<{ status: number; body: Body }> {
    counter += 1;
    clock.advance(1000);
    if (o.ctx !== undefined) state.ctx = o.ctx;
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (method === 'POST' && o.key !== null) {
      headers['idempotency-key'] = o.key ?? `m07-int-key-${String(counter).padStart(6, '0')}`;
    }
    const res = await apis[cmp].handle({
      method,
      path,
      headers,
      ...(o.query ? { query: o.query } : { query: {} }),
      ...(body === undefined ? {} : { body }),
    });
    return { status: res.status, body: res.body };
  }

  /** True when any component repository currently holds an open transaction. */
  function anyTxOpen(): boolean {
    return (
      repos.credential.inTransaction() ||
      repos.registry.inTransaction() ||
      repos.qr.inTransaction() ||
      repos.digilocker.inTransaction()
    );
  }

  return {
    clock,
    authorizer,
    repos,
    casePins,
    renderer,
    signer,
    issuerRefs,
    registryBridge,
    credentialRead,
    statusRead,
    bindings,
    digilockerApi,
    services: {
      credential: credentialService,
      registry: registryService,
      qr: qrService,
      digilocker: digilockerService,
    },
    apis,
    state,
    call,
    anyTxOpen,
  };
}

export type Stack = ReturnType<typeof buildStack>;
