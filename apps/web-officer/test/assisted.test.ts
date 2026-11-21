import { describe, expect, it } from 'vitest';
import {
  consentGate,
  representationGate,
  toAssistedSessionView,
  channelRequiresAuthority,
} from '../lib/portal/assisted';

const OFFICER = '33333333-3333-4333-8333-333333333333';
const CITIZEN = '44444444-4444-4444-8444-444444444444';

describe('officer assisted apply shell helpers', () => {
  it('projects session proof with apply gates and no impersonation', () => {
    const view = toAssistedSessionView({
      assisted_session: {
        session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        channel: 'CSC',
        applied_by_actor_id: OFFICER,
        applied_for_citizen_id: CITIZEN,
        applied_by_distinct_from_applied_for: true,
        lifecycle_status: 'REPRESENTATION_VERIFIED',
      },
      session_version: 3,
      proof: { consent_ref: 'consent:assisted-readback/ref-1', read_back_acknowledged: true },
    });
    expect(view?.can_apply).toBe(true);
    expect(view?.impersonation).toBe(false);
    expect(view?.applied_by_distinct_from_applied_for).toBe(true);
    expect(view?.consent_ref).toBe('consent:assisted-readback/ref-1');
  });

  it('fail-closes consent without read-back or when applied_by equals applied_for', () => {
    expect(
      consentGate({
        read_back_acknowledged: false,
        consent_ref: 'consent:assisted-readback/ref-1',
        applied_by_actor_id: OFFICER,
        applied_for_citizen_id: CITIZEN,
      }).ok,
    ).toBe(false);
    expect(
      consentGate({
        read_back_acknowledged: true,
        consent_ref: 'consent:assisted-readback/ref-1',
        applied_by_actor_id: CITIZEN,
        applied_for_citizen_id: CITIZEN,
      }),
    ).toMatchObject({ ok: false, code: 'APPLIED_BY_EQUALS_APPLIED_FOR' });
    expect(
      consentGate({
        read_back_acknowledged: true,
        consent_ref: 'consent:assisted-readback/ref-1',
        applied_by_actor_id: OFFICER,
        applied_for_citizen_id: CITIZEN,
      }).ok,
    ).toBe(true);
  });

  it('requires opaque authority only on representation channels', () => {
    expect(channelRequiresAuthority('CSC')).toBe(false);
    expect(channelRequiresAuthority('GUARDIAN')).toBe(true);
    expect(
      representationGate({ channel: 'CSC', representation_authority_ref: null }).ok,
    ).toBe(true);
    expect(
      representationGate({ channel: 'GUARDIAN', representation_authority_ref: null }),
    ).toMatchObject({ ok: false, code: 'REPRESENTATION_AUTHORITY_REF_REQUIRED' });
    expect(
      representationGate({
        channel: 'GUARDIAN',
        representation_authority_ref: 'authority:lab/guardian-ref-1',
      }).ok,
    ).toBe(true);
  });
});
