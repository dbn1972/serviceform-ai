export interface ConsentAccessPort {
  check(input: {
    tenant_id: string;
    subject_id: string;
    purpose_code: string;
    correlation_id: string;
  }): Promise<{ allowed: boolean; reason_code: string }>;
}

export interface SubjectDirectoryPort {
  exists(input: { tenant_id: string; subject_id: string }): Promise<boolean>;
}

export interface DigiLockerClaim {
  section_code: string;
  claim_code: string;
  value_text: string;
  source_ref: string;
}

export interface DigiLockerPort {
  fetchVerifiedClaims(input: {
    subject_id: string;
    scenario: string;
    test_run_id: string;
  }): Promise<{ claims: DigiLockerClaim[]; simulation: true }>;
}
