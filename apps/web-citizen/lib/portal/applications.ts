import { validateDisplayName } from '@serviceform/m10-sample-lab/identity-rules';

/** CMP-015 legal states (SF-CON-APPLICATION-CASE-SM). */
export type CaseState =
  | 'DRAFT'
  | 'READY_TO_SUBMIT'
  | 'SUBMITTED'
  | 'PAYMENT_PENDING'
  | 'RECEIVED'
  | 'UNDER_SCRUTINY'
  | 'DEFICIENCY_RAISED'
  | 'CITIZEN_RESPONSE'
  | 'VERIFICATION'
  | 'DECISION_PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'SIGNING_PENDING'
  | 'ISSUED'
  | 'CLOSED'
  | 'WITHDRAWN'
  | 'CANCELLED';

export type PortalStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'ACTION_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'ISSUED'
  | 'CLOSED';

export interface ResidenceForm {
  applicant_name: string;
  applicant_dob: string;
  applicant_gender: string;
  applicant_mobile?: string;
  applicant_aadhaar_last4?: string;
  residence_address: {
    house_no_or_name: string;
    locality: string;
    post_office?: string;
    district: string;
    state_code: string;
    pincode: string;
  };
  residence_duration_months: number;
  purpose_of_certificate: string;
  evidence_type: string;
  evidence_file_name?: string;
  evidence_mime?: string;
}

export interface PlatformApplication {
  application_id: string;
  state: CaseState;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  pins: { form_version_id: string; tenant_service_binding_id: string };
}

/** Browser view. Field values come from CMP-015 working data; state from the CMP-015 case. */
export interface PortalApplication extends Partial<ResidenceForm> {
  id: string;
  catalogue_id: 'IND-SOC-002';
  status: PortalStatus;
  platform_state: CaseState;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  source: 'PLATFORM';
  eligibility: 'NOT_EVALUATED';
  digilocker: { mode: 'SIMULATED'; status: 'NOT_REQUESTED' };
}

export function portalStatus(state: CaseState): PortalStatus {
  switch (state) {
    case 'DRAFT':
    case 'READY_TO_SUBMIT':
      return 'DRAFT';
    case 'APPROVED':
    case 'SIGNING_PENDING':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    case 'WITHDRAWN':
    case 'CANCELLED':
      return 'WITHDRAWN';
    case 'DEFICIENCY_RAISED':
      return 'ACTION_REQUIRED';
    case 'ISSUED':
      return 'ISSUED';
    case 'CLOSED':
      return 'CLOSED';
    default:
      return 'SUBMITTED';
  }
}

export function toPortalApplication(
  app: PlatformApplication,
  data: Partial<ResidenceForm> | Record<string, unknown> | null,
): PortalApplication {
  return {
    ...((data ?? {}) as Partial<ResidenceForm>),
    id: app.application_id,
    catalogue_id: 'IND-SOC-002',
    status: portalStatus(app.state),
    platform_state: app.state,
    aggregate_version: app.aggregate_version,
    created_at: app.created_at,
    updated_at: app.updated_at,
    submitted_at: app.submitted_at,
    source: 'PLATFORM',
    eligibility: 'NOT_EVALUATED',
    digilocker: { mode: 'SIMULATED', status: 'NOT_REQUESTED' },
  };
}

function text(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function optionalText(value: unknown, max = 200): string | undefined {
  return text(value, max) ?? undefined;
}

export type FormCheck =
  { ok: true; form: ResidenceForm } | { ok: false; field: string; message: string };

/**
 * Shape check for the SAMPLE_LAB residence form before it becomes CMP-015 working data. Schema
 * validation through CMP-009 is the follow-up named in CCR-M10-001. Synthetic-only names are
 * enforced server-side in SAMPLE_LAB (Phase A finding L-2).
 */
export function checkResidenceForm(raw: unknown, sampleLab: boolean): FormCheck {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const addr = (
    body['residence_address'] && typeof body['residence_address'] === 'object'
      ? body['residence_address']
      : {}
  ) as Record<string, unknown>;
  const required: [string, string | null][] = [
    ['applicant_name', text(body['applicant_name'], 80)],
    ['applicant_dob', text(body['applicant_dob'], 10)],
    ['applicant_gender', text(body['applicant_gender'], 20)],
    ['residence_address.house_no_or_name', text(addr['house_no_or_name'])],
    ['residence_address.locality', text(addr['locality'])],
    ['residence_address.district', text(addr['district'], 80)],
    ['residence_address.state_code', text(addr['state_code'], 4)],
    ['residence_address.pincode', text(addr['pincode'], 6)],
    ['purpose_of_certificate', text(body['purpose_of_certificate'])],
    ['evidence_type', text(body['evidence_type'], 80)],
  ];
  for (const [field, value] of required) {
    if (value === null) return { ok: false, field, message: 'Complete all required fields' };
  }
  const months = Number(body['residence_duration_months']);
  if (!Number.isInteger(months) || months < 0 || months > 1200) {
    return {
      ok: false,
      field: 'residence_duration_months',
      message: 'Enter the months as a whole number',
    };
  }
  const name = String(body['applicant_name']).trim();
  if (sampleLab) {
    const nameError = validateDisplayName(name);
    if (nameError) return { ok: false, field: 'applicant_name', message: nameError };
  }
  const mobile = optionalText(body['applicant_mobile'], 10);
  const aadhaar = optionalText(body['applicant_aadhaar_last4'], 4);
  if (aadhaar !== undefined && !/^\d{4}$/.test(aadhaar)) {
    return { ok: false, field: 'applicant_aadhaar_last4', message: 'Enter the last 4 digits only' };
  }
  const postOffice = optionalText(addr['post_office']);
  const fileName = optionalText(body['evidence_file_name']);
  const mime = optionalText(body['evidence_mime'], 80);
  return {
    ok: true,
    form: {
      applicant_name: name,
      applicant_dob: String(body['applicant_dob']).trim(),
      applicant_gender: String(body['applicant_gender']).trim(),
      ...(mobile ? { applicant_mobile: mobile } : {}),
      ...(aadhaar ? { applicant_aadhaar_last4: aadhaar } : {}),
      residence_address: {
        house_no_or_name: String(addr['house_no_or_name']).trim(),
        locality: String(addr['locality']).trim(),
        ...(postOffice ? { post_office: postOffice } : {}),
        district: String(addr['district']).trim(),
        state_code: String(addr['state_code']).trim(),
        pincode: String(addr['pincode']).trim(),
      },
      residence_duration_months: months,
      purpose_of_certificate: String(body['purpose_of_certificate']).trim(),
      evidence_type: String(body['evidence_type']).trim(),
      ...(fileName ? { evidence_file_name: fileName } : {}),
      ...(mime ? { evidence_mime: mime } : {}),
    },
  };
}
