import { describe, expect, it } from 'vitest';
import {
  SAMPLE_LAB_BPMN_CAMUNDA_FORBIDDEN_XML,
  SAMPLE_LAB_BPMN_SUPPORTED_XML,
  SAMPLE_LAB_INTEROP_HYGIENE_CATALOGUE,
  fixtureById,
  proveBpmnFixture,
  proveSfPackagePromotion,
  runInteropHygieneSuite,
  scenarioById,
  screenBpmnProfile,
  simulateInFlightMigration,
  validateSfPackageManifest,
} from '../src/interop-hygiene-catalogue.js';

describe('SAMPLE_LAB interop hygiene catalogue (BPMN / .sfpackage / migration)', () => {
  it('screens supported BPMN profile without claiming Camunda runtime', () => {
    const result = screenBpmnProfile({
      xml: SAMPLE_LAB_BPMN_SUPPORTED_XML,
      environment: 'LOCAL',
    });
    expect(result.ok).toBe(true);
    expect(result.temporal_remains_runtime).toBe(true);
    expect(result.camunda_runtime_forbidden).toBe(true);
    expect(result.bpmn_role).toBe('IMPORT_EXPORT_PROFILE_ONLY');
    expect(result.certified).toBe(false);
    expect(result.g6).toBe(false);
  });

  it('refuses Camunda assignee / executable BPMN (no second runtime)', () => {
    const result = screenBpmnProfile({
      xml: SAMPLE_LAB_BPMN_CAMUNDA_FORBIDDEN_XML,
      environment: 'LOCAL',
    });
    expect(result.ok).toBe(false);
    expect(result.reason_codes).toEqual(
      expect.arrayContaining(['BPMN_EXECUTABLE_FORBIDDEN', 'BPMN_RUNTIME_CONSTRUCT_FORBIDDEN']),
    );
    expect(result.camunda_runtime_forbidden).toBe(true);
  });

  it('proveBpmnFixture matches catalogue expectations', () => {
    const supported = fixtureById(
      SAMPLE_LAB_INTEROP_HYGIENE_CATALOGUE,
      'bpmn-supported-round-trip',
    );
    const forbidden = fixtureById(
      SAMPLE_LAB_INTEROP_HYGIENE_CATALOGUE,
      'bpmn-camunda-assignee-forbidden',
    );
    expect(supported).toBeTruthy();
    expect(forbidden).toBeTruthy();
    if (!supported || !forbidden) throw new Error('missing fixtures');
    expect(proveBpmnFixture(supported).ok).toBe(true);
    expect(proveBpmnFixture(forbidden).ok).toBe(true);
    expect(proveBpmnFixture(forbidden).compatibility_status).toBe('UNSUPPORTED');
  });

  it('validates .sfpackage manifest without embedded secrets', () => {
    const result = proveSfPackagePromotion({ environment: 'LOCAL' });
    expect(result.ok).toBe(true);
    expect(result.embedded_secrets_forbidden).toBe(true);
    expect(result.secrets_detected).toBe(false);
    expect(result.signature_ref_external).toBe(true);
    expect(result.certified).toBe(false);
    expect(result.g6).toBe(false);
  });

  it('refuses secret path in .sfpackage artifact list', () => {
    const base = SAMPLE_LAB_INTEROP_HYGIENE_CATALOGUE.sfpackage;
    const result = validateSfPackageManifest({
      environment: 'LOCAL',
      manifest: {
        ...base,
        artifact_hashes: [
          ...base.artifact_hashes,
          {
            path: 'secrets/api_key.txt',
            sha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.secrets_detected).toBe(true);
    expect(result.reason_codes).toContain('SECRET_PATH_IN_ARTIFACT');
  });

  it('simulates migration dry-run and refuses silent / same-principal / apply', () => {
    const scenario = scenarioById(SAMPLE_LAB_INTEROP_HYGIENE_CATALOGUE, 'mig-safe-point');
    expect(scenario).toBeTruthy();
    if (!scenario) throw new Error('missing scenario');

    const ok = simulateInFlightMigration({
      scenario,
      requested_by: 'maker-1',
      approved_by: 'checker-1',
      approval_ref: 'lab:approval:mig-safe-point',
      simulation_evidence_ref: 'lab:sim:mig-safe-point',
      apply: false,
      environment: 'LOCAL',
    });
    expect(ok.ok).toBe(true);
    expect(ok.dry_run).toBe(true);
    expect(ok.applied).toBe(false);
    expect(ok.certified).toBe(false);
    expect(ok.g6).toBe(false);

    const silent = simulateInFlightMigration({
      scenario,
      requested_by: 'maker-1',
      approved_by: 'checker-1',
      apply: false,
      environment: 'LOCAL',
    });
    expect(silent.ok).toBe(false);
    expect(silent.silent_repoint_refused).toBe(true);
    expect(silent.reason_codes).toContain('SILENT_REPOINT_FORBIDDEN');

    const same = simulateInFlightMigration({
      scenario,
      requested_by: 'same-person',
      approved_by: 'same-person',
      approval_ref: 'a',
      simulation_evidence_ref: 'b',
      environment: 'LOCAL',
    });
    expect(same.ok).toBe(false);
    expect(same.reason_codes).toContain('MAKER_CHECKER_SAME_PRINCIPAL');

    const apply = simulateInFlightMigration({
      scenario,
      requested_by: 'maker-1',
      approved_by: 'checker-1',
      approval_ref: 'a',
      simulation_evidence_ref: 'b',
      apply: true,
      environment: 'LOCAL',
    });
    expect(apply.ok).toBe(false);
    expect(apply.applied).toBe(false);
    expect(apply.reason_codes).toContain('APPLY_FORBIDDEN_IN_LAB_DEMO');
  });

  it('runInteropHygieneSuite passes SAMPLE_LAB catalogue without G6 claim', () => {
    const suite = runInteropHygieneSuite({ environment: 'LOCAL' });
    expect(suite.ok).toBe(true);
    expect(suite.bpmn).toHaveLength(2);
    expect(suite.migration).toHaveLength(2);
    expect(suite.sfpackage.ok).toBe(true);
    expect(suite.camunda_runtime_forbidden).toBe(true);
    expect(suite.temporal_remains_runtime).toBe(true);
    expect(suite.certified).toBe(false);
    expect(suite.g6).toBe(false);
  });
});
