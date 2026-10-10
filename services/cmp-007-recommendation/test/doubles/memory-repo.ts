import { AsyncLocalStorage } from 'node:async_hooks';
import type { EventEnvelope, RequestContext } from '@serviceform/contracts';
import { canTransition } from '../../src/domain/states.js';
import { Cmp007Error } from '../../src/errors.js';
import type {
  NewRecommendation,
  RecommendationPatch,
  RecommendationPolicy,
  RecommendationRepository,
  RecommendationRow,
  RecommendationTx,
  StoredIdempotent,
} from '../../src/repo/types.js';

interface IdemRow {
  tenant_id: string;
  principal_id: string;
  endpoint: string;
  key: string;
  fingerprint: string;
  status: number | null;
  body: unknown;
}

export interface MemoryState {
  policies: (RecommendationPolicy & { tenant_id: string })[];
  rows: RecommendationRow[];
  idem: IdemRow[];
  outbox: { topic: string; envelope: EventEnvelope<object> }[];
}

export function emptyState(): MemoryState {
  return { policies: [], rows: [], idem: [], outbox: [] };
}

class MemoryTx implements RecommendationTx {
  constructor(
    private readonly s: MemoryState,
    private readonly tenant: string,
  ) {}

  private idemRow(p: { principalId: string; endpoint: string; key: string }): IdemRow | undefined {
    return this.s.idem.find(
      (r) =>
        r.tenant_id === this.tenant &&
        r.principal_id === p.principalId &&
        r.endpoint === p.endpoint &&
        r.key === p.key,
    );
  }

  async claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
  }): Promise<StoredIdempotent | 'claimed'> {
    const row = this.idemRow(p);
    if (!row) {
      this.s.idem.push({
        tenant_id: this.tenant,
        principal_id: p.principalId,
        endpoint: p.endpoint,
        key: p.key,
        fingerprint: p.fingerprint,
        status: null,
        body: null,
      });
      return 'claimed';
    }
    if (row.fingerprint !== p.fingerprint || row.status === null) {
      throw new Cmp007Error('SF-APP-002');
    }
    return { status: row.status, body: structuredClone(row.body) };
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const row = this.idemRow(p);
    if (row) {
      row.status = p.status;
      row.body = structuredClone(p.body);
    }
  }

  async latestPolicy(code: string): Promise<RecommendationPolicy | null> {
    const rows = this.s.policies
      .filter((p) => p.tenant_id === this.tenant && p.policy_code === code)
      .sort((a, b) => b.version_no - a.version_no);
    return rows[0] ? structuredClone(rows[0]) : null;
  }

  async policyById(id: string): Promise<RecommendationPolicy | null> {
    const row = this.s.policies.find((p) => p.tenant_id === this.tenant && p.policy_id === id);
    return row ? structuredClone(row) : null;
  }

  async insertPolicy(row: RecommendationPolicy & { created_by: string }): Promise<void> {
    const { created_by: _c, ...policy } = row;
    this.s.policies.push({ ...policy, tenant_id: this.tenant });
  }

  async insertRecommendation(row: NewRecommendation): Promise<void> {
    this.s.rows.push({
      tenant_id: this.tenant,
      recommendation_id: row.recommendation_id,
      cell_id: row.cell_id,
      subject_id: row.subject_id,
      application_id: row.application_id,
      policy_id: row.policy_id,
      consent_purpose_code: row.consent_purpose_code,
      consent_ref: row.consent_ref,
      status: 'REQUESTED',
      candidates: row.candidates,
      signals: row.signals,
      items: [],
      reason_codes: [],
      model_route_ref: row.model_route_ref,
      provider_id: null,
      model_id: null,
      model_version: null,
      prompt_id: null,
      prompt_version: null,
      prompt_hash: null,
      gateway_request_id: null,
      rejection_code: null,
      disposition: null,
      selected_service_id: null,
      disposed_by: null,
      disposed_at: null,
      correlation_id: row.correlation_id,
      ai_gateway_cmp: 'CMP-039',
      non_authoritative: true,
      authoritative: false,
      statutory_decision: false,
      consent_recorded: true,
      aggregate_version: 1,
      created_at: row.now,
      updated_at: row.now,
    });
  }

  private row(id: string): RecommendationRow | undefined {
    return this.s.rows.find((r) => r.tenant_id === this.tenant && r.recommendation_id === id);
  }

  async getRecommendation(id: string): Promise<RecommendationRow | null> {
    const row = this.row(id);
    return row ? structuredClone(row) : null;
  }

  async lockRecommendation(id: string): Promise<RecommendationRow | null> {
    return this.getRecommendation(id);
  }

  async updateRecommendation(id: string, patch: RecommendationPatch): Promise<void> {
    const row = this.row(id);
    if (!row) return;
    if (!canTransition(row.status, patch.status)) {
      throw Object.assign(new Error('transition refused'), { code: 'P0001' });
    }
    row.status = patch.status;
    if (patch.items !== undefined) row.items = patch.items;
    if (patch.reason_codes !== undefined) row.reason_codes = patch.reason_codes;
    if (patch.provider_id !== undefined) row.provider_id = patch.provider_id;
    if (patch.model_id !== undefined) row.model_id = patch.model_id;
    if (patch.model_version !== undefined) row.model_version = patch.model_version;
    if (patch.prompt_id !== undefined) row.prompt_id = patch.prompt_id;
    if (patch.prompt_version !== undefined) row.prompt_version = patch.prompt_version;
    if (patch.prompt_hash !== undefined) row.prompt_hash = patch.prompt_hash;
    if (patch.gateway_request_id !== undefined) row.gateway_request_id = patch.gateway_request_id;
    if (patch.rejection_code !== undefined) row.rejection_code = patch.rejection_code;
    if (patch.disposition !== undefined) row.disposition = patch.disposition;
    if (patch.selected_service_id !== undefined)
      row.selected_service_id = patch.selected_service_id;
    if (patch.disposed_by !== undefined) row.disposed_by = patch.disposed_by;
    if (patch.disposed_at !== undefined) row.disposed_at = patch.disposed_at;
    row.aggregate_version += 1;
    row.updated_at = patch.now;
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    if (envelope.tenant_id !== this.tenant) {
      throw Object.assign(new Error('rls'), { code: '42501' });
    }
    this.s.outbox.push({ topic, envelope: structuredClone(envelope) });
  }
}

export class MemoryRecommendationRepository implements RecommendationRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(readonly state: MemoryState = emptyState()) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: RecommendationTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp007Error('SF-TEN-001');
    const snapshot = structuredClone(this.state);
    try {
      return await this.als.run(true, () => fn(new MemoryTx(this.state, ctx.tenant_id as string)));
    } catch (err) {
      Object.assign(this.state, snapshot);
      throw err;
    }
  }

  events(): EventEnvelope<object>[] {
    return this.state.outbox
      .filter((o) => o.topic === 'sf.recommendation.events.v1')
      .map((o) => o.envelope);
  }
}
