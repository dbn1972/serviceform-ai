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

/** Keys that must never appear on the officer audit surface (PII / tenancy). */
const FORBIDDEN_AUDIT_KEYS = new Set(['actor_id', 'tenant_id', 'principal_id', 'subject_id']);

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
    case 'FORWARD_FOR_APPROVAL':
      return 'Forwarded for approval';
    case 'RESUME_SCRUTINY':
      return 'Scrutiny resumed';
    default:
      return command;
  }
}

/** Compact correlation id for the trail UI (full UUID remains in code tooltip via title). */
export function shortCorrelationId(correlationId: string): string {
  if (correlationId.length <= 13) return correlationId;
  return `${correlationId.slice(0, 8)}…`;
}

export function auditTrailDepth(transitions: readonly CaseTransitionView[]): {
  total: number;
  by_command: Record<string, number>;
  deficiency_loop_events: number;
  has_human_decision: boolean;
} {
  const by_command: Record<string, number> = {};
  let deficiency_loop_events = 0;
  let has_human_decision = false;
  for (const t of transitions) {
    by_command[t.command] = (by_command[t.command] ?? 0) + 1;
    if (
      t.command === 'RAISE_DEFICIENCY' ||
      t.command === 'RECORD_CITIZEN_RESPONSE' ||
      t.command === 'CLOSE_DEFICIENCY'
    ) {
      deficiency_loop_events += 1;
    }
    if (t.command === 'RECORD_APPROVED' || t.command === 'RECORD_REJECTED') {
      has_human_decision = true;
    }
  }
  return {
    total: transitions.length,
    by_command,
    deficiency_loop_events,
    has_human_decision,
  };
}

/**
 * Drop forbidden identity keys if a platform row ever leaks them into the BFF payload.
 * Fail-closed display hygiene — does not replace CMP-015 platform stripping.
 */
export function sanitizeAuditRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!FORBIDDEN_AUDIT_KEYS.has(key)) {
      out[key] = value;
    }
  }
  return out as T;
}
