import {
  formFields,
  latestVersion,
  listTemplates,
  publishedVersion,
  stepLabels,
  type CertificateTemplate,
} from '@serviceform/service-templates';
import { portalPlacement } from './portal/platform';

export interface CatalogueEntry {
  catalogue_id: string;
  name: string;
  summary: string;
  category: string;
  output_type: string;
  offered: boolean;
  fee: string;
  service_time: string;
  eligibility: string;
  steps: number;
}

const PENDING = 'POLICY_INPUT_REQUIRED';

/** Citizen-facing copy for a policy fact the department has not published yet. */
export function policyText(value: string): string {
  return value === PENDING ? 'To be published by the department' : value;
}

/** A service is offered when this portal's placement binds it and a version is PUBLISHED. */
export function isOffered(template: CertificateTemplate): boolean {
  const offered = portalPlacement().offerings.some((o) => o.catalogue_id === template.catalogue_id);
  return offered && publishedVersion(template) !== null;
}

export function catalogueEntries(): CatalogueEntry[] {
  return listTemplates()
    .map((t) => ({
      catalogue_id: t.catalogue_id,
      name: t.name,
      summary: t.summary,
      category: t.category,
      output_type: t.output_type,
      offered: isOffered(t),
      fee: policyText(t.policy.fee),
      service_time: policyText(t.policy.service_time),
      eligibility: policyText(t.policy.eligibility),
      steps: stepLabels(publishedVersion(t) ?? latestVersion(t)).length,
    }))
    .sort((a, b) => Number(b.offered) - Number(a.offered) || a.name.localeCompare(b.name));
}

/** What the citizen will be asked: step names and leaf field titles of the latest version. */
export function formOutline(template: CertificateTemplate) {
  const version = publishedVersion(template) ?? latestVersion(template);
  return {
    version: version.version,
    steps: stepLabels(version),
    fields: formFields(version.form.json_schema).filter(
      (f) => f.pointer !== '/declaration_accepted',
    ),
  };
}
