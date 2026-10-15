import { describe, expect, it } from 'vitest';
import {
  hashHandoffToken,
  issueHandoffToken,
  handoffTokenMatches,
} from '../../src/domain/handoff.js';
import {
  CHANNELS,
  COMMAND_SOURCES,
  evaluateCommand,
  LIFECYCLE_STATUSES,
  requiresRepresentation,
  starterActors,
  toContract,
  type SessionAggregate,
} from '../../src/domain/session.js';

describe('channel / representation metadata (no statute)', () => {
  it('pins the frozen channel and lifecycle enums', () => {
    expect([...CHANNELS]).toEqual([
      'COUNTER',
      'CSC',
      'KIOSK',
      'CALL_CENTRE',
      'AUTHORIZED_REPRESENTATIVE',
      'GUARDIAN',
      'INSTITUTIONAL',
    ]);
    expect([...LIFECYCLE_STATUSES]).toEqual([
      'STARTED',
      'APPLICANT_BOUND',
      'REPRESENTATION_VERIFIED',
      'SUBMITTED',
      'HANDED_OFF',
      'CLOSED',
    ]);
  });

  it('marks only representation channels as requiring an opaque authority ref', () => {
    expect(requiresRepresentation('COUNTER')).toBe(false);
    expect(requiresRepresentation('AUTHORIZED_REPRESENTATIVE')).toBe(true);
    expect(starterActors('COUNTER')).toEqual(['OFFICER']);
    expect(starterActors('GUARDIAN')).toEqual(['CITIZEN', 'OFFICER']);
  });
});

describe('evaluateCommand (INT-015 lifecycle)', () => {
  it('allows the documented transitions and refuses terminal/illegal ones', () => {
    expect(evaluateCommand('BIND_APPLICANT', 'STARTED')).toEqual({
      allowed: true,
      to: 'APPLICANT_BOUND',
    });
    expect(evaluateCommand('VERIFY_REPRESENTATION', 'APPLICANT_BOUND')).toEqual({
      allowed: true,
      to: 'REPRESENTATION_VERIFIED',
    });
    expect(evaluateCommand('SUBMIT', 'REPRESENTATION_VERIFIED')).toEqual({
      allowed: true,
      to: 'SUBMITTED',
    });
    expect(evaluateCommand('HANDOFF', 'REPRESENTATION_VERIFIED')).toEqual({
      allowed: true,
      to: 'HANDED_OFF',
    });
    expect(evaluateCommand('RESUME', 'HANDED_OFF')).toEqual({ allowed: true, to: 'CLOSED' });
    expect(evaluateCommand('CLOSE', 'STARTED').allowed).toBe(true);
    expect(evaluateCommand('BIND_APPLICANT', 'CLOSED')).toEqual({
      allowed: false,
      reason: 'TERMINAL_STATUS',
    });
    expect(evaluateCommand('SUBMIT', 'STARTED')).toEqual({
      allowed: false,
      reason: 'TRANSITION_NOT_ALLOWED',
    });
  });

  it('submit and handoff only leave REPRESENTATION_VERIFIED (consent/representation gate)', () => {
    expect([...COMMAND_SOURCES.SUBMIT]).toEqual(['REPRESENTATION_VERIFIED']);
    expect([...COMMAND_SOURCES.HANDOFF]).toEqual(['REPRESENTATION_VERIFIED']);
  });
});

describe('toContract (SF-CON-ASSISTED-SESSION)', () => {
  const base: SessionAggregate = {
    session: {
      tenant_id: '11111111-1111-4111-8111-111111111111',
      session_id: '22222222-2222-4222-8222-222222222222',
      channel: 'COUNTER',
      applied_by_actor_id: '33333333-3333-4333-8333-333333333333',
      applied_by_actor_type: 'OFFICER',
      applied_for_citizen_id: '44444444-4444-4444-8444-444444444444',
      organisation_id: null,
      office_id: null,
      lifecycle_status: 'STARTED',
      session_version: 1,
      idempotency_key: 'idem-assisted-0001',
      applicant_assurance_ref: null,
      application_id: null,
      handoff_token_hash: null,
      handoff_expires_at: null,
      closure_reason: null,
      started_at: '2026-10-15T12:00:00.000Z',
      updated_at: '2026-10-15T12:00:00.000Z',
      last_correlation_id: '55555555-5555-4555-8555-555555555555',
    },
  };

  it('projects the frozen constants including applied_by_distinct_from_applied_for', () => {
    const doc = toContract(base);
    expect(doc.contract_id).toBe('SF-CON-ASSISTED-SESSION');
    expect(doc.contract_status).toBe('FROZEN');
    expect(doc.freeze_status).toBe('FROZEN');
    expect(doc.invented_statutory_policy_forbidden).toBe(true);
    expect(doc.applied_by_distinct_from_applied_for).toBe(true);
  });

  it('refuses to emit a self-assisted document', () => {
    const bad = structuredClone(base);
    bad.session.applied_for_citizen_id = bad.session.applied_by_actor_id;
    expect(() => toContract(bad)).toThrow(/distinct/i);
  });
});

describe('handoff token', () => {
  it('issues a one-time token, stores only the hash, and verifies with timing-safe compare', () => {
    const { token, hash } = issueHandoffToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashHandoffToken(token));
    expect(handoffTokenMatches(token, hash)).toBe(true);
    expect(handoffTokenMatches(token, 'sha256:' + '0'.repeat(64))).toBe(false);
    expect(handoffTokenMatches(token, null)).toBe(false);
  });
});
