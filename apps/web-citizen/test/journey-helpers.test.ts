import { describe, expect, it } from 'vitest';
import { formatCountdown, initials, safeNext, secondsUntil } from '../lib/auth-client';
import { applicationStatus, evidenceLabel, formatDate, GENDER_LABEL } from '../lib/ind-soc-002';

// REQ: INT-001 citizen auth → journey; open-redirect guard; citizen-facing status wording.
describe('safeNext (post sign-in destination)', () => {
  it('keeps same-origin absolute paths', () => {
    expect(safeNext('/certificates')).toBe('/certificates');
    expect(safeNext('/services/IND-SOC-002/apply')).toBe('/services/IND-SOC-002/apply');
  });

  it('rejects off-site and malformed targets (open-redirect guard)', () => {
    expect(safeNext('//evil.example/phish')).toBe('/services');
    expect(safeNext('https://evil.example')).toBe('/services');
    expect(safeNext('/\\evil.example')).toBe('/services');
    expect(safeNext(undefined, '/x')).toBe('/x');
  });
});

describe('OTP countdown helpers', () => {
  it('rounds up remaining seconds and never goes negative', () => {
    const now = Date.parse('2026-10-21T06:00:00.000Z');
    expect(secondsUntil('2026-10-21T06:00:29.200Z', now)).toBe(30);
    expect(secondsUntil('2026-10-21T05:59:00.000Z', now)).toBe(0);
    expect(formatCountdown(300)).toBe('5:00');
    expect(formatCountdown(9)).toBe('0:09');
  });
});

describe('account initials', () => {
  it('ignores the synthetic SAMPLE/Lab prefix', () => {
    expect(initials('SAMPLE Asha Devi')).toBe('AD');
    expect(initials('Lab Citizen One Two')).toBe('CO');
    expect(initials('SAMPLE')).toBe('S');
  });
});

describe('application status wording', () => {
  const dl = (status: string) => ({ status });
  it('maps lab states to citizen-facing labels and tones', () => {
    expect(applicationStatus({ status: 'SUBMITTED', digilocker: dl('NOT_REQUESTED') })).toEqual({
      label: 'Submitted · under review',
      tone: 'info',
    });
    expect(applicationStatus({ status: 'APPROVED', digilocker: dl('NOT_REQUESTED') }).tone).toBe(
      'info',
    );
    expect(applicationStatus({ status: 'ISSUED', digilocker: dl('NOT_REQUESTED') }).label).toBe(
      'Certificate issued',
    );
    expect(applicationStatus({ status: 'ISSUED', digilocker: dl('PUBLISHED') }).label).toBe(
      'In your DigiLocker (SIMULATED)',
    );
    expect(applicationStatus({ status: 'REJECTED', digilocker: dl('NOT_REQUESTED') }).tone).toBe(
      'error',
    );
    expect(applicationStatus({ status: 'DRAFT', digilocker: dl('NOT_REQUESTED') }).tone).toBe(
      'neutral',
    );
  });

  it('never reuses the golden-journey alert phrase as a status label', () => {
    for (const status of ['SUBMITTED', 'APPROVED', 'ISSUED', 'REJECTED', 'DRAFT']) {
      expect(applicationStatus({ status, digilocker: dl('NOT_REQUESTED') }).label).not.toMatch(
        /Awaiting officer decision/i,
      );
    }
  });

  it('formats labels for evidence, gender and dates', () => {
    expect(evidenceLabel('RATION_CARD')).toBe('Ration card');
    expect(evidenceLabel('UNKNOWN')).toBe('UNKNOWN');
    expect(GENDER_LABEL['PREFER_NOT_TO_SAY']).toBe('Prefer not to say');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('2026-10-21T06:00:00.000Z')).toMatch(/21 Oct 2026/);
  });
});
