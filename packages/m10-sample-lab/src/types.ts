import type { LabOtpPurpose, LabPreferredLanguage } from './identity-rules';

export type ApplicationStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ISSUED';

export type DigiLockerPublishStatus = 'NOT_REQUESTED' | 'PUBLISHED' | 'FAILED';

export interface LabAddress {
  house_no_or_name: string;
  locality: string;
  post_office?: string;
  district: string;
  state_code: string;
  pincode: string;
}

export interface LabApplication {
  id: string;
  catalogue_id: 'IND-SOC-002';
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
  applicant_name: string;
  applicant_dob: string;
  applicant_gender: string;
  applicant_mobile?: string;
  applicant_aadhaar_last4?: string;
  residence_address: LabAddress;
  residence_duration_months: number;
  purpose_of_certificate: string;
  evidence_type: string;
  evidence_file_name?: string;
  evidence_mime?: string;
  fee_paisa: number;
  eligibility_pass: boolean;
  rejection_reason?: string;
  credential_id?: string;
  digilocker: {
    mode: 'SIMULATED';
    doc_type: string;
    status: DigiLockerPublishStatus;
    provider_transaction_ref?: string;
    simulation_marker: string;
  };
}

export interface LabCitizenAccount {
  citizen_id: string;
  display_name: string;
  mobile: string;
  email?: string;
  preferred_language: LabPreferredLanguage;
  consent: { purpose_code: 'CITIZEN_AUTH_AND_UPDATES'; accepted_at: string };
  created_at: string;
}

export type LabOtpChallengeStatus = 'PENDING' | 'VERIFIED' | 'LOCKED' | 'EXPIRED' | 'SUPERSEDED';

export interface LabOtpChallenge {
  challenge_id: string;
  mobile: string;
  purpose: LabOtpPurpose;
  status: LabOtpChallengeStatus;
  attempts: number;
  max_attempts: number;
  created_at: string;
  expires_at: string;
  resend_after: string;
  simulation: { simulation: true; scenario: 'otp_challenge'; environment: 'SAMPLE_LAB' };
}

export interface LabStoreFile {
  version: 1;
  label: 'SAMPLE_LAB';
  g6_issued: false;
  applications: LabApplication[];
}

/** Citizen identity lives in its own file so resetting applications never drops OTP state. */
export interface LabIdentityStoreFile {
  version: 1;
  label: 'SAMPLE_LAB';
  citizen_accounts: LabCitizenAccount[];
  otp_challenges: LabOtpChallenge[];
}
