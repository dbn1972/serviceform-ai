import { AsyncLocalStorage } from 'node:async_hooks';
import type { EventEnvelope, RequestContext } from '@serviceform/contracts';
import { Cmp014Error } from '../../src/errors.js';
import type {
  DocIntelRepository,
  DocIntelTx,
  ExtractionPolicy,
  JobPatch,
  JobRow,
  NewJob,
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
  policies: (ExtractionPolicy & { tenant_id: string })[];
  jobs: JobRow[];
  idem: IdemRow[];
  outbox: { topic: string; envelope: EventEnvelope<object> }[];
}

export function emptyState(): MemoryState {
  return { policies: [], jobs: [], idem: [], outbox: [] };
}

class MemoryTx implements DocIntelTx {
  constructor(
    private readonly s: MemoryState,
    private readonly tenant: string,
  ) {}

  async claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
  }): Promise<StoredIdempotent | 'claimed'> {
    const row = this.s.idem.find(
      (r) =>
        r.tenant_id === this.tenant &&
        r.principal_id === p.principalId &&
        r.endpoint === p.endpoint &&
        r.key === p.key,
    );
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
      throw new Cmp014Error('SF-APP-002');
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
    const row = this.s.idem.find(
      (r) =>
        r.tenant_id === this.tenant &&
        r.principal_id === p.principalId &&
        r.endpoint === p.endpoint &&
        r.key === p.key,
    );
    if (row) {
      row.status = p.status;
      row.body = structuredClone(p.body);
    }
  }

  async latestPolicy(code: string): Promise<ExtractionPolicy | null> {
    const rows = this.s.policies
      .filter((p) => p.tenant_id === this.tenant && p.policy_code === code)
      .sort((a, b) => b.version_no - a.version_no);
    return rows[0] ? structuredClone(rows[0]) : null;
  }

  async policyById(id: string): Promise<ExtractionPolicy | null> {
    const row = this.s.policies.find((p) => p.tenant_id === this.tenant && p.policy_id === id);
    return row ? structuredClone(row) : null;
  }

  async insertPolicy(row: ExtractionPolicy & { created_by: string }): Promise<void> {
    const { created_by: _c, ...policy } = row;
    this.s.policies.push({ ...policy, tenant_id: this.tenant });
  }

  async insertJob(row: NewJob): Promise<void> {
    this.s.jobs.push({
      tenant_id: this.tenant,
      job_id: row.job_id,
      cell_id: row.cell_id,
      policy_id: row.policy_id,
      source_document_id: row.source_document_id,
      source_checksum_sha256: row.source_checksum_sha256,
      source_content_type: row.source_content_type,
      purpose: row.purpose,
      data_classification: row.data_classification,
      status: 'ACCEPTED',
      document_class: null,
      class_confidence: null,
      overall_confidence: null,
      ocr_text_hash: null,
      ocr_confidence: null,
      redaction_summary: {},
      extracted_fields: [],
      provider_id: null,
      model_id: null,
      model_version: null,
      prompt_id: null,
      prompt_version: null,
      prompt_hash: null,
      gateway_request_id: null,
      provenance: {},
      rejection_code: null,
      review_decision: null,
      reviewed_by: null,
      reviewed_at: null,
      ocr_mode: 'SIMULATED',
      simulation: row.simulation,
      advisory_only: true,
      statutory_decision: false,
      evidence_satisfied: false,
      entitlement_issued: false,
      aggregate_version: 1,
      created_at: row.now,
      updated_at: row.now,
    });
  }

  private job(id: string): JobRow | undefined {
    return this.s.jobs.find((j) => j.tenant_id === this.tenant && j.job_id === id);
  }

  async getJob(id: string): Promise<JobRow | null> {
    const row = this.job(id);
    return row ? structuredClone(row) : null;
  }

  async lockJob(id: string): Promise<JobRow | null> {
    return this.getJob(id);
  }

  async updateJob(id: string, patch: JobPatch): Promise<void> {
    const row = this.job(id);
    if (!row) return;
    row.status = patch.status;
    if (patch.document_class !== undefined) row.document_class = patch.document_class;
    if (patch.class_confidence !== undefined) row.class_confidence = patch.class_confidence;
    if (patch.overall_confidence !== undefined) row.overall_confidence = patch.overall_confidence;
    if (patch.ocr_text_hash !== undefined) row.ocr_text_hash = patch.ocr_text_hash;
    if (patch.ocr_confidence !== undefined) row.ocr_confidence = patch.ocr_confidence;
    if (patch.redaction_summary !== undefined) row.redaction_summary = patch.redaction_summary;
    if (patch.extracted_fields !== undefined) row.extracted_fields = patch.extracted_fields;
    if (patch.provider_id !== undefined) row.provider_id = patch.provider_id;
    if (patch.model_id !== undefined) row.model_id = patch.model_id;
    if (patch.model_version !== undefined) row.model_version = patch.model_version;
    if (patch.prompt_id !== undefined) row.prompt_id = patch.prompt_id;
    if (patch.prompt_version !== undefined) row.prompt_version = patch.prompt_version;
    if (patch.prompt_hash !== undefined) row.prompt_hash = patch.prompt_hash;
    if (patch.gateway_request_id !== undefined) row.gateway_request_id = patch.gateway_request_id;
    if (patch.provenance !== undefined) row.provenance = patch.provenance;
    if (patch.rejection_code !== undefined) row.rejection_code = patch.rejection_code;
    if (patch.review_decision !== undefined) row.review_decision = patch.review_decision;
    if (patch.reviewed_by !== undefined) row.reviewed_by = patch.reviewed_by;
    if (patch.reviewed_at !== undefined) row.reviewed_at = patch.reviewed_at;
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

export class MemoryDocIntelRepository implements DocIntelRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(readonly state: MemoryState = emptyState()) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: DocIntelTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp014Error('SF-TEN-001');
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
      .filter((o) => o.topic === 'sf.docintel.events.v1')
      .map((o) => o.envelope);
  }
}
