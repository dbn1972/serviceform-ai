/**
 * Eligibility machinery only. CMP-049 never computes a retention period, a due date or an erasure
 * timeline: those are owner-supplied statutory inputs (STATUTORY_RETENTION_POLICY_INPUT_REQUIRED).
 * A transition is permitted only when the tenant's published policy lists it AND, for archive or
 * delete eligibility, the policy carries an owner-supplied period reference. Everything else is
 * refused (fail closed). Nothing here archives or deletes data; owners act on the emitted events.
 */
export const ELIGIBILITY_STATES = [
  'ACTIVE',
  'ARCHIVE_ELIGIBLE',
  'DELETE_ELIGIBLE',
  'LEGAL_HOLD',
] as const;
export type Eligibility = (typeof ELIGIBILITY_STATES)[number];

/** Targets that are meaningless without an owner-approved period and therefore fail closed. */
export const PERIOD_GATED_TARGETS: ReadonlySet<Eligibility> = new Set([
  'ARCHIVE_ELIGIBLE',
  'DELETE_ELIGIBLE',
]);

export interface EligibilityTransition {
  from_eligibility: Eligibility;
  to_eligibility: Eligibility;
}

export type BlockingReason = 'SAME_STATE' | 'TRANSITION_NOT_IN_POLICY' | 'POLICY_INPUT_REQUIRED';

export type TransitionVerdict = { allowed: true } | { allowed: false; reason: BlockingReason };

export interface PolicyTransitionView {
  eligibility_transitions: readonly EligibilityTransition[];
  owner_supplied_period_ref: string | null;
}

export function isEligibility(value: unknown): value is Eligibility {
  return typeof value === 'string' && (ELIGIBILITY_STATES as readonly string[]).includes(value);
}

export function hasOwnerPeriodRef(ref: string | null | undefined): ref is string {
  return typeof ref === 'string' && ref.length > 0;
}

export function evaluateTransition(
  policy: PolicyTransitionView,
  from: Eligibility,
  to: Eligibility,
): TransitionVerdict {
  if (from === to) return { allowed: false, reason: 'SAME_STATE' };
  const listed = policy.eligibility_transitions.some(
    (t) => t.from_eligibility === from && t.to_eligibility === to,
  );
  if (!listed) return { allowed: false, reason: 'TRANSITION_NOT_IN_POLICY' };
  if (PERIOD_GATED_TARGETS.has(to) && !hasOwnerPeriodRef(policy.owner_supplied_period_ref)) {
    return { allowed: false, reason: 'POLICY_INPUT_REQUIRED' };
  }
  return { allowed: true };
}

export interface CandidateEvaluation {
  to_eligibility: Eligibility;
  allowed: boolean;
  blocking_reason: BlockingReason | null;
}

export function evaluateCandidates(
  policy: PolicyTransitionView,
  from: Eligibility,
): CandidateEvaluation[] {
  return ELIGIBILITY_STATES.filter((to) => to !== from).map((to) => {
    const verdict = evaluateTransition(policy, from, to);
    return {
      to_eligibility: to,
      allowed: verdict.allowed,
      blocking_reason: verdict.allowed ? null : verdict.reason,
    };
  });
}

/** PEP actions for a transition. Leaving LEGAL_HOLD needs a separate, explicit release grant. */
export function transitionActions(from: Eligibility, to: Eligibility): string[] {
  const actions = [`RETENTION_TRANSITION_${to}`];
  if (from === 'LEGAL_HOLD') actions.push('RETENTION_LEGAL_HOLD_RELEASE');
  return actions;
}
