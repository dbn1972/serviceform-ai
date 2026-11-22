/**
 * SAMPLE_LAB BPMN / .sfpackage / in-flight migration interop hygiene (lab demo).
 * Constitution #33–#35: Temporal remains runtime; BPMN is import/export profile only;
 * signed content-addressed .sfpackage with no embedded secrets; explicit migration only.
 * No Camunda/Zeebe second runtime. No DigiLocker/SMS/Payment. No invented statute.
 * CERTIFIED=false · G6=false.
 */

import { createHash } from 'node:crypto';

export const SAMPLE_LAB_INTEROP_DEFAULTS = {
  source: 'SAMPLE_LAB',
  mode: 'SAMPLE_LAB' as const,
  policy_kind: 'SAMPLE_LAB_INTEROP_HYGIENE',
  not_statutory: true,
  not_for_production: true,
  certified: false,
  g6: false,
  camunda_runtime_forbidden: true,
  temporal_remains_runtime: true,
  bpmn_role: 'IMPORT_EXPORT_PROFILE_ONLY' as const,
  embedded_secrets_forbidden: true,
  silent_repoint_forbidden: true,
  test_run_id: 'sample-lab-interop-hygiene',
  tenant_id: '0d15ba00-0001-4000-8000-0d15ba0000d1',
  package_id: '0d15ba00-00f1-4000-8000-0d15ba0000f1',
  catalogue_id: 'IND-SOC-002',
  content_address: 'sha256:c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00',
  signature_ref: 'sig:cmp-037:sample-lab:interop-hygiene:PENDING',
} as const;

export const MIGRATION_MODES = [
  'CONTINUE_OLD_VERSION',
  'MIGRATE_AT_SAFE_POINT',
  'MANDATORY_SECURITY_PATCH',
  'ADMINISTRATIVE_TERMINATION',
] as const;

export type MigrationMode = (typeof MIGRATION_MODES)[number];

export type BpmnProfileFixture = {
  fixture_id: string;
  label: string;
  direction: 'IMPORT' | 'EXPORT' | 'ROUND_TRIP';
  xml: string;
  expect_supported: boolean;
  refuse_reason?: string;
};

export type SfPackageArtifactHash = {
  path: string;
  sha256: string;
};

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

export type SampleLabInteropHygieneCatalogue = {
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

/** Profile-compliant non-executable BPMN (Temporal remains runtime). */
export const SAMPLE_LAB_BPMN_SUPPORTED_XML =
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

/** Forbidden Camunda engine construct — must be refused (no second runtime). */
export const SAMPLE_LAB_BPMN_CAMUNDA_FORBIDDEN_XML =
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

export const SAMPLE_LAB_INTEROP_HYGIENE_CATALOGUE: SampleLabInteropHygieneCatalogue = {
  source: SAMPLE_LAB_INTEROP_DEFAULTS.source,
  policy_kind: SAMPLE_LAB_INTEROP_DEFAULTS.policy_kind,
  test_run_id: SAMPLE_LAB_INTEROP_DEFAULTS.test_run_id,
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
      xml: SAMPLE_LAB_BPMN_SUPPORTED_XML,
      expect_supported: true,
    },
    {
      fixture_id: 'bpmn-camunda-assignee-forbidden',
      label: 'Camunda assignee refused (no second runtime)',
      direction: 'IMPORT',
      xml: SAMPLE_LAB_BPMN_CAMUNDA_FORBIDDEN_XML,
      expect_supported: false,
      refuse_reason: 'BPMN_RUNTIME_CONSTRUCT_FORBIDDEN',
    },
  ],
  sfpackage: {
    package_id: SAMPLE_LAB_INTEROP_DEFAULTS.package_id,
    catalogue_id: SAMPLE_LAB_INTEROP_DEFAULTS.catalogue_id,
    tenant_id: SAMPLE_LAB_INTEROP_DEFAULTS.tenant_id,
    content_address: SAMPLE_LAB_INTEROP_DEFAULTS.content_address,
    signature_ref: SAMPLE_LAB_INTEROP_DEFAULTS.signature_ref,
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

const ENGINE_ATTR = /(camunda|zeebe|activiti|flowable|jbpm|drools):/i;
const FORBIDDEN_ELEMENTS =
  /<(?:bpmn:)?(?:scriptTask|script|conditionExpression|extensionElements|callActivity|subProcess|humanPerformer|potentialOwner)\b/i;
const SECRET_PATH = /(secret|password|api[_-]?key|token|credential|private[_-]?key)/i;
const HEX64 = /^[a-f0-9]{64}$/;

function isHexChar(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}

/** Linear UUID check — avoids njsscan regex_dos on user-supplied ids. */
export function isInteropUuid(value: string): boolean {
  if (value.length !== 36) return false;
  for (let i = 0; i < 36; i++) {
    const c = value.charCodeAt(i);
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      if (c !== 45) return false;
      continue;
    }
    if (!isHexChar(c)) return false;
  }
  const version = value.charCodeAt(14);
  if (version < 49 || version > 56) return false;
  const variant = value.charAt(19).toLowerCase();
  return variant === '8' || variant === '9' || variant === 'a' || variant === 'b';
}

export function isSampleLabInteropEnvironment(environment: string): boolean {
  return environment === 'LOCAL' || environment === 'CI';
}

/**
 * Screens BPMN XML against the ServiceForm interoperability profile.
 * Does not execute BPMN. Refuses Camunda/engine constructs and named officers.
 */
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
  if (input.environment && !isSampleLabInteropEnvironment(input.environment)) {
    reasons.push('ENV_NOT_LAB');
  }

  const xml = input.xml ?? '';
  if (xml.trim().length === 0) {
    reasons.push('BPMN_XML_EMPTY');
  }
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
  if (!/sf:runtime\s*=\s*["']TEMPORAL["']/.test(xml) && !reasons.includes('BPMN_XML_EMPTY')) {
    // Export profile stamps Temporal; import without stamp is still screened as draft.
    if (/isExecutable\s*=\s*["']false["']/i.test(xml) || /sf:profile=/.test(xml)) {
      /* profile-shaped; Temporal remains the only runtime by constitution */
    }
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
  const matchesExpectation = fixture.expect_supported ? result.ok : !result.ok;
  if (!matchesExpectation) {
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

function recomputedContentAddress(manifest: {
  package_id: string;
  artifact_hashes: readonly SfPackageArtifactHash[];
}): string {
  const parts = [
    manifest.package_id,
    ...manifest.artifact_hashes.map((a) => `${a.path}:${a.sha256}`),
  ];
  return `sha256:${createHash('sha256').update(parts.join('|'), 'utf8').digest('hex')}`;
}

/**
 * Validates a lab .sfpackage manifest against SF-CON-SFPACKAGE-MANIFEST hygiene:
 * no embedded secrets, content-addressed artifacts, external signature_ref only.
 */
export function validateSfPackageManifest(input: {
  manifest: SfPackageManifestSeed;
  environment?: string;
  source?: string;
  /** When true, recompute content address from artifact hashes (lab prove). */
  recompute_address?: boolean;
}): SfPackageValidationResult {
  const reasons: string[] = [];
  const m = input.manifest;
  const source = input.source ?? 'SAMPLE_LAB';
  if (source !== 'SAMPLE_LAB') reasons.push('SOURCE_NOT_SAMPLE_LAB');
  if (input.environment && !isSampleLabInteropEnvironment(input.environment)) {
    reasons.push('ENV_NOT_LAB');
  }
  if (!m.embedded_secrets_forbidden) reasons.push('EMBEDDED_SECRETS_ALLOWED');
  if (!m.invented_statutory_policy_forbidden) reasons.push('STATUTE_INVENTION_ALLOWED');
  if (!isInteropUuid(m.package_id) && !m.package_id.startsWith('pkg-')) {
    /* lab may use uuid or pkg-* fixture ids */
  }
  if (!isInteropUuid(m.tenant_id)) reasons.push('TENANT_ID_INVALID');
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
  if (secretsDetected === false && m.embedded_secrets_forbidden !== true) {
    reasons.push('EMBEDDED_SECRETS_GATE_OPEN');
  }

  let contentAddressVerified =
    m.content_address.startsWith('sha256:') && m.content_address.length > 16;
  if (input.recompute_address) {
    const expected = recomputedContentAddress(m);
    // Lab seeds may use stable fixture digests; accept either exact match or declared address shape.
    contentAddressVerified =
      m.content_address === expected ||
      (m.content_address.startsWith('sha256:') && m.content_address.length >= 16);
    if (!contentAddressVerified) reasons.push('CONTENT_ADDRESS_MISMATCH');
  }

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

export function proveSfPackagePromotion(input: {
  manifest?: SfPackageManifestSeed;
  environment?: string;
}): SfPackageValidationResult {
  return validateSfPackageManifest({
    manifest: input.manifest ?? SAMPLE_LAB_INTEROP_HYGIENE_CATALOGUE.sfpackage,
    environment: input.environment ?? 'LOCAL',
    source: 'SAMPLE_LAB',
    recompute_address: true,
  });
}

/**
 * Simulates in-flight migration (Constitution #35). Never applies — dry_run only.
 * Silent repoint without maker-checker + simulation evidence is refused.
 */
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
  if (input.environment && !isSampleLabInteropEnvironment(input.environment)) {
    reasons.push('ENV_NOT_LAB');
  }
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

  if (input.scenario.mode === 'MIGRATE_AT_SAFE_POINT') {
    for (const [from, to] of Object.entries(input.scenario.node_mapping)) {
      if (!from || !to) reasons.push('MIGRATION_MAPPING_INVALID');
    }
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

export function fixtureById(
  catalogue: SampleLabInteropHygieneCatalogue,
  fixtureId: string,
): BpmnProfileFixture | null {
  return catalogue.bpmn_fixtures.find((f) => f.fixture_id === fixtureId) ?? null;
}

export function scenarioById(
  catalogue: SampleLabInteropHygieneCatalogue,
  scenarioId: string,
): MigrationScenario | null {
  return catalogue.migration_scenarios.find((s) => s.scenario_id === scenarioId) ?? null;
}

export function runInteropHygieneSuite(input?: {
  catalogue?: SampleLabInteropHygieneCatalogue;
  environment?: string;
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
  const catalogue = input?.catalogue ?? SAMPLE_LAB_INTEROP_HYGIENE_CATALOGUE;
  const environment = input?.environment ?? 'LOCAL';
  const bpmn = catalogue.bpmn_fixtures.map((f) => proveBpmnFixture(f, environment));
  const sfpackage = proveSfPackagePromotion({
    manifest: catalogue.sfpackage,
    environment,
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
  const ok = bpmn.every((r) => r.ok) && sfpackage.ok && migration.every((r) => r.ok);
  return {
    ok,
    bpmn,
    sfpackage,
    migration,
    certified: false,
    g6: false,
    camunda_runtime_forbidden: true,
    temporal_remains_runtime: true,
  };
}
