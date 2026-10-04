import { AsyncLocalStorage } from 'node:async_hooks';
import {
  dbSessionSettings,
  type EventEnvelope,
  type RequestContext,
  type SimulationMarker,
} from '@serviceform/contracts';
import type { Pool, PoolClient } from 'pg';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import type { UploadPolicy } from '../domain/policy.js';
import { Cmp013Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type {
  DocumentPatch,
  DocumentRow,
  NewDocument,
  ScanRow,
  SessionRow,
  StoredIdempotent,
  UploadRepository,
  UploadTx,
} from './types.js';

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function num(value: unknown): number {
  return Number(value);
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

const SQL_LATEST_POLICY = `SELECT policy_id, policy_code, version_no, status, allowed_content_types,
       max_bytes, session_ttl_seconds, max_scan_attempts, classification
  FROM sf_upload.upload_policy
 WHERE tenant_id = $1 AND policy_code = $2
 ORDER BY version_no DESC
 LIMIT 1`;
const SQL_POLICY_BY_ID = `SELECT policy_id, policy_code, version_no, status, allowed_content_types,
       max_bytes, session_ttl_seconds, max_scan_attempts, classification
  FROM sf_upload.upload_policy
 WHERE tenant_id = $1 AND policy_id = $2`;
const SQL_DOCUMENT =
  'SELECT * FROM sf_upload.document_metadata WHERE tenant_id = $1 AND document_id = $2';
const SQL_DOCUMENT_LOCK = `${SQL_DOCUMENT} FOR UPDATE`;
const SQL_SESSION =
  'SELECT * FROM sf_upload.upload_session WHERE tenant_id = $1 AND document_id = $2';
const SQL_SESSION_LOCK = `${SQL_SESSION} FOR UPDATE`;

function toPolicy(row: Record<string, unknown>): UploadPolicy {
  return {
    policy_id: String(row['policy_id']),
    policy_code: String(row['policy_code']),
    version_no: num(row['version_no']),
    status: row['status'] as UploadPolicy['status'],
    allowed_content_types: row['allowed_content_types'] as string[],
    max_bytes: num(row['max_bytes']),
    session_ttl_seconds: num(row['session_ttl_seconds']),
    max_scan_attempts: num(row['max_scan_attempts']),
    classification: row['classification'] as UploadPolicy['classification'],
  };
}

function toDocument(row: Record<string, unknown>): DocumentRow {
  return {
    tenant_id: String(row['tenant_id']),
    document_id: String(row['document_id']),
    cell_id: String(row['cell_id']),
    policy_id: String(row['policy_id']),
    classification: row['classification'] as DocumentRow['classification'],
    application_ref: (row['application_ref'] as string | null) ?? null,
    owner_actor_id: String(row['owner_actor_id']),
    owner_actor_type: row['owner_actor_type'] as DocumentRow['owner_actor_type'],
    declared_content_type: String(row['declared_content_type']),
    declared_byte_size: num(row['declared_byte_size']),
    declared_checksum_sha256: String(row['declared_checksum_sha256']),
    detected_content_type: (row['detected_content_type'] as string | null) ?? null,
    byte_size: numOrNull(row['byte_size']),
    checksum_sha256: (row['checksum_sha256'] as string | null) ?? null,
    object_ref: String(row['object_ref']),
    storage_mode: row['storage_mode'] as DocumentRow['storage_mode'],
    storage_simulation: (row['storage_simulation'] as SimulationMarker | null) ?? null,
    status: row['status'] as DocumentRow['status'],
    rejection_code: (row['rejection_code'] as string | null) ?? null,
    scan_attempts: num(row['scan_attempts']),
    aggregate_version: num(row['aggregate_version']),
    created_at: iso(row['created_at']),
    updated_at: iso(row['updated_at']),
  };
}

function toSession(row: Record<string, unknown>): SessionRow {
  return {
    tenant_id: String(row['tenant_id']),
    session_id: String(row['session_id']),
    document_id: String(row['document_id']),
    status: row['status'] as SessionRow['status'],
    expires_at: iso(row['expires_at']),
    created_by: String(row['created_by']),
    created_at: iso(row['created_at']),
    closed_at: row['closed_at'] === null ? null : iso(row['closed_at']),
  };
}

class PgUploadTx implements UploadTx {
  constructor(
    private readonly c: PoolClient,
    private readonly tenantId: string,
  ) {}

  async claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<StoredIdempotent | 'claimed'> {
    const expires = new Date(p.now.getTime() + IDEMPOTENCY_TTL_MS);
    const inserted = await this.c.query(
      `INSERT INTO sf_upload.idempotency_record (
         tenant_id, principal_id, endpoint, idempotency_key, request_fingerprint, status, created_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,'IN_PROGRESS',$6,$7)
       ON CONFLICT (tenant_id, principal_id, endpoint, idempotency_key) DO NOTHING`,
      [
        this.tenantId,
        p.principalId,
        p.endpoint,
        p.key,
        p.fingerprint,
        p.now.toISOString(),
        expires.toISOString(),
      ],
    );
    if ((inserted.rowCount ?? 0) === 1) return 'claimed';
    const existing = await this.c.query<{
      request_fingerprint: string;
      status: string;
      response_status: number | null;
      response_body: unknown;
    }>(
      `SELECT request_fingerprint, status, response_status, response_body
         FROM sf_upload.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row || row.request_fingerprint !== p.fingerprint) throw new Cmp013Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp013Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_upload.idempotency_record
          SET status = 'COMPLETED', response_ref = $1, response_status = $2, response_body = $3::jsonb
        WHERE tenant_id = $4 AND principal_id = $5 AND endpoint = $6 AND idempotency_key = $7`,
      [
        `sf_upload.idempotency_record:${p.key}`,
        p.status,
        JSON.stringify(p.body),
        this.tenantId,
        p.principalId,
        p.endpoint,
        p.key,
      ],
    );
  }

  async latestPolicy(policyCode: string): Promise<UploadPolicy | null> {
    const r = await this.c.query(SQL_LATEST_POLICY, [this.tenantId, policyCode]);
    return r.rows[0] ? toPolicy(r.rows[0] as Record<string, unknown>) : null;
  }

  async policyById(policyId: string): Promise<UploadPolicy | null> {
    const r = await this.c.query(SQL_POLICY_BY_ID, [this.tenantId, policyId]);
    return r.rows[0] ? toPolicy(r.rows[0] as Record<string, unknown>) : null;
  }

  async insertPolicy(row: UploadPolicy & { created_by: string }): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_upload.upload_policy (
         tenant_id, policy_id, policy_code, version_no, status, allowed_content_types, max_bytes,
         session_ttl_seconds, max_scan_attempts, classification, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        this.tenantId,
        row.policy_id,
        row.policy_code,
        row.version_no,
        row.status,
        row.allowed_content_types,
        row.max_bytes,
        row.session_ttl_seconds,
        row.max_scan_attempts,
        row.classification,
        row.created_by,
      ],
    );
  }

  async insertDocument(row: NewDocument): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_upload.document_metadata (
         tenant_id, document_id, cell_id, policy_id, classification, application_ref, owner_actor_id,
         owner_actor_type, declared_content_type, declared_byte_size, declared_checksum_sha256,
         object_ref, storage_mode, storage_simulation, status, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,'PENDING_UPLOAD',$15,$15)`,
      [
        this.tenantId,
        row.document_id,
        row.cell_id,
        row.policy_id,
        row.classification,
        row.application_ref,
        row.owner_actor_id,
        row.owner_actor_type,
        row.declared_content_type,
        row.declared_byte_size,
        row.declared_checksum_sha256,
        row.object_ref,
        row.storage_mode,
        row.storage_simulation === null ? null : JSON.stringify(row.storage_simulation),
        row.now,
      ],
    );
  }

  async insertSession(row: Omit<SessionRow, 'tenant_id' | 'closed_at' | 'status'>): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_upload.upload_session (
         tenant_id, session_id, document_id, status, expires_at, created_by, created_at
       ) VALUES ($1,$2,$3,'OPEN',$4,$5,$6)`,
      [
        this.tenantId,
        row.session_id,
        row.document_id,
        row.expires_at,
        row.created_by,
        row.created_at,
      ],
    );
  }

  async getDocument(documentId: string, forUpdate = false): Promise<DocumentRow | null> {
    const sql = forUpdate ? SQL_DOCUMENT_LOCK : SQL_DOCUMENT;
    const r = await this.c.query(sql, [this.tenantId, documentId]);
    return r.rows[0] ? toDocument(r.rows[0] as Record<string, unknown>) : null;
  }

  async getSessionForDocument(documentId: string, forUpdate = false): Promise<SessionRow | null> {
    const sql = forUpdate ? SQL_SESSION_LOCK : SQL_SESSION;
    const r = await this.c.query(sql, [this.tenantId, documentId]);
    return r.rows[0] ? toSession(r.rows[0] as Record<string, unknown>) : null;
  }

  async updateDocument(documentId: string, patch: DocumentPatch): Promise<number> {
    const r = await this.c.query<{ aggregate_version: string }>(
      `UPDATE sf_upload.document_metadata
          SET status = $3,
              rejection_code = COALESCE($4, rejection_code),
              detected_content_type = COALESCE($5, detected_content_type),
              byte_size = COALESCE($6, byte_size),
              checksum_sha256 = COALESCE($7, checksum_sha256),
              scan_attempts = COALESCE($8, scan_attempts),
              aggregate_version = aggregate_version + 1,
              updated_at = $9
        WHERE tenant_id = $1 AND document_id = $2
        RETURNING aggregate_version`,
      [
        this.tenantId,
        documentId,
        patch.status,
        patch.rejection_code ?? null,
        patch.detected_content_type ?? null,
        patch.byte_size ?? null,
        patch.checksum_sha256 ?? null,
        patch.scan_attempts ?? null,
        patch.now,
      ],
    );
    const row = r.rows[0];
    if (!row) throw new Cmp013Error('SF-SYS-002');
    return Number(row.aggregate_version);
  }

  async closeSession(
    sessionId: string,
    status: 'COMPLETED' | 'EXPIRED' | 'REJECTED',
    now: string,
  ): Promise<void> {
    await this.c.query(
      `UPDATE sf_upload.upload_session SET status = $3, closed_at = $4
        WHERE tenant_id = $1 AND session_id = $2 AND status = 'OPEN'`,
      [this.tenantId, sessionId, status, now],
    );
  }

  async insertScan(row: ScanRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_upload.document_scan_status (
         tenant_id, scan_id, document_id, attempt_no, verdict, engine_ref, scanner_mode, simulation, scanned_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        this.tenantId,
        row.scan_id,
        row.document_id,
        row.attempt_no,
        row.verdict,
        row.engine_ref,
        row.scanner_mode,
        row.simulation === null ? null : JSON.stringify(row.simulation),
        row.scanned_at,
      ],
    );
  }

  async recordInbox(consumerGroup: string, eventId: string): Promise<boolean> {
    const r = await this.c.query(
      `INSERT INTO sf_upload.inbox_event (consumer_group, event_id, tenant_id)
       VALUES ($1,$2,$3) ON CONFLICT (consumer_group, event_id) DO NOTHING`,
      [consumerGroup, eventId, this.tenantId],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async inboxSeen(consumerGroup: string, eventId: string): Promise<boolean> {
    const r = await this.c.query(
      `SELECT 1 FROM sf_upload.inbox_event
        WHERE tenant_id = $1 AND consumer_group = $2 AND event_id = $3`,
      [this.tenantId, consumerGroup, eventId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async openExpiredSessions(now: string, limit: number): Promise<SessionRow[]> {
    const r = await this.c.query(
      `SELECT * FROM sf_upload.upload_session
        WHERE tenant_id = $1 AND status = 'OPEN' AND expires_at <= $2
        ORDER BY expires_at
        LIMIT $3
        FOR UPDATE SKIP LOCKED`,
      [this.tenantId, now, limit],
    );
    return r.rows.map((row) => toSession(row as Record<string, unknown>));
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_upload.outbox_event (
         event_id, tenant_id, topic, partition_key, event_type, schema_version, aggregate_type,
         aggregate_id, aggregate_version, envelope
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        envelope.event_id,
        envelope.tenant_id,
        topic,
        topic === TOPIC_AUDIT
          ? `audit:${String((envelope.data as { audit_id?: string }).audit_id ?? envelope.aggregate_id)}`
          : envelope.aggregate_id,
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

/**
 * Short, tenant-bound transactions: SF-CON-DB-SESSION-CONTEXT settings are transaction-local
 * (`set_config(..., true)`), so a pooled connection never carries a tenant between requests.
 */
export class PgUploadRepository implements UploadRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: Pool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: UploadTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp013Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp013Error('SF-SYS-001', { details: [{ code: 'NESTED_TX' }] });
    }
    const tenantId = ctx.tenant_id;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of Object.entries(dbSessionSettings(ctx))) {
        await client.query('SELECT set_config($1, $2, true)', [key, value]);
      }
      const result = await this.als.run(true, () => fn(new PgUploadTx(client, tenantId)));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection already failed */
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
