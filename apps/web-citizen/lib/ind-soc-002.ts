/** Accepted evidence types from the published IND-SOC-002 evidence policy sample (fixtures). */
export const EVIDENCE_OPTIONS = [
  { value: 'ELECTRICITY_BILL', label: 'Electricity bill' },
  { value: 'ROR_COPY', label: 'Copy of RoR' },
  { value: 'EPIC_OR_AADHAAR', label: 'EPIC / Aadhaar card' },
  { value: 'LANDLINE_TELEPHONE_BILL', label: 'Landline telephone bill' },
  { value: 'WATER_CONNECTION_BILL', label: 'Water connection bill' },
  { value: 'RATION_CARD', label: 'Ration card' },
  { value: 'HOLDING_TAX_RECEIPT', label: 'Holding tax receipt' },
  { value: 'LEASE_AGREEMENT', label: 'Lease agreement with house owner' },
  { value: 'EMPLOYER_CERTIFICATE', label: 'Certificate from the employer' },
  { value: 'BANK_PASSBOOK_FIRST_PAGE', label: 'First page of bank passbook' },
  { value: 'VOTER_LIST_EXTRACT', label: 'Extract of latest voter list' },
] as const;

export const GENDER_LABEL: Record<string, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  TRANSGENDER: 'Transgender',
  OTHER: 'Other',
  PREFER_NOT_TO_SAY: 'Prefer not to say',
};

export function evidenceLabel(value: string): string {
  return EVIDENCE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export type ApplicationSummary = {
  id: string;
  status: string;
  applicant_name: string;
  created_at?: string;
  credential_id?: string;
  digilocker: { status: string };
};

export type StatusTone = 'info' | 'success' | 'error' | 'neutral';

/** Citizen-facing wording for lab application states (status codes stay visible as tags). */
export function applicationStatus(app: Pick<ApplicationSummary, 'status' | 'digilocker'>): {
  label: string;
  tone: StatusTone;
} {
  if (app.status === 'ISSUED' && app.digilocker.status === 'PUBLISHED') {
    return { label: 'In your DigiLocker (SIMULATED)', tone: 'success' };
  }
  switch (app.status) {
    case 'SUBMITTED':
      return { label: 'Submitted · under review', tone: 'info' };
    case 'APPROVED':
      return { label: 'Approved · certificate being issued', tone: 'info' };
    case 'ISSUED':
      return { label: 'Certificate issued', tone: 'success' };
    case 'REJECTED':
      return { label: 'Not approved', tone: 'error' };
    default:
      return { label: 'Draft', tone: 'neutral' };
  }
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
