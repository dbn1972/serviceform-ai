import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LAB_OTP_MAX_ATTEMPTS,
  LAB_OTP_RESEND_AFTER_SECONDS,
  LAB_OTP_TTL_SECONDS,
  LAB_SEED_ACCOUNT,
  LAB_SIMULATED_OTP_CODE,
  findLabAccount,
  identityStorePath,
  isLabLanguage,
  labStorePath,
  maskMobile,
  normaliseMobile,
  readIdentityStore,
  registerLabAccount,
  requestLabOtp,
  validateDisplayName,
  validateEmail,
  validateLabRegistration,
  validateMobile,
  validateOtpCode,
  verifyLabOtp,
} from '../src/index';

const NOW = new Date('2026-10-21T06:00:00.000Z');
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

beforeEach(() => {
  process.env['SF_M10_IDENTITY_STORE_PATH'] = join(
    tmpdir(),
    `sf-m10-identity-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
  );
});

afterEach(() => {
  const path = identityStorePath();
  if (existsSync(path)) unlinkSync(path);
  delete process.env['SF_M10_IDENTITY_STORE_PATH'];
});

function challenge(mobile = '9876543210', purpose: 'SIGN_IN' | 'REGISTER' = 'SIGN_IN') {
  const res = requestLabOtp({ mobile, purpose }, NOW);
  if (!res.ok) throw new Error(res.message);
  return res.challenge;
}

describe('SAMPLE_LAB identity rules (client + server shared)', () => {
  it('accepts only synthetic 10-digit mobiles starting with 9 and strips +91', () => {
    expect(validateMobile('')).toMatch(/Enter your mobile number/);
    expect(validateMobile('98765')).toMatch(/10-digit/);
    expect(validateMobile('8123456789')).toMatch(/synthetic/);
    expect(validateMobile('+91 98765 43210')).toBeNull();
    expect(normaliseMobile('+91 98765-43210')).toBe('9876543210');
  });

  it('requires a synthetic display name so real PII is not entered', () => {
    expect(validateDisplayName('  ')).toMatch(/Enter your full name/);
    expect(validateDisplayName('Ab')).toMatch(/at least 3/);
    expect(validateDisplayName('x'.repeat(81))).toMatch(/80 characters/);
    expect(validateDisplayName('Ravi Kumar')).toMatch(/synthetic/);
    expect(validateDisplayName('SAMPLE Asha Devi')).toBeNull();
    expect(validateDisplayName('Lab Citizen One')).toBeNull();
  });

  it('treats email as optional but validates its format', () => {
    expect(validateEmail('')).toBeNull();
    expect(validateEmail('not-an-email')).toMatch(/correct format/);
    expect(validateEmail('sample.citizen@example.org')).toBeNull();
  });

  it('validates OTP shape and masks mobile numbers for display', () => {
    expect(validateOtpCode('')).toMatch(/Enter the 6-digit OTP/);
    expect(validateOtpCode('12 4')).toMatch(/all 6 digits/);
    expect(validateOtpCode('123456')).toBeNull();
    expect(maskMobile('9876543210')).toBe('+91 98765 •••10');
    expect(maskMobile('123')).toBe('123');
    expect(isLabLanguage('hi')).toBe(true);
    expect(isLabLanguage('fr')).toBe(false);
  });
});

describe('SAMPLE_LAB OTP challenge (mirrors CMP-004 TTL/attempt semantics)', () => {
  it('issues a SIMULATED challenge with 5 min TTL and 30 s resend hint', () => {
    const res = requestLabOtp({ mobile: '+91 9876543210', purpose: 'SIGN_IN' }, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.simulated_code).toBe(LAB_SIMULATED_OTP_CODE);
    expect(res.challenge.mobile).toBe('9876543210');
    expect(res.challenge.status).toBe('PENDING');
    expect(res.challenge.simulation).toEqual({
      simulation: true,
      scenario: 'otp_challenge',
      environment: 'SAMPLE_LAB',
    });
    expect(Date.parse(res.challenge.expires_at) - NOW.getTime()).toBe(LAB_OTP_TTL_SECONDS * 1000);
    expect(Date.parse(res.challenge.resend_after) - NOW.getTime()).toBe(
      LAB_OTP_RESEND_AFTER_SECONDS * 1000,
    );
    expect(readIdentityStore().otp_challenges).toHaveLength(1);
  });

  it('refuses non-synthetic mobiles without creating a challenge', () => {
    const res = requestLabOtp({ mobile: '7012345678', purpose: 'SIGN_IN' }, NOW);
    expect(res).toMatchObject({ ok: false, reason: 'INVALID_MOBILE' });
    expect(readIdentityStore().otp_challenges).toHaveLength(0);
  });

  it('keeps parallel challenges independently verifiable and prunes ones older than a day', () => {
    const old = requestLabOtp({ mobile: '9876543210', purpose: 'SIGN_IN' }, later(-90_000));
    const a = challenge();
    const b = challenge();
    const ids = readIdentityStore().otp_challenges.map((c) => c.challenge_id);
    expect(old.ok && ids.includes(old.challenge.challenge_id)).toBe(false);
    expect(ids).toEqual([b.challenge_id, a.challenge_id]);
    const input = { code: LAB_SIMULATED_OTP_CODE, purpose: 'SIGN_IN' as const };
    expect(verifyLabOtp({ ...input, challenge_id: a.challenge_id }, later(5)).ok).toBe(true);
    expect(verifyLabOtp({ ...input, challenge_id: b.challenge_id }, later(5)).ok).toBe(true);
  });

  it('verifies the SIMULATED code once and refuses reuse', () => {
    const c = challenge();
    const input = {
      challenge_id: c.challenge_id,
      code: LAB_SIMULATED_OTP_CODE,
      purpose: 'SIGN_IN' as const,
    };
    const ok = verifyLabOtp(input, later(10));
    expect(ok.ok).toBe(true);
    expect(verifyLabOtp(input, later(11))).toEqual({
      ok: false,
      reason: 'ALREADY_USED',
      attempts_remaining: 0,
    });
  });

  it('counts wrong codes and locks after max attempts (failure path)', () => {
    const c = challenge();
    const wrong = { challenge_id: c.challenge_id, code: '000000', purpose: 'SIGN_IN' as const };
    for (let i = 1; i < LAB_OTP_MAX_ATTEMPTS; i += 1) {
      expect(verifyLabOtp(wrong, later(i))).toEqual({
        ok: false,
        reason: 'INVALID_CODE',
        attempts_remaining: LAB_OTP_MAX_ATTEMPTS - i,
      });
    }
    expect(verifyLabOtp(wrong, later(9))).toEqual({
      ok: false,
      reason: 'LOCKED',
      attempts_remaining: 0,
    });
    const right = { ...wrong, code: LAB_SIMULATED_OTP_CODE };
    expect(verifyLabOtp(right, later(10))).toMatchObject({ ok: false, reason: 'LOCKED' });
  });

  it('expires challenges after the TTL even with the right code', () => {
    const c = challenge();
    const input = {
      challenge_id: c.challenge_id,
      code: LAB_SIMULATED_OTP_CODE,
      purpose: 'SIGN_IN' as const,
    };
    expect(verifyLabOtp(input, later(LAB_OTP_TTL_SECONDS))).toMatchObject({
      ok: false,
      reason: 'EXPIRED',
    });
    expect(readIdentityStore().otp_challenges?.[0]?.status).toBe('EXPIRED');
    expect(verifyLabOtp(input, later(LAB_OTP_TTL_SECONDS + 1))).toMatchObject({
      reason: 'EXPIRED',
    });
  });

  it('rejects unknown challenges and cross-purpose reuse without consuming an attempt', () => {
    expect(
      verifyLabOtp({ challenge_id: 'missing', code: '123456', purpose: 'SIGN_IN' }, NOW),
    ).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
    const c = challenge('9876543210', 'REGISTER');
    const res = verifyLabOtp(
      { challenge_id: c.challenge_id, code: LAB_SIMULATED_OTP_CODE, purpose: 'SIGN_IN' },
      later(1),
    );
    expect(res).toEqual({
      ok: false,
      reason: 'PURPOSE_MISMATCH',
      attempts_remaining: LAB_OTP_MAX_ATTEMPTS,
    });
  });
});

describe('SAMPLE_LAB identity store isolation', () => {
  it('keeps identity state out of the applications store that golden E2E resets', () => {
    challenge();
    expect(identityStorePath()).not.toBe(labStorePath());
    expect(existsSync(labStorePath()) && labStorePath() === identityStorePath()).toBe(false);
  });

  it('falls back to an empty store when the file is corrupt or from another version', () => {
    writeFileSync(identityStorePath(), '{not json', 'utf8');
    expect(readIdentityStore().otp_challenges).toEqual([]);
    writeFileSync(identityStorePath(), JSON.stringify({ version: 2 }), 'utf8');
    expect(readIdentityStore().citizen_accounts).toEqual([]);
    expect(findLabAccount(LAB_SEED_ACCOUNT.mobile)).toEqual(LAB_SEED_ACCOUNT);
  });
});

describe('SAMPLE_LAB citizen accounts', () => {
  const valid = {
    display_name: 'SAMPLE Asha Devi',
    mobile: '9123456780',
    email: 'asha.sample@example.org',
    preferred_language: 'hi' as const,
    consent: true,
  };

  it('always resolves the seeded synthetic citizen on an empty store', () => {
    expect(findLabAccount('+91 98765 43210')).toEqual(LAB_SEED_ACCOUNT);
    expect(findLabAccount('9000000000')).toBeUndefined();
  });

  it('registers a synthetic account with recorded consent purpose', () => {
    const res = registerLabAccount(valid, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.account).toMatchObject({
      display_name: 'SAMPLE Asha Devi',
      mobile: '9123456780',
      email: 'asha.sample@example.org',
      preferred_language: 'hi',
      consent: { purpose_code: 'CITIZEN_AUTH_AND_UPDATES', accepted_at: NOW.toISOString() },
    });
    expect(findLabAccount('9123456780')?.citizen_id).toBe(res.account.citizen_id);
  });

  it('omits a blank optional email', () => {
    const res = registerLabAccount({ ...valid, email: '  ' }, NOW);
    expect(res.ok && 'email' in res.account).toBe(false);
  });

  it('refuses duplicates, including the seeded mobile', () => {
    expect(registerLabAccount(valid, NOW).ok).toBe(true);
    expect(registerLabAccount(valid, NOW)).toEqual({ ok: false, reason: 'EXISTS' });
    expect(registerLabAccount({ ...valid, mobile: LAB_SEED_ACCOUNT.mobile }, NOW)).toEqual({
      ok: false,
      reason: 'EXISTS',
    });
  });

  it('returns field-level errors for invalid input (failure path)', () => {
    const errors = validateLabRegistration({
      display_name: 'Real Person',
      mobile: '123',
      email: 'bad',
      preferred_language: 'en',
      consent: false,
    });
    expect(Object.keys(errors).sort()).toEqual(['consent', 'display_name', 'email', 'mobile']);
    expect(registerLabAccount({ ...valid, consent: false }, NOW)).toMatchObject({
      ok: false,
      reason: 'INVALID',
      field_errors: { consent: expect.stringMatching(/agree/) },
    });
  });
});
