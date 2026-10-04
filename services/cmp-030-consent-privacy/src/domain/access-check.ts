export type AccessCheckReason =
  | 'OK'
  | 'PURPOSE_NOT_FOUND'
  | 'PURPOSE_INACTIVE'
  | 'CONSENT_NOT_REQUIRED'
  | 'MISSING_CONSENT'
  | 'CONSENT_WITHDRAWN';

export interface AccessCheckInput {
  purposeStatus: 'ACTIVE' | 'RETIRED' | null;
  requiresConsent: boolean | null;
  consentStatus: 'GRANTED' | 'WITHDRAWN' | null;
}

export interface AccessCheckResult {
  allowed: boolean;
  reason_code: AccessCheckReason;
}

/**
 * Platform consent gate only. Does not interpret statutory eligibility or DPDP rights.
 * When purpose.requires_consent is false, access is allowed without a consent row.
 */
export function evaluateAccessCheck(input: AccessCheckInput): AccessCheckResult {
  if (input.purposeStatus === null || input.requiresConsent === null) {
    return { allowed: false, reason_code: 'PURPOSE_NOT_FOUND' };
  }
  if (input.purposeStatus !== 'ACTIVE') {
    return { allowed: false, reason_code: 'PURPOSE_INACTIVE' };
  }
  if (!input.requiresConsent) {
    return { allowed: true, reason_code: 'CONSENT_NOT_REQUIRED' };
  }
  if (input.consentStatus === 'GRANTED') {
    return { allowed: true, reason_code: 'OK' };
  }
  if (input.consentStatus === 'WITHDRAWN') {
    return { allowed: false, reason_code: 'CONSENT_WITHDRAWN' };
  }
  return { allowed: false, reason_code: 'MISSING_CONSENT' };
}
