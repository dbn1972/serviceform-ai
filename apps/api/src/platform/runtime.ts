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
import type { M06PluginMounts } from '../composition/m06.js';
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
import { Cmp051ApprovalPort, Cmp051WorkflowApprovalPort } from './approvals.js';
import { StudioPublishedFormPort, type FormSourceLike } from './forms.js';
import { registerFormPinRoutes } from './form-pins.js';
import { registerStudioWorkflowRoutes } from './workflow-studio.js';
import {
  StudioPublishedRulePackPort,
  StudioRuleEvaluationPort,
  type RulePackSourceLike,
} from './rules.js';
import {
  composeStudioRules,
  registerStudioRulesRoutes,
  type Cmp008StudioModule,
} from './rules-studio.js';
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
  createTenantUserDirectory,
  registerTenantUserAdminRoutes,
} from './tenant-users.js';
import {
  assertTemporalAddress,
  assertTemporalNamespace,
  composeLabWorkflow,
  unwiredActivityPorts,
  type Cmp016Module,
  type Cmp016SdkModule,
  type LabWorkflowBridge,
  type LabWorkflowFixture,
  type WorkflowLogger,
} from './workflow.js';
import {
  labHumanTaskPort,
  labPrincipalScopePort,
  readLabAssignmentScope,
  type Cmp017Module,
} from './tasks.js';
import {
  composeLabDocumentUpload,
  loadUploadPolicyFixture,
  policySeedContext,
  registerLabDocumentUploadSimulators,
  seedLabUploadPolicy,
  type Cmp013Module,
  type LabStorage,
  type LabUploadService,
  type UploadPolicyFixture,
} from './document-upload.js';

async function seedLabUploadPolicySafe(
  service: LabUploadService,
  fixture: UploadPolicyFixture,
  officer: { tenantId: string; cellId: string; officerId: string; roles: string[] },
): Promise<void> {
  try {
    await seedLabUploadPolicy({
      service,
      fixture,
      ctx: policySeedContext(officer),
    });
  } catch (err) {
    // Idempotent seed: a replayed policy write is fine; other failures must surface.
    const message = err instanceof Error ? err.message : String(err);
    if (!/idempotenc|already|conflict|duplicate/i.test(message)) throw err;
  }
}
import { deficiencyOwnerEnrichingAuthorizer, LabCaseCommandPort } from './deficiency.js';
import {
  composeLabGrievance,
  loadGrievanceCatalogue,
  registerLabGrievanceRoutes,
  type LabGrievanceCatalogue,
} from './grievance.js';
import {
  composeLabInspection,
  loadInspectionCatalogue,
  registerLabInspectionRoutes,
  type LabInspectionCatalogue,
} from './inspection.js';
import {
  caseCommandName,
  composeLabSla,
  loadSlaCatalogue,
  type LabSlaLifecycle,
  type SlaServiceLike,
} from './sla.js';
import {
  composeLabAssisted,
  loadAssistedCatalogue,
  registerLabAssistedRoutes,
  type LabAssistedCatalogue,
} from './assisted.js';
import {
  composeLabScheduler,
  loadAppointmentCatalogue,
  registerLabSchedulerRoutes,
  type LabAppointmentCatalogue,
} from './scheduler.js';
import {
  composeLabM08,
  loadM08OpsCatalogue,
  registerLabM08Routes,
  type LabM08OpsCatalogue,
} from './m08-ops.js';
import {
  composeLabPrivacyCentre,
  loadPrivacyCatalogue,
  registerLabPrivacyCentreRoutes,
  type LabPrivacyCatalogue,
} from './privacy-centre.js';
import type { M08PluginMounts } from '../composition/m08.js';
import type { M09PluginMounts } from '../composition/m09.js';
import {
  composeLabNotification,
  journeyTriggerForCommand,
  loadNotificationCatalogue,
  type LabJourneyNotifyBridge,
} from './notification.js';
import {
  composeLabPayment,
  loadFeeCatalogue,
  registerLabPaymentRoutes,
  type ComposeLabPaymentResult,
} from './payment.js';
import {
  createLabTsbSealStore,
  loadTsbSealCatalogue,
  registerLabTsbSealRoutes,
  type LabTsbSealCatalogue,
} from './tsb-seal.js';
import {
  loadLicencePermitPinDemos,
  registerLabLicencePermitPinDemoRoutes,
} from './licence-permit-pin-demos.js';
import {
  loadInteropHygieneCatalogue,
  registerLabInteropHygieneRoutes,
  type LabInteropHygieneCatalogue,
} from './interop-hygiene.js';

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
  /** SF-47 CMP-019 deficiency. Optional — when set, Raise Deficiency / citizen respond mount. */
  DATABASE_URL_CMP019?: string;
  /** SF-49 CMP-013 document upload. Optional — when set, citizen evidence upload mounts. */
  DATABASE_URL_CMP013?: string;
  DATABASE_URL_CMP009?: string;
  DATABASE_URL_CMP016?: string;
  /** SF-46: CMP-017 work queue / HUMAN_TASK from graph. */
  DATABASE_URL_CMP017?: string;
  DATABASE_URL_CMP022?: string;
  DATABASE_URL_CMP024?: string;
  DATABASE_URL_CMP012?: string;
  DATABASE_URL_CMP005?: string;
  DATABASE_URL_CMP030?: string;
  DATABASE_URL_CMP033?: string;
  DATABASE_URL_CMP051?: string;
  DATABASE_URL_CMP052?: string;
  /** Optional SAMPLE_LAB CMP-027 grievance/helpdesk mount. */
  DATABASE_URL_CMP027?: string;
  /** SF-57: optional CMP-018 inspection / verification desk. */
  DATABASE_URL_CMP018?: string;
  /** SF-53: optional CMP-029 SLA clocks (officer visibility + deficiency pause). */
  DATABASE_URL_CMP029?: string;
  /** Optional SAMPLE_LAB CMP-057 assisted / CSC apply shell. */
  DATABASE_URL_CMP057?: string;
  /** SF-62: optional CMP-056 appointment / scheduling shell (Constitution #37). */
  DATABASE_URL_CMP056?: string;
  /** Privacy centre UI: optional CMP-061 rights orchestration. */
  DATABASE_URL_CMP061?: string;
  /** SF-63: optional M08 search / analytics / ops / discovery golden UI. */
  DATABASE_URL_CMP035?: string;
  DATABASE_URL_CMP045?: string;
  DATABASE_URL_CMP046?: string;
  DATABASE_URL_CMP006?: string;
  /** SF-55: optional CMP-025 notification (journey SIM SMS). */
  DATABASE_URL_CMP025?: string;
  /** SF-55: optional CMP-026 messaging (official notices; fanout still CMP-025). */
  DATABASE_URL_CMP026?: string;
  /** SF-56: optional CMP-020 fee calculation (SAMPLE_LAB DUMMY fee>0). */
  DATABASE_URL_CMP020?: string;
  /** SF-56: optional CMP-021 payment (SIMULATED PSP only; REAL owner-held). */
  DATABASE_URL_CMP021?: string;
  SF_TEMPORAL_ADDRESS?: string;
  SF_TEMPORAL_NAMESPACE?: string;
  SF_TEMPORAL_TASK_QUEUE?: string;
  SF_CMP004_PEPPER?: string;
  SF_OPA_URL?: string;
  SF_OPA_TOKEN?: string;
  /**
   * CMP-004 per-IP limit. When SF_TRUSTED_PROXY_HOPS is unset, every portal request shares the
   * BFF address (SEC F-08). With hops configured (ADR-0008) and the BFF forwarding
   * X-Forwarded-For, the key is the trusted client address.
   */
  SF_IDENTITY_RATE_LIMIT_MAX?: string;
  /** CMP-009 per-IP limit; same trusted-hop caveat as the identity limit (ADR-0008). */
  SF_FORMS_RATE_LIMIT_MAX?: string;
  /** CMP-005 per-IP limit; same trusted-hop caveat as the identity limit (ADR-0008). */
  SF_PROFILE_RATE_LIMIT_MAX?: string;
  /** CMP-033/051/052 studio/admin per-IP limit; same trusted-hop caveat (ADR-0008). */
  SF_STUDIO_RATE_LIMIT_MAX?: string;
  /**
   * Comma-separated BFF hop IPs/CIDRs for Fastify trustProxy (ADR-0008). Empty = no trust.
   * SAMPLE_LAB example: `127.0.0.1,::1`. Never `*` / `0.0.0.0/0`.
   */
  SF_TRUSTED_PROXY_HOPS?: string;
  /**
   * SF-71 optional Keycloak Admin REST (SAMPLE_LAB). When unset, tenant-user admin uses
   * the labelled SIMULATED adapter. Does not claim production IdP or ADR-0007 acceptance.
   */
  SF_KEYCLOAK_BASE_URL?: string;
  SF_KEYCLOAK_ADMIN_CLIENT_ID?: string;
  SF_KEYCLOAK_ADMIN_CLIENT_SECRET?: string;
  SF_KEYCLOAK_ADMIN_REALM?: string;
  SF_KEYCLOAK_REALM?: string;
  SF_KEYCLOAK_TENANT_ID?: string;
  SF_KEYCLOAK_TENANT_REALM_MAP?: string;
  SF_KEYCLOAK_TENANT_ATTRIBUTE?: string;
}

export interface PlatformLab {
  placement: PortalPlacement;
  m02: M02PluginMounts;
  /** SF-M10-B-4: CMP-033/051/052 mounted when DATABASE_URL_CMP033/051/052 are set. */
  m03?: M03PluginMounts;
  m04: M04PluginMounts;
  m05: M05PluginMounts;
  /** SF-55/SF-56: CMP-020/021/025/026 when corresponding DATABASE_URL_CMP* are set. */
  m06?: M06PluginMounts;
  m07: M07PluginMounts;
  wave2: Wave2PluginMounts;
  readinessChecks: ReadinessCheck[];
  registerSimulators(app: FastifyInstance): Promise<void>;
  /** CCR-M10-003 `/v1/applications/:id/issuance` (post-approval issuance + status projection). */
  registerIssuance(app: FastifyInstance): Promise<void>;
  /** SF-M10-C-2 CMP-016 Studio authoring routes (`/v1/workflow-graphs/*`, `/v1/workflow-drafts`). */
  registerStudioWorkflow(app: FastifyInstance): Promise<void>;
  /** SF-M10-C-3 CMP-008 Studio test bench (`/v1/rule-packs/test`, ZEN engine, nothing stored). */
  registerStudioRules(app: FastifyInstance): Promise<void>;
  /** Phase C live-pins: resolve Studio form pin (form_key + hash) by CMP-033 version id. */
  registerFormPins(app: FastifyInstance): Promise<void>;
  /** SAMPLE_LAB CMP-027 lab list/catalogue routes (optional when DATABASE_URL_CMP027 is set). */
  registerGrievance?(app: FastifyInstance): Promise<void>;
  /** SF-57: SAMPLE_LAB CMP-018 lab catalogue route (optional when DATABASE_URL_CMP018 is set). */
  registerInspection?(app: FastifyInstance): Promise<void>;
  /** SAMPLE_LAB CMP-057 assisted/CSC lab routes (optional when DATABASE_URL_CMP057 is set). */
  registerAssisted?(app: FastifyInstance): Promise<void>;
  /** SF-62: SAMPLE_LAB CMP-056 lab catalogue/ensure routes (optional when DATABASE_URL_CMP056 is set). */
  registerScheduler?(app: FastifyInstance): Promise<void>;
  /** Privacy centre: SAMPLE_LAB CMP-061 lab catalogue route (optional when DATABASE_URL_CMP061 is set). */
  registerPrivacyCentre?(app: FastifyInstance): Promise<void>;
  /** SF-63: SAMPLE_LAB M08 lab catalogue/ensure routes (optional when M08 pools are set). */
  registerM08?(app: FastifyInstance): Promise<void>;
  /** SF-56: lab SIM payment callback (INTEGRATION + HMAC) when CMP-020/021 mounted. */
  registerPayment?(app: FastifyInstance): Promise<void>;
  /** SF-60: SAMPLE_LAB TSB eng seal prove routes (hash + mutation gate; G6 seal still false). */
  registerTsbSeal(app: FastifyInstance): Promise<void>;
  /** Licence/Permit Studio→TSB pin demos (DRAFT/DUMMY; not citizen-offerable). */
  registerLicencePermitPinDemos(app: FastifyInstance): Promise<void>;
  /** SAMPLE_LAB BPMN / .sfpackage / migration interop hygiene lab routes (no Camunda runtime). */
  registerInteropHygiene(app: FastifyInstance): Promise<void>;
  /** SF-71: SAMPLE_LAB tenant workforce user admin (Keycloak Admin REST or SIMULATED). */
  registerTenantUsers(app: FastifyInstance): Promise<void>;
  /** M08 mounts (CMP-035/045/046/006) when corresponding pools are set. */
  m08?: M08PluginMounts;
  /** M09 mounts (CMP-056/057/061) when corresponding pools are set. */
  m09?: M09PluginMounts;
  /** SF-49: SIMULATED document put + sync scan drain (LOCAL/CI only). */
  registerDocumentUploadSimulators(app: FastifyInstance): Promise<void>;
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
  private slaLifecycle: LabSlaLifecycle | null = null;
  private journeyNotify: LabJourneyNotifyBridge | null = null;

  constructor(
    deps: ConstructorParameters<typeof ApplicationCaseService>[0],
    private readonly sequencing: LabWorkflowBridge,
  ) {
    super(deps);
  }

  /** Optional SF-53 SLA hooks — set after CMP-029 compose so draft construction stays unchanged. */
  bindSlaLifecycle(lifecycle: LabSlaLifecycle | null): void {
    this.slaLifecycle = lifecycle;
  }

  /** Optional SF-55 journey notify — set after CMP-025 compose. */
  bindJourneyNotify(bridge: LabJourneyNotifyBridge | null): void {
    this.journeyNotify = bridge;
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

  override async executeCommand(
    rawCtx: unknown,
    rawApplicationId: unknown,
    rawBody: unknown,
    rawKey: unknown,
  ) {
    const result = await super.executeCommand(rawCtx, rawApplicationId, rawBody, rawKey);
    if (result.status !== 200) return result;
    const application = (result.body as { application?: { application_id?: string } } | undefined)
      ?.application;
    const applicationId =
      typeof application?.application_id === 'string'
        ? application.application_id
        : typeof rawApplicationId === 'string'
          ? rawApplicationId
          : null;
    if (!applicationId) return result;
    const command = caseCommandName(rawBody);
    const sla = this.slaLifecycle;
    if (sla) {
      if (command === 'SUBMIT') {
        void sla.startAfterSubmit(applicationId);
      } else if (
        command === 'RECORD_APPROVED' ||
        command === 'RECORD_REJECTED' ||
        // Legacy aliases if any host path still used them
        command === 'APPROVE' ||
        command === 'REJECT'
      ) {
        void sla.completeAfterDecision(applicationId);
      }
    }
    const notify = this.journeyNotify;
    if (notify && journeyTriggerForCommand(command)) {
      void notify.notifyAfterDecision(applicationId, command as string);
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
  SimulatedFormDefinitionPort: new (config: unknown) => FormSourceLike & {
    publish(form: {
      tenant_id: string;
      form_key: string;
      version_id: string;
      content_hash: string;
      status: 'PUBLISHED';
      payload: unknown;
    }): void;
  };
  FormDefinitionNotFoundError: new () => Error;
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
  registerMetadata: (app: FastifyInstance, opts: unknown) => Promise<void>;
  loadConfig: (env: NodeJS.ProcessEnv) => unknown;
  readPublishedDocument: (
    pool: pg.Pool,
    input: { tenantId: string; documentId: string; kind: 'FORM' | 'RULES' | 'WORKFLOW' },
  ) => Promise<{ document_id: string; payload: unknown } | null>;
}

interface Cmp051Module {
  registerMakerChecker: (app: FastifyInstance, opts: unknown) => Promise<void>;
  loadConfig: (env: NodeJS.ProcessEnv) => unknown;
  OffAiValidationPort: new () => unknown;
}

interface Cmp052Module {
  registerVersioning: (app: FastifyInstance, opts: unknown) => Promise<void>;
  loadConfig: (env: NodeJS.ProcessEnv) => unknown;
  Cmp052Error: new (
    code: string,
    options?: { statusCode?: number; details?: { code: string }[] },
  ) => Error;
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
 * SF-M10-B-4 / Phase C live-pins host adapter: resolves CMP-015 PublishedBinding pins from
 * CMP-052's pool. Prefers an exact PUBLISHED binding_id; when Studio has published a newer
 * binding for the same offering_ref (catalogue id), that row wins so cases pick up Studio form /
 * workflow / rules pins. Falls back to the fixture-seeded SimulatedPublishedBindingPort.
 * LOCAL/CI only — guarded upstream by assertSimulatorEnvironment.
 */
class Cmp052PublishedBindingPort implements PublishedBindingPort {
  constructor(
    private readonly pool: pg.Pool,
    private readonly fallback: SimulatedPublishedBindingPort,
    /** binding_id → service_id, from the fixture (CMP-052 does not store service_id). */
    private readonly serviceIds: Map<string, string>,
    /** placement binding_id → catalogue_id (used as CMP-052 offering_ref). */
    private readonly offeringByBinding: Map<string, string>,
  ) {}

  private toPublished(
    bindingId: string,
    map: Record<string, { version_ref: string }>,
    serviceId: string,
  ): PublishedBinding {
    return {
      tenant_service_binding_id: bindingId,
      service_id: serviceId,
      status: 'PUBLISHED',
      pins: {
        tenant_service_binding_id: bindingId,
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
  }

  async resolve(params: {
    tenant_id: string;
    tenant_service_binding_id: string;
  }): Promise<PublishedBinding | null> {
    const { tenant_id, tenant_service_binding_id } = params;
    const offeringRef = this.offeringByBinding.get(tenant_service_binding_id);
    const fixtureServiceId = this.serviceIds.get(tenant_service_binding_id);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant_id]);
      const exact = await client.query<{
        binding_id: string;
        pins: Record<string, { version_ref: string }>;
      }>(
        `SELECT binding_id, pins
           FROM sf_versioning.tenant_service_binding
          WHERE tenant_id = $1 AND binding_id = $2 AND status = 'PUBLISHED'`,
        [tenant_id, tenant_service_binding_id],
      );
      let row = exact.rows[0];
      // Studio publishes a new binding_id per version; prefer the latest PUBLISHED for the offering.
      if (!row && offeringRef) {
        const byOffering = await client.query<{
          binding_id: string;
          pins: Record<string, { version_ref: string }>;
        }>(
          `SELECT binding_id, pins
             FROM sf_versioning.tenant_service_binding
            WHERE tenant_id = $1 AND offering_ref = $2 AND status = 'PUBLISHED'
            ORDER BY created_at DESC
            LIMIT 1`,
          [tenant_id, offeringRef],
        );
        row = byOffering.rows[0];
      }
      await client.query('COMMIT');
      if (!row || !fixtureServiceId) return this.fallback.resolve(params);
      // Applications pin the resolved PUBLISHED binding id (Studio version), not the placement stub.
      return this.toPublished(row.binding_id, row.pins, fixtureServiceId);
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

interface TemplateLike {
  catalogue_id: string;
  versions: readonly TemplateVersionLike[];
  policy: { fee: string; service_time: string; eligibility: string; evidence: string };
}

interface TemplatesModule {
  listTemplates(): readonly TemplateLike[];
  publishedVersion(template: TemplateLike): TemplateVersionLike | null;
  labOfferVersion(
    template: TemplateLike,
    opts?: { environmentLabel?: string | null },
  ): TemplateVersionLike | null;
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
/**
 * Resolve a catalogue form pin for the SIMULATED lab host.
 * PUBLISHED versions are preferred. In SAMPLE_LAB only, DRAFT stubs that use SAMPLE_LAB DUMMY
 * policy may be offered when a placement binds them — CMP-009 still receives status PUBLISHED
 * so the engine accepts the pin; production/non-lab refuse DRAFT.
 */
export function publishedFormFor(
  catalogueId: string,
  formVersionId: string,
  tenantId: string,
  opts: { allowSampleLabDraft?: boolean } = {},
) {
  const template = templates.catalogue.listTemplates().find((t) => t.catalogue_id === catalogueId);
  let version = template ? templates.catalogue.publishedVersion(template) : null;
  if (!version && opts.allowSampleLabDraft && template) {
    version = templates.catalogue.labOfferVersion(template, {
      environmentLabel: 'SAMPLE_LAB',
    });
  }
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
    ...(env.DATABASE_URL_CMP019
      ? { cmp019: new pg.Pool({ connectionString: env.DATABASE_URL_CMP019, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP013
      ? { cmp013: new pg.Pool({ connectionString: env.DATABASE_URL_CMP013, max: 4 }) }
      : {}),
    cmp016: new pg.Pool({ connectionString: required(env, 'DATABASE_URL_CMP016'), max: 8 }),
    cmp017: new pg.Pool({ connectionString: required(env, 'DATABASE_URL_CMP017'), max: 8 }),
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
    ...(env.DATABASE_URL_CMP027
      ? { cmp027: new pg.Pool({ connectionString: env.DATABASE_URL_CMP027, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP018
      ? { cmp018: new pg.Pool({ connectionString: env.DATABASE_URL_CMP018, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP029
      ? { cmp029: new pg.Pool({ connectionString: env.DATABASE_URL_CMP029, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP057
      ? { cmp057: new pg.Pool({ connectionString: env.DATABASE_URL_CMP057, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP056
      ? { cmp056: new pg.Pool({ connectionString: env.DATABASE_URL_CMP056, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP061
      ? { cmp061: new pg.Pool({ connectionString: env.DATABASE_URL_CMP061, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP025
      ? { cmp025: new pg.Pool({ connectionString: env.DATABASE_URL_CMP025, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP026
      ? { cmp026: new pg.Pool({ connectionString: env.DATABASE_URL_CMP026, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP020
      ? { cmp020: new pg.Pool({ connectionString: env.DATABASE_URL_CMP020, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP021
      ? { cmp021: new pg.Pool({ connectionString: env.DATABASE_URL_CMP021, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP035
      ? { cmp035: new pg.Pool({ connectionString: env.DATABASE_URL_CMP035, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP045
      ? { cmp045: new pg.Pool({ connectionString: env.DATABASE_URL_CMP045, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP046
      ? { cmp046: new pg.Pool({ connectionString: env.DATABASE_URL_CMP046, max: 4 }) }
      : {}),
    ...(env.DATABASE_URL_CMP006
      ? { cmp006: new pg.Pool({ connectionString: env.DATABASE_URL_CMP006, max: 4 }) }
      : {}),
  } as {
    cmp004: pg.Pool;
    cmp009: pg.Pool;
    cmp015: pg.Pool;
    cmp019?: pg.Pool;
    cmp013?: pg.Pool;
    cmp016: pg.Pool;
    cmp017: pg.Pool;
    cmp022: pg.Pool;
    cmp024: pg.Pool;
    cmp012: pg.Pool;
    cmp005: pg.Pool;
    cmp030: pg.Pool;
    cmp033?: pg.Pool;
    cmp051?: pg.Pool;
    cmp052?: pg.Pool;
    cmp027?: pg.Pool;
    cmp018?: pg.Pool;
    cmp029?: pg.Pool;
    cmp057?: pg.Pool;
    cmp056?: pg.Pool;
    cmp061?: pg.Pool;
    cmp025?: pg.Pool;
    cmp026?: pg.Pool;
    cmp020?: pg.Pool;
    cmp021?: pg.Pool;
    cmp035?: pg.Pool;
    cmp045?: pg.Pool;
    cmp046?: pg.Pool;
    cmp006?: pg.Pool;
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
  // SF-M10-B-4 / Phase C live-pins: prefer CMP-052 DB bindings when available; fall back to fixture.
  const serviceIdMap = new Map(
    published.bindings.map((b) => [b.tenant_service_binding_id, b.service_id]),
  );
  const offeringByBinding = new Map(
    published.bindings.map((b) => [b.tenant_service_binding_id, b.catalogue_id]),
  );
  const bindings: PublishedBindingPort = pools.cmp052
    ? new Cmp052PublishedBindingPort(
        pools.cmp052,
        simulatedBindings,
        serviceIdMap,
        offeringByBinding,
      )
    : simulatedBindings;
  const [cmp016, cmp016Sdk] = await Promise.all([
    loadComponent<Cmp016Module>('@serviceform/cmp-016-workflow-engine', 'cmp-016-workflow-engine'),
    loadComponent<Cmp016SdkModule>(
      '@serviceform/cmp-016-workflow-engine/temporal-sdk',
      'cmp-016-workflow-engine',
      'temporal/sdk/index.ts',
    ),
  ]);
  const workflowFixture = readJson<LabWorkflowFixture>(join(dir, 'workflow.json'));
  const cmp008 = await loadComponent<
    Cmp008StudioModule & {
      ZenRuleEngine: new () => {
        evaluate(
          jdm: unknown,
          inputs: Record<string, unknown>,
          timeoutMs: number,
        ): Promise<{ outputs: Record<string, unknown> }>;
      };
      RulePackNotFoundError: new () => Error;
    }
  >('@serviceform/cmp-008-rules', 'cmp-008-rules');
  const cmp033Pool = pools.cmp033;
  const cmp033 = cmp033Pool
    ? await loadComponent<Cmp033Module>('@serviceform/cmp-033-metadata', 'cmp-033-metadata')
    : undefined;
  const studioRulePacks: RulePackSourceLike | undefined =
    cmp033 && cmp033Pool
      ? new StudioPublishedRulePackPort({
          read: (input) => cmp033.readPublishedDocument(cmp033Pool, input),
          isNotFound: (err) => err instanceof cmp008.RulePackNotFoundError,
          notFound: () => new cmp008.RulePackNotFoundError(),
        })
      : undefined;
  const studioApprovals =
    pools.cmp051 && pools.cmp052
      ? new Cmp051WorkflowApprovalPort({ cmp051: pools.cmp051, cmp052: pools.cmp052 })
      : undefined;
  type CaseReader = {
    getApplication(ctx: unknown, id: unknown): Promise<{ status: number; body: unknown }>;
    getWorkingData(ctx: unknown, id: unknown): Promise<{ status: number; body: unknown }>;
  };
  const applicationCaseRef: { current?: CaseReader } = {};
  const officersFixture = readJson<{
    officers: LabOfficer[];
    lab_assignment?: unknown;
  }>(join(dir, 'officers.json'));
  const labAssignment = readLabAssignmentScope(officersFixture);
  const cmp017 = await loadComponent<Cmp017Module>(
    '@serviceform/cmp-017-work-queue-tasks',
    'cmp-017-work-queue-tasks',
  );
  const taskService = new cmp017.TaskService({
    repo: new cmp017.PgTaskRepository(pools.cmp017),
    authz: opa as unknown as { decide(input: unknown): Promise<unknown> },
    scopes: labPrincipalScopePort(labAssignment),
  });
  const activityPorts = (() => {
    const base = unwiredActivityPorts(cmp016);
    const humanTasks = labHumanTaskPort({
      service: () => taskService,
      workloadRoles: workflowFixture.workload.roles,
      refuse: (code) => new cmp016.Cmp016Error('SF-SYS-004', [{ code }]),
    });
    if (!studioRulePacks) return { ...base, humanTasks };
    const rules = new StudioRuleEvaluationPort({
      packs: studioRulePacks,
      engine: new cmp008.ZenRuleEngine() as {
        evaluate(
          jdm: unknown,
          inputs: Record<string, unknown>,
          timeoutMs: number,
        ): Promise<{ outputs: Record<string, unknown> }>;
      },
      refuse: (code) => new cmp016.Cmp016Error('SF-SYS-004', [{ code }]),
      loadCase: async (tenantId, applicationId, correlationId) => {
        const cases = applicationCaseRef.current;
        if (!cases)
          throw new cmp016.Cmp016Error('SF-SYS-004', [{ code: 'CASE_SERVICE_NOT_READY' }]);
        const ctx = {
          tenant_id: tenantId,
          cell_id: placement.cell_id,
          actor: { type: 'SYSTEM' as const, id: workflowFixture.workload.actor_id },
          correlation_id: correlationId,
          trace_id: correlationId.replace(/-/g, ''),
          roles: workflowFixture.workload.roles,
          jurisdiction_ids: [] as string[],
          auth_assurance: 'AAL1',
        };
        const appRes = await cases.getApplication(ctx, applicationId);
        if (appRes.status !== 200) throw new cmp016.Cmp016Error('SF-SYS-002');
        const app = (appRes.body as { application?: { pins?: { rule_version_id?: string } } })
          .application;
        const ruleVersionId = app?.pins?.rule_version_id;
        if (!ruleVersionId) {
          throw new cmp016.Cmp016Error('SF-SYS-004', [{ code: 'RULE_PIN_MISSING' }]);
        }
        const wdRes = await cases.getWorkingData(ctx, applicationId);
        const data =
          wdRes.status === 200
            ? ((wdRes.body as { working_data?: { data?: Record<string, unknown> } }).working_data
                ?.data ?? {})
            : {};
        return { rule_version_id: ruleVersionId, inputs: data };
      },
    });
    return { ...base, humanTasks, rules };
  })();
  const workflow = composeLabWorkflow({
    environment,
    cmp016,
    sdk: cmp016Sdk,
    pool: pools.cmp016,
    pdp: opa,
    fixture: workflowFixture,
    pins: offeredBindings.map((b) => ({
      tenant_id: b.tenant_id,
      catalogue_id: b.catalogue_id,
      workflow_version_id: b.pins.workflow_version_id,
    })),
    cellId: placement.cell_id,
    temporal,
    ...(opts.logger ? { logger: opts.logger } : {}),
    ...(studioApprovals ? { studioApprovals } : {}),
    activityPorts,
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
  applicationCaseRef.current = applicationCase as unknown as CaseReader;

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
  const catalogueForms = new cmp009.SimulatedFormDefinitionPort(formsConfig);
  const allowSampleLabDraft = placement.environment_label === 'SAMPLE_LAB';
  for (const b of offeredBindings) {
    catalogueForms.publish(
      publishedFormFor(b.catalogue_id, b.pins.form_version_id, placement.tenant_id, {
        allowSampleLabDraft,
      }),
    );
  }
  // SF-M10-C-1: Studio forms frozen in CMP-033 resolve by hash pin after the catalogue.
  const forms: FormSourceLike =
    cmp033 && cmp033Pool
      ? new StudioPublishedFormPort({
          catalogue: catalogueForms,
          read: (input) => cmp033.readPublishedDocument(cmp033Pool, input),
          isNotFound: (err) => err instanceof cmp009.FormDefinitionNotFoundError,
          notFound: () => new cmp009.FormDefinitionNotFoundError(),
        })
      : catalogueForms;

  const officers = officersFixture.officers.filter((o) => o.tenant_id === placement.tenant_id);

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
  const resolveContext = placementContextResolver({ verifier, sessions, placement });

  // SF-55: CMP-025/026 journey notifications (SIM). Optional when DATABASE_URL_CMP025 is set.
  let journeyNotify: LabJourneyNotifyBridge | null = null;
  let deficiencyNotifier: ReturnType<typeof composeLabNotification>['deficiencyNotifier'] | null =
    null;
  let m06: M06PluginMounts | undefined;
  if (pools.cmp025) {
    const [cmp025, cmp026] = await Promise.all([
      loadComponent<{
        buildNotificationService: (opts: Record<string, unknown>) => unknown;
        buildDeliveryWorker: (opts: Record<string, unknown>) => unknown;
        DefaultConnectorRegistry: new (opts: { simulation: { testRunId: string } }) => unknown;
      }>('@serviceform/cmp-025-notification', 'cmp-025-notification'),
      pools.cmp026
        ? loadComponent<{
            MessagingService: new (deps: Record<string, unknown>) => unknown;
            PgMessagingStore: new (pool: pg.Pool) => unknown;
            SimulatedCaseParticipation: new () => unknown;
            SimulatedAttachmentStorage: new () => unknown;
            loadConfig: (env: Record<string, string | undefined>) => unknown;
            OutboxOnlyWorkflowSignal: new () => unknown;
          }>('@serviceform/cmp-026-communication-messaging', 'cmp-026-communication-messaging')
        : Promise.resolve(undefined),
    ]);
    const notifyCatalogue = loadNotificationCatalogue(dir);
    const composed = composeLabNotification({
      pool: pools.cmp025,
      ...(pools.cmp026 ? { messagingPool: pools.cmp026 } : {}),
      authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
      resolveContext: (request) => resolveContext(request as Parameters<typeof resolveContext>[0]),
      environment,
      testRunId: issuance.test_run_id,
      catalogue: notifyCatalogue,
      cellId: placement.cell_id,
      tenantId: placement.tenant_id,
      cmp025: cmp025 as never,
      ...(cmp026 ? { cmp026: cmp026 as never } : {}),
    });
    journeyNotify = composed.bridge;
    deficiencyNotifier = composed.deficiencyNotifier;
    m06 = composed.m06 as M06PluginMounts;
    applicationCase.bindJourneyNotify(journeyNotify);
  }

  // SF-56: CMP-020/021 SAMPLE_LAB DUMMY fee>0 + SIMULATED payment. Merges into m06 mounts.
  let paymentLab: ComposeLabPaymentResult | null = null;
  if (pools.cmp020 && pools.cmp021) {
    const [cmp020, cmp021] = await Promise.all([
      loadComponent<{
        buildFeeService: (opts: Record<string, unknown>) => unknown;
      }>('@serviceform/cmp-020-fee-calculation', 'cmp-020-fee-calculation'),
      loadComponent<{
        buildPaymentService: (opts: Record<string, unknown>) => unknown;
        SimulatedPspConnector: new (marker: {
          simulation: true;
          scenario: string;
          test_run_id: string;
          connector_binding_id: string;
          environment: string;
        }) => unknown;
        simulatorSecret: (testRunId: string) => string;
        signPayload: (secret: string, payload: Record<string, unknown>) => string;
      }>('@serviceform/cmp-021-payment', 'cmp-021-payment'),
    ]);
    paymentLab = composeLabPayment({
      feePool: pools.cmp020,
      paymentPool: pools.cmp021,
      authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
      resolveContext: (request) => resolveContext(request as Parameters<typeof resolveContext>[0]),
      environment,
      catalogue: loadFeeCatalogue(dir),
      cellId: placement.cell_id,
      tenantId: placement.tenant_id,
      cases: applicationCase,
      cmp020: cmp020 as never,
      cmp021: cmp021 as never,
    });
    m06 = {
      ...(m06 ?? {}),
      ...paymentLab.m06FeePayment,
    } as M06PluginMounts;
  }

  const coordinator = new LabIssuanceCoordinator({
    config: issuance,
    cases,
    credentialApi: bound(cmp022.createCredentialApi, credential),
    digilockerApi: bound(cmp012.createDigilockerApi, digilocker),
    workload,
    ...(journeyNotify ? { journeyNotify } : {}),
  });

  // SF-49: optional CMP-013 document upload (SIMULATED storage/scanner).
  let documentUpload: {
    mounts: NonNullable<M04PluginMounts['documentUpload']>;
    storage: LabStorage;
    service: LabUploadService;
    seedPolicy: () => Promise<void>;
  } | null = null;
  if (pools.cmp013) {
    const cmp013 = await loadComponent<Cmp013Module>(
      '@serviceform/cmp-013-document-upload',
      'cmp-013-document-upload',
    );
    const composed = await composeLabDocumentUpload({
      environment: environment as DeploymentEnvironment,
      pool: pools.cmp013,
      resolveContext,
      authorizer: opa as never,
      portalId: placement.portal_id,
      workerActorId: '01301301-0000-4000-8000-013013013013',
      cmp013,
    });
    const uploadFixture = loadUploadPolicyFixture(dir, environment);
    const seedOfficer =
      officers.find((o) => o.roles.includes('SAMPLE_LAB_CASE_OFFICER')) ?? officers[0];
    if (!seedOfficer) {
      throw new Error('SF-49: SAMPLE_LAB needs an officer to seed the upload policy');
    }
    documentUpload = {
      mounts: composed.mounts,
      storage: composed.storage,
      service: composed.service,
      seedPolicy: () =>
        seedLabUploadPolicySafe(composed.service, uploadFixture, {
          tenantId: placement.tenant_id,
          cellId: placement.cell_id,
          officerId: seedOfficer.officer_id,
          roles: seedOfficer.roles,
        }),
    };
  }

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

  const studioRules = composeStudioRules(
    cmp008,
    opa as unknown as { decide(input: unknown): Promise<{ allow?: unknown }> },
  );

  let grievanceCatalogue: LabGrievanceCatalogue | null = null;
  let grievanceService: ReturnType<typeof composeLabGrievance> | null = null;
  if (pools.cmp027) {
    grievanceCatalogue = loadGrievanceCatalogue(dir);
    grievanceService = composeLabGrievance({
      pool: pools.cmp027,
      authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
      environment,
      catalogue: grievanceCatalogue,
    });
  }

  let inspectionCatalogue: LabInspectionCatalogue | null = null;
  let inspectionService: ReturnType<typeof composeLabInspection> | null = null;
  if (pools.cmp018) {
    inspectionCatalogue = loadInspectionCatalogue(dir);
    inspectionService = composeLabInspection({
      pool: pools.cmp018,
      authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
      catalogue: inspectionCatalogue,
    });
  }

  let slaLifecycle: LabSlaLifecycle | null = null;
  let slaMount: {
    pool: pg.Pool;
    resolveContext: typeof resolveContext;
    authorizer: { decide: (input: unknown) => Promise<unknown> };
  } | null = null;
  let slaClockPort: ReturnType<typeof composeLabSla>['clockPort'] | null = null;
  if (pools.cmp029) {
    const cmp029 = await loadComponent<{
      buildSlaService: (opts: {
        pool: pg.Pool;
        authorizer: { decide: (input: unknown) => Promise<unknown> };
        clock?: () => Date;
      }) => SlaServiceLike;
    }>('@serviceform/cmp-029-sla-escalation', 'cmp-029-sla-escalation');
    const slaCatalogue = loadSlaCatalogue(dir);
    const composed = composeLabSla({
      pool: pools.cmp029,
      authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
      buildSlaService: cmp029.buildSlaService,
      catalogue: slaCatalogue,
      cellId: placement.cell_id,
      tenantId: placement.tenant_id,
    });
    slaLifecycle = composed.lifecycle;
    slaClockPort = composed.clockPort;
    slaMount = {
      pool: pools.cmp029,
      resolveContext,
      authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
    };
    applicationCase.bindSlaLifecycle(slaLifecycle);
  }

  let assistedCatalogue: LabAssistedCatalogue | null = null;
  let assistedMount: ReturnType<typeof composeLabAssisted> | null = null;
  if (pools.cmp057) {
    assistedCatalogue = loadAssistedCatalogue(dir);
    assistedMount = composeLabAssisted({
      pool: pools.cmp057,
      authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
      applicants: new cmp004.PgCitizenSubjectDirectory(pools.cmp004),
    });
  }

  let appointmentCatalogue: LabAppointmentCatalogue | null = null;
  let schedulerMount: ReturnType<typeof composeLabScheduler> | null = null;
  if (pools.cmp056) {
    appointmentCatalogue = loadAppointmentCatalogue(dir);
    schedulerMount = composeLabScheduler({
      pool: pools.cmp056,
      authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
      catalogue: appointmentCatalogue,
      cellId: placement.cell_id,
      tenantId: placement.tenant_id,
      cases,
    });
  }

  let privacyCatalogue: LabPrivacyCatalogue | null = null;
  let privacyCentreMount: ReturnType<typeof composeLabPrivacyCentre> | null = null;
  if (pools.cmp061) {
    privacyCatalogue = loadPrivacyCatalogue(dir);
    privacyCentreMount = composeLabPrivacyCentre({
      pool: pools.cmp061,
      authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
    });
  }

  let m08Catalogue: LabM08OpsCatalogue | null = null;
  let m08Mount: ReturnType<typeof composeLabM08> | null = null;
  if (pools.cmp035 && pools.cmp045 && pools.cmp046 && pools.cmp006) {
    m08Catalogue = loadM08OpsCatalogue(dir);
    m08Mount = composeLabM08({
      searchPool: pools.cmp035,
      analyticsPool: pools.cmp045,
      opsPool: pools.cmp046,
      discoveryPool: pools.cmp006,
      authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
      catalogue: m08Catalogue,
      cellId: placement.cell_id,
      tenantId: placement.tenant_id,
      environment: environment as
        'LOCAL' | 'CI' | 'DEVELOPMENT' | 'SIT' | 'PERFORMANCE' | 'UAT' | 'PREPROD' | 'PRODUCTION',
    });
  }

  // SF-60: SAMPLE_LAB TSB eng seal catalogue (always available; CMP-052 pool optional).
  const tsbSealCatalogue: LabTsbSealCatalogue = loadTsbSealCatalogue(dir);
  const tsbSealStore = createLabTsbSealStore();

  // Licence/Permit Studio→TSB pin demos (DRAFT/DUMMY; not on citizen placement).
  const licencePermitPinDemos = loadLicencePermitPinDemos(dir);

  // SAMPLE_LAB BPMN / .sfpackage / migration interop hygiene (always available; no Camunda).
  const interopHygieneCatalogue: LabInteropHygieneCatalogue = loadInteropHygieneCatalogue(dir);

  // SF-M10-B-4 / Phase C live-pins: mount CMP-033/051/052 when pool env vars are present.
  // CMP-052 ApprovalPort is CMP-051-backed (no SimulatedApprovalPort(allow=true) short-circuit).
  let m03: M03PluginMounts | undefined;
  if (cmp033 && pools.cmp033 && pools.cmp051 && pools.cmp052) {
    const [cmp051, cmp052] = await Promise.all([
      loadComponent<Cmp051Module>('@serviceform/cmp-051-maker-checker', 'cmp-051-maker-checker'),
      loadComponent<Cmp052Module>('@serviceform/cmp-052-versioning', 'cmp-052-versioning'),
    ]);
    const testRunId = `platform-lab-${placement.portal_id}`;
    const studioRate = positiveInt(
      env.SF_STUDIO_RATE_LIMIT_MAX ?? '120',
      'SF_STUDIO_RATE_LIMIT_MAX',
    ).toString();
    m03 = {
      metadata: {
        pool: pools.cmp033,
        resolveContext,
        authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
        config: cmp033.loadConfig({
          SF_ENVIRONMENT: environment,
          SF_METADATA_SCHEMA_MODE: 'SIMULATED',
          SF_METADATA_TEST_RUN_ID: testRunId,
          SF_METADATA_SCENARIO: 'sample_lab_studio',
          SF_METADATA_RATE_LIMIT_MAX: studioRate,
        }),
        clock: () => new Date(),
      },
      makerChecker: {
        pool: pools.cmp051,
        resolveContext,
        authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
        config: cmp051.loadConfig({
          SF_ENVIRONMENT: environment,
          SF_CMP051_METADATA_MODE: 'SIMULATED',
          SF_CMP051_VERSIONING_MODE: 'SIMULATED',
          SF_CMP051_AI_MODE: 'OFF',
          SF_CMP051_TEST_RUN_ID: testRunId,
          SF_CMP051_SCENARIO: 'sample_lab_maker_checker',
          SF_CMP051_RATE_LIMIT_MAX: studioRate,
        }),
        ai: new cmp051.OffAiValidationPort(),
        clock: () => new Date(),
      },
      versioning: {
        pool: pools.cmp052,
        resolveContext,
        authorizer: opa as unknown as { decide: (input: unknown) => Promise<unknown> },
        config: cmp052.loadConfig({
          SF_ENVIRONMENT: environment,
          // REAL would mean an external approval connector; CMP-051 is the in-platform checker.
          SF_CMP052_APPROVAL_MODE: 'SIMULATED',
          SF_CMP052_TEST_RUN_ID: testRunId,
          SF_CMP052_SCENARIO: 'sample_lab_maker_checker',
          SF_CMP052_RATE_LIMIT_MAX: studioRate,
        }),
        approval: new Cmp051ApprovalPort({
          pool: pools.cmp051,
          tenantId: placement.tenant_id,
          refuse: (code) => new cmp052.Cmp052Error('SF-SYS-003', { details: [{ code }] }),
        }) as unknown as NonNullable<M03PluginMounts['versioning']>['approval'],
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
      ...(documentUpload ? { documentUpload: documentUpload.mounts } : {}),
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
      tasks: {
        service: taskService,
        resolveContext,
      },
      ...(pools.cmp019
        ? {
            deficiency: {
              pool: pools.cmp019,
              resolveContext,
              authorizer: deficiencyOwnerEnrichingAuthorizer(
                opa as never,
                new PgCaseStore(pools.cmp015),
                placement.cell_id,
              ) as { decide: (input: unknown) => Promise<unknown> },
              caseCommands: new LabCaseCommandPort(applicationCase),
              // SF-53: when CMP-029 is mounted, INT-009 pause/resume uses LabSlaClockPort.
              // Otherwise UnboundSlaClockPort remains the CMP-019 default.
              ...(slaClockPort ? { slaClock: slaClockPort } : {}),
              // SF-55: CMP-025 SIM journey notify (was UnboundNotificationPort).
              ...(deficiencyNotifier ? { notifier: deficiencyNotifier } : {}),
            },
          }
        : {}),
      ...(grievanceService
        ? {
            grievance: {
              service: grievanceService,
              resolveContext,
            },
          }
        : {}),
      ...(inspectionService
        ? {
            inspection: {
              service: inspectionService,
              resolveContext,
            },
          }
        : {}),
      ...(slaMount ? { sla: slaMount } : {}),
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
      ...(pools.cmp019 ? [poolReadiness('cmp019-db', pools.cmp019)] : []),
      ...(pools.cmp013 ? [poolReadiness('cmp013-db', pools.cmp013)] : []),
      poolReadiness('cmp016-db', pools.cmp016),
      poolReadiness('cmp017-db', pools.cmp017),
      poolReadiness('cmp022-db', pools.cmp022),
      poolReadiness('cmp024-db', pools.cmp024),
      poolReadiness('cmp012-db', pools.cmp012),
      poolReadiness('cmp005-db', pools.cmp005),
      poolReadiness('cmp030-db', pools.cmp030),
      ...(pools.cmp033 ? [poolReadiness('cmp033-db', pools.cmp033)] : []),
      ...(pools.cmp051 ? [poolReadiness('cmp051-db', pools.cmp051)] : []),
      ...(pools.cmp052 ? [poolReadiness('cmp052-db', pools.cmp052)] : []),
      ...(pools.cmp027 ? [poolReadiness('cmp027-db', pools.cmp027)] : []),
      ...(pools.cmp018 ? [poolReadiness('cmp018-db', pools.cmp018)] : []),
      ...(pools.cmp029 ? [poolReadiness('cmp029-db', pools.cmp029)] : []),
      ...(pools.cmp057 ? [poolReadiness('cmp057-db', pools.cmp057)] : []),
      ...(pools.cmp056 ? [poolReadiness('cmp056-db', pools.cmp056)] : []),
      ...(pools.cmp061 ? [poolReadiness('cmp061-db', pools.cmp061)] : []),
      ...(pools.cmp025 ? [poolReadiness('cmp025-db', pools.cmp025)] : []),
      ...(pools.cmp026 ? [poolReadiness('cmp026-db', pools.cmp026)] : []),
      ...(pools.cmp020 ? [poolReadiness('cmp020-db', pools.cmp020)] : []),
      ...(pools.cmp021 ? [poolReadiness('cmp021-db', pools.cmp021)] : []),
      ...(pools.cmp035 ? [poolReadiness('cmp035-db', pools.cmp035)] : []),
      ...(pools.cmp045 ? [poolReadiness('cmp045-db', pools.cmp045)] : []),
      ...(pools.cmp046 ? [poolReadiness('cmp046-db', pools.cmp046)] : []),
      ...(pools.cmp006 ? [poolReadiness('cmp006-db', pools.cmp006)] : []),
      ...workflow.readinessChecks,
    ],
    ...(m06 ? { m06 } : {}),
    ...(m08Mount
      ? {
          m08: {
            search: { service: m08Mount.search, resolveContext },
            analytics: { service: m08Mount.analytics, resolveContext },
            ops: { service: m08Mount.ops, resolveContext },
            discovery: { service: m08Mount.discovery, resolveContext },
          } satisfies M08PluginMounts,
        }
      : {}),
    ...(schedulerMount || assistedMount || privacyCentreMount
      ? {
          m09: {
            ...(schedulerMount
              ? {
                  scheduler: {
                    service: schedulerMount.service,
                    resolveContext,
                  },
                }
              : {}),
            ...(assistedMount
              ? {
                  assisted: {
                    service: assistedMount.service,
                    resolveContext,
                  },
                }
              : {}),
            ...(privacyCentreMount
              ? {
                  privacy: {
                    service: privacyCentreMount.service,
                    resolveContext,
                  },
                }
              : {}),
          } satisfies M09PluginMounts,
        }
      : {}),
    registerSimulators: (app) =>
      registerLabSimulators(app, {
        environment,
        inbox,
        officers,
        mint: (claims) => cmp004.mintSimulatedIdpAssertion(pepper, claims),
      }),
    registerDocumentUploadSimulators: async (app) => {
      if (!documentUpload) return;
      await registerLabDocumentUploadSimulators(app, {
        environment,
        storage: documentUpload.storage,
        service: documentUpload.service,
        resolveContext,
        placement: { tenant_id: placement.tenant_id, cell_id: placement.cell_id },
        workerActorId: '01301301-0000-4000-8000-013013013013',
      });
    },
    registerIssuance: (app) =>
      registerLabIssuanceRoutes(app, { environment, coordinator, resolveContext }),
    registerStudioRules: (app) =>
      registerStudioRulesRoutes(app, {
        api: studioRules,
        resolveContext,
        rateLimitMax: positiveInt(
          env.SF_STUDIO_RATE_LIMIT_MAX ?? '120',
          'SF_STUDIO_RATE_LIMIT_MAX',
        ),
      }),
    registerStudioWorkflow: (app) =>
      registerStudioWorkflowRoutes(app, {
        api: workflow.studio,
        resolveContext,
        rateLimitMax: positiveInt(
          env.SF_STUDIO_RATE_LIMIT_MAX ?? '120',
          'SF_STUDIO_RATE_LIMIT_MAX',
        ),
      }),
    registerFormPins: (app) =>
      registerFormPinRoutes(app, {
        forms: forms instanceof StudioPublishedFormPort ? forms : null,
        bindings,
        offerings: new Map(
          placement.offerings.map((o) => [o.catalogue_id, o.tenant_service_binding_id]),
        ),
        resolveContext,
      }),
    ...(grievanceService && grievanceCatalogue
      ? {
          registerGrievance: async (app: FastifyInstance) => {
            registerLabGrievanceRoutes(app, {
              service: grievanceService,
              resolveContext,
              catalogue: grievanceCatalogue,
            });
          },
        }
      : {}),
    ...(inspectionService && inspectionCatalogue
      ? {
          registerInspection: async (app: FastifyInstance) => {
            registerLabInspectionRoutes(app, { catalogue: inspectionCatalogue });
          },
        }
      : {}),
    ...(assistedMount && assistedCatalogue
      ? {
          registerAssisted: async (app: FastifyInstance) => {
            registerLabAssistedRoutes(app, {
              service: assistedMount.service,
              resolveContext,
              catalogue: assistedCatalogue,
              ledger: assistedMount.ledger,
              applicationCase,
              offerings: placement.offerings,
            });
          },
        }
      : {}),
    ...(schedulerMount && appointmentCatalogue
      ? {
          registerScheduler: async (app: FastifyInstance) => {
            registerLabSchedulerRoutes(app, {
              catalogue: appointmentCatalogue,
              seeder: schedulerMount.seeder,
              service: schedulerMount.service,
              resolveContext,
            });
          },
        }
      : {}),
    ...(privacyCentreMount && privacyCatalogue
      ? {
          registerPrivacyCentre: async (app: FastifyInstance) => {
            registerLabPrivacyCentreRoutes(app, {
              catalogue: privacyCatalogue,
              resolveContext,
            });
          },
        }
      : {}),
    ...(m08Mount && m08Catalogue
      ? {
          registerM08: async (app: FastifyInstance) => {
            registerLabM08Routes(app, {
              catalogue: m08Catalogue,
              seeder: m08Mount.seeder,
              opensearchMirror: m08Mount.opensearchMirror,
              tenantId: placement.tenant_id,
            });
          },
        }
      : {}),
    ...(paymentLab
      ? {
          registerPayment: async (app: FastifyInstance) => {
            registerLabPaymentRoutes(app, {
              environment,
              applySimulatedCapture: paymentLab.applySimulatedCapture,
            });
          },
        }
      : {}),
    registerTsbSeal: async (app: FastifyInstance) => {
      registerLabTsbSealRoutes(app, {
        environment,
        catalogue: tsbSealCatalogue,
        store: tsbSealStore,
        ...(pools.cmp052 ? { pool: pools.cmp052 } : {}),
        defaultTenantId: placement.tenant_id,
      });
    },
    registerLicencePermitPinDemos: async (app: FastifyInstance) => {
      registerLabLicencePermitPinDemoRoutes(app, {
        environment,
        catalogue: licencePermitPinDemos,
      });
    },
    registerInteropHygiene: async (app: FastifyInstance) => {
      registerLabInteropHygieneRoutes(app, {
        environment,
        catalogue: interopHygieneCatalogue,
      });
    },
    registerTenantUsers: async (app: FastifyInstance) => {
      const directory = createTenantUserDirectory({
        env: env as Record<string, string | undefined>,
        officers: officersFixture.officers,
      });
      registerTenantUserAdminRoutes(app, {
        directory,
        authorizer: opa as unknown as { decide: (input: unknown) => Promise<{ allow?: unknown }> },
        resolveContext,
      });
    },
    async start() {
      await privacy.publish();
      if (documentUpload) await documentUpload.seedPolicy();
      await workflow.start();
      // SF-53: seed CMP-029 calendar/policy fail-soft so a seed fault never blocks lab readiness.
      if (slaLifecycle) {
        try {
          await slaLifecycle.ensurePublishedPolicy();
        } catch {
          // Lab host stays up; clocks remain unavailable until seed succeeds on retry.
        }
      }
      // SF-55: publish CMP-025 journey templates fail-soft.
      if (journeyNotify) {
        try {
          await journeyNotify.ensureTemplatesPublished();
        } catch {
          // Lab host stays up; dispatch retries seed on next event.
        }
      }
      // SF-62: seed CMP-056 opaque appointment types + capacity slots fail-soft.
      if (schedulerMount) {
        try {
          await schedulerMount.seeder.ensureCatalogueSeeded();
        } catch {
          // Lab host stays up; desk ensure route can retry.
        }
      }
      // SF-63: seed M08 search projections + analytics definitions fail-soft.
      if (m08Mount) {
        try {
          await m08Mount.seeder.ensureCatalogueSeeded();
        } catch {
          // Lab host stays up; /v1/lab/m08/ensure can retry.
        }
      }
    },
    async close() {
      await workflow.close();
      await privacy.close();
      await Promise.all(Object.values(pools).map((p) => p.end()));
    },
  };
}
