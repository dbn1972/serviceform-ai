/**
 * Odisha e-District public sample constants (Finding M-04 resolved).
 * DigiLocker remains SAMPLE_LAB / SIMULATED — not a registrar-issued doc type.
 */
export const ODISHA_LAB_POLICY = {
  catalogue_id: 'IND-SOC-002',
  policy_source_url: 'https://edistrict.odisha.gov.in/',
  min_residence_months: 12,
  fee_amount_paisa: 0,
  sla_working_days: 10,
  credential_template_ref: 'SAMPLE_LAB_IND_SOC_002_OD_RESIDENT_V1',
  digilocker_doc_type: 'SAMPLE_LAB_RESIDENT_CERTIFICATE',
  digilocker_mode: 'SIMULATED' as const,
  environment_label: 'SAMPLE_LAB',
  g6_issued: false,
} as const;

export type DigiLockerMockMode = typeof ODISHA_LAB_POLICY.digilocker_mode;
