/**
 * Officer-visible case audit trail from CMP-015 append-only transitions.
 * Actor ids and tenant_id are stripped by the platform transition view (no PII in UI).
 * CERTIFIED=false. G6=false.
 */

export interface CaseTransitionView {
  transition_id: string;
  application_id: string;
  command: string;
  from_state: string | null;
  to_state: string;
  transition_key: string | null;
  transition_class: string | null;
  aggregate_version: number;
  authz_policy_revision: string;
  correlation_id: string;
  actor_type: string;
  reason_code: string | null;
  occurred_at: string;
}

export function transitionSummary(t: CaseTransitionView): string {
  const from = t.from_state ?? '∅';
  return `${from} → ${t.to_state}`;
}

export function transitionCommandLabel(command: string): string {
  switch (command) {
    case 'SUBMIT':
      return 'Citizen submitted';
    case 'MARK_RECEIVED':
      return 'Marked received';
    case 'ENTER_SCRUTINY':
      return 'Entered scrutiny';
    case 'ENTER_DECISION_PENDING':
      return 'Awaiting decision';
    case 'RECORD_APPROVED':
      return 'Approved (human)';
    case 'RECORD_REJECTED':
      return 'Rejected (human)';
    case 'RAISE_DEFICIENCY':
      return 'Deficiency raised';
    case 'RECORD_CITIZEN_RESPONSE':
      return 'Citizen response recorded';
    case 'CLOSE_DEFICIENCY':
      return 'Deficiency closed';
    default:
      return command;
  }
}
