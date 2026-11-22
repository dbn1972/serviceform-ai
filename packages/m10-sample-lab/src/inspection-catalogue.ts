/**
 * SAMPLE_LAB published inspection / verification pins (CMP-018).
 * Metadata-driven — services that pin an inspection workflow node appear here.
 * Not statute. CERTIFIED=false · G6=false.
 */

export const SAMPLE_LAB_INSPECTION_ROLE = 'SAMPLE_LAB_INSPECTION_OFFICER' as const;

export const SAMPLE_LAB_VERIFICATION_RESULTS = [
  {
    code: 'VERIFIED',
    label: 'Verified',
    description: 'Non-statutory site/evidence verification passed',
  },
  {
    code: 'NOT_VERIFIED',
    label: 'Not verified',
    description: 'Non-statutory verification failed',
  },
  {
    code: 'INCONCLUSIVE',
    label: 'Inconclusive',
    description: 'Verification could not be completed',
  },
  {
    code: 'DEFICIENCY_NOTED',
    label: 'Deficiency noted',
    description: 'Verification recorded a deficiency for follow-up (not statutory reject)',
  },
] as const;

export type SampleLabVerificationResult = (typeof SAMPLE_LAB_VERIFICATION_RESULTS)[number]['code'];

export const SAMPLE_LAB_INSPECTION_ASSIGNMENT = {
  role_code: SAMPLE_LAB_INSPECTION_ROLE,
  organisation_id: '0d15ba00-0a01-4000-8000-0d15ba000a01',
  jurisdiction_id: '0d15ba00-0b01-4000-8000-0d15ba000b01',
  office_id: null as string | null,
} as const;

export interface SampleLabInspectionChecklistItem {
  code: string;
  label: string;
  required: boolean;
}

export interface SampleLabInspectionPin {
  pin_code: string;
  /** Catalogue id when the pin is service-specific; null = catalogue-agnostic. */
  catalogue_id: string | null;
  label: string;
  description: string;
  workflow_node_id: string;
  checklist_items: readonly SampleLabInspectionChecklistItem[];
}

/** Pins for services (and generic nodes) that require CMP-018 inspection. */
export const SAMPLE_LAB_INSPECTION_PINS: readonly SampleLabInspectionPin[] = [
  {
    pin_code: 'TRADE_LICENCE_SITE_VISIT',
    /** Real registry id (IND-BTP-001 Trade Licence) — SAMPLE_LAB pin demo; not citizen-offerable. */
    catalogue_id: 'IND-BTP-001',
    label: 'Trade licence site visit',
    description:
      'SAMPLE_LAB pin for IND-BTP-001 Trade Licence site verification (Studio→TSB pin demo; DRAFT/DUMMY)',
    workflow_node_id: 'SITE_VISIT',
    checklist_items: [
      { code: 'SITE_ACCESS', label: 'Premises accessible', required: true },
      { code: 'SIGNAGE', label: 'Business identity visible', required: true },
      { code: 'DOCUMENTS_ON_SITE', label: 'Required documents available on site', required: false },
    ],
  },
  {
    pin_code: 'FACTORY_LICENCE_INSPECTION',
    /** Real registry id (IND-LAB-019 Factory Registration / Licence). */
    catalogue_id: 'IND-LAB-019',
    label: 'Factory licence inspection',
    description:
      'SAMPLE_LAB pin for IND-LAB-019 Factory Licence verification (Studio→TSB pin demo; DRAFT/DUMMY)',
    workflow_node_id: 'FACTORY_INSPECTION',
    checklist_items: [
      { code: 'SAFETY_POSTERS', label: 'Safety notices posted', required: true },
      { code: 'EGRESS_CLEAR', label: 'Egress paths clear', required: true },
    ],
  },
  {
    pin_code: 'GENERIC_VERIFICATION',
    catalogue_id: null,
    label: 'Generic verification node',
    description:
      'Catalogue-agnostic pin for any SAMPLE_LAB case that references WORKFLOW node SITE_VERIFY',
    workflow_node_id: 'SITE_VERIFY',
    checklist_items: [
      { code: 'IDENTITY_MATCH', label: 'Subject identity matches application', required: true },
      { code: 'LOCATION_MATCH', label: 'Location matches declared address', required: true },
    ],
  },
] as const;

export function isSampleLabVerificationResult(
  value: unknown,
): value is SampleLabVerificationResult {
  return typeof value === 'string' && SAMPLE_LAB_VERIFICATION_RESULTS.some((r) => r.code === value);
}

export function pinForCode(pinCode: string): SampleLabInspectionPin | null {
  return SAMPLE_LAB_INSPECTION_PINS.find((p) => p.pin_code === pinCode) ?? null;
}

export function pinsForCatalogue(catalogueId: string | null | undefined): SampleLabInspectionPin[] {
  if (!catalogueId) {
    return SAMPLE_LAB_INSPECTION_PINS.filter((p) => p.catalogue_id === null);
  }
  return SAMPLE_LAB_INSPECTION_PINS.filter(
    (p) => p.catalogue_id === catalogueId || p.catalogue_id === null,
  );
}

export function verificationResultLabel(code: string): string {
  return SAMPLE_LAB_VERIFICATION_RESULTS.find((r) => r.code === code)?.label ?? code;
}
