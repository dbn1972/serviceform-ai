export const APPEAL_STATES = [
  'FILED',
  'ADMITTED',
  'NOT_ADMITTED',
  'IN_REVIEW',
  'DECISION_REFERENCED',
  'WITHDRAWN',
  'CANCELLED',
] as const;
export type AppealState = (typeof APPEAL_STATES)[number];

export const OPERATIONS = [
  'FILE',
  'RECORD_ADMISSIBILITY',
  'ASSIGN',
  'REASSIGN',
  'RECORD_REVIEW',
  'RECORD_HEARING',
  'RECORD_DECISION',
  'WITHDRAW',
  'CANCEL',
  'LINK_WORKFLOW',
] as const;
export type Operation = (typeof OPERATIONS)[number];

export const ADMISSIBILITY = ['PENDING', 'ADMITTED', 'NOT_ADMITTED'] as const;
export type AdmissibilityCode = (typeof ADMISSIBILITY)[number];

export const TERMINAL_STATES: readonly AppealState[] = [
  'NOT_ADMITTED',
  'DECISION_REFERENCED',
  'WITHDRAWN',
  'CANCELLED',
];

export function isTerminal(state: AppealState): boolean {
  return TERMINAL_STATES.includes(state);
}

export const AUTHZ_ACTION: Record<Operation | 'READ' | 'AI_ASSIST', string> = {
  FILE: 'APPEAL_FILE',
  RECORD_ADMISSIBILITY: 'APPEAL_ADMISSIBILITY',
  ASSIGN: 'APPEAL_ASSIGN',
  REASSIGN: 'APPEAL_REASSIGN',
  RECORD_REVIEW: 'APPEAL_RECORD_REVIEW',
  RECORD_HEARING: 'APPEAL_RECORD_REVIEW',
  RECORD_DECISION: 'APPEAL_RECORD_DECISION',
  WITHDRAW: 'APPEAL_WITHDRAW',
  CANCEL: 'APPEAL_CANCEL',
  LINK_WORKFLOW: 'APPEAL_FILE',
  READ: 'APPEAL_READ',
  AI_ASSIST: 'APPEAL_READ',
};

export const EVENT_TYPE: Record<Operation, string> = {
  FILE: 'AppealFiled',
  RECORD_ADMISSIBILITY: 'AppealAdmissibilityRecorded',
  ASSIGN: 'AppealAssigned',
  REASSIGN: 'AppealReassigned',
  RECORD_REVIEW: 'AppealReviewRecorded',
  RECORD_HEARING: 'AppealHearingReferenced',
  RECORD_DECISION: 'AppealDecisionReferenced',
  WITHDRAW: 'AppealWithdrawn',
  CANCEL: 'AppealCancelled',
  LINK_WORKFLOW: 'AppealWorkflowLinked',
};

export const NOTE_KINDS = ['SUMMARY', 'RETRIEVAL', 'DRAFT_NOTE', 'CHECKLIST'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

const FORBIDDEN_AI = [
  'ADMISSIBILITY',
  'APPROVAL',
  'REJECTION',
  'PENALTY',
  'ELIGIBILITY',
  'FINAL_LEGAL_OUTCOME',
  'DECIDE',
  'DECISION',
] as const;

export function isForbiddenAiKind(value: string): boolean {
  const n = value.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return (FORBIDDEN_AI as readonly string[]).includes(n);
}

export function isAiActor(roles: readonly string[]): boolean {
  return roles.some((r) => r.startsWith('AI_') || r === 'AI_GATEWAY' || r === 'COPILOT');
}
