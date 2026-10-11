/**
 * Decision boundary (AI-GOVERNANCE.md, Architecture Constitution). A recommendation is decision
 * support only. It is never a statutory eligibility, approval, rejection, penalty, fee or
 * payment outcome and never a case state. The service stores coded reasons, never free text, so
 * a model cannot smuggle a binding assertion into a stored or emitted recommendation.
 */
export const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
export const SIGNAL_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
export const PURPOSE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
export const ROUTE_REF_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/;
export const GATEWAY_POLICY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;

const DECISION_WORDS =
  /(?:ELIGIB|APPROV|REJECT|DENIED|DENY|PENALT|ENTITL|ADJUDICAT|SANCTION|DECISION|GRANT|WAIVE|WAIVER|EXEMPT|FEE|PAYMENT|PAID|CASE_STATE|DISPOSAL)/;

/** True when a coded value names a statutory/financial/case outcome rather than a relevance signal. */
export function namesBindingOutcome(code: string): boolean {
  return DECISION_WORDS.test(code.toUpperCase());
}

export function isValidReasonCode(code: string): boolean {
  return REASON_CODE_PATTERN.test(code) && !namesBindingOutcome(code);
}

export function isValidSignalCode(code: string): boolean {
  return SIGNAL_CODE_PATTERN.test(code) && !namesBindingOutcome(code);
}
