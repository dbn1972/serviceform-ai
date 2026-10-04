import { AsyncLocalStorage } from 'node:async_hooks';
import { dbSessionSettings, type EventEnvelope, type RequestContext } from '@serviceform/contracts';
import type { Pool, PoolClient } from 'pg';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import { Cmp014Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type {
  DocIntelRepository,
  DocIntelTx,
  ExtractionPolicy,
  JobPatch,
  JobRow,
  NewJob,
  StoredIdempotent,
} from './types.js';

function num(value: unknown): number {
  return Number(value);
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toPolicy(row: Record<string, unknown>): ExtractionPolicy {
  return {
    policy_id: String(row['policy_id']),
    policy_code: String(row['policy_code']),
    version_no: num(row['version_no']),
    status: row['status'] as ExtractionPolicy['status'],
    allowed_content_types: row['allowed_content_types'] as string[],
    min_confidence: num(row['min_confidence']),
    max_excerpt_chars: num(row['max_excerpt_chars']),
    gateway_policy_id: String(row['gateway_policy_id']),
    gateway_policy_version: num(row['gateway_policy_version']),
    latency_budget_ms: num(row['latency_budget_ms']),
  };
}

function toJob(row: Record<string, unknown>): JobRow {
  return {
    tenant_id: String(row['tenant_id']),
    job_id: String(row['job_id']),
    cell_id: String(row['cell_id']),
    policy_id: String(row['policy_id']),
    source_document_id: String(row['source_document_id']),
    source_checksum_sha256: String(row['source_checksum_sha256']),
    source_content_type: String(row['source_content_type']),
    purpose: String(row['purpose']),
    data_classification: row['data_classification'] as JobRow['data_classification'],
    status: row['status'] as JobRow['status'],
    document_class: (row['document_class'] as JobRow['document_class']) ?? null,
    class_confidence: numOrNull(row['class_confidence']),
    overall_confidence: numOrNull(row['overall_confidence']),
    ocr_text_hash: (row['ocr_text_hash'] as string | null) ?? null,
    ocr_confidence: numOrNull(row['ocr_confidence']),
    redaction_summary: (row['redaction_summary'] as JobRow['redaction_summary']) ?? {},
    extracted_fields: (row['extracted_fields'] as JobRow['extracted_fields']) ?? [],
    provider_id: (row['provider_id'] as string | null) ?? null,
    model_id: (row['model_id'] as string | null) ?? null,
    model_version: (row['model_version'] as string | null) ?? null,
    prompt_id: (row['prompt_id'] as string | null) ?? null,
    prompt_version: numOrNull(row['prompt_version']),
    prompt_hash: (row['prompt_hash'] as string | null) ?? null,
    gateway_request_id: (row['gateway_request_id'] as string | null) ?? null,
    provenance: (row['provenance'] as Record<string, unknown>) ?? {},
    rejection_code: (row['rejection_code'] as string | null) ?? null,
    review_decision: (row['review_decision'] as JobRow['review_decision']) ?? null,
    reviewed_by: (row['reviewed_by'] as string | null) ?? null,
    reviewed_at: row['reviewed_at'] ? iso(row['reviewed_at']) : null,
    ocr_mode: 'SIMULATED',
    simulation: (row['simulation'] as JobRow['simulation']) ?? null,
    advisory_only: true,
    statutory_decision: false,
    evidence_satisfied: false,
    entitlement_issued: false,
    aggregate_version: num(row['aggregate_version']),
    created_at: iso(row['created_at']),
    updated_at: iso(row['updated_at']),
  };
}

class PgTx implements DocIntelTx {
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
      `INSERT INTO sf_docintel.idempotency_record (
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
         FROM sf_docintel.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp014Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp014Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp014Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const ref = `sf_docintel.idempotency_record:${this.tenantId}:${p.key}`;
    await this.c.query(
      `UPDATE sf_docintel.idempotency_record
          SET status = 'COMPLETED', response_ref = $1, response_status = $2, response_body = $3::jsonb
        WHERE tenant_id = $4 AND principal_id = $5 AND endpoint = $6 AND idempotency_key = $7`,
      [ref, p.status, JSON.stringify(p.body), this.tenantId, p.principalId, p.endpoint, p.key],
    );
  }

  async latestPolicy(code: string): Promise<ExtractionPolicy | null> {
    const r = await this.c.query(
      `SELECT * FROM sf_docintel.extraction_policy
        WHERE tenant_id = $1 AND policy_code = $2
        ORDER BY version_no DESC LIMIT 1`,
      [this.tenantId, code],
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return row ? toPolicy(row) : null;
  }

  async policyById(id: string): Promise<ExtractionPolicy | null> {
    const r = await this.c.query(
      `SELECT * FROM sf_docintel.extraction_policy WHERE tenant_id = $1 AND policy_id = $2`,
      [this.tenantId, id],
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return row ? toPolicy(row) : null;
  }

  async insertPolicy(row: ExtractionPolicy & { created_by: string }): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_docintel.extraction_policy (
         tenant_id, policy_id, policy_code, version_no, status, allowed_content_types,
         min_confidence, max_excerpt_chars, gateway_policy_id, gateway_policy_version,
         latency_budget_ms, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        this.tenantId,
        row.policy_id,
        row.policy_code,
        row.version_no,
        row.status,
        row.allowed_content_types,
        row.min_confidence,
        row.max_excerpt_chars,
        row.gateway_policy_id,
        row.gateway_policy_version,
        row.latency_budget_ms,
        row.created_by,
      ],
    );
  }

  async insertJob(row: NewJob): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_docintel.intelligence_job (
         tenant_id, job_id, cell_id, policy_id, source_document_id, source_checksum_sha256,
         source_content_type, purpose, data_classification, status, ocr_mode, simulation,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACCEPTED',$10,$11::jsonb,$12,$12)`,
      [
        this.tenantId,
        row.job_id,
        row.cell_id,
        row.policy_id,
        row.source_document_id,
        row.source_checksum_sha256,
        row.source_content_type,
        row.purpose,
        row.data_classification,
        row.ocr_mode,
        JSON.stringify(row.simulation),
        row.now,
      ],
    );
  }

  async getJob(id: string): Promise<JobRow | null> {
    const r = await this.c.query(
      `SELECT * FROM sf_docintel.intelligence_job WHERE tenant_id = $1 AND job_id = $2`,
      [this.tenantId, id],
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return row ? toJob(row) : null;
  }

  async lockJob(id: string): Promise<JobRow | null> {
    const r = await this.c.query(
      `SELECT * FROM sf_docintel.intelligence_job WHERE tenant_id = $1 AND job_id = $2 FOR UPDATE`,
      [this.tenantId, id],
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return row ? toJob(row) : null;
  }

  async updateJob(id: string, patch: JobPatch): Promise<void> {
    await this.c.query(
      `UPDATE sf_docintel.intelligence_job SET
         status = $3,
         document_class = COALESCE($4, document_class),
         class_confidence = COALESCE($5, class_confidence),
         overall_confidence = COALESCE($6, overall_confidence),
         ocr_text_hash = COALESCE($7, ocr_text_hash),
         ocr_confidence = COALESCE($8, ocr_confidence),
         redaction_summary = COALESCE($9::jsonb, redaction_summary),
         extracted_fields = COALESCE($10::jsonb, extracted_fields),
         provider_id = COALESCE($11, provider_id),
         model_id = COALESCE($12, model_id),
         model_version = COALESCE($13, model_version),
         prompt_id = COALESCE($14, prompt_id),
         prompt_version = COALESCE($15, prompt_version),
         prompt_hash = COALESCE($16, prompt_hash),
         gateway_request_id = COALESCE($17, gateway_request_id),
         provenance = COALESCE($18::jsonb, provenance),
         rejection_code = COALESCE($19, rejection_code),
         review_decision = COALESCE($20, review_decision),
         reviewed_by = COALESCE($21, reviewed_by),
         reviewed_at = COALESCE($22, reviewed_at),
         aggregate_version = aggregate_version + 1,
         updated_at = $23
       WHERE tenant_id = $1 AND job_id = $2`,
      [
        this.tenantId,
        id,
        patch.status,
        patch.document_class ?? null,
        patch.class_confidence ?? null,
        patch.overall_confidence ?? null,
        patch.ocr_text_hash ?? null,
        patch.ocr_confidence ?? null,
        patch.redaction_summary ? JSON.stringify(patch.redaction_summary) : null,
        patch.extracted_fields ? JSON.stringify(patch.extracted_fields) : null,
        patch.provider_id ?? null,
        patch.model_id ?? null,
        patch.model_version ?? null,
        patch.prompt_id ?? null,
        patch.prompt_version ?? null,
        patch.prompt_hash ?? null,
        patch.gateway_request_id ?? null,
        patch.provenance ? JSON.stringify(patch.provenance) : null,
        patch.rejection_code ?? null,
        patch.review_decision ?? null,
        patch.reviewed_by ?? null,
        patch.reviewed_at ?? null,
        patch.now,
      ],
    );
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_docintel.outbox_event (
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

export class PgDocIntelRepository implements DocIntelRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: Pool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: DocIntelTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp014Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp014Error('SF-SYS-001', { details: [{ code: 'NESTED_TX' }] });
    }
    const tenantId = ctx.tenant_id;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of Object.entries(dbSessionSettings(ctx))) {
        await client.query('SELECT set_config($1, $2, true)', [key, value]);
      }
      const result = await this.als.run(true, () => fn(new PgTx(client, tenantId)));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
