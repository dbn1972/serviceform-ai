import { usesSampleLabDummyPolicy } from './sample-lab-dummy';
import type { CertificateTemplate, TemplateVersion } from './types';

/**
 * SAMPLE_LAB representative certificates for citizen→officer→credential E2E
 * (Residence + diverse stubs). Full catalogue form contract coverage is separate.
 * Fail-closed outside SAMPLE_LAB placements.
 */
export const SAMPLE_LAB_REPRESENTATIVE_CATALOGUE_IDS = [
  'IND-SOC-002', // Residence — PUBLISHED
  'IND-SOC-031', // Income — M11 shell
  'IND-SOC-001', // Domicile — hand-crafted stub
  'IND-CIV-001', // Birth Registration — Registration exception
  'IND-AGR-002', // Farmer Certificate — generated stub
  'IND-EDU-004', // Transfer Certificate — generated stub
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
