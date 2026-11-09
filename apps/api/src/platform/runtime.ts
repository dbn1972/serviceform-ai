import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ApplicationCaseService,
  DenyServicePolicyPort,
  type CaseView,
  PgCaseStore,
  SimulatedPublishedBindingPort,
  type DeploymentEnvironment,
  type PublishedBinding,
  type PublishedBindingPort,
} from '@serviceform/cmp-015-application-case';
import type { RequestContext } from '@serviceform/contracts';
import { OpaPdpClient } from '@serviceform/security';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import type { M02PluginMounts } from '../composition/m02.js';
import type { M03PluginMounts } from '../composition/m03.js';
import type { M04PluginMounts } from '../composition/m04.js';
import type { M05PluginMounts } from '../composition/m05.js';
import type { M07PluginMounts } from '../composition/m07.js';
import type { Wave2PluginMounts } from '../composition/wave2.js';
import type { ReadinessCheck } from '../plugins/health.js';
import {
  placementContextResolver,
  type PrincipalPort,
  type SessionContextPort,
} from './context.js';
import {
  CaseIssuancePinsBridge,
  CredentialVerificationBridge,
  LabDigiLockerBinding,
  LabIssuanceCoordinator,
  parseIssuanceFixture,
  RegistryBridge,
  registerLabIssuanceRoutes,
  SimulatedEsignBridge,
  SimulatedRenderBridge,
  workloadContext,
  type CaseServiceLike,
  type NeutralFactory,
} from './issuance.js';
import { loadPlacement, type PortalPlacement } from './placement.js';
import { composeLabPrivacy, parseConsentFixture, type Cmp030Module } from './profile.js';
import {
  assertSimulatorEnvironment,
  registerLabSimulators,
  SimulatedOtpInbox,
  type LabOfficer,
  type MintAssertion,
  type OtpAdapterLike,
} from './simulators.js';
import {
  assertTemporalAddress,
  assertTemporalNamespace,
  composeLabWorkflow,
  type Cmp016Module,
  type Cmp016SdkModule,
  type LabWorkflowBridge,
  type LabWorkflowFixture,
  type WorkflowLogger,
} from './workflow.js';

/**
 * SF-M10-B-2/B-2c/B-2d/B-3 SAMPLE_LAB platform host: CMP-004 identity, CMP-009 dynamic forms,
 * CMP-015 application/case on PostgreSQL (FORCE RLS, one runtime login per component per ADR-0006)
 * with real OPA as the PDP, CMP-016 sequencing on Temporal after each CMP-015 commit (B-2c),
 * CMP-005 citizen profile and CMP-030 consent with a SIMULATED privacy publication (B-2d), and
 * the M07 issuance chain (CMP-022 credential engine, CMP-024 registry, CMP-012 DigiLocker publish)
 * on approve/issue (B-3). Connectors are SIMULATED (OTP, IdP, DigiLocker identity and publish,
 * eSign, render, published-binding and published-form ports) and the whole runtime refuses to start
 * outside LOCAL/CI. Host composition only: no domain logic.
 */
export interface PlatformLabEnv {
  SF_ENVIRONMENT?: string;
  SF_PLATFORM_LAB_DIR?: string;
  DATABASE_URL_CMP004?: string;
  DATABASE_URL_CMP015?: string;
  DATABASE_URL_CMP009?: string;
  DATABASE_URL_CMP016?: string;
  DATABASE_URL_CMP022?: string;
  DATABASE_URL_CMP024?: string;
  DATABASE_URL_CMP012?: string;
  DATABASE_URL_CMP005?: string;
  DATABASE_URL_CMP030?: string;
  DATABASE_URL_CMP033?: string;
  DATABASE_URL_CMP051?: string;
  DATABASE_URL_CMP052?: string;
  SF_TEMPORAL_ADDRESS?: string;
  SF_TEMPORAL_NAMESPACE?: string;
  SF_TEMPORAL_TASK_QUEUE?: string;
  SF_CMP004_PEPPER?: string;
  SF_OPA_URL?: string;
  SF_OPA_TOKEN?: string;
  /**
   * CMP-004 per-IP limit. Every portal request reaches the host from the BFF's address, so the
   * limit is per portal instance until the BFF forwards the client address through a trusted hop.
   */
  SF_IDENTITY_RATE_LIMIT_MAX?: string;
  /** CMP-009 per-IP limit; same single-BFF-address caveat as the identity limit. */
  SF_FORMS_RATE_LIMIT_MAX?: string;
  /** CMP-005 per-IP limit; same single-BFF-address caveat as the identity limit. */
  SF_PROFILE_RATE_LIMIT_MAX?: string;
  /** CMP-033/051/052 studio/admin per-IP limit; same single-BFF-address caveat. */
  SF_STUDIO_RATE_LIMIT_MAX?: string;
}

export interface PlatformLab {
  placement: PortalPlacement;
  m02: M02PluginMounts;
  /** SF-M10-B-4: CMP-033/051/052 mounted when DATABASE_URL_CMP033/051/052 are set. */
  m03?: M03PluginMounts;
  m04: M04PluginMounts;
  m05: M05PluginMounts;
  m07: M07PluginMounts;
  wave2: Wave2PluginMounts;
  readinessChecks: ReadinessCheck[];
  registerSimulators(app: FastifyInstance): Promise<void>;
  /** CCR-M10-003 `/v1/applications/:id/issuance` (post-approval issuance + status projection). */
  registerIssuance(app: FastifyInstance): Promise<void>;
  /**
   * Publishes the SAMPLE_LAB privacy purposes (CMP-030), connects Temporal, seeds the pinned
   * workflow versions and starts the CMP-016 worker.
   */
  start(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Starts the CMP-016 instance once the CMP-015 draft has committed. CMP-015 never waits on it:
 * the draft response is unchanged when the start is deferred, and the first committed transition
 * retries the start.
 */
class SequencedApplicationCaseService extends ApplicationCaseService {
  constructor(
    deps: ConstructorParameters<typeof ApplicationCaseService>[0],
    private readonly sequencing: LabWorkflowBridge,
  ) {
    super(deps);
  }

  override async createDraft(rawCtx: unknown, rawBody: unknown, rawKey: unknown) {
    const result = await super.createDraft(rawCtx, rawBody, rawKey);
    const application = (result.body as { application?: CaseView } | undefined)?.application;
    if (result.status === 201 && !result.replayed && application) {
      const ctx = rawCtx as { tenant_id: string; correlation_id: string };
      await this.sequencing.onDraftCreated({
        tenant_id: ctx.tenant_id,
        application_id: application.application_id,
        workflow_version_id: application.pins.workflow_version_id,
        correlation_id: ctx.correlation_id,
      });
    }
    return result;
  }
}

interface Cmp004Module {
  IdentityService: new (opts: Record<string, unknown>) => unknown;
  PgSessionDirectory: new (pool: pg.Pool) => unknown;
  IdentityPrincipalVerifier: new (directory: unknown) => PrincipalPort;
  IdentityContextResolver: new (directory: unknown, cellId: string) => SessionContextPort;
  SimulatedOtpAdapter: new (binding: unknown, pepper: string) => OtpAdapterLike;
  SimulatedIdpAdapter: new (binding: unknown, pepper: string) => unknown;
  SimulatedDigiLockerIdentityAdapter: new (binding: unknown, pepper: string) => unknown;
  PgCitizenSubjectDirectory: new (pool: pg.Pool) => {
    exists: (input: { tenant_id: string; subject_id: string }) => Promise<boolean>;
  };
  simulatedBinding: (params: {
    id: string;
    connector_type: string;
    environment?: string;
    simulator_version: string;
  }) => unknown;
  mintSimulatedIdpAssertion: (pepper: string, claims: Parameters<MintAssertion>[0]) => string;
  outboxAuditRecorder: unknown;
}

interface Cmp009Module {
  loadConfig: (env: NodeJS.ProcessEnv) => unknown;
  SimulatedFormDefinitionPort: new (config: unknown) => {
    publish(form: {
      tenant_id: string;
      form_key: string;
      version_id: string;
      content_hash: string;
      status: 'PUBLISHED';
      payload: unknown;
    }): void;
  };
  IdentityLocalizationPort: new () => unknown;
}

interface Cmp022Module {
  buildCredentialService(opts: Record<string, unknown>): {
    get(ctx: unknown, credentialId: string): Promise<{ status: number; body: unknown }>;
  };
  createCredentialApi: NeutralFactory;
  PgCredentialRepository: new (pool: pg.Pool) => unknown;
}

interface Cmp024Module {
  buildCredentialRegistryService(opts: Record<string, unknown>): unknown;
  createRegistryApi: NeutralFactory;
  PgRegistryRepository: new (pool: pg.Pool) => unknown;
}

interface Cmp012Module {
  buildDigiLockerService(opts: Record<string, unknown>): unknown;
  createDigilockerApi: NeutralFactory;
  PgDigilockerRepository: new (pool: pg.Pool) => unknown;
  SimulatedDigiLockerConnector: new (marker: {
    simulation: true;
    scenario: string;
    test_run_id: string;
    connector_binding_id: string;
    environment: string;
  }) => unknown;
}

interface Cmp033Module {
  registerMetadata: (app: import('fastify').FastifyInstance, opts: unknown) => Promise<void>;
  SimulatedSchemaRegistry: new () => unknown;
}

interface Cmp051Module {
  registerMakerChecker: (app: import('fastify').FastifyInstance, opts: unknown) => Promise<void>;
  SimulatedMetadataPort: new () => unknown;
  SimulatedVersioningPort: new () => unknown;
  OffAiValidationPort: new () => unknown;
}

interface Cmp052Module {
  registerVersioning: (app: import('fastify').FastifyInstance, opts: unknown) => Promise<void>;
  SimulatedApprovalPort: new (
    config: {
      environment: string;
      approvalMode: string;
      scenario: string;
      testRunId: string;
      approvalBindingId: string;
    },
    allow: boolean,
  ) => unknown;
}

/**
 * SF-M10-B-4 host adapter: resolves CMP-015 PublishedBinding pins from CMP-052's pool.
 * Falls back to the fixture-seeded SimulatedPublishedBindingPort when CMP-052 has no PUBLISHED row.
 * LOCAL/CI only — guarded upstream by assertSimulatorEnvironment.
 */
class Cmp052PublishedBindingPort implements PublishedBindingPort {
  constructor(
    private readonly pool: pg.Pool,
    private readonly fallback: SimulatedPublishedBindingPort,
    /** binding_id → service_id, from the fixture (CMP-052 does not store service_id). */
    private readonly serviceIds: Map<string, string>,
  ) {}

  async resolve(params: {
    tenant_id: string;
    tenant_service_binding_id: string;
  }): Promise<PublishedBinding | null> {
    const { tenant_id, tenant_service_binding_id } = params;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant_id]);
      const res = await client.query<{
        binding_id: string;
        pins: Record<string, { version_ref: string }>;
      }>(
        `SELECT binding_id, pins
           FROM sf_versioning.tenant_service_binding
          WHERE tenant_id = $1 AND binding_id = $2 AND status = 'PUBLISHED'`,
        [tenant_id, tenant_service_binding_id],
      );
      await client.query('COMMIT');
      const row = res.rows[0];
      if (!row) return this.fallback.resolve(params);
      const map = row.pins;
      const serviceId = this.serviceIds.get(tenant_service_binding_id);
      if (!serviceId) return this.fallback.resolve(params);
      return {
        tenant_service_binding_id,
        service_id: serviceId,
        status: 'PUBLISHED',
        pins: {
          tenant_service_binding_id,
          form_version_id: map['form']?.version_ref ?? '',
          rule_version_id: map['rules']?.version_ref ?? '',
          workflow_version_id: map['workflow']?.version_ref ?? '',
          evidence_policy_version_id: map['evidence']?.version_ref ?? '',
          sla_policy_version_id: map['sla']?.version_ref ?? '',
          ...(map['fee'] ? { fee_policy_version_id: map['fee'].version_ref } : {}),
          ...(map['credential']
            ? { credential_template_version_id: map['credential'].version_ref }
            : {}),
          ...(map['notification']
            ? { notification_version_id: map['notification'].version_ref }
            : {}),
          ...(map['authorization_policy']
            ? { authorization_policy_version_id: map['authorization_policy'].version_ref }
            : {}),
        } as PublishedBinding['pins'],
      };
    } catch {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      return this.fallback.resolve(params);
    } finally {
      client.release();
    }
  }
}

const BINDING_IDS = {
  otp: '0d15ba00-0c01-4000-8000-0d15ba000c01',
  idp: '0d15ba00-0c02-4000-8000-0d15ba000c02',
  digilocker: '0d15ba00-0c03-4000-8000-0d15ba000c03',
  forms: '0d15ba00-0c09-4000-8000-0d15ba000c09',
  profileDigilocker: '0d15ba00-0c05-4000-8000-0d15ba000c05',
} as const;

/** Structural subset of `@serviceform/service-templates` used by the host. */
interface TemplateVersionLike {
  version_id: string;
  status: string;
  content_hash: string;
  form: { form_id: string };
}

interface TemplatesModule {
  listTemplates(): readonly { catalogue_id: string; versions: readonly TemplateVersionLike[] }[];
  publishedVersion(template: {
    versions: readonly TemplateVersionLike[];
  }): TemplateVersionLike | null;
}

interface TemplateIntegrityModule {
  assertVersionIntegrity(version: TemplateVersionLike): void;
}

// Non-literal specifiers keep the bundler-resolved catalogue sources out of this NodeNext program.
const TEMPLATES_SPECIFIER = '@serviceform/service-templates';
const templates = {
  catalogue: (await import(TEMPLATES_SPECIFIER)) as TemplatesModule,
  integrity: (await import(`${TEMPLATES_SPECIFIER}/integrity`)) as TemplateIntegrityModule,
};

async function loadComponent<T>(pkg: string, dir: string, entry = 'index.ts'): Promise<T> {
  const specifiers = [
    pkg,
    new URL(`../../../../services/${dir}/src/${entry}`, import.meta.url).href,
  ];
  let last: unknown;
  for (const specifier of specifiers) {
    try {
      return (await import(specifier)) as T;
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

function required(env: PlatformLabEnv, name: keyof PlatformLabEnv): string {
  const value = env[name];
  if (!value) throw new Error(`Invalid configuration for: ${name}`);
  return value;
}

function positiveInt(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000)
    throw new Error(`Invalid configuration for: ${name}`);
  return n;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function poolReadiness(name: string, pool: pg.Pool): ReadinessCheck {
  return {
    name,
    async check() {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
    },
  };
}

/**
 * SIMULATED publication of the Studio template catalogue (replaced by CMP-052 in slice B-4). The
 * binding's pinned form version must be a PUBLISHED catalogue version whose recorded content hash
 * still matches its form, or the host refuses to start.
 */
export function publishedFormFor(catalogueId: string, formVersionId: string, tenantId: string) {
  const template = templates.catalogue.listTemplates().find((t) => t.catalogue_id === catalogueId);
  const version = template ? templates.catalogue.publishedVersion(template) : null;
  if (!version || version.version_id !== formVersionId) {
    throw new Error(`SF-M10: no PUBLISHED form version ${formVersionId} for ${catalogueId}`);
  }
  templates.integrity.assertVersionIntegrity(version);
  return {
    tenant_id: tenantId,
    form_key: version.form.form_id,
    version_id: version.version_id,
    content_hash: version.content_hash,
    status: 'PUBLISHED' as const,
    payload: version.form,
  };
}

export async function buildPlatformLab(
  env: PlatformLabEnv,
  opts: { logger?: WorkflowLogger } = {},
): Promise<PlatformLab> {
  const environment = env.SF_ENVIRONMENT ?? 'LOCAL';
  assertSimulatorEnvironment(environment);
  const dir = required(env, 'SF_PLATFORM_LAB_DIR');
  const pepper = required(env, 'SF_CMP004_PEPPER');
  if (pepper.length < 32) throw new Error('Invalid configuration for: SF_CMP004_PEPPER');
  const placement = loadPlacement(join(dir, 'placement.citizen.json'), environment);
  const temporal = {
    address: assertTemporalAddress(env.SF_TEMPORAL_ADDRESS),
    namespace: assertTemporalNamespace(env.SF_TEMPORAL_NAMESPACE),
    taskQueue: required(env, 'SF_TEMPORAL_TASK_QUEUE'),
  };

  const pools = {
    cmp004: new pg.Pool({ connectionString: required(env, 'DATABASE_URL_CMP004'), max: 8 }),
    cmp009: new pg.Pool({ connectionString: required(env, 'DATABASE_URL_CMP009'), max: 8 }),
    cmp015: new pg.Pool({ connectionString: required(env, 'DATABASE_URL_CMP015'), max: 8 }),
    cmp016: new pg.Pool({ connectionString: required(env, 'DATABASE_URL_CMP016'), max: 8 }),
    cmp022: new pg.Pool({ connectionString: required(env, 'DATABASE_URL_CMP022'), max: 4 }),
    cmp024: new pg.Pool({ connectionString: required(env, 'DATABASE_URL_CMP024'), max: 4 }),
    cmp012: new pg.Pool({ connectionString: required(env, 'DATABASE_URL_CMP012'), max: 4 }),
    cmp005: new pg.Pool({ connectionString: required(env, 'DATABASE_URL_CMP005'), max: 8 }),
    cmp030: new pg.Pool({ connectionString: required(env, 'DATABASE_URL_CMP030'), max: 8 }),
    // SF-M10-B-4: optional — only created when env vars are present
    ...(env.DATABASE_URL_CMP033
      ? { cmp033: new pg.Pool({ connectionString: env.DATABASE_URL_CMP033, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP051
      ? { cmp051: new pg.Pool({ connectionString: env.DATABASE_URL_CMP051, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP052
      ? { cmp052: new pg.Pool({ connectionString: env.DATABASE_URL_CMP052, max: 4 }) }
      : {}),
  } as {
    cmp004: pg.Pool;
    cmp009: pg.Pool;
    cmp015: pg.Pool;
    cmp016: pg.Pool;
    cmp022: pg.Pool;
    cmp024: pg.Pool;
    cmp012: pg.Pool;
    cmp005: pg.Pool;
    cmp030: pg.Pool;
    cmp033?: pg.Pool;
    cmp051?: pg.Pool;
    cmp052?: pg.Pool;
  };
  const opa = new OpaPdpClient({
    opaUrl: required(env, 'SF_OPA_URL'),
    timeoutMs: 1000,
    ...(env.SF_OPA_TOKEN ? { token: env.SF_OPA_TOKEN } : {}),
  });

  const cmp004 = await loadComponent<Cmp004Module>(
    '@serviceform/cmp-004-identity-access',
    'cmp-004-identity-access',
  );
  const binding = (id: string, connector_type: string, simulator_version: string) =>
    cmp004.simulatedBinding({ id, connector_type, environment, simulator_version });
  const inbox = new SimulatedOtpInbox();
  const directory = new cmp004.PgSessionDirectory(pools.cmp004);
  const verifier = new cmp004.IdentityPrincipalVerifier(directory);
  const sessions = new cmp004.IdentityContextResolver(directory, placement.cell_id);
  const commands = new cmp004.IdentityService({
    pool: pools.cmp004,
    pepper,
    otp: inbox.wrap(
      new cmp004.SimulatedOtpAdapter(binding(BINDING_IDS.otp, 'OTP', 'otp-sim-1'), pepper),
    ),
    idp: new cmp004.SimulatedIdpAdapter(
      binding(BINDING_IDS.idp, 'DEPARTMENT_API', 'idp-sim-1'),
      pepper,
    ),
    digilocker: new cmp004.SimulatedDigiLockerIdentityAdapter(
      binding(BINDING_IDS.digilocker, 'DIGILOCKER', 'dl-sim-1'),
      pepper,
    ),
    authorizer: opa,
    audit: cmp004.outboxAuditRecorder,
    clock: () => new Date(),
    testRunId: `platform-lab-${placement.portal_id}`,
  });

  const simulatedBindings = new SimulatedPublishedBindingPort();
  const published = readJson<{
    bindings: (PublishedBinding & { tenant_id: string; catalogue_id: string })[];
  }>(join(dir, 'published-bindings.json'));
  const offered = new Set(placement.offerings.map((o) => o.tenant_service_binding_id));
  const offeredBindings = published.bindings.filter(
    (b) => b.tenant_id === placement.tenant_id && offered.has(b.tenant_service_binding_id),
  );
  for (const b of offeredBindings) {
    simulatedBindings.put(b.tenant_id, {
      tenant_service_binding_id: b.tenant_service_binding_id,
      service_id: b.service_id,
      status: 'PUBLISHED',
      pins: b.pins,
    });
  }
  // SF-M10-B-4: prefer CMP-052 DB bindings when available; fall back to fixture.
  const serviceIdMap = new Map(
    published.bindings.map((b) => [b.tenant_service_binding_id, b.service_id]),
  );
  const bindings: PublishedBindingPort = pools.cmp052
    ? new Cmp052PublishedBindingPort(pools.cmp052, simulatedBindings, serviceIdMap)
    : simulatedBindings;
  const [cmp016, cmp016Sdk] = await Promise.all([
    loadComponent<Cmp016Module>('@serviceform/cmp-016-workflow-engine', 'cmp-016-workflow-engine'),
    loadComponent<Cmp016SdkModule>(
      '@serviceform/cmp-016-workflow-engine/temporal-sdk',
      'cmp-016-workflow-engine',
      'temporal/sdk/index.ts',
    ),
  ]);
  const workflow = composeLabWorkflow({
    environment,
    cmp016,
    sdk: cmp016Sdk,
    pool: pools.cmp016,
    pdp: opa,
    fixture: readJson<LabWorkflowFixture>(join(dir, 'workflow.json')),
    pins: offeredBindings.map((b) => ({
      tenant_id: b.tenant_id,
      catalogue_id: b.catalogue_id,
      workflow_version_id: b.pins.workflow_version_id,
    })),
    cellId: placement.cell_id,
    temporal,
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
  const applicationCase = new SequencedApplicationCaseService(
    {
      store: new PgCaseStore(pools.cmp015),
      authorizer: opa,
      bindings,
      servicePolicy: new DenyServicePolicyPort(),
      workflow: workflow.bridge,
      config: { environment: environment as DeploymentEnvironment },
    },
    workflow.bridge,
  );

  const cmp009 = await loadComponent<Cmp009Module>(
    '@serviceform/cmp-009-dynamic-forms',
    'cmp-009-dynamic-forms',
  );
  const formsConfig = cmp009.loadConfig({
    SF_ENVIRONMENT: environment,
    SF_CMP009_FORM_SOURCE_MODE: 'SIMULATED',
    SF_CMP009_LOCALIZATION_MODE: 'OFF',
    SF_CMP009_FORM_SOURCE_BINDING_ID: BINDING_IDS.forms,
    SF_CMP009_TEST_RUN_ID: `platform-lab-${placement.portal_id}`,
    SF_CMP009_SCENARIO: 'sample_lab_published_form',
    SF_CMP009_RATE_LIMIT_MAX: positiveInt(
      env.SF_FORMS_RATE_LIMIT_MAX ?? '120',
      'SF_FORMS_RATE_LIMIT_MAX',
    ).toString(),
  });
  const forms = new cmp009.SimulatedFormDefinitionPort(formsConfig);
  for (const b of offeredBindings) {
    forms.publish(publishedFormFor(b.catalogue_id, b.pins.form_version_id, placement.tenant_id));
  }

  const officers = readJson<{ officers: LabOfficer[] }>(join(dir, 'officers.json')).officers.filter(
    (o) => o.tenant_id === placement.tenant_id,
  );

  const issuance = parseIssuanceFixture(
    readJson<unknown>(join(dir, 'issuance.json')),
    placement.tenant_id,
    environment,
    `platform-lab-${placement.portal_id}`,
  );
  const workload = () => workloadContext(issuance, placement.cell_id);
  const [cmp022, cmp024, cmp012] = await Promise.all([
    loadComponent<Cmp022Module>(
      '@serviceform/cmp-022-credential-engine',
      'cmp-022-credential-engine',
    ),
    loadComponent<Cmp024Module>(
      '@serviceform/cmp-024-credential-registry',
      'cmp-024-credential-registry',
    ),
    loadComponent<Cmp012Module>('@serviceform/cmp-012-digilocker', 'cmp-012-digilocker'),
  ]);
  const cases = applicationCase as unknown as CaseServiceLike;
  const registry = cmp024.buildCredentialRegistryService({
    repository: new cmp024.PgRegistryRepository(pools.cmp024),
    authorizer: opa,
  });
  const bound = (factory: NeutralFactory, service: unknown) => (ctx: RequestContext) =>
    factory({ service, resolveContext: async () => ctx });
  const credential = cmp022.buildCredentialService({
    repository: new cmp022.PgCredentialRepository(pools.cmp022),
    authorizer: opa,
    casePins: new CaseIssuancePinsBridge(cases, issuance.templates),
    renderer: new SimulatedRenderBridge(),
    signing: new SimulatedEsignBridge(issuance),
    registry: new RegistryBridge(bound(cmp024.createRegistryApi, registry), issuance),
    environment,
  });
  const digilocker = cmp012.buildDigiLockerService({
    repository: new cmp012.PgDigilockerRepository(pools.cmp012),
    authorizer: opa,
    connectorBinding: new LabDigiLockerBinding(issuance),
    credentialVerification: new CredentialVerificationBridge(credential, workload),
    digilockerApi: new cmp012.SimulatedDigiLockerConnector({
      simulation: true,
      scenario: 'digilocker_publish',
      test_run_id: issuance.test_run_id,
      connector_binding_id: issuance.digilocker_binding_id,
      environment,
    }),
    runtimeEnvironment: environment,
  });
  const coordinator = new LabIssuanceCoordinator({
    config: issuance,
    cases,
    credentialApi: bound(cmp022.createCredentialApi, credential),
    digilockerApi: bound(cmp012.createDigilockerApi, digilocker),
    workload,
  });
  const resolveContext = placementContextResolver({ verifier, sessions, placement });
  const cmp030 = await loadComponent<Cmp030Module>(
    '@serviceform/cmp-030-consent-privacy',
    'cmp-030-consent-privacy',
  );
  const privacy = composeLabPrivacy({
    environment,
    cmp030,
    pool: pools.cmp030,
    pdp: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
    fixture: parseConsentFixture(readJson<unknown>(join(dir, 'consent.json'))),
    placement,
  });

  // SF-M10-B-4: mount CMP-033/051/052 when pool env vars are present.
  let m03: M03PluginMounts | undefined;
  if (pools.cmp033 && pools.cmp051 && pools.cmp052) {
    // studioRateMax: consumed via each component's loadConfig() defaulting to env vars.
    const [cmp033, cmp051, cmp052] = await Promise.all([
      loadComponent<Cmp033Module>('@serviceform/cmp-033-metadata', 'cmp-033-metadata'),
      loadComponent<Cmp051Module>('@serviceform/cmp-051-maker-checker', 'cmp-051-maker-checker'),
      loadComponent<Cmp052Module>('@serviceform/cmp-052-versioning', 'cmp-052-versioning'),
    ]);
    m03 = {
      metadata: {
        pool: pools.cmp033,
        resolveContext,
        authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
        registry: new cmp033.SimulatedSchemaRegistry(),
        clock: () => new Date(),
      },
      makerChecker: {
        pool: pools.cmp051,
        resolveContext,
        authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
        metadata: new cmp051.SimulatedMetadataPort(),
        versioning: new cmp051.SimulatedVersioningPort(),
        ai: new cmp051.OffAiValidationPort(),
        clock: () => new Date(),
      },
      versioning: {
        pool: pools.cmp052,
        resolveContext,
        authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
        approval: new cmp052.SimulatedApprovalPort(
          {
            environment,
            approvalMode: 'SIMULATED',
            scenario: 'sample_lab_maker_checker',
            testRunId: `platform-lab-${placement.portal_id}`,
            approvalBindingId: '05200000-0000-4000-8000-000000000052',
          },
          true,
        ) as unknown as NonNullable<M03PluginMounts['versioning']>['approval'],
        clock: () => new Date(),
      },
    };
  }

  return {
    placement,
    m02: {
      identityAccess: {
        commands,
        verifier,
        resolveContext: sessions as unknown as NonNullable<
          M02PluginMounts['identityAccess']
        >['resolveContext'],
        cellId: placement.cell_id,
        ...(env.SF_IDENTITY_RATE_LIMIT_MAX
          ? {
              rateLimitMax: positiveInt(
                env.SF_IDENTITY_RATE_LIMIT_MAX,
                'SF_IDENTITY_RATE_LIMIT_MAX',
              ),
            }
          : {}),
      },
      citizenProfile: {
        pool: pools.cmp005,
        resolveContext,
        authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
        consentAccess: privacy.consentAccess,
        subjectDirectory: new cmp004.PgCitizenSubjectDirectory(pools.cmp004),
        deploymentEnvironment: environment as DeploymentEnvironment,
        digiLockerBinding: {
          ...(binding(BINDING_IDS.profileDigilocker, 'DIGILOCKER', 'dl-profile-sim-1') as object),
          tenant_id: placement.tenant_id,
        } as NonNullable<M02PluginMounts['citizenProfile']>['digiLockerBinding'],
        ...(env.SF_PROFILE_RATE_LIMIT_MAX
          ? {
              rateLimitMax: positiveInt(env.SF_PROFILE_RATE_LIMIT_MAX, 'SF_PROFILE_RATE_LIMIT_MAX'),
            }
          : {}),
      },
    },
    m04: {
      forms: {
        pool: pools.cmp009,
        resolveContext,
        authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
        forms,
        localization: new cmp009.IdentityLocalizationPort(),
        config: formsConfig,
      },
    },
    m05: {
      applicationCase: {
        service: applicationCase,
        resolveContext,
      },
    },
    wave2: {
      consentPrivacy: {
        pool: pools.cmp030,
        resolveContext,
        authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
      },
    },
    ...(m03 ? { m03 } : {}),
    m07: {
      credential: { service: credential, resolveContext },
      registry: { service: registry, resolveContext },
      digilocker: { service: digilocker, resolveContext },
    },
    readinessChecks: [
      poolReadiness('cmp004-db', pools.cmp004),
      poolReadiness('cmp009-db', pools.cmp009),
      poolReadiness('cmp015-db', pools.cmp015),
      poolReadiness('cmp016-db', pools.cmp016),
      poolReadiness('cmp022-db', pools.cmp022),
      poolReadiness('cmp024-db', pools.cmp024),
      poolReadiness('cmp012-db', pools.cmp012),
      poolReadiness('cmp005-db', pools.cmp005),
      poolReadiness('cmp030-db', pools.cmp030),
      ...(pools.cmp033 ? [poolReadiness('cmp033-db', pools.cmp033)] : []),
      ...(pools.cmp051 ? [poolReadiness('cmp051-db', pools.cmp051)] : []),
      ...(pools.cmp052 ? [poolReadiness('cmp052-db', pools.cmp052)] : []),
      ...workflow.readinessChecks,
    ],
    registerSimulators: (app) =>
      registerLabSimulators(app, {
        environment,
        inbox,
        officers,
        mint: (claims) => cmp004.mintSimulatedIdpAssertion(pepper, claims),
      }),
    registerIssuance: (app) =>
      registerLabIssuanceRoutes(app, { environment, coordinator, resolveContext }),
    async start() {
      await privacy.publish();
      await workflow.start();
    },
    async close() {
      await workflow.close();
      await privacy.close();
      await Promise.all(Object.values(pools).map((p) => p.end()));
    },
  };
}
