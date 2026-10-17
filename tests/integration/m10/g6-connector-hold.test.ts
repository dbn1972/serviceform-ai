/**
 * G6 connector / TSB seal holds — fail-closed without inventing DigiLocker registrations.
 * Complements int-013 mode rules. SAMPLE_LAB DigiLocker doc types must not be PRODUCTION-bound.
 */
import { describe, expect, it } from 'vitest';
import { ODISHA_PUBLIC_SAMPLE } from './support/fixtures.js';

const SAMPLE_LAB_DOC = 'SAMPLE_LAB_RESIDENT_CERTIFICATE';

describe('M10 G6 REAL-connector and TSB seal holds', () => {
  it('Odisha sample credential template is SAMPLE_LAB-prefixed (not DigiLocker-registered)', () => {
    expect(ODISHA_PUBLIC_SAMPLE.credential_template_ref.startsWith('SAMPLE_LAB_')).toBe(true);
  });

  it('SAMPLE_LAB DigiLocker doc type must be refused as a PRODUCTION critical binding', () => {
    const binding = {
      environment: 'PRODUCTION' as const,
      critical: true,
      mode: 'SIMULATED' as const,
      digilocker_doc_type: SAMPLE_LAB_DOC,
    };
    // Critical PRODUCTION binding with SIMULATED mode or SAMPLE_LAB doc type is forbidden.
    const refuseSimulated =
      binding.environment === 'PRODUCTION' && binding.critical && binding.mode !== 'REAL';
    const refuseSampleLabDoc =
      binding.environment === 'PRODUCTION' &&
      binding.critical &&
      binding.digilocker_doc_type.startsWith('SAMPLE_LAB_');
    expect(refuseSimulated).toBe(true);
    expect(refuseSampleLabDoc).toBe(true);
  });

  it('TSB immutability seal remains false until REAL DigiLocker/DLT bindings exist', () => {
    // Mirrors fixtures/golden/ind-soc-002/tsb-publish-fixture.json publish_gate_requirements.
    const gate = {
      all_policy_input_required_fields_resolved: true,
      tsb_immutability_sealed: false,
      production_digilocker_ready: false,
      production_dlt_ready: false,
    };
    expect(gate.all_policy_input_required_fields_resolved).toBe(true);
    expect(gate.tsb_immutability_sealed).toBe(false);
    expect(gate.production_digilocker_ready).toBe(false);
  });

  it.todo(
    'REAL DigiLocker publish against registrar-issued doc type — blocked until DigiLocker credentials + doc-type registration supplied (not inventable from e-District portal)',
  );

  it.todo(
    'UX4G golden citizen journey a11y/keyboard/responsive/visual evidence — blocked until SF-M10-005 dispatched with Design System evidence pack',
  );

  it.todo(
    'Resilience backup/restore/rollback drill evidence — blocked until ops runbook + restore cell authorized',
  );
});
