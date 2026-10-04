import { describe, expect, it } from 'vitest';
import { evaluateAccessCheck } from '../../src/domain/access-check.js';
import { canonicalJson, requestFingerprint } from '../../src/domain/fingerprint.js';

describe('evaluateAccessCheck', () => {
  it('denies missing purpose and inactive purpose', () => {
    expect(evaluateAccessCheck({ purposeStatus: null, requiresConsent: null, consentStatus: null })).toEqual({
      allowed: false,
      reason_code: 'PURPOSE_NOT_FOUND',
    });
    expect(
      evaluateAccessCheck({ purposeStatus: 'RETIRED', requiresConsent: true, consentStatus: null }),
    ).toEqual({ allowed: false, reason_code: 'PURPOSE_INACTIVE' });
  });

  it('allows when consent not required', () => {
    expect(
      evaluateAccessCheck({ purposeStatus: 'ACTIVE', requiresConsent: false, consentStatus: null }),
    ).toEqual({ allowed: true, reason_code: 'CONSENT_NOT_REQUIRED' });
  });

  it('requires active grant when consent required', () => {
    expect(
      evaluateAccessCheck({ purposeStatus: 'ACTIVE', requiresConsent: true, consentStatus: null }),
    ).toEqual({ allowed: false, reason_code: 'MISSING_CONSENT' });
    expect(
      evaluateAccessCheck({
        purposeStatus: 'ACTIVE',
        requiresConsent: true,
        consentStatus: 'WITHDRAWN',
      }),
    ).toEqual({ allowed: false, reason_code: 'CONSENT_WITHDRAWN' });
    expect(
      evaluateAccessCheck({ purposeStatus: 'ACTIVE', requiresConsent: true, consentStatus: 'GRANTED' }),
    ).toEqual({ allowed: true, reason_code: 'OK' });
  });
});

describe('fingerprint', () => {
  it('canonicalizes and fingerprints stably', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    const a = requestFingerprint('POST', '/v1/consents', { subject_id: 'x' });
    const b = requestFingerprint('POST', '/v1/consents', { subject_id: 'x' });
    expect(a).toBe(b);
    expect(a.startsWith('sha256:')).toBe(true);
  });
});
