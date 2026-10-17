import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pilot public-sample constants (Finding M-04 resolved via public e-District portal).
 * DigiLocker remains SAMPLE_LAB / SIMULATED — not a registrar-issued doc type.
 * Jurisdiction display names live in fixtures/master data only (Constitution #3).
 */

function loadPolicySourceUrl(): string {
  const candidates = [
    join(process.cwd(), 'fixtures/golden/ind-soc-002/SOURCE_PROVENANCE.md'),
    join(process.cwd(), '../../fixtures/golden/ind-soc-002/SOURCE_PROVENANCE.md'),
  ];
  for (const path of candidates) {
    if (!existsSync(/*turbopackIgnore: true*/ path)) continue;
    const text = readFileSync(/*turbopackIgnore: true*/ path, 'utf8');
    const m = text.match(/https:\/\/edistrict\.[a-z0-9.-]+\//i);
    if (m?.[0]) return m[0];
  }
  // Fail closed without naming a jurisdiction in source.
  return 'SAMPLE_LAB_POLICY_SOURCE_UNRESOLVED';
}

export const PUBLIC_SAMPLE_LAB_POLICY = {
  catalogue_id: 'IND-SOC-002',
  policy_source_url: loadPolicySourceUrl(),
  min_residence_months: 12,
  fee_amount_paisa: 0,
  sla_working_days: 10,
  credential_template_ref: 'SAMPLE_LAB_IND_SOC_002_OD_RESIDENT_V1',
  digilocker_doc_type: 'SAMPLE_LAB_RESIDENT_CERTIFICATE',
  digilocker_mode: 'SIMULATED' as const,
  environment_label: 'SAMPLE_LAB',
  g6_issued: false,
} as const;

export type DigiLockerMockMode = typeof PUBLIC_SAMPLE_LAB_POLICY.digilocker_mode;
