import type { ActorType, EventEnvelope } from '../domain/validate.js';
import type { MessageKind, ThreadStatus } from '../domain/model.js';

export interface DbSession {
  tenantId: string;
  cellId: string;
  actorType: ActorType;
  actorId: string;
  correlationId: string;
}

export interface ThreadRow {
  thread_id: string;
  tenant_id: string;
  cell_id: string;
  application_id: string;
  subject_code: string | null;
  status: ThreadStatus;
  aggregate_version: number;
  message_seq: number;
  organisation_id: string | null;
  jurisdiction_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_correlation_id: string;
}

export interface ThreadTransitionRow {
  transition_id: string;
  tenant_id: string;
  thread_id: string;
  command: string;
  from_status: ThreadStatus | null;
  to_status: ThreadStatus;
  aggregate_version: number;
  idempotency_key: string;
  authz_decision_id: string;
  authz_policy_revision: string;
  correlation_id: string;
  actor_type: ActorType;
  actor_id: string;
  occurred_at: string;
}

export interface ParticipantRow {
  participant_id: string;
  tenant_id: string;
  thread_id: string;
  actor_id: string;
  participant_ref: string;
  role_code: string;
  added_by: string;
  added_at: string;
  removed_at: string | null;
  removed_by: string | null;
}

export interface MessageRow {
  message_id: string;
  tenant_id: string;
  thread_id: string;
  sequence: number;
  kind: MessageKind;
  sender_actor_type: ActorType;
  sender_id: string;
  sender_participant_ref: string;
  body_text: string;
  body_sha256: string;
  ack_required: boolean;
  ack_due_at: string | null;
  created_at: string;
  correlation_id: string;
}

export interface MessageWithState extends MessageRow {
  retracted_at: string | null;
  ack_count: number;
}

export interface AttachmentRow {
  attachment_id: string;
  tenant_id: string;
  thread_id: string;
  message_id: string;
  storage_key: string;
  byte_size: number;
  checksum_sha256: string;
  scan_verdict: 'CLEAN';
  created_at: string;
}

export interface RetractionRow {
  retraction_id: string;
  tenant_id: string;
  thread_id: string;
  message_id: string;
  retracted_by: string;
  reason_code: string | null;
  retracted_at: string;
  correlation_id: string;
}

export interface AckRow {
  ack_id: string;
  tenant_id: string;
  thread_id: string;
  message_id: string;
  actor_id: string;
  acknowledged_at: string;
  correlation_id: string;
}

export interface ReadReceiptRow {
  thread_id: string;
  actor_id: string;
  last_read_sequence: number;
  read_at: string;
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

export interface IdempotencyKeyRef {
  principalId: string;
  endpoint: string;
  key: string;
}

export type IdempotencyLookup =
  | { state: 'absent' }
  | { state: 'pending'; fingerprint: string }
  | { state: 'completed'; fingerprint: string; response: StoredResponse };

export interface MessagingTx {
  lookupIdempotency(ref: IdempotencyKeyRef): Promise<IdempotencyLookup>;
  claimIdempotency(
    ref: IdempotencyKeyRef & { fingerprint: string; now: Date },
  ): Promise<'claimed' | StoredResponse>;
  completeIdempotency(ref: IdempotencyKeyRef & { response: StoredResponse }): Promise<void>;

  insertThread(row: ThreadRow): Promise<void>;
  getThread(id: string, opts?: { forUpdate?: boolean }): Promise<ThreadRow | null>;
  listThreadsForActor(applicationId: string, actorId: string): Promise<ThreadRow[]>;
  updateThreadStatus(params: {
    threadId: string;
    fromStatus: ThreadStatus;
    toStatus: ThreadStatus;
    fromVersion: number;
    updatedAt: string;
    correlationId: string;
  }): Promise<boolean>;
  /** Advances message_seq by one on an OPEN thread; returns the new sequence or null. */
  nextMessageSequence(params: {
    threadId: string;
    updatedAt: string;
    correlationId: string;
  }): Promise<number | null>;
  insertTransition(row: ThreadTransitionRow): Promise<void>;
  listTransitions(threadId: string): Promise<ThreadTransitionRow[]>;

  insertParticipant(row: ParticipantRow): Promise<void>;
  getParticipantByActor(threadId: string, actorId: string): Promise<ParticipantRow | null>;
  listParticipants(threadId: string): Promise<ParticipantRow[]>;
  countActiveParticipants(threadId: string): Promise<number>;
  removeParticipant(params: {
    threadId: string;
    actorId: string;
    removedBy: string;
    removedAt: string;
  }): Promise<boolean>;

  insertMessage(row: MessageRow): Promise<void>;
  getMessage(threadId: string, messageId: string): Promise<MessageWithState | null>;
  listMessages(params: {
    threadId: string;
    afterSequence: number;
    limit: number;
  }): Promise<MessageWithState[]>;
  insertAttachment(row: AttachmentRow): Promise<void>;
  listAttachments(threadId: string, messageIds?: string[]): Promise<AttachmentRow[]>;
  getAttachment(threadId: string, attachmentId: string): Promise<AttachmentRow | null>;
  insertRetraction(row: RetractionRow): Promise<void>;
  insertAck(row: AckRow): Promise<void>;
  getAck(messageId: string, actorId: string): Promise<AckRow | null>;
  upsertReadReceipt(params: {
    threadId: string;
    actorId: string;
    lastReadSequence: number;
    readAt: string;
  }): Promise<void>;
  listReadReceipts(threadId: string): Promise<ReadReceiptRow[]>;

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface MessagingStore {
  withTx<T>(session: DbSession, fn: (tx: MessagingTx) => Promise<T>): Promise<T>;
}
