import {
  formFields,
  labOfferVersion,
  latestVersion,
  listTemplates,
  policyInputsPending,
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

/**
 * A service is offered when this portal's placement binds it and policy facts are resolved.
 * Outside SAMPLE_LAB a PUBLISHED version is required. In SAMPLE_LAB, DRAFT stubs with
 * SAMPLE_LAB DUMMY policy may be offered when the placement binds them (fail-closed elsewhere).
 */
export function isOffered(template: CertificateTemplate): boolean {
  const placement = portalPlacement();
  const offered = placement.offerings.some((o) => o.catalogue_id === template.catalogue_id);
  if (!offered || policyInputsPending(template)) return false;
  return (
    labOfferVersion(template, {
      environmentLabel: placement.environment_label ?? null,
    }) !== null
  );
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
