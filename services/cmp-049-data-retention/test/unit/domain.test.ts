import { describe, expect, it } from 'vitest';
import {
  ELIGIBILITY_STATES,
  evaluateCandidates,
  evaluateTransition,
  transitionActions,
  type Eligibility,
} from '../../src/domain/eligibility.js';
import {
  looksLikeDuration,
  normalizePeriodRef,
  normalizeScope,
  normalizeTransitions,
  PolicyRejected,
  toContract,
  type RetentionPolicyRecord,
} from '../../src/domain/policy.js';
import { FULL_TRANSITIONS, OWNER_PERIOD_REF, TENANT_A } from '../doubles/fixtures.js';

const transitions = FULL_TRANSITIONS.map((t) => ({ ...t }));
const unbound = { eligibility_transitions: transitions, owner_supplied_period_ref: null };
const bound = { eligibility_transitions: transitions, owner_supplied_period_ref: OWNER_PERIOD_REF };

function rejection(fn: () => unknown): string {
  try {
    fn();
    return 'accepted';
  } catch (e) {
    return e instanceof PolicyRejected ? e.reason : 'other';
  }
}

describe('evaluateTransition (fail closed)', () => {
  it('refuses ARCHIVE_ELIGIBLE and DELETE_ELIGIBLE with POLICY_INPUT_REQUIRED while the owner period ref is null', () => {
    expect(evaluateTransition(unbound, 'ACTIVE', 'ARCHIVE_ELIGIBLE')).toEqual({
      allowed: false,
      reason: 'POLICY_INPUT_REQUIRED',
    });
    expect(evaluateTransition(unbound, 'ARCHIVE_ELIGIBLE', 'DELETE_ELIGIBLE')).toEqual({
      allowed: false,
      reason: 'POLICY_INPUT_REQUIRED',
    });
  });

  it('treats an empty-string period ref as missing', () => {
    const empty = { eligibility_transitions: transitions, owner_supplied_period_ref: '' };
    expect(evaluateTransition(empty, 'ACTIVE', 'ARCHIVE_ELIGIBLE')).toEqual({
      allowed: false,
      reason: 'POLICY_INPUT_REQUIRED',
    });
  });

  it('allows archive/delete eligibility only when the policy lists it AND the period ref is bound', () => {
    expect(evaluateTransition(bound, 'ACTIVE', 'ARCHIVE_ELIGIBLE')).toEqual({ allowed: true });
    expect(evaluateTransition(bound, 'ARCHIVE_ELIGIBLE', 'DELETE_ELIGIBLE')).toEqual({
      allowed: true,
    });
    expect(evaluateTransition(bound, 'ACTIVE', 'DELETE_ELIGIBLE')).toEqual({
      allowed: false,
      reason: 'TRANSITION_NOT_IN_POLICY',
    });
  });

  it('allows LEGAL_HOLD and returns to ACTIVE without a period ref when the policy lists them', () => {
    expect(evaluateTransition(unbound, 'ACTIVE', 'LEGAL_HOLD')).toEqual({ allowed: true });
    expect(evaluateTransition(unbound, 'LEGAL_HOLD', 'ACTIVE')).toEqual({ allowed: true });
  });

  it('refuses a transition that leaves LEGAL_HOLD for a period-gated target even when listed, unless bound', () => {
    const p = {
      eligibility_transitions: [
        { from_eligibility: 'LEGAL_HOLD', to_eligibility: 'DELETE_ELIGIBLE' },
      ],
      owner_supplied_period_ref: null,
    } as const;
    expect(
      evaluateTransition(
        { ...p, eligibility_transitions: [...p.eligibility_transitions] },
        'LEGAL_HOLD',
        'DELETE_ELIGIBLE',
      ),
    ).toEqual({
      allowed: false,
      reason: 'POLICY_INPUT_REQUIRED',
    });
  });

  it('refuses unlisted and same-state transitions', () => {
    expect(evaluateTransition(bound, 'DELETE_ELIGIBLE', 'ACTIVE').allowed).toBe(false);
    expect(evaluateTransition(bound, 'ACTIVE', 'ACTIVE')).toEqual({
      allowed: false,
      reason: 'SAME_STATE',
    });
  });

  it('exhaustively: no period-gated target is ever allowed without a period ref', () => {
    const all = ELIGIBILITY_STATES.flatMap((f) =>
      ELIGIBILITY_STATES.filter((t) => t !== f).map((t) => ({
        from_eligibility: f,
        to_eligibility: t,
      })),
    );
    const openPolicy = { eligibility_transitions: all, owner_supplied_period_ref: null };
    for (const from of ELIGIBILITY_STATES) {
      for (const to of ['ARCHIVE_ELIGIBLE', 'DELETE_ELIGIBLE'] as Eligibility[]) {
        if (from === to) continue;
        expect(evaluateTransition(openPolicy, from, to).allowed).toBe(false);
      }
    }
  });

  it('evaluateCandidates lists every other state with its blocking reason', () => {
    const out = evaluateCandidates(unbound, 'ACTIVE');
    expect(out.map((c) => c.to_eligibility)).toEqual([
      'ARCHIVE_ELIGIBLE',
      'DELETE_ELIGIBLE',
      'LEGAL_HOLD',
    ]);
    expect(out[0]).toEqual({
      to_eligibility: 'ARCHIVE_ELIGIBLE',
      allowed: false,
      blocking_reason: 'POLICY_INPUT_REQUIRED',
    });
    expect(out[1]?.blocking_reason).toBe('TRANSITION_NOT_IN_POLICY');
    expect(out[2]).toEqual({ to_eligibility: 'LEGAL_HOLD', allowed: true, blocking_reason: null });
  });

  it('leaving LEGAL_HOLD requires an extra explicit release action', () => {
    expect(transitionActions('ACTIVE', 'LEGAL_HOLD')).toEqual(['RETENTION_TRANSITION_LEGAL_HOLD']);
    expect(transitionActions('LEGAL_HOLD', 'ACTIVE')).toEqual([
      'RETENTION_TRANSITION_ACTIVE',
      'RETENTION_LEGAL_HOLD_RELEASE',
    ]);
  });
});

describe('owner period ref is a reference, never an invented period', () => {
  it.each([
    '30',
    '365d',
    '7 years',
    '10y',
    '90-days',
    '12months',
    'P7Y',
    'p30d',
    'PT24H',
    'P1Y6M',
    'P2W',
  ])('refuses duration-like value %s', (value) => {
    expect(looksLikeDuration(value)).toBe(true);
    expect(rejection(() => normalizePeriodRef(value, '/x'))).toMatch(
      /^PERIOD_REF_(LOOKS_LIKE_DURATION|INVALID)$/,
    );
  });

  it.each([OWNER_PERIOD_REF, 'gazette:2026/notice-17', 'P2026-REG-7', 'decision.register.0042'])(
    'accepts opaque reference %s',
    (value) => {
      expect(normalizePeriodRef(value, '/x')).toBe(value);
    },
  );

  it('accepts null/undefined as "no owner input yet" and refuses non-strings and oversize refs', () => {
    expect(normalizePeriodRef(null, '/x')).toBeNull();
    expect(normalizePeriodRef(undefined, '/x')).toBeNull();
    expect(rejection(() => normalizePeriodRef(30, '/x'))).toBe('PERIOD_REF_INVALID');
    expect(rejection(() => normalizePeriodRef(`r${'x'.repeat(128)}`, '/x'))).toBe(
      'PERIOD_REF_INVALID',
    );
    expect(rejection(() => normalizePeriodRef('has space', '/x'))).toBe('PERIOD_REF_INVALID');
  });
});

describe('policy shape normalisation', () => {
  it('scope requires a PascalCase/upper resource_type and refuses unknown keys', () => {
    expect(normalizeScope({ resource_type: 'APPLICATION' })).toEqual({
      resource_type: 'APPLICATION',
    });
    expect(rejection(() => normalizeScope({ resource_type: 'application' }))).toBe(
      'RESOURCE_TYPE_INVALID',
    );
    expect(
      rejection(() => normalizeScope({ resource_type: 'APPLICATION', retention_days: 1 })),
    ).toBe('UNKNOWN_FIELD');
    expect(rejection(() => normalizeScope(null))).toBe('SCOPE_REQUIRED');
  });

  it('transitions must be a non-empty, unique, non-self-loop list of known states', () => {
    expect(rejection(() => normalizeTransitions([]))).toBe('TRANSITIONS_REQUIRED');
    expect(
      rejection(() =>
        normalizeTransitions([{ from_eligibility: 'ACTIVE', to_eligibility: 'ACTIVE' }]),
      ),
    ).toBe('TRANSITION_SELF_LOOP');
    expect(
      rejection(() =>
        normalizeTransitions([
          { from_eligibility: 'ACTIVE', to_eligibility: 'LEGAL_HOLD' },
          { from_eligibility: 'ACTIVE', to_eligibility: 'LEGAL_HOLD' },
        ]),
      ),
    ).toBe('TRANSITION_DUPLICATE');
    expect(
      rejection(() =>
        normalizeTransitions([{ from_eligibility: 'ACTIVE', to_eligibility: 'PURGED' }]),
      ),
    ).toBe('ELIGIBILITY_INVALID');
    expect(
      rejection(() =>
        normalizeTransitions([
          { from_eligibility: 'ACTIVE', to_eligibility: 'LEGAL_HOLD', after_days: 30 },
        ]),
      ),
    ).toBe('UNKNOWN_FIELD');
  });

  it('toContract always emits the constant markers and never a period value', () => {
    const row: RetentionPolicyRecord = {
      tenant_id: TENANT_A,
      policy_id: '88888888-8888-4888-8888-888888888888',
      policy_version: 1,
      scope: { resource_type: 'APPLICATION' },
      owner_supplied_period_ref: null,
      eligibility_transitions: transitions,
      created_at: '2026-10-10T10:00:00.000Z',
      updated_at: '2026-10-10T10:00:00.000Z',
      created_by: '22222222-2222-4222-8222-222222222222',
      last_correlation_id: '77777777-7777-4777-8777-777777777777',
    };
    const c = toContract(row);
    expect(c.statutory_retention_policy_input_required).toBe(true);
    expect(c.invented_statutory_period_forbidden).toBe(true);
    expect(c.policy_neutral_shape).toBe(true);
    expect(c.owner_supplied_period_ref).toBeNull();
    expect(Object.keys(c).some((k) => /day|year|month|period_(days|value)|ttl/.test(k))).toBe(
      false,
    );
  });
});
