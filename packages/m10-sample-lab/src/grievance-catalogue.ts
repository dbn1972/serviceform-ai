/**
 * SAMPLE_LAB published grievance / helpdesk catalogue (ONDC IGM–inspired categories,
 * government casework desks). Not statute. CERTIFIED=false.
 *
 * Categories adapt commerce ORDER/ITEM/… to CASE/DOCUMENT/PAYMENT/FULFILLMENT/OTHER.
 * Escalation ladder is role_code metadata only — never named officers.
 */

export const SAMPLE_LAB_GRIEVANCE_CATEGORIES = [
  {
    code: 'CASE',
    label: 'Case / application decision',
    description: 'Delay, status, or process concern about a filed application',
  },
  {
    code: 'DOCUMENT',
    label: 'Document / credential',
    description: 'Issued document, DigiLocker publish, or evidence handling',
  },
  {
    code: 'PAYMENT',
    label: 'Fee / payment',
    description: 'Fee collection, receipt, or refund process (lab ₹0 paths still use this code)',
  },
  {
    code: 'FULFILLMENT',
    label: 'Issuance / fulfillment',
    description: 'Credential issuance or delivery after approval',
  },
  {
    code: 'OTHER',
    label: 'Other',
    description: 'General helpdesk when no other category fits',
  },
] as const;

export type SampleLabGrievanceCategoryCode =
  (typeof SAMPLE_LAB_GRIEVANCE_CATEGORIES)[number]['code'];

/** Desk levels — assignment role_code only (Constitution #19). */
export const SAMPLE_LAB_GRIEVANCE_ESCALATION = [
  {
    level: 1,
    role_code: 'SAMPLE_LAB_HELPDESK_L1',
    label: 'Helpdesk L1',
  },
  {
    level: 2,
    role_code: 'SAMPLE_LAB_HELPDESK_L2',
    label: 'Supervisor L2',
  },
  {
    level: 3,
    role_code: 'SAMPLE_LAB_HELPDESK_L3',
    label: 'Appellate desk L3',
  },
] as const;

/** Lab org/jurisdiction pins for assignment metadata (opaque UUIDs; not place names). */
export const SAMPLE_LAB_GRIEVANCE_ROUTING = {
  organisation_id: '0d15ba00-0a01-4000-8000-0d15ba000a01',
  jurisdiction_id: '0d15ba00-0j01-4000-8000-0d15ba000j01',
  office_id: null as string | null,
  max_escalation_level: 3,
  citizen_may_request_escalation: true,
} as const;

export function isSampleLabGrievanceCategory(
  value: unknown,
): value is SampleLabGrievanceCategoryCode {
  return (
    typeof value === 'string' &&
    SAMPLE_LAB_GRIEVANCE_CATEGORIES.some((c) => c.code === value)
  );
}

export function escalationForLevel(level: number) {
  return SAMPLE_LAB_GRIEVANCE_ESCALATION.find((e) => e.level === level) ?? null;
}

export function nextEscalationLevel(currentRoleCode: string | null | undefined): number | null {
  const current = SAMPLE_LAB_GRIEVANCE_ESCALATION.find((e) => e.role_code === currentRoleCode);
  const level = current?.level ?? 1;
  if (level >= SAMPLE_LAB_GRIEVANCE_ROUTING.max_escalation_level) return null;
  return level + 1;
}
