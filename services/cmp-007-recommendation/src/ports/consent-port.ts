export interface ConsentCheck {
  granted: boolean;
  consentRef?: string;
}

/**
 * CMP-030 consent/purpose port. Fail closed: any thrown error is treated as "not granted" by the
 * caller, and a missing or withdrawn consent for the purpose blocks the recommendation.
 */
export interface ConsentPort {
  check(input: { tenantId: string; subjectId: string; purposeCode: string }): Promise<ConsentCheck>;
}
