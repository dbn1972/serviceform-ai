import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  LAB_OTP_MAX_ATTEMPTS,
  LAB_OTP_RESEND_AFTER_SECONDS,
  LAB_OTP_TTL_SECONDS,
  normaliseMobile,
  validateLabRegistration,
  validateMobile,
  type LabOtpPurpose,
  type LabRegistrationField,
  type LabRegistrationInput,
} from './identity-rules';
import type { LabCitizenAccount, LabIdentityStoreFile, LabOtpChallenge } from './types';

/**
 * SAMPLE_LAB citizen identity — SIMULATED OTP adapter and synthetic account register.
 * Same lifecycle as CMP-004 (challenge → verify → session) but file-backed and never PRODUCTION.
 */

/** SIMULATED adapter code: fixed so the lab journey can be demonstrated without an SMS gateway. */
export const LAB_SIMULATED_OTP_CODE = '123456';

const CHALLENGE_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_IDENTITY_FILE = join('/tmp', 'sf-m10-citizen-identity-lab.json');

export function identityStorePath(): string {
  return process.env['SF_M10_IDENTITY_STORE_PATH'] ?? DEFAULT_IDENTITY_FILE;
}

export function readIdentityStore(): LabIdentityStoreFile {
  const empty: LabIdentityStoreFile = {
    version: 1,
    label: 'SAMPLE_LAB',
    citizen_accounts: [],
    otp_challenges: [],
  };
  const path = identityStorePath();
  if (!existsSync(/*turbopackIgnore: true*/ path)) return empty;
  try {
    const parsed = JSON.parse(
      readFileSync(/*turbopackIgnore: true*/ path, 'utf8'),
    ) as LabIdentityStoreFile;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.citizen_accounts) ||
      !Array.isArray(parsed.otp_challenges)
    ) {
      return empty;
    }
    return parsed;
  } catch {
    return empty;
  }
}

function writeIdentityStore(store: LabIdentityStoreFile): void {
  const path = identityStorePath();
  mkdirSync(/*turbopackIgnore: true*/ dirname(path), { recursive: true });
  writeFileSync(
    /*turbopackIgnore: true*/ path,
    JSON.stringify({ ...store, label: 'SAMPLE_LAB' }, null, 2),
    'utf8',
  );
}
const MAX_STORED_CHALLENGES = 500;

/** Pre-registered synthetic citizen so the golden journey works on an empty lab store. */
export const LAB_SEED_ACCOUNT: LabCitizenAccount = {
  citizen_id: '5a3b1ab0-0000-4000-8000-000000000001',
  display_name: 'SAMPLE LAB Citizen',
  mobile: '9876543210',
  preferred_language: 'en',
  consent: { purpose_code: 'CITIZEN_AUTH_AND_UPDATES', accepted_at: '2026-10-01T00:00:00.000Z' },
  created_at: '2026-10-01T00:00:00.000Z',
};

export type LabOtpRequestResult =
  | { ok: true; challenge: LabOtpChallenge; simulated_code: string }
  | { ok: false; reason: 'INVALID_MOBILE'; message: string };

export function requestLabOtp(
  input: { mobile: string; purpose: LabOtpPurpose },
  now: Date = new Date(),
): LabOtpRequestResult {
  const invalid = validateMobile(input.mobile);
  if (invalid) return { ok: false, reason: 'INVALID_MOBILE', message: invalid };
  const at = now.getTime();
  const challenge: LabOtpChallenge = {
    challenge_id: randomUUID(),
    mobile: normaliseMobile(input.mobile),
    purpose: input.purpose,
    status: 'PENDING',
    attempts: 0,
    max_attempts: LAB_OTP_MAX_ATTEMPTS,
    created_at: now.toISOString(),
    expires_at: new Date(at + LAB_OTP_TTL_SECONDS * 1000).toISOString(),
    resend_after: new Date(at + LAB_OTP_RESEND_AFTER_SECONDS * 1000).toISOString(),
    simulation: { simulation: true, scenario: 'otp_challenge', environment: 'SAMPLE_LAB' },
  };
  const store = readIdentityStore();
  const retained = store.otp_challenges.filter(
    (c) => at - Date.parse(c.created_at) < CHALLENGE_RETENTION_MS,
  );
  store.otp_challenges = [challenge, ...retained].slice(0, MAX_STORED_CHALLENGES);
  writeIdentityStore(store);
  return { ok: true, challenge, simulated_code: LAB_SIMULATED_OTP_CODE };
}

export type LabOtpFailureReason =
  'NOT_FOUND' | 'PURPOSE_MISMATCH' | 'ALREADY_USED' | 'EXPIRED' | 'LOCKED' | 'INVALID_CODE';

export type LabOtpVerifyResult =
  | { ok: true; challenge: LabOtpChallenge }
  | { ok: false; reason: LabOtpFailureReason; attempts_remaining: number };

export function verifyLabOtp(
  input: { challenge_id: string; code: string; purpose: LabOtpPurpose },
  now: Date = new Date(),
): LabOtpVerifyResult {
  const store = readIdentityStore();
  const challenge = store.otp_challenges.find((c) => c.challenge_id === input.challenge_id);
  if (!challenge) return { ok: false, reason: 'NOT_FOUND', attempts_remaining: 0 };
  const remaining = () => Math.max(0, challenge.max_attempts - challenge.attempts);
  if (challenge.purpose !== input.purpose) {
    return { ok: false, reason: 'PURPOSE_MISMATCH', attempts_remaining: remaining() };
  }
  if (challenge.status === 'VERIFIED') {
    return { ok: false, reason: 'ALREADY_USED', attempts_remaining: 0 };
  }
  if (challenge.status === 'LOCKED') return { ok: false, reason: 'LOCKED', attempts_remaining: 0 };
  if (challenge.status !== 'PENDING' || Date.parse(challenge.expires_at) <= now.getTime()) {
    challenge.status = 'EXPIRED';
    writeIdentityStore(store);
    return { ok: false, reason: 'EXPIRED', attempts_remaining: 0 };
  }
  challenge.attempts += 1;
  if (input.code !== LAB_SIMULATED_OTP_CODE) {
    const locked = challenge.attempts >= challenge.max_attempts;
    if (locked) challenge.status = 'LOCKED';
    writeIdentityStore(store);
    return {
      ok: false,
      reason: locked ? 'LOCKED' : 'INVALID_CODE',
      attempts_remaining: remaining(),
    };
  }
  challenge.status = 'VERIFIED';
  writeIdentityStore(store);
  return { ok: true, challenge };
}

export function findLabAccount(mobile: string): LabCitizenAccount | undefined {
  const normalised = normaliseMobile(mobile);
  const stored = readIdentityStore().citizen_accounts.find((a) => a.mobile === normalised);
  if (stored) return stored;
  return normalised === LAB_SEED_ACCOUNT.mobile ? LAB_SEED_ACCOUNT : undefined;
}

export type LabRegistrationResult =
  | { ok: true; account: LabCitizenAccount }
  | { ok: false; reason: 'INVALID'; field_errors: Partial<Record<LabRegistrationField, string>> }
  | { ok: false; reason: 'EXISTS' };

export function registerLabAccount(
  input: LabRegistrationInput,
  now: Date = new Date(),
): LabRegistrationResult {
  const field_errors = validateLabRegistration(input);
  if (Object.keys(field_errors).length > 0) return { ok: false, reason: 'INVALID', field_errors };
  if (findLabAccount(input.mobile)) return { ok: false, reason: 'EXISTS' };
  const email = input.email?.trim();
  const account: LabCitizenAccount = {
    citizen_id: randomUUID(),
    display_name: input.display_name.trim(),
    mobile: normaliseMobile(input.mobile),
    ...(email ? { email } : {}),
    preferred_language: input.preferred_language,
    consent: { purpose_code: 'CITIZEN_AUTH_AND_UPDATES', accepted_at: now.toISOString() },
    created_at: now.toISOString(),
  };
  const store = readIdentityStore();
  store.citizen_accounts = [account, ...store.citizen_accounts];
  writeIdentityStore(store);
  return { ok: true, account };
}
