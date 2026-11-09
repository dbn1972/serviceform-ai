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
} from '@serviceform/cmp-015-application-case';
import { OpaPdpClient } from '@serviceform/security';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import type { M02PluginMounts } from '../composition/m02.js';
import type { M04PluginMounts } from '../composition/m04.js';
import type { M05PluginMounts } from '../composition/m05.js';
import type { ReadinessCheck } from '../plugins/health.js';
import {
  placementContextResolver,
  type PrincipalPort,
  type SessionContextPort,
} from './context.js';
import { loadPlacement, type PortalPlacement } from './placement.js';
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
 * SF-M10-B-2 SAMPLE_LAB platform host: CMP-004 identity, CMP-009 dynamic forms and CMP-015
 * application/case on PostgreSQL (FORCE RLS, one runtime login per component per ADR-0006) with
 * real OPA as the PDP, and CMP-016 sequencing on Temporal after each CMP-015 commit (B-2c). Connectors are SIMULATED (OTP, IdP, DigiLocker identity, published-binding
 * and published-form ports) and the whole runtime refuses to start outside LOCAL/CI. Host
 * composition only: no domain logic.
 */
export interface PlatformLabEnv {
  SF_ENVIRONMENT?: string;
  SF_PLATFORM_LAB_DIR?: string;
  DATABASE_URL_CMP004?: string;
  DATABASE_URL_CMP015?: string;
  DATABASE_URL_CMP009?: string;
  DATABASE_URL_CMP016?: string;
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
}

export interface PlatformLab {
  placement: PortalPlacement;
  m02: M02PluginMounts;
  m04: M04PluginMounts;
  m05: M05PluginMounts;
  readinessChecks: ReadinessCheck[];
  registerSimulators(app: FastifyInstance): Promise<void>;
  /** Connects Temporal, seeds the pinned workflow versions and starts the CMP-016 worker. */
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

const BINDING_IDS = {
  otp: '0d15ba00-0c01-4000-8000-0d15ba000c01',
  idp: '0d15ba00-0c02-4000-8000-0d15ba000c02',
  digilocker: '0d15ba00-0c03-4000-8000-0d15ba000c03',
  forms: '0d15ba00-0c09-4000-8000-0d15ba000c09',
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

  const bindings = new SimulatedPublishedBindingPort();
  const published = readJson<{
    bindings: (PublishedBinding & { tenant_id: string; catalogue_id: string })[];
  }>(join(dir, 'published-bindings.json'));
  const offered = new Set(placement.offerings.map((o) => o.tenant_service_binding_id));
  const offeredBindings = published.bindings.filter(
    (b) => b.tenant_id === placement.tenant_id && offered.has(b.tenant_service_binding_id),
  );
  for (const b of offeredBindings) {
    bindings.put(b.tenant_id, {
      tenant_service_binding_id: b.tenant_service_binding_id,
      service_id: b.service_id,
      status: 'PUBLISHED',
      pins: b.pins,
    });
  }
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
    },
    m04: {
      forms: {
        pool: pools.cmp009,
        resolveContext: placementContextResolver({ verifier, sessions, placement }),
        authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
        forms,
        localization: new cmp009.IdentityLocalizationPort(),
        config: formsConfig,
      },
    },
    m05: {
      applicationCase: {
        service: applicationCase,
        resolveContext: placementContextResolver({ verifier, sessions, placement }),
      },
    },
    readinessChecks: [
      poolReadiness('cmp004-db', pools.cmp004),
      poolReadiness('cmp009-db', pools.cmp009),
      poolReadiness('cmp015-db', pools.cmp015),
      poolReadiness('cmp016-db', pools.cmp016),
      ...workflow.readinessChecks,
    ],
    registerSimulators: (app) =>
      registerLabSimulators(app, {
        environment,
        inbox,
        officers,
        mint: (claims) => cmp004.mintSimulatedIdpAssertion(pepper, claims),
      }),
    start: () => workflow.start(),
    async close() {
      await workflow.close();
      await Promise.all(Object.values(pools).map((p) => p.end()));
    },
  };
}
