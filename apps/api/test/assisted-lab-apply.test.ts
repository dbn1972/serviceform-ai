import { describe, expect, it } from 'vitest';

/**
 * Pure guards mirroring lab apply route Constitution #36 checks.
 * Full Fastify mount is exercised in platform lab when DATABASE_URL_CMP057 is set.
 */

function mayAssistedApply(input: {
  lifecycle_status: string;
  applied_by_actor_id: string;
  applied_for_citizen_id: string;
  operator_id: string;
}): { ok: true } | { ok: false; code: string } {
  if (input.lifecycle_status !== 'REPRESENTATION_VERIFIED') {
    return { ok: false, code: 'CONSENT_OR_REPRESENTATION_REQUIRED' };
  }
  if (input.applied_by_actor_id.toLowerCase() !== input.operator_id.toLowerCase()) {
    return { ok: false, code: 'OPERATOR_NOT_SESSION_OWNER' };
  }
  if (input.applied_by_actor_id.toLowerCase() === input.applied_for_citizen_id.toLowerCase()) {
    return { ok: false, code: 'APPLIED_BY_EQUALS_APPLIED_FOR' };
  }
  return { ok: true };
}

describe('lab assisted apply gate', () => {
  const OFFICER = '33333333-3333-4333-8333-333333333333';
  const CITIZEN = '44444444-4444-4444-8444-444444444444';

  it('allows apply only after representation/consent verification', () => {
    expect(
      mayAssistedApply({
        lifecycle_status: 'APPLICANT_BOUND',
        applied_by_actor_id: OFFICER,
        applied_for_citizen_id: CITIZEN,
        operator_id: OFFICER,
      }),
    ).toMatchObject({ ok: false, code: 'CONSENT_OR_REPRESENTATION_REQUIRED' });
    expect(
      mayAssistedApply({
        lifecycle_status: 'REPRESENTATION_VERIFIED',
        applied_by_actor_id: OFFICER,
        applied_for_citizen_id: CITIZEN,
        operator_id: OFFICER,
      }).ok,
    ).toBe(true);
  });

  it('refuses self-assisted / impersonation shapes', () => {
    expect(
      mayAssistedApply({
        lifecycle_status: 'REPRESENTATION_VERIFIED',
        applied_by_actor_id: CITIZEN,
        applied_for_citizen_id: CITIZEN,
        operator_id: CITIZEN,
      }),
    ).toMatchObject({ ok: false, code: 'APPLIED_BY_EQUALS_APPLIED_FOR' });
  });
});
