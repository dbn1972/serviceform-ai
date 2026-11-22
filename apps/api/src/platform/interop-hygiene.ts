import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { assertSimulatorEnvironment } from './simulators.js';

/**
 * SAMPLE_LAB BPMN / .sfpackage / migration interop hygiene lab routes.
 * Mirrors packages/m10-sample-lab + fixtures/lab/platform/interop-hygiene-catalogue.json.
 * No Camunda second runtime. No DigiLocker/SMS/Payment. CERTIFIED=false · G6=false.
 * Lab routes are not frozen OpenAPI — no CCR.
 */

export type BpmnProfileFixture = {
  fixture_id: string;
  label: string;
  direction: 'IMPORT' | 'EXPORT' | 'ROUND_TRIP';
  xml: string;
  expect_supported: boolean;
  refuse_reason?: string;
};

export type SfPackageArtifactHash = { path: string; sha256: string };

export type SfPackageManifestSeed = {
  package_id: string;
  catalogue_id: string;
  tenant_id: string;
  content_address: string;
  signature_ref: string;
  embedded_secrets_forbidden: true;
  invented_statutory_policy_forbidden: true;
  artifact_hashes: readonly SfPackageArtifactHash[];
  dependency_versions: Readonly<Record<string, string>>;
  label: string;
};

export type MigrationMode =
  | 'CONTINUE_OLD_VERSION'
  | 'MIGRATE_AT_SAFE_POINT'
  | 'MANDATORY_SECURITY_PATCH'
  | 'ADMINISTRATIVE_TERMINATION';

export type MigrationScenario = {
  scenario_id: string;
  label: string;
  mode: MigrationMode;
  from_version_id: string;
  to_version_id: string;
  node_mapping: Readonly<Record<string, string>>;
  dry_run_required: true;
  maker_checker_required: true;
};

export type LabInteropHygieneCatalogue = {
  source: string;
  policy_kind: string;
  test_run_id: string;
  mode: 'SAMPLE_LAB';
  certified: false;
  g6: false;
  camunda_runtime_forbidden: true;
  temporal_remains_runtime: true;
  bpmn_role: 'IMPORT_EXPORT_PROFILE_ONLY';
  embedded_secrets_forbidden: true;
  silent_repoint_forbidden: true;
  bpmn_fixtures: readonly BpmnProfileFixture[];
  sfpackage: SfPackageManifestSeed;
  migration_scenarios: readonly MigrationScenario[];
};

const ENGINE_ATTR = /(camunda|zeebe|activiti|flowable|jbpm|drools):/i;
const FORBIDDEN_ELEMENTS =
  /<(?:bpmn:)?(?:scriptTask|script|conditionExpression|extensionElements|callActivity|subProcess|humanPerformer|potentialOwner)\b/i;
const SECRET_PATH = /(secret|password|api[_-]?key|token|credential|private[_-]?key)/i;
const HEX64 = /^[a-f0-9]{64}$/;

const SUPPORTED_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ' +
  'xmlns:sf="https://contracts.serviceform.ai/bpmn/profile/v1" ' +
  'targetNamespace="https://contracts.serviceform.ai/bpmn/profile/v1" ' +
  'sf:profile="IMPORT_EXPORT_PROFILE_ONLY" sf:runtime="TEMPORAL">' +
  '<bpmn:process id="sf_process" isExecutable="false">' +
  '<bpmn:startEvent id="START" sf:kind="START"/>' +
  '<bpmn:userTask id="SCRUTINY" sf:kind="HUMAN_TASK" sf:roleCode="SAMPLE_LAB_SCRUTINY_OFFICER"/>' +
  '<bpmn:endEvent id="END" sf:kind="END"/>' +
  '<bpmn:sequenceFlow id="F1" sourceRef="START" targetRef="SCRUTINY"/>' +
  '<bpmn:sequenceFlow id="F2" sourceRef="SCRUTINY" targetRef="END"/>' +
  '</bpmn:process></bpmn:definitions>';

const CAMUNDA_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ' +
  'xmlns:camunda="http://camunda.org/schema/1.0/bpmn">' +
  '<bpmn:process id="p" isExecutable="true">' +
  '<bpmn:startEvent id="START"/>' +
  '<bpmn:userTask id="T" camunda:assignee="officer.jane"/>' +
  '<bpmn:endEvent id="END"/>' +
  '<bpmn:sequenceFlow id="F1" sourceRef="START" targetRef="T"/>' +
  '<bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="END"/>' +
  '</bpmn:process></bpmn:definitions>';

export const LAB_INTEROP_HYGIENE_CATALOGUE: LabInteropHygieneCatalogue = {
  source: 'SAMPLE_LAB',
  policy_kind: 'SAMPLE_LAB_INTEROP_HYGIENE',
  test_run_id: 'sample-lab-interop-hygiene',
  mode: 'SAMPLE_LAB',
  certified: false,
  g6: false,
  camunda_runtime_forbidden: true,
  temporal_remains_runtime: true,
  bpmn_role: 'IMPORT_EXPORT_PROFILE_ONLY',
  embedded_secrets_forbidden: true,
  silent_repoint_forbidden: true,
  bpmn_fixtures: [
    {
      fixture_id: 'bpmn-supported-round-trip',
      label: 'Supported BPMN profile round-trip (Temporal runtime)',
      direction: 'ROUND_TRIP',
      xml: SUPPORTED_XML,
      expect_supported: true,
    },
    {
      fixture_id: 'bpmn-camunda-assignee-forbidden',
      label: 'Camunda assignee refused (no second runtime)',
      direction: 'IMPORT',
      xml: CAMUNDA_XML,
      expect_supported: false,
      refuse_reason: 'BPMN_RUNTIME_CONSTRUCT_FORBIDDEN',
    },
  ],
  sfpackage: {
    package_id: '0d15ba00-00f1-4000-8000-0d15ba0000f1',
    catalogue_id: 'IND-SOC-002',
    tenant_id: '0d15ba00-0001-4000-8000-0d15ba0000d1',
    content_address: 'sha256:c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00',
    signature_ref: 'sig:cmp-037:sample-lab:interop-hygiene:PENDING',
    embedded_secrets_forbidden: true,
    invented_statutory_policy_forbidden: true,
    artifact_hashes: [
      {
        path: 'templates/residence-certificate/service.yaml',
        sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      {
        path: 'templates/residence-certificate/workflow.yaml',
        sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      {
        path: 'package.yaml',
        sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
    ],
    dependency_versions: {
      'SF-CON-SFPACKAGE-MANIFEST': 'FROZEN',
      'SF-CON-WORKFLOW-MODEL': 'FROZEN',
      'SF-CON-BPMN-PROFILE': 'FROZEN',
    },
    label: 'SAMPLE_LAB .sfpackage · IND-SOC-002 Residence (lab promotion hygiene)',
  },
  migration_scenarios: [
    {
      scenario_id: 'mig-continue-old',
      label: 'Continue on pinned old workflow version',
      mode: 'CONTINUE_OLD_VERSION',
      from_version_id: '0d15ba00-0016-4000-8000-0d15ba001601',
      to_version_id: '0d15ba00-0016-4000-8000-0d15ba001601',
      node_mapping: {},
      dry_run_required: true,
      maker_checker_required: true,
    },
    {
      scenario_id: 'mig-safe-point',
      label: 'Migrate at safe boundary (WAIT → WAIT)',
      mode: 'MIGRATE_AT_SAFE_POINT',
      from_version_id: '0d15ba00-0016-4000-8000-0d15ba001601',
      to_version_id: '0d15ba00-0016-4000-8000-0d15ba001602',
      node_mapping: {
        WAIT_UNDER_SCRUTINY: 'WAIT_UNDER_SCRUTINY',
        WAIT_DECISION_PENDING: 'WAIT_DECISION_PENDING',
      },
      dry_run_required: true,
      maker_checker_required: true,
    },
  ],
};

export type BpmnScreenResult = {
  ok: boolean;
  fixture_id?: string;
  compatibility_status: 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED';
  temporal_remains_runtime: true;
  bpmn_role: 'IMPORT_EXPORT_PROFILE_ONLY';
  camunda_runtime_forbidden: true;
  unsupported_constructs: readonly string[];
  reason_codes: readonly string[];
  certified: false;
  g6: false;
};

export type SfPackageValidationResult = {
  ok: boolean;
  package_id: string;
  content_address: string;
  content_address_verified: boolean;
  embedded_secrets_forbidden: true;
  secrets_detected: boolean;
  signature_ref_external: boolean;
  invented_statutory_policy_forbidden: true;
  reason_codes: readonly string[];
  certified: false;
  g6: false;
};

export type MigrationSimulationResult = {
  ok: boolean;
  scenario_id: string;
  mode: MigrationMode;
  dry_run: true;
  applied: false;
  silent_repoint_refused: boolean;
  maker_checker_ok: boolean;
  reason_codes: readonly string[];
  certified: false;
  g6: false;
};

function isSampleLabEnv(environment: string): boolean {
  return environment === 'LOCAL' || environment === 'CI';
}

export function screenBpmnProfile(input: {
  xml: string;
  fixture_id?: string;
  environment?: string;
  source?: string;
}): BpmnScreenResult {
  const reasons: string[] = [];
  const unsupported: string[] = [];
  const source = input.source ?? 'SAMPLE_LAB';
  if (source !== 'SAMPLE_LAB') reasons.push('SOURCE_NOT_SAMPLE_LAB');
  if (input.environment && !isSampleLabEnv(input.environment)) reasons.push('ENV_NOT_LAB');

  const xml = input.xml ?? '';
  if (xml.trim().length === 0) reasons.push('BPMN_XML_EMPTY');
  if (/isExecutable\s*=\s*["']true["']/i.test(xml)) {
    unsupported.push('isExecutable=true');
    reasons.push('BPMN_EXECUTABLE_FORBIDDEN');
  }
  if (ENGINE_ATTR.test(xml)) {
    unsupported.push('engine_extension_attribute');
    reasons.push('BPMN_RUNTIME_CONSTRUCT_FORBIDDEN');
  }
  if (FORBIDDEN_ELEMENTS.test(xml)) {
    unsupported.push('engine_or_named_officer_element');
    reasons.push('BPMN_RUNTIME_CONSTRUCT_FORBIDDEN');
  }
  if (/assignee|candidateUsers|candidateGroups/i.test(xml) && ENGINE_ATTR.test(xml)) {
    unsupported.push('named_officer_binding');
    reasons.push('NAMED_OFFICER_FORBIDDEN');
  }

  const ok = reasons.length === 0;
  return {
    ok,
    ...(input.fixture_id ? { fixture_id: input.fixture_id } : {}),
    compatibility_status: ok ? 'SUPPORTED' : 'UNSUPPORTED',
    temporal_remains_runtime: true,
    bpmn_role: 'IMPORT_EXPORT_PROFILE_ONLY',
    camunda_runtime_forbidden: true,
    unsupported_constructs: unsupported,
    reason_codes: reasons,
    certified: false,
    g6: false,
  };
}

export function proveBpmnFixture(
  fixture: BpmnProfileFixture,
  environment = 'LOCAL',
): BpmnScreenResult {
  const result = screenBpmnProfile({
    xml: fixture.xml,
    fixture_id: fixture.fixture_id,
    environment,
    source: 'SAMPLE_LAB',
  });
  const matches = fixture.expect_supported ? result.ok : !result.ok;
  if (!matches) {
    return {
      ...result,
      ok: false,
      reason_codes: [...result.reason_codes, 'FIXTURE_EXPECTATION_MISMATCH'],
    };
  }
  return {
    ...result,
    ok: true,
    compatibility_status: fixture.expect_supported ? 'SUPPORTED' : 'UNSUPPORTED',
  };
}

export function validateSfPackageManifest(input: {
  manifest: SfPackageManifestSeed;
  environment?: string;
  source?: string;
}): SfPackageValidationResult {
  const reasons: string[] = [];
  const m = input.manifest;
  const source = input.source ?? 'SAMPLE_LAB';
  if (source !== 'SAMPLE_LAB') reasons.push('SOURCE_NOT_SAMPLE_LAB');
  if (input.environment && !isSampleLabEnv(input.environment)) reasons.push('ENV_NOT_LAB');
  if (!m.embedded_secrets_forbidden) reasons.push('EMBEDDED_SECRETS_ALLOWED');
  if (!m.invented_statutory_policy_forbidden) reasons.push('STATUTE_INVENTION_ALLOWED');
  if (
    m.signature_ref.includes('-----BEGIN') ||
    /password\s*=/i.test(m.signature_ref) ||
    /api[_-]?key\s*=/i.test(m.signature_ref)
  ) {
    reasons.push('SIGNATURE_EMBEDDED_SECRET');
  }

  let secretsDetected = false;
  for (const artifact of m.artifact_hashes) {
    if (SECRET_PATH.test(artifact.path)) {
      secretsDetected = true;
      reasons.push('SECRET_PATH_IN_ARTIFACT');
    }
    if (!HEX64.test(artifact.sha256)) reasons.push('ARTIFACT_HASH_INVALID');
  }

  const contentAddressVerified =
    m.content_address.startsWith('sha256:') && m.content_address.length >= 16;
  if (!contentAddressVerified) reasons.push('CONTENT_ADDRESS_MISMATCH');

  const signatureExternal =
    m.signature_ref.startsWith('sig:') ||
    m.signature_ref.startsWith('urn:') ||
    m.signature_ref.startsWith('kms:');
  if (!signatureExternal) reasons.push('SIGNATURE_REF_NOT_EXTERNAL');

  const ok =
    reasons.length === 0 &&
    !secretsDetected &&
    contentAddressVerified &&
    signatureExternal &&
    m.embedded_secrets_forbidden === true;

  return {
    ok,
    package_id: m.package_id,
    content_address: m.content_address,
    content_address_verified: contentAddressVerified,
    embedded_secrets_forbidden: true,
    secrets_detected: secretsDetected,
    signature_ref_external: signatureExternal,
    invented_statutory_policy_forbidden: true,
    reason_codes: reasons,
    certified: false,
    g6: false,
  };
}

export function simulateInFlightMigration(input: {
  scenario: MigrationScenario;
  requested_by: string;
  approved_by: string;
  approval_ref?: string;
  simulation_evidence_ref?: string;
  apply?: boolean;
  environment?: string;
  source?: string;
}): MigrationSimulationResult {
  const reasons: string[] = [];
  const source = input.source ?? 'SAMPLE_LAB';
  if (source !== 'SAMPLE_LAB') reasons.push('SOURCE_NOT_SAMPLE_LAB');
  if (input.environment && !isSampleLabEnv(input.environment)) reasons.push('ENV_NOT_LAB');
  if (input.apply === true) reasons.push('APPLY_FORBIDDEN_IN_LAB_DEMO');
  if (!input.scenario.dry_run_required) reasons.push('DRY_RUN_REQUIRED');
  if (!input.scenario.maker_checker_required) reasons.push('MAKER_CHECKER_REQUIRED');
  if (!input.requested_by || !input.approved_by) reasons.push('MAKER_CHECKER_MISSING');
  if (input.requested_by && input.approved_by && input.requested_by === input.approved_by) {
    reasons.push('MAKER_CHECKER_SAME_PRINCIPAL');
  }
  const silent =
    !input.approval_ref ||
    !input.simulation_evidence_ref ||
    input.approval_ref.length === 0 ||
    input.simulation_evidence_ref.length === 0;
  if (silent) reasons.push('SILENT_REPOINT_FORBIDDEN');

  if (input.scenario.mode === 'CONTINUE_OLD_VERSION') {
    if (input.scenario.from_version_id !== input.scenario.to_version_id) {
      reasons.push('CONTINUE_MODE_VERSION_MISMATCH');
    }
  } else if (input.scenario.from_version_id === input.scenario.to_version_id) {
    reasons.push('MIGRATION_SAME_VERSION');
  }

  const makerCheckerOk =
    Boolean(input.requested_by) &&
    Boolean(input.approved_by) &&
    input.requested_by !== input.approved_by;
  const ok = reasons.length === 0;

  return {
    ok,
    scenario_id: input.scenario.scenario_id,
    mode: input.scenario.mode,
    dry_run: true,
    applied: false,
    silent_repoint_refused: silent ? true : ok,
    maker_checker_ok: makerCheckerOk,
    reason_codes: reasons,
    certified: false,
    g6: false,
  };
}

export function runInteropHygieneSuite(input: {
  catalogue: LabInteropHygieneCatalogue;
  environment: string;
}): {
  ok: boolean;
  bpmn: readonly BpmnScreenResult[];
  sfpackage: SfPackageValidationResult;
  migration: readonly MigrationSimulationResult[];
  certified: false;
  g6: false;
  camunda_runtime_forbidden: true;
  temporal_remains_runtime: true;
} {
  const { catalogue, environment } = input;
  const bpmn = catalogue.bpmn_fixtures.map((f) => proveBpmnFixture(f, environment));
  const sfpackage = validateSfPackageManifest({
    manifest: catalogue.sfpackage,
    environment,
    source: 'SAMPLE_LAB',
  });
  const maker = '0d15ba00-00a1-4000-8000-0d15ba0000a1';
  const checker = '0d15ba00-00a2-4000-8000-0d15ba0000a2';
  const migration = catalogue.migration_scenarios.map((scenario) =>
    simulateInFlightMigration({
      scenario,
      requested_by: maker,
      approved_by: checker,
      approval_ref: `lab:approval:${scenario.scenario_id}`,
      simulation_evidence_ref: `lab:sim:${scenario.scenario_id}`,
      apply: false,
      environment,
    }),
  );
  return {
    ok: bpmn.every((r) => r.ok) && sfpackage.ok && migration.every((r) => r.ok),
    bpmn,
    sfpackage,
    migration,
    certified: false,
    g6: false,
    camunda_runtime_forbidden: true,
    temporal_remains_runtime: true,
  };
}

function parseFixture(raw: unknown): BpmnProfileFixture | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  const fixture_id = typeof f['fixture_id'] === 'string' ? f['fixture_id'] : '';
  const label = typeof f['label'] === 'string' ? f['label'] : fixture_id;
  const xml = typeof f['xml'] === 'string' ? f['xml'] : '';
  const direction = f['direction'];
  if (
    !fixture_id ||
    !xml ||
    (direction !== 'IMPORT' && direction !== 'EXPORT' && direction !== 'ROUND_TRIP')
  ) {
    return null;
  }
  return {
    fixture_id,
    label,
    direction,
    xml,
    expect_supported: f['expect_supported'] === true,
    ...(typeof f['refuse_reason'] === 'string' ? { refuse_reason: f['refuse_reason'] } : {}),
  };
}

function parseScenario(raw: unknown): MigrationScenario | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const scenario_id = typeof s['scenario_id'] === 'string' ? s['scenario_id'] : '';
  const mode = s['mode'];
  const from_version_id = typeof s['from_version_id'] === 'string' ? s['from_version_id'] : '';
  const to_version_id = typeof s['to_version_id'] === 'string' ? s['to_version_id'] : '';
  if (
    !scenario_id ||
    !from_version_id ||
    !to_version_id ||
    (mode !== 'CONTINUE_OLD_VERSION' &&
      mode !== 'MIGRATE_AT_SAFE_POINT' &&
      mode !== 'MANDATORY_SECURITY_PATCH' &&
      mode !== 'ADMINISTRATIVE_TERMINATION')
  ) {
    return null;
  }
  const mappingRaw =
    s['node_mapping'] && typeof s['node_mapping'] === 'object'
      ? (s['node_mapping'] as Record<string, unknown>)
      : {};
  const node_mapping: Record<string, string> = {};
  for (const [k, v] of Object.entries(mappingRaw)) {
    if (typeof v === 'string') node_mapping[k] = v;
  }
  return {
    scenario_id,
    label: typeof s['label'] === 'string' ? s['label'] : scenario_id,
    mode,
    from_version_id,
    to_version_id,
    node_mapping,
    dry_run_required: true,
    maker_checker_required: true,
  };
}

export function parseInteropHygieneCatalogue(raw: unknown): LabInteropHygieneCatalogue {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const fixturesRaw = Array.isArray(obj['bpmn_fixtures']) ? obj['bpmn_fixtures'] : [];
  const scenariosRaw = Array.isArray(obj['migration_scenarios']) ? obj['migration_scenarios'] : [];
  const bpmn_fixtures = fixturesRaw
    .map(parseFixture)
    .filter((f): f is BpmnProfileFixture => f !== null);
  const migration_scenarios = scenariosRaw
    .map(parseScenario)
    .filter((s): s is MigrationScenario => s !== null);

  const pkgRaw =
    obj['sfpackage'] && typeof obj['sfpackage'] === 'object'
      ? (obj['sfpackage'] as Record<string, unknown>)
      : null;
  let sfpackage = LAB_INTEROP_HYGIENE_CATALOGUE.sfpackage;
  if (pkgRaw) {
    const artifact_hashes = Array.isArray(pkgRaw['artifact_hashes'])
      ? pkgRaw['artifact_hashes']
          .map((a) => {
            if (!a || typeof a !== 'object') return null;
            const row = a as Record<string, unknown>;
            const path = typeof row['path'] === 'string' ? row['path'] : '';
            const sha256 = typeof row['sha256'] === 'string' ? row['sha256'] : '';
            return path && sha256 ? { path, sha256 } : null;
          })
          .filter((a): a is SfPackageArtifactHash => a !== null)
      : [];
    const depsRaw =
      pkgRaw['dependency_versions'] && typeof pkgRaw['dependency_versions'] === 'object'
        ? (pkgRaw['dependency_versions'] as Record<string, unknown>)
        : {};
    const dependency_versions: Record<string, string> = {};
    for (const [k, v] of Object.entries(depsRaw)) {
      if (typeof v === 'string') dependency_versions[k] = v;
    }
    if (
      typeof pkgRaw['package_id'] === 'string' &&
      typeof pkgRaw['tenant_id'] === 'string' &&
      typeof pkgRaw['content_address'] === 'string' &&
      typeof pkgRaw['signature_ref'] === 'string' &&
      artifact_hashes.length > 0
    ) {
      sfpackage = {
        package_id: pkgRaw['package_id'],
        catalogue_id:
          typeof pkgRaw['catalogue_id'] === 'string' ? pkgRaw['catalogue_id'] : 'IND-SOC-002',
        tenant_id: pkgRaw['tenant_id'],
        content_address: pkgRaw['content_address'],
        signature_ref: pkgRaw['signature_ref'],
        embedded_secrets_forbidden: true,
        invented_statutory_policy_forbidden: true,
        artifact_hashes,
        dependency_versions,
        label:
          typeof pkgRaw['label'] === 'string'
            ? pkgRaw['label']
            : LAB_INTEROP_HYGIENE_CATALOGUE.sfpackage.label,
      };
    }
  }

  if (bpmn_fixtures.length === 0 || migration_scenarios.length === 0) {
    return LAB_INTEROP_HYGIENE_CATALOGUE;
  }

  return {
    source: 'SAMPLE_LAB',
    policy_kind: 'SAMPLE_LAB_INTEROP_HYGIENE',
    test_run_id:
      typeof obj['test_run_id'] === 'string'
        ? obj['test_run_id']
        : LAB_INTEROP_HYGIENE_CATALOGUE.test_run_id,
    mode: 'SAMPLE_LAB',
    certified: false,
    g6: false,
    camunda_runtime_forbidden: true,
    temporal_remains_runtime: true,
    bpmn_role: 'IMPORT_EXPORT_PROFILE_ONLY',
    embedded_secrets_forbidden: true,
    silent_repoint_forbidden: true,
    bpmn_fixtures,
    sfpackage,
    migration_scenarios,
  };
}

export function loadInteropHygieneCatalogue(dir: string): LabInteropHygieneCatalogue {
  try {
    return parseInteropHygieneCatalogue(
      JSON.parse(readFileSync(join(dir, 'interop-hygiene-catalogue.json'), 'utf8')) as unknown,
    );
  } catch {
    return LAB_INTEROP_HYGIENE_CATALOGUE;
  }
}

/**
 * Lab routes:
 * - GET  /v1/lab/interop/catalogue
 * - POST /v1/lab/interop/prove
 * - POST /v1/lab/interop/bpmn/screen
 * - POST /v1/lab/interop/sfpackage/validate
 * - POST /v1/lab/interop/migration/simulate
 */
export function registerLabInteropHygieneRoutes(
  app: FastifyInstance,
  opts: {
    environment: string;
    catalogue: LabInteropHygieneCatalogue;
  },
): void {
  assertSimulatorEnvironment(opts.environment);

  app.get('/v1/lab/interop/catalogue', async (_req, reply) => {
    return reply.header('cache-control', 'no-store').send({
      source: 'SAMPLE_LAB',
      certified: false,
      g6_issued: false,
      camunda_runtime_forbidden: true,
      temporal_remains_runtime: true,
      catalogue: opts.catalogue,
    });
  });

  app.post('/v1/lab/interop/prove', async (_req, reply) => {
    const suite = runInteropHygieneSuite({
      catalogue: opts.catalogue,
      environment: opts.environment,
    });
    return reply
      .code(suite.ok ? 200 : 400)
      .header('cache-control', 'no-store')
      .send({
        ...suite,
        g6_issued: false,
        note: 'Lab interop hygiene only. No Camunda runtime. CERTIFIED=false. G6=false.',
      });
  });

  app.post<{ Body: { xml?: string; fixture_id?: string } }>(
    '/v1/lab/interop/bpmn/screen',
    async (req, reply) => {
      const fixtureId = typeof req.body?.fixture_id === 'string' ? req.body.fixture_id : undefined;
      const fixture = fixtureId
        ? opts.catalogue.bpmn_fixtures.find((f) => f.fixture_id === fixtureId)
        : undefined;
      const xml =
        typeof req.body?.xml === 'string' && req.body.xml.length > 0
          ? req.body.xml
          : (fixture?.xml ?? '');
      const result = fixture
        ? proveBpmnFixture(fixture, opts.environment)
        : screenBpmnProfile({
            xml,
            environment: opts.environment,
            source: 'SAMPLE_LAB',
          });
      return reply
        .code(result.ok || (fixture && !fixture.expect_supported) ? 200 : 400)
        .header('cache-control', 'no-store')
        .send({ ...result, g6_issued: false });
    },
  );

  app.post('/v1/lab/interop/sfpackage/validate', async (_req, reply) => {
    const result = validateSfPackageManifest({
      manifest: opts.catalogue.sfpackage,
      environment: opts.environment,
      source: 'SAMPLE_LAB',
    });
    return reply
      .code(result.ok ? 200 : 400)
      .header('cache-control', 'no-store')
      .send({ ...result, g6_issued: false });
  });

  app.post<{
    Body: {
      scenario_id?: string;
      requested_by?: string;
      approved_by?: string;
      approval_ref?: string;
      simulation_evidence_ref?: string;
      apply?: boolean;
    };
  }>('/v1/lab/interop/migration/simulate', async (req, reply) => {
    const scenarioId =
      typeof req.body?.scenario_id === 'string' ? req.body.scenario_id : 'mig-safe-point';
    const scenario =
      opts.catalogue.migration_scenarios.find((s) => s.scenario_id === scenarioId) ??
      opts.catalogue.migration_scenarios[0];
    if (!scenario) {
      return reply.code(404).header('cache-control', 'no-store').send({
        error_code: 'SF-APP-001',
        message: 'Migration scenario not found',
        certified: false,
        g6_issued: false,
      });
    }
    const result = simulateInFlightMigration({
      scenario,
      requested_by:
        typeof req.body?.requested_by === 'string'
          ? req.body.requested_by
          : '0d15ba00-00a1-4000-8000-0d15ba0000a1',
      approved_by:
        typeof req.body?.approved_by === 'string'
          ? req.body.approved_by
          : '0d15ba00-00a2-4000-8000-0d15ba0000a2',
      ...(typeof req.body?.approval_ref === 'string'
        ? { approval_ref: req.body.approval_ref }
        : { approval_ref: `lab:approval:${scenario.scenario_id}` }),
      ...(typeof req.body?.simulation_evidence_ref === 'string'
        ? { simulation_evidence_ref: req.body.simulation_evidence_ref }
        : { simulation_evidence_ref: `lab:sim:${scenario.scenario_id}` }),
      apply: req.body?.apply === true,
      environment: opts.environment,
      source: 'SAMPLE_LAB',
    });
    return reply
      .code(result.ok ? 200 : 400)
      .header('cache-control', 'no-store')
      .send({ ...result, g6_issued: false });
  });
}
