import type { Actor, ActorType } from '../types.js';

export const CONTRACT_ID = 'SF-CON-ASSISTED-SESSION';

export const CHANNELS = [
  'COUNTER',
  'CSC',
  'KIOSK',
  'CALL_CENTRE',
  'AUTHORIZED_REPRESENTATIVE',
  'GUARDIAN',
  'INSTITUTIONAL',
] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * Channels in which applied_by acts for applied_for on a claimed representation basis. They need a
 * representation_authority_ref and a verifier who is neither party. Which evidence qualifies is
 * tenant metadata behind the opaque ref; nothing here encodes a representation statute.
 */
export const REPRESENTATION_CHANNELS: readonly Channel[] = [
  'AUTHORIZED_REPRESENTATIVE',
  'GUARDIAN',
  'INSTITUTIONAL',
];

export const LIFECYCLE_STATUSES = [
  'STARTED',
  'APPLICANT_BOUND',
  'REPRESENTATION_VERIFIED',
  'SUBMITTED',
  'HANDED_OFF',
  'CLOSED',
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const TERMINAL_STATUSES: readonly LifecycleStatus[] = ['CLOSED'];

export const SESSION_COMMANDS = [
  'BIND_APPLICANT',
  'VERIFY_REPRESENTATION',
  'SUBMIT',
  'HANDOFF',
  'RESUME',
  'CLOSE',
] as const;
export type SessionCommand = (typeof SESSION_COMMANDS)[number];

export const COMMAND_TARGET: Readonly<Record<SessionCommand, LifecycleStatus>> = {
  BIND_APPLICANT: 'APPLICANT_BOUND',
  VERIFY_REPRESENTATION: 'REPRESENTATION_VERIFIED',
  SUBMIT: 'SUBMITTED',
  HANDOFF: 'HANDED_OFF',
  RESUME: 'CLOSED',
  CLOSE: 'CLOSED',
};

/**
 * INT-015 step 2: representation basis and consent are verified before submission or handoff.
 * The same pairs are enforced by sf_assisted.guard_session().
 */
export const COMMAND_SOURCES: Readonly<Record<SessionCommand, readonly LifecycleStatus[]>> = {
  BIND_APPLICANT: ['STARTED'],
  VERIFY_REPRESENTATION: ['APPLICANT_BOUND'],
  SUBMIT: ['REPRESENTATION_VERIFIED'],
  HANDOFF: ['REPRESENTATION_VERIFIED'],
  RESUME: ['HANDED_OFF'],
  CLOSE: ['STARTED', 'APPLICANT_BOUND', 'REPRESENTATION_VERIFIED', 'SUBMITTED', 'HANDED_OFF'],
};

export const CLOSURE_REASONS = ['OPERATOR_CLOSED', 'RESUMED_SELF_SERVICE'] as const;
export type ClosureReason = (typeof CLOSURE_REASONS)[number];

export type CommandVerdict =
  | { allowed: true; to: LifecycleStatus }
  | { allowed: false; reason: 'TERMINAL_STATUS' | 'TRANSITION_NOT_ALLOWED' };

export function evaluateCommand(command: SessionCommand, from: LifecycleStatus): CommandVerdict {
  if (TERMINAL_STATUSES.includes(from)) return { allowed: false, reason: 'TERMINAL_STATUS' };
  if (!COMMAND_SOURCES[command].includes(from)) {
    return { allowed: false, reason: 'TRANSITION_NOT_ALLOWED' };
  }
  return { allowed: true, to: COMMAND_TARGET[command] };
}

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);
}

export function requiresRepresentation(channel: Channel): boolean {
  return REPRESENTATION_CHANNELS.includes(channel);
}

/** Actor types that may open a session as applied_by on a channel. */
export function starterActors(channel: Channel): readonly ActorType[] {
  return requiresRepresentation(channel) ? ['CITIZEN', 'OFFICER'] : ['OFFICER'];
}

export const OPAQUE_REF = /^[A-Za-z0-9_.:-]{1,128}$/;

export function isOpaqueRef(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_REF.test(value);
}

export interface SessionRecord {
  tenant_id: string;
  session_id: string;
  channel: Channel;
  applied_by_actor_id: string;
  applied_by_actor_type: ActorType;
  applied_for_citizen_id: string;
  organisation_id: string | null;
  office_id: string | null;
  lifecycle_status: LifecycleStatus;
  session_version: number;
  idempotency_key: string;
  applicant_assurance_ref: string | null;
  application_id: string | null;
  handoff_token_hash: string | null;
  handoff_expires_at: string | null;
  closure_reason: ClosureReason | null;
  started_at: string;
  updated_at: string;
  last_correlation_id: string;
}

export interface RepresentationRecord {
  tenant_id: string;
  representation_id: string;
  session_id: string;
  representation_authority_ref: string | null;
  valid_until: string | null;
  verified_by_actor_id: string;
  verified_by_actor_type: ActorType;
  verified_at: string;
}

export interface ConsentRecord {
  tenant_id: string;
  consent_record_id: string;
  session_id: string;
  consent_ref: string;
  read_back_acknowledged: true;
  captured_by_actor_id: string;
  captured_at: string;
}

export type ActionCommand = 'START' | SessionCommand;

export interface OperatorActionRecord {
  tenant_id: string;
  action_id: string;
  session_id: string;
  sequence: number;
  command: ActionCommand;
  from_status: LifecycleStatus | null;
  to_status: LifecycleStatus;
  actor_type: Actor['type'];
  actor_id: string;
  correlation_id: string;
  acted_at: string;
}

export interface SessionAggregate {
  session: SessionRecord;
  representation?: RepresentationRecord;
  consent?: ConsentRecord;
}

export interface AssistedSessionContract {
  contract_id: typeof CONTRACT_ID;
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  tenant_id: string;
  idempotency_key: string;
  invented_statutory_policy_forbidden: true;
  correlation_id?: string;
  session_id: string;
  channel: Channel;
  applied_by_actor_id: string;
  applied_for_citizen_id: string;
  applied_by_distinct_from_applied_for: true;
  representation_authority_ref?: string | null;
  lifecycle_status: LifecycleStatus;
}

/** Projection onto FROZEN SF-CON-ASSISTED-SESSION; refuses to emit a self-assisted document. */
export function toContract(agg: SessionAggregate): AssistedSessionContract {
  const s = agg.session;
  if (s.applied_by_actor_id.toLowerCase() === s.applied_for_citizen_id.toLowerCase()) {
    throw new Error('applied_by must be distinct from applied_for');
  }
  const doc: AssistedSessionContract = {
    contract_id: CONTRACT_ID,
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: s.tenant_id,
    idempotency_key: s.idempotency_key,
    invented_statutory_policy_forbidden: true,
    correlation_id: s.last_correlation_id,
    session_id: s.session_id,
    channel: s.channel,
    applied_by_actor_id: s.applied_by_actor_id,
    applied_for_citizen_id: s.applied_for_citizen_id,
    applied_by_distinct_from_applied_for: true,
    lifecycle_status: s.lifecycle_status,
  };
  if (agg.representation) {
    doc.representation_authority_ref = agg.representation.representation_authority_ref;
  }
  return doc;
}
