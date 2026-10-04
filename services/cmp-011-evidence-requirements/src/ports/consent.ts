export interface ConsentAccessPort {
  check(input: {
    tenant_id: string;
    subject_id: string;
    purpose_code: string;
    correlation_id: string;
  }): Promise<{ allowed: boolean; reason_code: string }>;
}
