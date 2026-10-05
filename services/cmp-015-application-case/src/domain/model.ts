/**
 * SF-CON-APPLICATION-CASE-SM (FROZEN) as executable data. test/contract asserts these tables are
 * identical to contracts/m05/schemas/application-case-sm.schema.json.
 */

export const LEGAL_STATES = [
  'DRAFT',
  'READY_TO_SUBMIT',
  'SUBMITTED',
  'PAYMENT_PENDING',
  'RECEIVED',
  'UNDER_SCRUTINY',
  'DEFICIENCY_RAISED',
  'CITIZEN_RESPONSE',
  'VERIFICATION',
  'DECISION_PENDING',
  'APPROVED',
  'REJECTED',
  'SIGNING_PENDING',
  'ISSUED',
  'CLOSED',
  'WITHDRAWN',
  'CANCELLED',
] as const;
export type CaseState = (typeof LEGAL_STATES)[number];

/** ADR-0003: workflow/request constructs, never an authoritative application state. */
export const FORBIDDEN_AUTHORITATIVE_STATES = [
  'WITHDRAWAL_REQUESTED',
  'CANCELLATION_REQUESTED',
] as const;

export const COMMANDS = [
  'CREATE_DRAFT',
  'MARK_READY_TO_SUBMIT',
  'RETURN_TO_DRAFT',
  'SUBMIT',
  'ENTER_PAYMENT_PENDING',
  'MARK_RECEIVED',
  'ENTER_SCRUTINY',
  'RAISE_DEFICIENCY',
  'RECORD_CITIZEN_RESPONSE',
  'ENTER_VERIFICATION',
  'ENTER_DECISION_PENDING',
  'RECORD_APPROVED',
  'RECORD_REJECTED',
  'ENTER_SIGNING_PENDING',
  'RECORD_ISSUED',
  'CLOSE',
  'COMMIT_WITHDRAWAL',
  'COMMIT_CANCELLATION',
] as const;
export type CaseCommand = (typeof COMMANDS)[number];
export type TransitionCommand = Exclude<CaseCommand, 'CREATE_DRAFT'>;

export type TransitionClass =
  'ALWAYS_LEGAL' | 'POLICY_GATED_WITHDRAWAL' | 'POLICY_GATED_CANCELLATION';
export type RequestKind = 'WITHDRAWAL' | 'CANCELLATION';
export const REQUEST_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'REJECTED',
  'EXPIRED',
  'COMMITTED',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface TransitionDef {
  key: string;
  from: CaseState;
  to: CaseState;
  command: TransitionCommand;
  cls: TransitionClass;
}

const ALWAYS_LEGAL: readonly [CaseState, CaseState, TransitionCommand][] = [
  ['DRAFT', 'READY_TO_SUBMIT', 'MARK_READY_TO_SUBMIT'],
  ['READY_TO_SUBMIT', 'SUBMITTED', 'SUBMIT'],
  ['READY_TO_SUBMIT', 'DRAFT', 'RETURN_TO_DRAFT'],
  ['SUBMITTED', 'PAYMENT_PENDING', 'ENTER_PAYMENT_PENDING'],
  ['SUBMITTED', 'RECEIVED', 'MARK_RECEIVED'],
  ['PAYMENT_PENDING', 'RECEIVED', 'MARK_RECEIVED'],
  ['RECEIVED', 'UNDER_SCRUTINY', 'ENTER_SCRUTINY'],
  ['UNDER_SCRUTINY', 'DEFICIENCY_RAISED', 'RAISE_DEFICIENCY'],
  ['UNDER_SCRUTINY', 'VERIFICATION', 'ENTER_VERIFICATION'],
  ['UNDER_SCRUTINY', 'DECISION_PENDING', 'ENTER_DECISION_PENDING'],
  ['DEFICIENCY_RAISED', 'CITIZEN_RESPONSE', 'RECORD_CITIZEN_RESPONSE'],
  ['CITIZEN_RESPONSE', 'UNDER_SCRUTINY', 'ENTER_SCRUTINY'],
  ['VERIFICATION', 'UNDER_SCRUTINY', 'ENTER_SCRUTINY'],
  ['VERIFICATION', 'DECISION_PENDING', 'ENTER_DECISION_PENDING'],
  ['DECISION_PENDING', 'APPROVED', 'RECORD_APPROVED'],
  ['DECISION_PENDING', 'REJECTED', 'RECORD_REJECTED'],
  ['APPROVED', 'SIGNING_PENDING', 'ENTER_SIGNING_PENDING'],
  ['APPROVED', 'ISSUED', 'RECORD_ISSUED'],
  ['REJECTED', 'CLOSED', 'CLOSE'],
  ['SIGNING_PENDING', 'ISSUED', 'RECORD_ISSUED'],
  ['ISSUED', 'CLOSED', 'CLOSE'],
];

export const WITHDRAWAL_SOURCES: readonly CaseState[] = [
  'DRAFT',
  'READY_TO_SUBMIT',
  'SUBMITTED',
  'PAYMENT_PENDING',
  'RECEIVED',
  'UNDER_SCRUTINY',
  'DEFICIENCY_RAISED',
  'CITIZEN_RESPONSE',
  'VERIFICATION',
  'DECISION_PENDING',
];

export const CANCELLATION_SOURCES: readonly CaseState[] = [
  'PAYMENT_PENDING',
  'DEFICIENCY_RAISED',
  'SUBMITTED',
  'RECEIVED',
  'UNDER_SCRUTINY',
  'CITIZEN_RESPONSE',
  'VERIFICATION',
  'DECISION_PENDING',
];

export const TRANSITIONS: readonly TransitionDef[] = [
  ...ALWAYS_LEGAL.map(([from, to, command]) => ({
    key: `${from}>${to}`,
    from,
    to,
    command,
    cls: 'ALWAYS_LEGAL' as const,
  })),
  ...WITHDRAWAL_SOURCES.map((from) => ({
    key: `${from}>WITHDRAWN`,
    from,
    to: 'WITHDRAWN' as const,
    command: 'COMMIT_WITHDRAWAL' as const,
    cls: 'POLICY_GATED_WITHDRAWAL' as const,
  })),
  ...CANCELLATION_SOURCES.map((from) => ({
    key: `${from}>CANCELLED`,
    from,
    to: 'CANCELLED' as const,
    command: 'COMMIT_CANCELLATION' as const,
    cls: 'POLICY_GATED_CANCELLATION' as const,
  })),
];

/** Statutory decision commands; Constitution #20 forbids an AI decision-maker for these. */
export const DECISION_COMMANDS: ReadonlySet<CaseCommand> = new Set([
  'RECORD_APPROVED',
  'RECORD_REJECTED',
]);

export function isLegalState(value: unknown): value is CaseState {
  return typeof value === 'string' && (LEGAL_STATES as readonly string[]).includes(value);
}

export function isForbiddenAuthoritativeState(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (FORBIDDEN_AUTHORITATIVE_STATES as readonly string[]).includes(value)
  );
}

export function isTransitionCommand(value: unknown): value is TransitionCommand {
  return (
    typeof value === 'string' &&
    value !== 'CREATE_DRAFT' &&
    (COMMANDS as readonly string[]).includes(value)
  );
}

export function resolveTransition(
  command: TransitionCommand,
  from: CaseState,
): TransitionDef | undefined {
  return TRANSITIONS.find((t) => t.command === command && t.from === from);
}

export function requestKindFor(cls: TransitionClass): RequestKind | null {
  if (cls === 'POLICY_GATED_WITHDRAWAL') return 'WITHDRAWAL';
  if (cls === 'POLICY_GATED_CANCELLATION') return 'CANCELLATION';
  return null;
}

export function requestSources(kind: RequestKind): readonly CaseState[] {
  return kind === 'WITHDRAWAL' ? WITHDRAWAL_SOURCES : CANCELLATION_SOURCES;
}

const REQUEST_STATUS_NEXT: Record<RequestStatus, readonly RequestStatus[]> = {
  SUBMITTED: ['UNDER_REVIEW', 'REJECTED', 'EXPIRED', 'COMMITTED'],
  UNDER_REVIEW: ['REJECTED', 'EXPIRED', 'COMMITTED'],
  REJECTED: [],
  EXPIRED: [],
  COMMITTED: [],
};

export function isRequestStatusChangeLegal(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_STATUS_NEXT[from].includes(to);
}
