import { AsyncLocalStorage } from 'node:async_hooks';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import type { ArtifactRow, CredentialRow } from '../domain/credential.js';
import type { DownstreamChannel, DownstreamOutcomeRow } from '../domain/outcome.js';
import type { SigningRecordRow } from '../domain/signing.js';
import { Cmp022Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { SimulationMarker } from '../ports/signing-port.js';
import type { EventEnvelope, RequestContext } from '../types.js';
import type {
  CredentialRepository,
  CredentialTx,
  IdempotencyPeek,
  StoredIdempotent,
} from './types.js';

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

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const CREDENTIAL_COLS = `tenant_id, credential_id, application_id, cell_id, tenant_service_binding_id,
  service_version_id, credential_template_id, credential_template_version, lifecycle_status,
  issuance_key, idempotency_key, approval_decision_ref, signing_record_id, correlation_id,
  actor_type, created_by, generated_at, signed_at, issued_at`;
const SELECT_CREDENTIAL = `SELECT ${CREDENTIAL_COLS} FROM sf_credential.credential`;

const SIGNING_COLS = `tenant_id, signing_record_id, credential_id, connector_binding_id,
  connector_mode, simulation_marker, signing_result, signature_ref, signed_artifact_sha256,
  provider_transaction_ref, failure_code, attempt_number, idempotency_key, recorded_at,
  correlation_id`;

const SELECT_SIGNING = `SELECT ${SIGNING_COLS} FROM sf_credential.signing_record`;

const OUTCOME_COLS = `tenant_id, outcome_id, credential_id, channel, outcome, outcome_ref,
  failure_code, actor_type, recorded_by, correlation_id, recorded_at`;
const SELECT_OUTCOME = `SELECT ${OUTCOME_COLS} FROM sf_credential.downstream_outcome`;
const INSERT_OUTCOME = `INSERT INTO sf_credential.downstream_outcome (${OUTCOME_COLS})
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  ON CONFLICT (tenant_id, credential_id, channel, outcome_ref) DO NOTHING`;

function toCredential(r: Record<string, unknown>): CredentialRow {
  return {
    tenant_id: String(r['tenant_id']),
    credential_id: String(r['credential_id']),
    application_id: String(r['application_id']),
    cell_id: String(r['cell_id']),
    tenant_service_binding_id: String(r['tenant_service_binding_id']),
    service_version_id: String(r['service_version_id']),
    credential_template_id: String(r['credential_template_id']),
    credential_template_version: Number(r['credential_template_version']),
    lifecycle_status: r['lifecycle_status'] as CredentialRow['lifecycle_status'],
    issuance_key: String(r['issuance_key']),
    idempotency_key: String(r['idempotency_key']),
    approval_decision_ref: String(r['approval_decision_ref']),
    signing_record_id: strOrNull(r['signing_record_id']),
    correlation_id: String(r['correlation_id']),
    actor_type: r['actor_type'] as CredentialRow['actor_type'],
    created_by: String(r['created_by']),
    generated_at: iso(r['generated_at']),
    signed_at: isoOrNull(r['signed_at']),
    issued_at: isoOrNull(r['issued_at']),
  };
}

function toArtifact(r: Record<string, unknown>): ArtifactRow {
  return {
    credential_id: String(r['credential_id']),
    artifact_kind: r['artifact_kind'] as ArtifactRow['artifact_kind'],
    storage_key: String(r['storage_key']),
    sha256: String(r['sha256']),
  };
}

function toSigning(r: Record<string, unknown>): SigningRecordRow {
  return {
    tenant_id: String(r['tenant_id']),
    signing_record_id: String(r['signing_record_id']),
    credential_id: String(r['credential_id']),
    connector_binding_id: String(r['connector_binding_id']),
    connector_mode: r['connector_mode'] as SigningRecordRow['connector_mode'],
    simulation_marker: (r['simulation_marker'] ?? null) as SimulationMarker | null,
    signing_result: r['signing_result'] as SigningRecordRow['signing_result'],
    signature_ref: strOrNull(r['signature_ref']),
    signed_artifact_sha256: strOrNull(r['signed_artifact_sha256']),
    provider_transaction_ref: strOrNull(r['provider_transaction_ref']),
    failure_code: strOrNull(r['failure_code']),
    attempt_number: Number(r['attempt_number']),
    idempotency_key: String(r['idempotency_key']),
    recorded_at: iso(r['recorded_at']),
    correlation_id: String(r['correlation_id']),
  };
}

function toOutcome(r: Record<string, unknown>): DownstreamOutcomeRow {
  return {
    tenant_id: String(r['tenant_id']),
    outcome_id: String(r['outcome_id']),
    credential_id: String(r['credential_id']),
    channel: r['channel'] as DownstreamOutcomeRow['channel'],
    outcome: r['outcome'] as DownstreamOutcomeRow['outcome'],
    outcome_ref: String(r['outcome_ref']),
    failure_code: strOrNull(r['failure_code']),
    actor_type: r['actor_type'] as DownstreamOutcomeRow['actor_type'],
    recorded_by: String(r['recorded_by']),
    correlation_id: String(r['correlation_id']),
    recorded_at: iso(r['recorded_at']),
  };
}

class PgTx implements CredentialTx {
  constructor(
    private readonly c: SqlClient,
    private readonly tenantId: string,
  ) {}

  async peekIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
  }): Promise<IdempotencyPeek | undefined> {
    const r = await this.c.query<{
      request_fingerprint: string;
      status: IdempotencyPeek['status'];
      response_status: number | null;
      response_body: unknown;
    }>(
      `SELECT request_fingerprint, status, response_status, response_body
         FROM sf_credential.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    return r.rows[0];
  }

  async claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<StoredIdempotent | 'claimed'> {
    const expires = new Date(p.now.getTime() + IDEMPOTENCY_TTL_MS);
    const inserted = await this.c.query(
      `INSERT INTO sf_credential.idempotency_record (
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
    const row = await this.peekIdempotency(p);
    if (!row) throw new Cmp022Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp022Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp022Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_credential.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async insertCredential(row: CredentialRow): Promise<boolean> {
    const r = await this.c.query(
      `INSERT INTO sf_credential.credential (
         tenant_id, credential_id, application_id, cell_id, tenant_service_binding_id,
         service_version_id, credential_template_id, credential_template_version,
         lifecycle_status, issuance_key, idempotency_key, approval_decision_ref, correlation_id,
         actor_type, created_by, generated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'GENERATED',$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT DO NOTHING`,
      [
        row.tenant_id,
        row.credential_id,
        row.application_id,
        row.cell_id,
        row.tenant_service_binding_id,
        row.service_version_id,
        row.credential_template_id,
        row.credential_template_version,
        row.issuance_key,
        row.idempotency_key,
        row.approval_decision_ref,
        row.correlation_id,
        row.actor_type,
        row.created_by,
        row.generated_at,
      ],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async getCredential(credentialId: string): Promise<CredentialRow | undefined> {
    const r = await this.c.query(
      SELECT_CREDENTIAL + ' WHERE tenant_id = $1 AND credential_id = $2',
      [this.tenantId, credentialId],
    );
    return r.rows[0] ? toCredential(r.rows[0]) : undefined;
  }

  async lockCredential(credentialId: string): Promise<CredentialRow | undefined> {
    const r = await this.c.query(
      SELECT_CREDENTIAL + ' WHERE tenant_id = $1 AND credential_id = $2 FOR UPDATE',
      [this.tenantId, credentialId],
    );
    return r.rows[0] ? toCredential(r.rows[0]) : undefined;
  }

  async listByApplication(applicationId: string): Promise<CredentialRow[]> {
    const r = await this.c.query(
      SELECT_CREDENTIAL +
        ' WHERE tenant_id = $1 AND application_id = $2 ORDER BY generated_at, credential_id',
      [this.tenantId, applicationId],
    );
    return r.rows.map(toCredential);
  }

  async insertArtifact(row: ArtifactRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_credential.credential_artifact (
         tenant_id, credential_id, artifact_kind, storage_key, sha256
       ) VALUES ($1,$2,$3,$4,$5)`,
      [this.tenantId, row.credential_id, row.artifact_kind, row.storage_key, row.sha256],
    );
  }

  async listArtifacts(credentialId: string): Promise<ArtifactRow[]> {
    const r = await this.c.query(
      `SELECT credential_id, artifact_kind, storage_key, sha256
         FROM sf_credential.credential_artifact
        WHERE tenant_id = $1 AND credential_id = $2 ORDER BY artifact_kind DESC`,
      [this.tenantId, credentialId],
    );
    return r.rows.map(toArtifact);
  }

  async insertSigningRecord(row: SigningRecordRow): Promise<boolean> {
    const r = await this.c.query(
      `INSERT INTO sf_credential.signing_record (
         tenant_id, signing_record_id, credential_id, connector_binding_id, connector_mode,
         simulation_marker, signing_result, signature_ref, signed_artifact_sha256,
         provider_transaction_ref, failure_code, attempt_number, idempotency_key, recorded_at,
         correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (tenant_id, credential_id, attempt_number) DO NOTHING`,
      [
        row.tenant_id,
        row.signing_record_id,
        row.credential_id,
        row.connector_binding_id,
        row.connector_mode,
        row.simulation_marker === null ? null : JSON.stringify(row.simulation_marker),
        row.signing_result,
        row.signature_ref,
        row.signed_artifact_sha256,
        row.provider_transaction_ref,
        row.failure_code,
        row.attempt_number,
        row.idempotency_key,
        row.recorded_at,
        row.correlation_id,
      ],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async listSigningRecords(credentialId: string): Promise<SigningRecordRow[]> {
    const r = await this.c.query(
      SELECT_SIGNING + ' WHERE tenant_id = $1 AND credential_id = $2 ORDER BY attempt_number',
      [this.tenantId, credentialId],
    );
    return r.rows.map(toSigning);
  }

  async markSigned(
    credentialId: string,
    signingRecordId: string,
    signedAt: string,
  ): Promise<boolean> {
    const r = await this.c.query(
      `UPDATE sf_credential.credential
          SET lifecycle_status = 'SIGNED', signing_record_id = $3, signed_at = $4
        WHERE tenant_id = $1 AND credential_id = $2 AND lifecycle_status = 'GENERATED'`,
      [this.tenantId, credentialId, signingRecordId, signedAt],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async markIssued(credentialId: string, issuedAt: string): Promise<boolean> {
    const r = await this.c.query(
      `UPDATE sf_credential.credential
          SET lifecycle_status = 'ISSUED', issued_at = $3
        WHERE tenant_id = $1 AND credential_id = $2 AND lifecycle_status = 'SIGNED'`,
      [this.tenantId, credentialId, issuedAt],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async insertDownstreamOutcome(row: DownstreamOutcomeRow): Promise<boolean> {
    const r = await this.c.query(INSERT_OUTCOME, [
      row.tenant_id,
      row.outcome_id,
      row.credential_id,
      row.channel,
      row.outcome,
      row.outcome_ref,
      row.failure_code,
      row.actor_type,
      row.recorded_by,
      row.correlation_id,
      row.recorded_at,
    ]);
    return (r.rowCount ?? 0) === 1;
  }

  async findDownstreamOutcome(
    credentialId: string,
    channel: DownstreamChannel,
    outcomeRef: string,
  ): Promise<DownstreamOutcomeRow | undefined> {
    const r = await this.c.query(
      SELECT_OUTCOME +
        ' WHERE tenant_id = $1 AND credential_id = $2 AND channel = $3 AND outcome_ref = $4',
      [this.tenantId, credentialId, channel, outcomeRef],
    );
    return r.rows[0] ? toOutcome(r.rows[0]) : undefined;
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_credential.outbox_event (
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

export class PgCredentialRepository implements CredentialRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: CredentialTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp022Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp022Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
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
