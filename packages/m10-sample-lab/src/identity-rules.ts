/**
 * SAMPLE_LAB citizen identity rules shared by the citizen UI and lab route handlers.
 * Pure functions only (no node:fs) so client components can import this subpath.
 * Mirrors CMP-004 citizen OTP semantics (5 min TTL, 5 attempts) with a SIMULATED code.
 */

export const LAB_OTP_LENGTH = 6;
export const LAB_OTP_TTL_SECONDS = 300;
export const LAB_OTP_RESEND_AFTER_SECONDS = 30;
export const LAB_OTP_MAX_ATTEMPTS = 5;
export const LAB_SESSION_TTL_SECONDS = 8 * 60 * 60;

export type LabOtpPurpose = 'SIGN_IN' | 'REGISTER';
export type LabPreferredLanguage = 'en' | 'hi';

export const LAB_LANGUAGES: readonly { value: LabPreferredLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी' },
];

const SYNTHETIC_NAME = /^(SAMPLE\b|Lab\s)/i;
const SYNTHETIC_MOBILE = /^9\d{9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normaliseMobile(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

export function validateMobile(raw: string): string | null {
  const mobile = normaliseMobile(raw);
  if (!mobile) return 'Enter your mobile number';
  if (!/^\d{10}$/.test(mobile)) return 'Enter a 10-digit mobile number';
  if (!SYNTHETIC_MOBILE.test(mobile)) {
    return 'Use a synthetic mobile number that starts with 9 in this sample environment';
  }
  return null;
}

export function validateDisplayName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'Enter your full name';
  if (name.length < 3) return 'Full name must be at least 3 characters';
  if (name.length > 80) return 'Full name must be 80 characters or fewer';
  if (!SYNTHETIC_NAME.test(name)) {
    return 'Use a synthetic name that starts with “SAMPLE” or “Lab” in this sample environment';
  }
  return null;
}

export function validateEmail(raw: string): string | null {
  const email = raw.trim();
  if (!email) return null;
  if (email.length > 254 || !EMAIL.test(email)) {
    return 'Enter an email address in the correct format, like name@example.com';
  }
  return null;
}

export function validateOtpCode(raw: string): string | null {
  const code = raw.replace(/\s/g, '');
  if (!code) return `Enter the ${LAB_OTP_LENGTH}-digit OTP`;
  if (!new RegExp(`^\\d{${LAB_OTP_LENGTH}}$`).test(code)) {
    return `Enter all ${LAB_OTP_LENGTH} digits of the OTP`;
  }
  return null;
}

export type LabRegistrationInput = {
  display_name: string;
  mobile: string;
  email?: string;
  preferred_language: LabPreferredLanguage;
  consent: boolean;
};

export type LabRegistrationField = 'display_name' | 'mobile' | 'email' | 'consent';

export function validateLabRegistration(
  input: LabRegistrationInput,
): Partial<Record<LabRegistrationField, string>> {
  const errors: Partial<Record<LabRegistrationField, string>> = {};
  const name = validateDisplayName(input.display_name);
  if (name) errors.display_name = name;
  const mobile = validateMobile(input.mobile);
  if (mobile) errors.mobile = mobile;
  const email = validateEmail(input.email ?? '');
  if (email) errors.email = email;
  if (!input.consent) errors.consent = 'Confirm that you agree to the terms to create an account';
  return errors;
}

export function isLabLanguage(value: unknown): value is LabPreferredLanguage {
  return value === 'en' || value === 'hi';
}

/** `98765 43210` → `+91 98765 •••10` — enough for a citizen to recognise their number. */
export function maskMobile(raw: string): string {
  const mobile = normaliseMobile(raw);
  if (mobile.length !== 10) return mobile;
  return `+91 ${mobile.slice(0, 5)} •••${mobile.slice(8)}`;
}
