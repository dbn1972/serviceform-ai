import { describe, expect, it } from 'vitest';
import { parseAssignment } from '../../src/domain/assignment.js';
import { parseVerificationResult } from '../../src/domain/result.js';
import { parseSchedule } from '../../src/domain/scheduling.js';
import { assertSimulationPolicy } from '../../src/domain/simulation.js';
import { mismatches, scopeFromContext } from '../../src/domain/resolution.js';
import { ctxFor, INSPECT_ASSIGNMENT, OFFICER_1 } from '../doubles/fixtures.js';

describe('assignment and scheduling metadata', () => {
  it('accepts role/office/jurisdiction criteria and refuses named officers', () => {
    expect(parseAssignment(INSPECT_ASSIGNMENT).role_code).toBe('INSPECTION_OFFICER');
    expect(() => parseAssignment({ ...INSPECT_ASSIGNMENT, named_officer: 'x' })).toThrowError();
    expect(() => parseAssignment({ ...INSPECT_ASSIGNMENT, assignee: OFFICER_1 })).toThrowError();
  });

  it('accepts opaque slot/location refs and refuses calendar-product keys', () => {
    const s = parseSchedule({
      window_start: '2026-10-07T09:00:00.000Z',
      window_end: '2026-10-07T11:00:00.000Z',
      slot_ref: 'SLOT:A1',
      timezone_iana: 'Asia/Kolkata',
    });
    expect(s.slot_ref).toBe('SLOT:A1');
    expect(() => parseSchedule({ department_calendar: 'PWD' })).toThrowError();
    expect(() => parseSchedule({ cmp_056_slot: 'x' })).toThrowError();
  });

  it('verification result is never statutory approval', () => {
    expect(parseVerificationResult({ verification_result: 'VERIFIED' })).toBe('VERIFIED');
    expect(() => parseVerificationResult({ verification_result: 'APPROVED' })).toThrowError();
    expect(() => parseVerificationResult({ verification_result: 'REJECTED' })).toThrowError();
    expect(() => parseVerificationResult({ verification_result: 'ELIGIBLE' })).toThrowError();
    expect(() =>
      parseVerificationResult({ verification_result: 'RECORD_APPROVED' }),
    ).toThrowError();
  });

  it('assignment resolution uses server-derived scope', () => {
    const ctx = ctxFor(OFFICER_1);
    const miss = mismatches(parseAssignment(INSPECT_ASSIGNMENT), scopeFromContext(ctx));
    expect(miss).toEqual([]);
  });
});

describe('INT-013 DigiLocker SIMULATED fail-closed', () => {
  const binding = {
    critical: true,
    mode: 'SIMULATED' as const,
    environment: 'CI',
    connector_binding_id: '00000000-0000-4000-8000-000000000201',
  };
  it('allows SIMULATED in CI and refuses production-critical SIMULATED', () => {
    expect(() => assertSimulationPolicy([binding])).not.toThrow();
    expect(() => assertSimulationPolicy([{ ...binding, environment: 'PRODUCTION' }])).toThrowError(
      /External/,
    );
  });
});
