import { AsyncLocalStorage } from 'node:async_hooks';
import { dbSessionSettings, type EventEnvelope, type RequestContext } from '@serviceform/contracts';
import type { Pool, PoolClient } from 'pg';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import { Cmp007Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type {
  NewRecommendation,
  RecommendationPatch,
  RecommendationPolicy,
  RecommendationRepository,
  RecommendationRow,
  RecommendationTx,
  StoredIdempotent,
} from './types.js';

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toPolicy(row: Record<string, unknown>): RecommendationPolicy {
  return {
    policy_id: String(row['policy_id']),
    policy_code: String(row['policy_code']),
    version_no: Number(row['version_no']),
    status: row['status'] as RecommendationPolicy['status'],
    consent_purpose_code: String(row['consent_purpose_code']),
    gateway_policy_id: String(row['gateway_policy_id']),
    gateway_policy_version: Number(row['gateway_policy_version']),
    model_route_ref: String(row['model_route_ref']),
    allowed_reason_codes: row['allowed_reason_codes'] as string[],
    allowed_signal_codes: row['allowed_signal_codes'] as string[],
    max_candidates: Number(row['max_candidates']),
    max_results: Number(row['max_results']),
    latency_budget_ms: Number(row['latency_budget_ms']),
  };
}

function toRecommendation(row: Record<string, unknown>): RecommendationRow {
  return {
    tenant_id: String(row['tenant_id']),
    recommendation_id: String(row['recommendation_id']),
    cell_id: String(row['cell_id']),
    subject_id: String(row['subject_id']),
    application_id: str(row['application_id']),
    policy_id: String(row['policy_id']),
    consent_purpose_code: String(row['consent_purpose_code']),
    consent_ref: str(row['consent_ref']),
    status: row['status'] as RecommendationRow['status'],
    candidates: row['candidates'] as RecommendationRow['candidates'],
    signals: (row['signals'] as string[]) ?? [],
    items: (row['items'] as RecommendationRow['items']) ?? [],
    reason_codes: (row['reason_codes'] as string[]) ?? [],
    model_route_ref: String(row['model_route_ref']),
    provider_id: str(row['provider_id']),
    model_id: str(row['model_id']),
    model_version: str(row['model_version']),
    prompt_id: str(row['prompt_id']),
    prompt_version:
      row['prompt_version'] === null || row['prompt_version'] === undefined
        ? null
        : Number(row['prompt_version']),
    prompt_hash: str(row['prompt_hash']),
    gateway_request_id: str(row['gateway_request_id']),
    rejection_code: str(row['rejection_code']),
    disposition: (row['disposition'] as RecommendationRow['disposition']) ?? null,
    selected_service_id: str(row['selected_service_id']),
    disposed_by: str(row['disposed_by']),
    disposed_at: row['disposed_at'] ? iso(row['disposed_at']) : null,
    correlation_id: String(row['correlation_id']),
    ai_gateway_cmp: 'CMP-039',
    non_authoritative: true,
    authoritative: false,
    statutory_decision: false,
    consent_recorded: true,
    aggregate_version: Number(row['aggregate_version']),
    created_at: iso(row['created_at']),
    updated_at: iso(row['updated_at']),
  };
}

class PgTx implements RecommendationTx {
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
      `INSERT INTO sf_recommendation.idempotency_record (
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
         FROM sf_recommendation.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp007Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp007Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp007Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const ref = `sf_recommendation.idempotency_record:${this.tenantId}:${p.key}`;
    await this.c.query(
      `UPDATE sf_recommendation.idempotency_record
          SET status = 'COMPLETED', response_ref = $1, response_status = $2, response_body = $3::jsonb
        WHERE tenant_id = $4 AND principal_id = $5 AND endpoint = $6 AND idempotency_key = $7`,
      [ref, p.status, JSON.stringify(p.body), this.tenantId, p.principalId, p.endpoint, p.key],
    );
  }

  async latestPolicy(code: string): Promise<RecommendationPolicy | null> {
    const r = await this.c.query(
      `SELECT * FROM sf_recommendation.recommendation_policy
        WHERE tenant_id = $1 AND policy_code = $2
        ORDER BY version_no DESC LIMIT 1`,
      [this.tenantId, code],
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return row ? toPolicy(row) : null;
  }

  async policyById(id: string): Promise<RecommendationPolicy | null> {
    const r = await this.c.query(
      `SELECT * FROM sf_recommendation.recommendation_policy WHERE tenant_id = $1 AND policy_id = $2`,
      [this.tenantId, id],
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return row ? toPolicy(row) : null;
  }

  async insertPolicy(row: RecommendationPolicy & { created_by: string }): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_recommendation.recommendation_policy (
         tenant_id, policy_id, policy_code, version_no, status, consent_purpose_code,
         gateway_policy_id, gateway_policy_version, model_route_ref, allowed_reason_codes,
         allowed_signal_codes, max_candidates, max_results, latency_budget_ms, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        this.tenantId,
        row.policy_id,
        row.policy_code,
        row.version_no,
        row.status,
        row.consent_purpose_code,
        row.gateway_policy_id,
        row.gateway_policy_version,
        row.model_route_ref,
        row.allowed_reason_codes,
        row.allowed_signal_codes,
        row.max_candidates,
        row.max_results,
        row.latency_budget_ms,
        row.created_by,
      ],
    );
  }

  async insertRecommendation(row: NewRecommendation): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_recommendation.recommendation (
         tenant_id, recommendation_id, cell_id, subject_id, application_id, policy_id,
         consent_purpose_code, consent_ref, status, candidates, signals, model_route_ref,
         correlation_id, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'REQUESTED',$9::jsonb,$10,$11,$12,$13,$13)`,
      [
        this.tenantId,
        row.recommendation_id,
        row.cell_id,
        row.subject_id,
        row.application_id,
        row.policy_id,
        row.consent_purpose_code,
        row.consent_ref,
        JSON.stringify(row.candidates),
        row.signals,
        row.model_route_ref,
        row.correlation_id,
        row.now,
      ],
    );
  }

  async getRecommendation(id: string): Promise<RecommendationRow | null> {
    const r = await this.c.query(
      `SELECT * FROM sf_recommendation.recommendation WHERE tenant_id = $1 AND recommendation_id = $2`,
      [this.tenantId, id],
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return row ? toRecommendation(row) : null;
  }

  async lockRecommendation(id: string): Promise<RecommendationRow | null> {
    const r = await this.c.query(
      `SELECT * FROM sf_recommendation.recommendation
        WHERE tenant_id = $1 AND recommendation_id = $2 FOR UPDATE`,
      [this.tenantId, id],
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return row ? toRecommendation(row) : null;
  }

  async updateRecommendation(id: string, patch: RecommendationPatch): Promise<void> {
    await this.c.query(
      `UPDATE sf_recommendation.recommendation SET
         status = $3,
         items = COALESCE($4::jsonb, items),
         reason_codes = COALESCE($5::text[], reason_codes),
         provider_id = COALESCE($6, provider_id),
         model_id = COALESCE($7, model_id),
         model_version = COALESCE($8, model_version),
         prompt_id = COALESCE($9, prompt_id),
         prompt_version = COALESCE($10, prompt_version),
         prompt_hash = COALESCE($11, prompt_hash),
         gateway_request_id = COALESCE($12, gateway_request_id),
         rejection_code = COALESCE($13, rejection_code),
         disposition = COALESCE($14, disposition),
         selected_service_id = COALESCE($15, selected_service_id),
         disposed_by = COALESCE($16, disposed_by),
         disposed_at = COALESCE($17, disposed_at),
         aggregate_version = aggregate_version + 1,
         updated_at = $18
       WHERE tenant_id = $1 AND recommendation_id = $2`,
      [
        this.tenantId,
        id,
        patch.status,
        patch.items ? JSON.stringify(patch.items) : null,
        patch.reason_codes ?? null,
        patch.provider_id ?? null,
        patch.model_id ?? null,
        patch.model_version ?? null,
        patch.prompt_id ?? null,
        patch.prompt_version ?? null,
        patch.prompt_hash ?? null,
        patch.gateway_request_id ?? null,
        patch.rejection_code ?? null,
        patch.disposition ?? null,
        patch.selected_service_id ?? null,
        patch.disposed_by ?? null,
        patch.disposed_at ?? null,
        patch.now,
      ],
    );
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_recommendation.outbox_event (
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

export class PgRecommendationRepository implements RecommendationRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: Pool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: RecommendationTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp007Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp007Error('SF-SYS-001', { details: [{ code: 'NESTED_TX' }] });
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
