import { AsyncLocalStorage } from 'node:async_hooks';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import { TOKEN_PURPOSE, type VerificationTokenRecord } from '../domain/token.js';
import { Cmp023Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { ActorType, EventEnvelope, RequestContext } from '../types.js';
import type { QrRepository, QrTx, StoredIdempotent } from './types.js';

export interface SqlResult<R = Record<string, unknown>> {
  rows: R[];
  rowCount: number | null;
}
export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<SqlResult<R>>;
  release(): void;
}
export interface SqlPool {
  connect(): Promise<SqlClient>;
}

const isoOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function toToken(r: Record<string, unknown>): VerificationTokenRecord {
  return {
    tenant_id: String(r['tenant_id']),
    token_id: String(r['token_id']),
    credential_id: String(r['credential_id']),
    opaque_token: String(r['opaque_token']),
    credential_type_ref: String(r['credential_type_ref']),
    issuer_ref: String(r['issuer_ref']),
    issued_at: isoOrNull(r['issued_at']),
    signed_artifact_sha256: strOrNull(r['signed_artifact_sha256']),
    expires_at: isoOrNull(r['expires_at']),
    actor_type: r['actor_type'] as ActorType,
    actor_id: String(r['actor_id']),
    created_at: isoOrNull(r['created_at']) ?? '',
    correlation_id: String(r['correlation_id']),
  };
}

class PgTx implements QrTx {
  constructor(
    private readonly c: SqlClient,
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
      `INSERT INTO sf_qr.idempotency_record (
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
         FROM sf_qr.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp023Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp023Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp023Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_qr.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async insertToken(row: VerificationTokenRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_qr.verification_token (
         tenant_id, token_id, credential_id, opaque_token, credential_type_ref, issuer_ref,
         issued_at, signed_artifact_sha256, expires_at, actor_type, actor_id, created_at,
         correlation_id, token_purpose
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        row.tenant_id,
        row.token_id,
        row.credential_id,
        row.opaque_token,
        row.credential_type_ref,
        row.issuer_ref,
        row.issued_at,
        row.signed_artifact_sha256,
        row.expires_at,
        row.actor_type,
        row.actor_id,
        row.created_at,
        row.correlation_id,
        TOKEN_PURPOSE,
      ],
    );
  }

  private first(res: SqlResult): VerificationTokenRecord | undefined {
    const r = res.rows[0];
    return r ? toToken(r) : undefined;
  }

  async getToken(tokenId: string): Promise<VerificationTokenRecord | undefined> {
    const res = await this.c.query(
      `SELECT tenant_id, token_id, credential_id, opaque_token, credential_type_ref, issuer_ref,
              issued_at, signed_artifact_sha256, expires_at, actor_type, actor_id, created_at,
              correlation_id
         FROM sf_qr.verification_token
        WHERE tenant_id = $1 AND token_purpose = $2 AND token_id = $3`,
      [this.tenantId, TOKEN_PURPOSE, tokenId],
    );
    return this.first(res);
  }

  async getTokenByOpaque(opaqueToken: string): Promise<VerificationTokenRecord | undefined> {
    const res = await this.c.query(
      `SELECT tenant_id, token_id, credential_id, opaque_token, credential_type_ref, issuer_ref,
              issued_at, signed_artifact_sha256, expires_at, actor_type, actor_id, created_at,
              correlation_id
         FROM sf_qr.verification_token
        WHERE tenant_id = $1 AND token_purpose = $2 AND opaque_token = $3`,
      [this.tenantId, TOKEN_PURPOSE, opaqueToken],
    );
    return this.first(res);
  }

  async getTokenByCredential(credentialId: string): Promise<VerificationTokenRecord | undefined> {
    const res = await this.c.query(
      `SELECT tenant_id, token_id, credential_id, opaque_token, credential_type_ref, issuer_ref,
              issued_at, signed_artifact_sha256, expires_at, actor_type, actor_id, created_at,
              correlation_id
         FROM sf_qr.verification_token
        WHERE tenant_id = $1 AND token_purpose = $2 AND credential_id = $3`,
      [this.tenantId, TOKEN_PURPOSE, credentialId],
    );
    return this.first(res);
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_qr.outbox_event (
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

export class PgQrRepository implements QrRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: QrTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp023Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp023Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    const tenantId = ctx.tenant_id;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const settings: [string, string][] = [
        ['app.tenant_id', tenantId],
        ['app.cell_id', ctx.cell_id],
        ['app.actor_type', ctx.actor.type],
        ['app.actor_id', ctx.actor.id],
        ['app.correlation_id', ctx.correlation_id],
      ];
      for (const [key, value] of settings) {
        await client.query('SELECT set_config($1, $2, true)', [key, value]);
      }
      const result = await this.als.run(true, () => fn(new PgTx(client, tenantId)));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // keep original
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
