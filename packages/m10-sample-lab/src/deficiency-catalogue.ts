/**
 * SAMPLE_LAB published deficiency catalogue (SF-47).
 * Mirrors fixtures/lab/platform/deficiency-catalogue.json. Item codes reuse IND-SOC-002
 * evidence_requirements from fixtures/golden/ind-soc-002/tenant-overlay.yaml.
 * Codes only — not statute. CERTIFIED=false.
 */

export interface DeficiencyCatalogueReason {
  reason_code: string;
  label: string;
  notice_code: string;
  instruction_ref: string;
  default_item_codes: string[];
}

export interface DeficiencyCatalogueItem {
  item_code: string;
  label: string;
}

export interface DeficiencyCatalogue {
  reasons: DeficiencyCatalogueReason[];
  item_codes: DeficiencyCatalogueItem[];
  close_reason_codes: { close_reason_code: string; label: string }[];
  evidence_kind_codes: { officer_notice: string; citizen_upload: string };
}

export const SAMPLE_LAB_DEFICIENCY_CATALOGUE: DeficiencyCatalogue = {
  reasons: [
    {
      reason_code: 'MISSING_PROOF',
      label: 'Supporting document missing or unclear',
      notice_code: 'CLARIFY_EVIDENCE',
      instruction_ref: 'ref:sample-lab:deficiency:clarify-evidence',
      default_item_codes: ['ELECTRICITY_BILL', 'EPIC_OR_AADHAAR', 'RATION_CARD'],
    },
    {
      reason_code: 'ADDRESS_MISMATCH',
      label: 'Address details need clarification',
      notice_code: 'CLARIFY_ADDRESS',
      instruction_ref: 'ref:sample-lab:deficiency:clarify-address',
      default_item_codes: ['ELECTRICITY_BILL', 'LEASE_AGREEMENT', 'HOLDING_TAX_RECEIPT'],
    },
  ],
  item_codes: [
    { item_code: 'ELECTRICITY_BILL', label: 'Electricity bill' },
    { item_code: 'ROR_COPY', label: 'Copy of RoR' },
    { item_code: 'EPIC_OR_AADHAAR', label: 'EPIC / Aadhaar card' },
    { item_code: 'LANDLINE_TELEPHONE_BILL', label: 'Landline telephone bill' },
    { item_code: 'WATER_CONNECTION_BILL', label: 'Water connection bill' },
    { item_code: 'RATION_CARD', label: 'Ration card' },
    { item_code: 'HOLDING_TAX_RECEIPT', label: 'Holding tax receipt' },
    { item_code: 'LEASE_AGREEMENT', label: 'Lease agreement with house owner' },
    { item_code: 'EMPLOYER_CERTIFICATE', label: 'Certificate from the employer' },
    { item_code: 'BANK_PASSBOOK_FIRST_PAGE', label: 'First page of bank passbook' },
    { item_code: 'VOTER_LIST_EXTRACT', label: 'Extract of latest voter list' },
    { item_code: 'NREGA_JOB_CARD', label: 'NREGA job card' },
    { item_code: 'OTHER_RELEVANT', label: 'Other relevant document' },
  ],
  close_reason_codes: [
    { close_reason_code: 'CITIZEN_RESPONDED', label: 'Citizen response received' },
    { close_reason_code: 'NO_LONGER_REQUIRED', label: 'Further evidence no longer required' },
  ],
  evidence_kind_codes: {
    officer_notice: 'NOTICE_ATTACHMENT',
    citizen_upload: 'CITIZEN_UPLOAD',
  },
};

export function itemLabel(itemCode: string): string {
  return (
    SAMPLE_LAB_DEFICIENCY_CATALOGUE.item_codes.find((i) => i.item_code === itemCode)?.label ??
    itemCode
  );
}

export function reasonLabel(reasonCode: string): string {
  return (
    SAMPLE_LAB_DEFICIENCY_CATALOGUE.reasons.find((r) => r.reason_code === reasonCode)?.label ??
    reasonCode
  );
}
