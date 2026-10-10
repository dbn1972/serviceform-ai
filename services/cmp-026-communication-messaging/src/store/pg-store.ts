import type { ActorType, EventEnvelope } from '../domain/validate.js';
import type { MessageKind, ThreadStatus } from '../domain/model.js';
import { Cmp026Error, mapPgError } from '../errors.js';
import type {
  AckRow,
  AttachmentRow,
  DbSession,
  IdempotencyKeyRef,
  IdempotencyLookup,
  MessageRow,
  MessageWithState,
  MessagingStore,
  MessagingTx,
  ParticipantRow,
  ReadReceiptRow,
  RetractionRow,
  StoredResponse,
  ThreadRow,
  ThreadTransitionRow,
} from './types.js';

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<SqlQueryResult>;
  release(err?: Error | boolean): void;
}
export interface SqlPool {
  connect(): Promise<SqlClient>;
}

export const SCHEMA = 'sf_messaging';
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const THREAD_COLS = [
  'thread_id',
  'tenant_id',
  'cell_id',
  'application_id',
  'subject_code',
  'status',
  'aggregate_version',
  'message_seq',
  'organisation_id',
  'jurisdiction_id',
  'created_by',
  'created_at',
  'updated_at',
  'last_correlation_id',
] as const;

const TRANSITION_COLS = [
  'transition_id',
  'tenant_id',
  'thread_id',
  'command',
  'from_status',
  'to_status',
  'aggregate_version',
  'idempotency_key',
  'authz_decision_id',
  'authz_policy_revision',
  'correlation_id',
  'actor_type',
  'actor_id',
  'occurred_at',
] as const;

const PARTICIPANT_COLS = [
  'participant_id',
  'tenant_id',
  'thread_id',
  'actor_id',
  'participant_ref',
  'role_code',
  'added_by',
  'added_at',
  'removed_at',
  'removed_by',
] as const;

const MESSAGE_COLS = [
  'message_id',
  'tenant_id',
  'thread_id',
  'sequence',
  'kind',
  'sender_actor_type',
  'sender_id',
  'sender_participant_ref',
  'body_text',
  'body_sha256',
  'ack_required',
  'ack_due_at',
  'created_at',
  'correlation_id',
] as const;

const ATTACHMENT_COLS = [
  'attachment_id',
  'tenant_id',
  'thread_id',
  'message_id',
  'storage_key',
  'byte_size',
  'checksum_sha256',
  'scan_verdict',
  'created_at',
] as const;

function placeholders(n: number): string {
  return Array.from({ length: n }, (_, i) => `$${i + 1}`).join(',');
}

const MSG_SELECT =
  'SELECT m.message_id, m.tenant_id, m.thread_id, m.sequence, m.kind, m.sender_actor_type, ' +
  'm.sender_id, m.sender_participant_ref, m.body_text, m.body_sha256, m.ack_required, ' +
  'm.ack_due_at, m.created_at, m.correlation_id, r.retracted_at, ' +
  '(SELECT count(*) FROM sf_messaging.notice_acknowledgement a WHERE a.message_id = m.message_id) AS ack_count ' +
  'FROM sf_messaging.message m ' +
  'LEFT JOIN sf_messaging.message_retraction r ON r.tenant_id = m.tenant_id AND r.message_id = m.message_id ';

const SQL = {
  insertThread: `INSERT INTO sf_messaging.thread (${THREAD_COLS.join(',')}) VALUES (${placeholders(THREAD_COLS.length)})`,
  selectThread: `SELECT ${THREAD_COLS.join(',')} FROM sf_messaging.thread WHERE thread_id = $1`,
  listThreadsForActor:
    `SELECT ${THREAD_COLS.map((c) => `t.${c}`).join(',')} FROM sf_messaging.thread t ` +
    'JOIN sf_messaging.participant p ON p.tenant_id = t.tenant_id AND p.thread_id = t.thread_id ' +
    'WHERE t.application_id = $1 AND p.actor_id = $2 AND p.removed_at IS NULL ORDER BY t.created_at, t.thread_id',
  insertTransition: `INSERT INTO sf_messaging.thread_transition (${TRANSITION_COLS.join(',')}) VALUES (${placeholders(TRANSITION_COLS.length)})`,
  listTransitions: `SELECT ${TRANSITION_COLS.join(',')} FROM sf_messaging.thread_transition WHERE thread_id = $1 ORDER BY aggregate_version`,
  insertParticipant: `INSERT INTO sf_messaging.participant (${PARTICIPANT_COLS.join(',')}) VALUES (${placeholders(PARTICIPANT_COLS.length)})`,
  selectParticipantByActor: `SELECT ${PARTICIPANT_COLS.join(',')} FROM sf_messaging.participant WHERE thread_id = $1 AND actor_id = $2`,
  listParticipants: `SELECT ${PARTICIPANT_COLS.join(',')} FROM sf_messaging.participant WHERE thread_id = $1 ORDER BY added_at, participant_id`,
  insertMessage: `INSERT INTO sf_messaging.message (${MESSAGE_COLS.join(',')}) VALUES (${placeholders(MESSAGE_COLS.length)})`,
  selectMessage: `${MSG_SELECT}WHERE m.thread_id = $1 AND m.message_id = $2`,
  listMessages: `${MSG_SELECT}WHERE m.thread_id = $1 AND m.sequence > $2 ORDER BY m.sequence LIMIT $3`,
  insertAttachment: `INSERT INTO sf_messaging.message_attachment (${ATTACHMENT_COLS.join(',')}) VALUES (${placeholders(ATTACHMENT_COLS.length)})`,
  listAttachmentsAll: `SELECT ${ATTACHMENT_COLS.join(',')} FROM sf_messaging.message_attachment WHERE thread_id = $1 ORDER BY created_at, attachment_id`,
  listAttachmentsFor: `SELECT ${ATTACHMENT_COLS.join(',')} FROM sf_messaging.message_attachment WHERE thread_id = $1 AND message_id = ANY($2::uuid[]) ORDER BY created_at, attachment_id`,
  selectAttachment: `SELECT ${ATTACHMENT_COLS.join(',')} FROM sf_messaging.message_attachment WHERE thread_id = $1 AND attachment_id = $2`,
} as const;

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function str(value: unknown): string {
  return String(value);
}

function strOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function threadFrom(r: Record<string, unknown>): ThreadRow {
  return {
    thread_id: str(r['thread_id']),
    tenant_id: str(r['tenant_id']),
    cell_id: str(r['cell_id']),
    application_id: str(r['application_id']),
    subject_code: strOrNull(r['subject_code']),
    status: str(r['status']) as ThreadStatus,
    aggregate_version: Number(r['aggregate_version']),
    message_seq: Number(r['message_seq']),
    organisation_id: strOrNull(r['organisation_id']),
    jurisdiction_id: strOrNull(r['jurisdiction_id']),
    created_by: str(r['created_by']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
    last_correlation_id: str(r['last_correlation_id']),
  };
}

function transitionFrom(r: Record<string, unknown>): ThreadTransitionRow {
  return {
    transition_id: str(r['transition_id']),
    tenant_id: str(r['tenant_id']),
    thread_id: str(r['thread_id']),
    command: str(r['command']),
    from_status: strOrNull(r['from_status']) as ThreadStatus | null,
    to_status: str(r['to_status']) as ThreadStatus,
    aggregate_version: Number(r['aggregate_version']),
    idempotency_key: str(r['idempotency_key']),
    authz_decision_id: str(r['authz_decision_id']),
    authz_policy_revision: str(r['authz_policy_revision']),
    correlation_id: str(r['correlation_id']),
    actor_type: str(r['actor_type']) as ActorType,
    actor_id: str(r['actor_id']),
    occurred_at: iso(r['occurred_at']),
  };
}

function participantFrom(r: Record<string, unknown>): ParticipantRow {
  return {
    participant_id: str(r['participant_id']),
    tenant_id: str(r['tenant_id']),
    thread_id: str(r['thread_id']),
    actor_id: str(r['actor_id']),
    participant_ref: str(r['participant_ref']),
    role_code: str(r['role_code']),
    added_by: str(r['added_by']),
    added_at: iso(r['added_at']),
    removed_at: isoOrNull(r['removed_at']),
    removed_by: strOrNull(r['removed_by']),
  };
}

function messageFrom(r: Record<string, unknown>): MessageWithState {
  return {
    message_id: str(r['message_id']),
    tenant_id: str(r['tenant_id']),
    thread_id: str(r['thread_id']),
    sequence: Number(r['sequence']),
    kind: str(r['kind']) as MessageKind,
    sender_actor_type: str(r['sender_actor_type']) as ActorType,
    sender_id: str(r['sender_id']),
    sender_participant_ref: str(r['sender_participant_ref']),
    body_text: str(r['body_text']),
    body_sha256: str(r['body_sha256']),
    ack_required: r['ack_required'] === true,
    ack_due_at: isoOrNull(r['ack_due_at']),
    created_at: iso(r['created_at']),
    correlation_id: str(r['correlation_id']),
    retracted_at: isoOrNull(r['retracted_at']),
    ack_count: Number(r['ack_count'] ?? 0),
  };
}

function attachmentFrom(r: Record<string, unknown>): AttachmentRow {
  return {
    attachment_id: str(r['attachment_id']),
    tenant_id: str(r['tenant_id']),
    thread_id: str(r['thread_id']),
    message_id: str(r['message_id']),
    storage_key: str(r['storage_key']),
    byte_size: Number(r['byte_size']),
    checksum_sha256: str(r['checksum_sha256']),
    scan_verdict: 'CLEAN',
    created_at: iso(r['created_at']),
  };
}

class PgTx implements MessagingTx {
  constructor(
    private readonly client: SqlClient,
    private readonly tenantId: string,
  ) {}

  async lookupIdempotency(ref: IdempotencyKeyRef): Promise<IdempotencyLookup> {
    const { rows } = await this.client.query(
      `SELECT request_fingerprint, status, response_status, response_body
         FROM sf_messaging.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, ref.principalId, ref.endpoint, ref.key],
    );
    const row = rows[0];
    if (!row) return { state: 'absent' };
    const fingerprint = str(row['request_fingerprint']);
    if (row['status'] === 'COMPLETED' && row['response_status'] !== null) {
      return {
        state: 'completed',
        fingerprint,
        response: { status: Number(row['response_status']), body: row['response_body'] },
      };
    }
    return { state: 'pending', fingerprint };
  }

  async claimIdempotency(
    ref: IdempotencyKeyRef & { fingerprint: string; now: Date },
  ): Promise<'claimed' | StoredResponse> {
    const expires = new Date(ref.now.getTime() + IDEMPOTENCY_TTL_MS);
    const inserted = await this.client.query(
      `INSERT INTO sf_messaging.idempotency_record (
         tenant_id, principal_id, endpoint, idempotency_key, request_fingerprint, status, created_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,'IN_PROGRESS',$6,$7)
       ON CONFLICT (tenant_id, principal_id, endpoint, idempotency_key) DO NOTHING`,
      [
        this.tenantId,
        ref.principalId,
        ref.endpoint,
        ref.key,
        ref.fingerprint,
        ref.now.toISOString(),
        expires.toISOString(),
      ],
    );
    if ((inserted.rowCount ?? 0) === 1) return 'claimed';
    const existing = await this.lookupIdempotency(ref);
    if (existing.state === 'absent') throw new Cmp026Error('SF-SYS-001');
    if (existing.fingerprint !== ref.fingerprint) throw new Cmp026Error('SF-APP-002');
    if (existing.state === 'completed') return existing.response;
    throw new Cmp026Error('SF-APP-002');
  }

  async completeIdempotency(ref: IdempotencyKeyRef & { response: StoredResponse }): Promise<void> {
    await this.client.query(
      `UPDATE sf_messaging.idempotency_record
          SET status = 'COMPLETED', response_ref = $1, response_status = $2, response_body = $3::jsonb
        WHERE tenant_id = $4 AND principal_id = $5 AND endpoint = $6 AND idempotency_key = $7`,
      [
        `sf_messaging.idempotency_record:${ref.key}`,
        ref.response.status,
        JSON.stringify(ref.response.body),
        this.tenantId,
        ref.principalId,
        ref.endpoint,
        ref.key,
      ],
    );
  }

  async insertThread(row: ThreadRow): Promise<void> {
    await this.client.query(
      SQL.insertThread,
      THREAD_COLS.map((c) => row[c]),
    );
  }

  async getThread(id: string, opts: { forUpdate?: boolean } = {}): Promise<ThreadRow | null> {
    const sql = opts.forUpdate ? `${SQL.selectThread} FOR UPDATE` : SQL.selectThread;
    const { rows } = await this.client.query(sql, [id]);
    return rows[0] ? threadFrom(rows[0]) : null;
  }

  async listThreadsForActor(applicationId: string, actorId: string): Promise<ThreadRow[]> {
    const { rows } = await this.client.query(SQL.listThreadsForActor, [applicationId, actorId]);
    return rows.map(threadFrom);
  }

  async updateThreadStatus(params: {
    threadId: string;
    fromStatus: ThreadStatus;
    toStatus: ThreadStatus;
    fromVersion: number;
    updatedAt: string;
    correlationId: string;
  }): Promise<boolean> {
    const res = await this.client.query(
      `UPDATE sf_messaging.thread
          SET status = $1, aggregate_version = aggregate_version + 1, updated_at = $2,
              last_correlation_id = $3
        WHERE thread_id = $4 AND status = $5 AND aggregate_version = $6`,
      [
        params.toStatus,
        params.updatedAt,
        params.correlationId,
        params.threadId,
        params.fromStatus,
        params.fromVersion,
      ],
    );
    return (res.rowCount ?? 0) === 1;
  }

  async nextMessageSequence(params: {
    threadId: string;
    updatedAt: string;
    correlationId: string;
  }): Promise<number | null> {
    const res = await this.client.query(
      `UPDATE sf_messaging.thread
          SET message_seq = message_seq + 1, updated_at = $1, last_correlation_id = $2
        WHERE thread_id = $3 AND status = 'OPEN'
        RETURNING message_seq`,
      [params.updatedAt, params.correlationId, params.threadId],
    );
    const row = res.rows[0];
    return row ? Number(row['message_seq']) : null;
  }

  async insertTransition(row: ThreadTransitionRow): Promise<void> {
    await this.client.query(
      SQL.insertTransition,
      TRANSITION_COLS.map((c) => row[c]),
    );
  }

  async listTransitions(threadId: string): Promise<ThreadTransitionRow[]> {
    const { rows } = await this.client.query(SQL.listTransitions, [threadId]);
    return rows.map(transitionFrom);
  }

  async insertParticipant(row: ParticipantRow): Promise<void> {
    await this.client.query(
      SQL.insertParticipant,
      PARTICIPANT_COLS.map((c) => row[c]),
    );
  }

  async getParticipantByActor(threadId: string, actorId: string): Promise<ParticipantRow | null> {
    const { rows } = await this.client.query(SQL.selectParticipantByActor, [threadId, actorId]);
    return rows[0] ? participantFrom(rows[0]) : null;
  }

  async listParticipants(threadId: string): Promise<ParticipantRow[]> {
    const { rows } = await this.client.query(SQL.listParticipants, [threadId]);
    return rows.map(participantFrom);
  }

  async countActiveParticipants(threadId: string): Promise<number> {
    const { rows } = await this.client.query(
      'SELECT count(*)::int AS n FROM sf_messaging.participant WHERE thread_id = $1 AND removed_at IS NULL',
      [threadId],
    );
    return Number(rows[0]?.['n'] ?? 0);
  }

  async removeParticipant(params: {
    threadId: string;
    actorId: string;
    removedBy: string;
    removedAt: string;
  }): Promise<boolean> {
    const res = await this.client.query(
      `UPDATE sf_messaging.participant SET removed_at = $1, removed_by = $2
        WHERE thread_id = $3 AND actor_id = $4 AND removed_at IS NULL`,
      [params.removedAt, params.removedBy, params.threadId, params.actorId],
    );
    return (res.rowCount ?? 0) === 1;
  }

  async insertMessage(row: MessageRow): Promise<void> {
    await this.client.query(
      SQL.insertMessage,
      MESSAGE_COLS.map((c) => row[c]),
    );
  }

  async getMessage(threadId: string, messageId: string): Promise<MessageWithState | null> {
    const { rows } = await this.client.query(SQL.selectMessage, [threadId, messageId]);
    return rows[0] ? messageFrom(rows[0]) : null;
  }

  async listMessages(params: {
    threadId: string;
    afterSequence: number;
    limit: number;
  }): Promise<MessageWithState[]> {
    const { rows } = await this.client.query(SQL.listMessages, [
      params.threadId,
      params.afterSequence,
      params.limit,
    ]);
    return rows.map(messageFrom);
  }

  async insertAttachment(row: AttachmentRow): Promise<void> {
    await this.client.query(
      SQL.insertAttachment,
      ATTACHMENT_COLS.map((c) => row[c]),
    );
  }

  async listAttachments(threadId: string, messageIds?: string[]): Promise<AttachmentRow[]> {
    const { rows } =
      messageIds === undefined
        ? await this.client.query(SQL.listAttachmentsAll, [threadId])
        : await this.client.query(SQL.listAttachmentsFor, [threadId, messageIds]);
    return rows.map(attachmentFrom);
  }

  async getAttachment(threadId: string, attachmentId: string): Promise<AttachmentRow | null> {
    const { rows } = await this.client.query(SQL.selectAttachment, [threadId, attachmentId]);
    return rows[0] ? attachmentFrom(rows[0]) : null;
  }

  async insertRetraction(row: RetractionRow): Promise<void> {
    await this.client.query(
      `INSERT INTO sf_messaging.message_retraction (
         retraction_id, tenant_id, thread_id, message_id, retracted_by, reason_code, retracted_at, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        row.retraction_id,
        row.tenant_id,
        row.thread_id,
        row.message_id,
        row.retracted_by,
        row.reason_code,
        row.retracted_at,
        row.correlation_id,
      ],
    );
  }

  async insertAck(row: AckRow): Promise<void> {
    await this.client.query(
      `INSERT INTO sf_messaging.notice_acknowledgement (
         ack_id, tenant_id, thread_id, message_id, actor_id, acknowledged_at, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        row.ack_id,
        row.tenant_id,
        row.thread_id,
        row.message_id,
        row.actor_id,
        row.acknowledged_at,
        row.correlation_id,
      ],
    );
  }

  async getAck(messageId: string, actorId: string): Promise<AckRow | null> {
    const { rows } = await this.client.query(
      `SELECT ack_id, tenant_id, thread_id, message_id, actor_id, acknowledged_at, correlation_id
         FROM sf_messaging.notice_acknowledgement WHERE message_id = $1 AND actor_id = $2`,
      [messageId, actorId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      ack_id: str(r['ack_id']),
      tenant_id: str(r['tenant_id']),
      thread_id: str(r['thread_id']),
      message_id: str(r['message_id']),
      actor_id: str(r['actor_id']),
      acknowledged_at: iso(r['acknowledged_at']),
      correlation_id: str(r['correlation_id']),
    };
  }

  async upsertReadReceipt(params: {
    threadId: string;
    actorId: string;
    lastReadSequence: number;
    readAt: string;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO sf_messaging.read_receipt (tenant_id, thread_id, actor_id, last_read_sequence, read_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, thread_id, actor_id)
       DO UPDATE SET last_read_sequence = GREATEST(sf_messaging.read_receipt.last_read_sequence, EXCLUDED.last_read_sequence),
                     read_at = EXCLUDED.read_at`,
      [this.tenantId, params.threadId, params.actorId, params.lastReadSequence, params.readAt],
    );
  }

  async listReadReceipts(threadId: string): Promise<ReadReceiptRow[]> {
    const { rows } = await this.client.query(
      `SELECT thread_id, actor_id, last_read_sequence, read_at
         FROM sf_messaging.read_receipt WHERE thread_id = $1 ORDER BY read_at, actor_id`,
      [threadId],
    );
    return rows.map((r) => ({
      thread_id: str(r['thread_id']),
      actor_id: str(r['actor_id']),
      last_read_sequence: Number(r['last_read_sequence']),
      read_at: iso(r['read_at']),
    }));
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    const partitionKey =
      topic === 'sf.audit.ingest.v1'
        ? `audit:${String((envelope.data as { audit_id?: string }).audit_id ?? envelope.aggregate_id)}`
        : envelope.aggregate_id;
    await this.client.query(
      `INSERT INTO sf_messaging.outbox_event (
         event_id, tenant_id, topic, partition_key, event_type, schema_version,
         aggregate_type, aggregate_id, aggregate_version, envelope
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        envelope.event_id,
        envelope.tenant_id,
        topic,
        partitionKey,
        envelope.event_type,
        envelope.schema_version,
        envelope.aggregate_type,
        envelope.aggregate_id,
        envelope.aggregate_version,
        JSON.stringify(envelope),
      ],
    );
  }
}

export class PgMessagingStore implements MessagingStore {
  constructor(private readonly pool: SqlPool) {}

  async withTx<T>(session: DbSession, fn: (tx: MessagingTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const settings: [string, string][] = [
        ['app.tenant_id', session.tenantId],
        ['app.cell_id', session.cellId],
        ['app.actor_type', session.actorType],
        ['app.actor_id', session.actorId],
        ['app.correlation_id', session.correlationId],
      ];
      for (const [key, value] of settings) {
        await client.query('SELECT set_config($1, $2, true)', [key, value]);
      }
      const result = await fn(new PgTx(client, session.tenantId));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw mapPgError(err);
    } finally {
      client.release();
    }
  }
}
