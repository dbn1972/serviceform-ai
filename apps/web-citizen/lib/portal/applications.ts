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
  digilocker: PortalDigiLocker;
  credential_id?: string;
}

export type DigiLockerStatus =
  'NOT_REQUESTED' | 'PENDING' | 'PUBLISHED' | 'FAILED' | 'RETRY_SCHEDULED';

export interface PortalDigiLocker {
  mode: 'SIMULATED' | 'SANDBOX' | 'REAL';
  status: DigiLockerStatus;
  provider_transaction_ref?: string;
}

/** Host projection `GET /v1/applications/{id}/issuance` (CMP-022 credential + CMP-012 publish). */
export interface IssuanceProjection {
  credential: { credential_id: string; lifecycle_status: string } | null;
  digilocker: PortalDigiLocker & { publish_request_id?: string; failure_code?: string };
}

const NOT_REQUESTED: PortalDigiLocker = { mode: 'SIMULATED', status: 'NOT_REQUESTED' };

/** Cases past a recorded approval are the only ones with an issuance projection. */
export function issuanceApplies(state: CaseState): boolean {
  return ['APPROVED', 'SIGNING_PENDING', 'ISSUED', 'CLOSED'].includes(state);
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
  issuance: IssuanceProjection | null = null,
): PortalApplication {
  const dl = issuance?.digilocker;
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
    digilocker: dl
      ? {
          mode: dl.mode,
          status: dl.status,
          ...(dl.provider_transaction_ref
            ? { provider_transaction_ref: dl.provider_transaction_ref }
            : {}),
        }
      : NOT_REQUESTED,
    ...(issuance?.credential ? { credential_id: issuance.credential.credential_id } : {}),
  };
}
