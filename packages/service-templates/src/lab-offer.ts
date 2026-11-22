import { usesSampleLabDummyPolicy } from './sample-lab-dummy';
import type { CertificateTemplate, TemplateVersion } from './types';

/**
 * SAMPLE_LAB citizen lab offers: Residence PUBLISHED + DRAFT stubs/packs with
 * SAMPLE_LAB DUMMY sample parameters (fee/eligibility/evidence/service_time).
 * Spans Certificate + Licence + Permit. Never real statute / production policy.
 * Income (IND-SOC-031) stays DUMMY-labeled — no invented statute.
 * Fail-closed outside SAMPLE_LAB placements. CERTIFIED=false · G6=false.
 */
export const SAMPLE_LAB_REPRESENTATIVE_CATALOGUE_IDS = [
  // Certificates (existing)
  'IND-SOC-002', // Residence — PUBLISHED
  'IND-SOC-031', // Income — M11 shell (DUMMY only; SF-33 statute still owner)
  'IND-SOC-001', // Domicile — hand-crafted stub
  'IND-CIV-001', // Birth Registration — Registration exception
  'IND-AGR-002', // Farmer Certificate — generated stub
  'IND-EDU-004', // Transfer Certificate — generated stub (fee>0 SIM)
  // Certificates (expanded)
  'IND-SOC-003', // Permanent Residence Certificate
  'IND-EDU-002', // Bonafide Student Certificate
  // Licences (expanded from DRAFT stubs/packs)
  'IND-BTP-001', // Trade Licence
  'IND-AGR-010', // Seed Dealer Licence
  'IND-LAB-019', // Factory Registration / Licence
  // Permits (expanded from DRAFT stubs/packs)
  'IND-ULB-007', // Building Construction Permit
  'IND-ENV-002', // Tree Transit Permit
] as const;

export type SampleLabRepresentativeId = (typeof SAMPLE_LAB_REPRESENTATIVE_CATALOGUE_IDS)[number];

const PENDING = 'POLICY_INPUT_REQUIRED';

export function isSampleLabRepresentative(catalogueId: string): boolean {
  return (SAMPLE_LAB_REPRESENTATIVE_CATALOGUE_IDS as readonly string[]).includes(catalogueId);
}

/**
 * Version a SAMPLE_LAB placement may pin: PUBLISHED when present; otherwise the latest
 * DRAFT stub that carries SAMPLE_LAB DUMMY policy (lab-only offer path).
 */
export function labOfferVersion(
  template: CertificateTemplate,
  opts: { environmentLabel?: string | null } = {},
): TemplateVersion | null {
  const published = [...template.versions].reverse().find((v) => v.status === 'PUBLISHED');
  if (published) return published;
  if (opts.environmentLabel !== 'SAMPLE_LAB') return null;
  const p = template.policy;
  const pending = [p.fee, p.service_time, p.eligibility, p.evidence].includes(PENDING);
  if (pending || !usesSampleLabDummyPolicy(template)) return null;
  const draft = template.versions[template.versions.length - 1];
  return draft?.status === 'DRAFT' ? draft : null;
}
