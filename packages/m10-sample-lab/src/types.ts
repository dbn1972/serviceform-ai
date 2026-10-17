export type ApplicationStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ISSUED';

export type DigiLockerPublishStatus = 'NOT_REQUESTED' | 'PUBLISHED' | 'FAILED';

export interface LabAddress {
  house_no_or_name: string;
  locality: string;
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
  residence_address: LabAddress;
  residence_duration_months: number;
  purpose_of_certificate: string;
  evidence_type: string;
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

export interface LabStoreFile {
  version: 1;
  label: 'SAMPLE_LAB';
  g6_issued: false;
  applications: LabApplication[];
}
