import { describe, expect, it } from 'vitest';
import {
  isLabLanguage,
  maskMobile,
  normaliseMobile,
  validateDisplayName,
  validateEmail,
  validateMobile,
  validateOtpCode,
} from '../src/identity-rules';

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
