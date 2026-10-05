import { randomUUID } from 'node:crypto';
import type { RequestContext, SimulationMarker } from '@serviceform/contracts';
import { appendAudit } from '../audit.js';
import { authzInput, authorize, type AuthorizationPort } from '../authz.js';
import { classifyDocument } from '../domain/classify.js';
import { sha256Prefixed } from '../domain/fingerprint.js';
import { parseGatewayExtraction, publicFields } from '../domain/parse-extraction.js';
import { logSafe, redactText } from '../domain/redaction.js';
import { isAllowedContentType, type JobStatus } from '../domain/states.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp014Error, detail } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN, type DomainEventType } from '../outbox.js';
import type { AiGatewayPort } from '../ports/gateway-port.js';
import type { OcrPort } from '../ports/ocr-port.js';
import type { SourceAclPort, SourceDocumentPort } from '../ports/source-port.js';
import type {
  DocIntelRepository,
  DocIntelTx,
  ExtractionPolicy,
  JobPatch,
  JobRow,
} from '../repo/types.js';

export type TenantContext = RequestContext & { tenant_id: string };

export interface IntelligenceServiceDeps {
  repo: DocIntelRepository;
  authorizer: AuthorizationPort;
  sources: SourceDocumentPort;
  sourceAcl: SourceAclPort;
  ocr: OcrPort;
  gateway: AiGatewayPort;
  clock: () => Date;
}

export interface Idempotency {
  key: string;
  fingerprint: string;
  endpoint: string;
}

export interface PolicyInput {
  policy_code: string;
  allowed_content_types: string[];
  min_confidence: number;
  max_excerpt_chars: number;
  gateway_policy_id: string;
  gateway_policy_version: number;
  latency_budget_ms: number;
  status?: 'ACTIVE' | 'RETIRED';
}

export interface JobInput {
  policy_code: string;
  source_document_id: string;
  source_checksum_sha256: string;
  purpose: string;
  data_classification: 'PUBLIC' | 'INTERNAL' | 'PERSONAL' | 'SENSITIVE';
}

export interface ReviewInput {
  decision: 'CONFIRM_ASSISTIVE' | 'DISCARD';
}

export interface JobView {
  job_id: string;
  status: JobStatus;
  document_class: string | null;
  class_confidence: number | null;
  overall_confidence: number | null;
  source_document_id: string;
  source_checksum_sha256: string;
  ocr_text_hash: string | null;
  model: { provider_id: string; model_id: string; model_version: string } | null;
  prompt: { policy_id: string; policy_version: number; template_hash: string } | null;
  gateway_request_id: string | null;
  fields: { name: string; value?: string; value_hash: string; confidence: number }[];
  provenance: Record<string, unknown>;
  rejection_code: string | null;
  review_decision: string | null;
  advisory_only: true;
  statutory_decision: false;
  evidence_satisfied: false;
  entitlement_issued: false;
  simulation: SimulationMarker | null;
}

export class IntelligenceService {
  constructor(private readonly deps: IntelligenceServiceDeps) {}

  private external<T>(op: string, fn: () => Promise<T>): Promise<T> {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp014Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }, { code: op }] });
    }
    return fn();
  }

  private view(row: JobRow, includeValues: boolean): JobView {
    const model =
      row.provider_id && row.model_id && row.model_version
        ? { provider_id: row.provider_id, model_id: row.model_id, model_version: row.model_version }
        : null;
    const prompt =
      row.prompt_id && row.prompt_version !== null && row.prompt_hash
        ? {
            policy_id: row.prompt_id,
            policy_version: row.prompt_version,
            template_hash: row.prompt_hash,
          }
        : null;
    return {
      job_id: row.job_id,
      status: row.status,
      document_class: row.document_class,
      class_confidence: row.class_confidence,
      overall_confidence: row.overall_confidence,
      source_document_id: row.source_document_id,
      source_checksum_sha256: row.source_checksum_sha256,
      ocr_text_hash: row.ocr_text_hash,
      model,
      prompt,
      gateway_request_id: row.gateway_request_id,
      fields: includeValues
        ? row.extracted_fields.map((f) => ({
            name: f.name,
            value: f.value,
            value_hash: f.value_hash,
            confidence: f.confidence,
          }))
        : publicFields(row.extracted_fields),
      provenance: row.provenance,
      rejection_code: row.rejection_code,
      review_decision: row.review_decision,
      advisory_only: true,
      statutory_decision: false,
      evidence_satisfied: false,
      entitlement_issued: false,
      simulation: row.simulation,
    };
  }

  private async emit(
    tx: DocIntelTx,
    ctx: TenantContext,
    row: JobRow,
    type: DomainEventType,
    extra: Record<string, unknown>,
    now: Date,
  ): Promise<void> {
    const env = envelopeOf({
      eventType: type,
      tenantId: ctx.tenant_id,
      cellId: ctx.cell_id,
      aggregateType: 'IntelligenceJob',
      aggregateId: row.job_id,
      aggregateVersion: row.aggregate_version,
      occurredAt: now.toISOString(),
      correlationId: ctx.correlation_id,
      actor: ctx.actor,
      data: {
        job_id: row.job_id,
        source_document_id: row.source_document_id,
        source_checksum_sha256: row.source_checksum_sha256,
        status: row.status,
        advisory_only: true,
        statutory_decision: false,
        ...extra,
      },
    });
    await tx.insertOutbox(env, TOPIC_DOMAIN);
  }

  async createPolicy(
    ctx: TenantContext,
    input: PolicyInput,
    idem: Idempotency,
  ): Promise<{ status: number; body: unknown }> {
    await this.external('AUTHZ', () =>
      authorize(this.deps.authorizer, authzInput(ctx, 'DOCINTEL_POLICY', 'ExtractionPolicy')),
    );
    for (const type of input.allowed_content_types) {
      if (!isAllowedContentType(type)) {
        throw new Cmp014Error('SF-SYS-003', detail('CONTENT_TYPE_NOT_ALLOWED'));
      }
    }
    const now = this.deps.clock();
    return this.deps.repo.withTx(ctx, async (tx) => {
      const claimed = await tx.claimIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        fingerprint: idem.fingerprint,
        now,
      });
      if (claimed !== 'claimed') return claimed;
      const latest = await tx.latestPolicy(input.policy_code);
      const version_no = (latest?.version_no ?? 0) + 1;
      const policy: ExtractionPolicy = {
        policy_id: randomUUID(),
        policy_code: input.policy_code,
        version_no,
        status: input.status ?? 'ACTIVE',
        allowed_content_types: input.allowed_content_types,
        min_confidence: input.min_confidence,
        max_excerpt_chars: input.max_excerpt_chars,
        gateway_policy_id: input.gateway_policy_id,
        gateway_policy_version: input.gateway_policy_version,
        latency_budget_ms: input.latency_budget_ms,
      };
      await tx.insertPolicy({ ...policy, created_by: ctx.actor.id });
      await appendAudit(tx, ctx, {
        action: 'DOCINTEL_POLICY_CREATED',
        actionClass: 'WRITE',
        resourceType: 'ExtractionPolicy',
        resourceId: policy.policy_id,
        result: 'SUCCESS',
        now,
      });
      const body = { policy_id: policy.policy_id, version_no, status: policy.status };
      await tx.completeIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        status: 201,
        body,
      });
      return { status: 201, body };
    });
  }

  async createJob(
    ctx: TenantContext,
    input: JobInput,
    idem: Idempotency,
  ): Promise<{ status: number; body: unknown }> {
    if (!isUuid(input.source_document_id) || !/^[0-9a-f]{64}$/.test(input.source_checksum_sha256)) {
      throw new Cmp014Error('SF-SYS-003', detail('SOURCE_DOCUMENT_REF'));
    }
    await this.external('AUTHZ', () =>
      authorize(this.deps.authorizer, authzInput(ctx, 'DOCINTEL_CREATE', 'IntelligenceJob')),
    );
    const acl = await this.external('SOURCE_ACL', () =>
      this.deps.sourceAcl.canRead({
        tenantId: ctx.tenant_id,
        actorId: ctx.actor.id,
        sourceId: input.source_document_id,
      }),
    );
    if (!acl) throw new Cmp014Error('SF-AUTH-002', detail('SOURCE_ACL_DENIED'));
    const source = await this.external('SOURCE_RESOLVE', () =>
      this.deps.sources.resolve({
        tenantId: ctx.tenant_id,
        documentId: input.source_document_id,
        checksumSha256: input.source_checksum_sha256,
      }),
    );
    if (!source || source.tenantId !== ctx.tenant_id || source.status !== 'AVAILABLE') {
      throw new Cmp014Error('SF-SYS-002', detail('SOURCE_DOCUMENT_UNAVAILABLE'));
    }
    const now = this.deps.clock();
    const simulation = this.deps.ocr.simulation;
    if (!simulation) throw new Cmp014Error('SF-INT-001', detail('SIMULATION_MARKER_REQUIRED'));
    return this.deps.repo.withTx(ctx, async (tx) => {
      const claimed = await tx.claimIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        fingerprint: idem.fingerprint,
        now,
      });
      if (claimed !== 'claimed') return claimed;
      const policy = await tx.latestPolicy(input.policy_code);
      if (!policy || policy.status !== 'ACTIVE') {
        throw new Cmp014Error('SF-SYS-003', detail('EXTRACTION_POLICY_UNAVAILABLE'));
      }
      if (!policy.allowed_content_types.includes(source.contentType)) {
        throw new Cmp014Error('SF-SYS-003', detail('CONTENT_TYPE_NOT_ALLOWED'));
      }
      const jobId = randomUUID();
      await tx.insertJob({
        job_id: jobId,
        cell_id: ctx.cell_id,
        policy_id: policy.policy_id,
        source_document_id: source.documentId,
        source_checksum_sha256: source.checksumSha256,
        source_content_type: source.contentType,
        purpose: input.purpose,
        data_classification: input.data_classification,
        ocr_mode: 'SIMULATED',
        simulation,
        now: now.toISOString(),
      });
      const row = await tx.getJob(jobId);
      if (!row) throw new Cmp014Error('SF-SYS-001');
      await this.emit(tx, ctx, row, 'IntelligenceJobAccepted', {}, now);
      await appendAudit(tx, ctx, {
        action: 'DOCINTEL_JOB_ACCEPTED',
        actionClass: 'WRITE',
        resourceType: 'IntelligenceJob',
        resourceId: jobId,
        result: 'SUCCESS',
        now,
      });
      const body = this.view(row, false);
      await tx.completeIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        status: 201,
        body,
      });
      return { status: 201, body };
    });
  }

  async getJob(ctx: TenantContext, jobId: string): Promise<JobView> {
    if (!isUuid(jobId)) throw new Cmp014Error('SF-SYS-003', detail('JOB_ID'));
    await this.external('AUTHZ', () =>
      authorize(this.deps.authorizer, authzInput(ctx, 'DOCINTEL_READ', 'IntelligenceJob')),
    );
    return this.deps.repo.withTx(ctx, async (tx) => {
      const row = await tx.getJob(jobId);
      if (!row) throw new Cmp014Error('SF-SYS-002');
      return this.view(row, true);
    });
  }

  async processJob(ctx: TenantContext, jobId: string): Promise<JobView> {
    if (!isUuid(jobId)) throw new Cmp014Error('SF-SYS-003', detail('JOB_ID'));
    await this.external('AUTHZ', () =>
      authorize(this.deps.authorizer, authzInput(ctx, 'DOCINTEL_CREATE', 'IntelligenceJob')),
    );
    const loaded = await this.deps.repo.withTx(ctx, (tx) => tx.getJob(jobId));
    if (!loaded) throw new Cmp014Error('SF-SYS-002');
    if (!['ACCEPTED', 'CLASSIFYING'].includes(loaded.status)) return this.view(loaded, true);

    const policy = await this.deps.repo.withTx(ctx, (tx) => tx.policyById(loaded.policy_id));
    if (!policy) throw new Cmp014Error('SF-SYS-003', detail('EXTRACTION_POLICY_UNAVAILABLE'));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.latency_budget_ms);
    let ocr;
    try {
      ocr = await this.external('OCR', () =>
        this.deps.ocr.recognize({
          tenantId: ctx.tenant_id,
          documentId: loaded.source_document_id,
          checksumSha256: loaded.source_checksum_sha256,
          contentType: loaded.source_content_type,
          signal: controller.signal,
        }),
      );
    } finally {
      clearTimeout(timer);
    }

    if (
      ocr.scenario === 'unsupported' ||
      ocr.scenario === 'malformed' ||
      ocr.scenario === 'empty'
    ) {
      return this.failOrReject(ctx, jobId, 'REJECTED', ocr.scenario.toUpperCase());
    }

    const classified = classifyDocument({
      contentType: loaded.source_content_type,
      ocrText: ocr.text,
    });
    const redacted = redactText(ocr.text);
    const excerpt = redacted.text.slice(0, policy.max_excerpt_chars);
    const ocrHash = sha256Prefixed(ocr.text);
    const now = this.deps.clock();

    if (loaded.status === 'ACCEPTED') {
      await this.deps.repo.withTx(ctx, async (tx) => {
        const locked = await tx.lockJob(jobId);
        if (!locked || locked.status !== 'ACCEPTED') return;
        const patch: JobPatch = {
          status: 'CLASSIFYING',
          document_class: classified.documentClass,
          class_confidence: classified.confidence,
          ocr_text_hash: ocrHash,
          ocr_confidence: ocr.confidence,
          redaction_summary: redacted.summary,
          now: now.toISOString(),
        };
        await tx.updateJob(jobId, patch);
        const row = await tx.getJob(jobId);
        if (!row) throw new Cmp014Error('SF-SYS-001');
        await this.emit(
          tx,
          ctx,
          row,
          'IntelligenceJobClassified',
          {
            document_class: row.document_class,
            class_confidence: row.class_confidence,
            ocr_text_hash: row.ocr_text_hash,
          },
          now,
        );
      });
    }

    const gwController = new AbortController();
    const gwTimer = setTimeout(() => gwController.abort(), policy.latency_budget_ms);
    let gw;
    try {
      gw = await this.external('GATEWAY', () =>
        this.deps.gateway.invoke(
          ctx,
          {
            policy_id: policy.gateway_policy_id,
            policy_version: policy.gateway_policy_version,
            purpose: loaded.purpose,
            data_classification: loaded.data_classification,
            caller_component: 'CMP-014',
            variables: {
              document_class: classified.documentClass,
              redacted_excerpt: excerpt,
              ocr_text_hash: ocrHash,
            },
            sources: [{ source_id: loaded.source_document_id, tenant_id: ctx.tenant_id }],
          },
          gwController.signal,
        ),
      );
    } finally {
      clearTimeout(gwTimer);
    }

    if (!gw.ok) {
      const code =
        gw.kind === 'DENIED'
          ? 'GATEWAY_DENIED'
          : gw.kind === 'TIMEOUT'
            ? 'GATEWAY_TIMEOUT'
            : gw.kind === 'UNSAFE'
              ? 'UNSAFE_OUTPUT'
              : 'GATEWAY_UNAVAILABLE';
      return this.failOrReject(ctx, jobId, 'FAILED', code, gw.kind === 'DENIED' ? 403 : 503);
    }

    const parsed = parseGatewayExtraction(gw.output_text, sha256Prefixed);
    if (parsed.unsafe) {
      return this.failOrReject(ctx, jobId, 'FAILED', 'UNSAFE_OUTPUT');
    }
    const overall = Math.min(ocr.confidence, classified.confidence, parsed.overall);
    const terminal: JobStatus = overall < policy.min_confidence ? 'NEEDS_REVIEW' : 'COMPLETED';
    const extractedAt = this.deps.clock();

    return this.deps.repo.withTx(ctx, async (tx) => {
      const locked = await tx.lockJob(jobId);
      if (!locked) throw new Cmp014Error('SF-SYS-002');
      if (locked.status !== 'CLASSIFYING') return this.view(locked, true);
      await tx.updateJob(jobId, { status: 'EXTRACTING', now: extractedAt.toISOString() });
      const provenance = {
        source_document_id: locked.source_document_id,
        source_checksum_sha256: locked.source_checksum_sha256,
        ocr_text_hash: ocrHash,
        model: gw.model,
        prompt: {
          policy_id: policy.gateway_policy_id,
          policy_version: policy.gateway_policy_version,
          template_hash: gw.prompt_hash,
        },
        gateway_request_id: gw.request_id,
      };
      await tx.updateJob(jobId, {
        status: terminal,
        overall_confidence: overall,
        extracted_fields: parsed.fields,
        provider_id: gw.model.provider_id,
        model_id: gw.model.model_id,
        model_version: gw.model.model_version,
        prompt_id: policy.gateway_policy_id,
        prompt_version: policy.gateway_policy_version,
        prompt_hash: gw.prompt_hash,
        gateway_request_id: gw.request_id,
        provenance,
        now: extractedAt.toISOString(),
      });
      const row = await tx.getJob(jobId);
      if (!row) throw new Cmp014Error('SF-SYS-001');
      await this.emit(
        tx,
        ctx,
        row,
        'IntelligenceJobExtracted',
        {
          field_count: parsed.fields.length,
          overall_confidence: overall,
          ocr_text_hash: ocrHash,
          model_id: gw.model.model_id,
          model_version: gw.model.model_version,
          prompt_id: policy.gateway_policy_id,
          prompt_version: policy.gateway_policy_version,
          prompt_hash: gw.prompt_hash,
          fields: publicFields(parsed.fields),
        },
        extractedAt,
      );
      await this.emit(
        tx,
        ctx,
        row,
        terminal === 'NEEDS_REVIEW' ? 'IntelligenceJobNeedsReview' : 'IntelligenceJobCompleted',
        { overall_confidence: overall },
        extractedAt,
      );
      await appendAudit(tx, ctx, {
        action: terminal === 'NEEDS_REVIEW' ? 'DOCINTEL_NEEDS_REVIEW' : 'DOCINTEL_COMPLETED',
        actionClass: 'WRITE',
        resourceType: 'IntelligenceJob',
        resourceId: jobId,
        result: 'SUCCESS',
        now: extractedAt,
      });
      return this.view(row, true);
    });
  }

  private async failOrReject(
    ctx: TenantContext,
    jobId: string,
    status: 'FAILED' | 'REJECTED',
    code: string,
    http?: number,
  ): Promise<JobView> {
    const now = this.deps.clock();
    const view = await this.deps.repo.withTx(ctx, async (tx) => {
      const locked = await tx.lockJob(jobId);
      if (!locked) throw new Cmp014Error('SF-SYS-002');
      if (locked.status === 'FAILED' || locked.status === 'REJECTED')
        return this.view(locked, true);
      await tx.updateJob(jobId, {
        status,
        rejection_code: code,
        now: now.toISOString(),
      });
      const row = await tx.getJob(jobId);
      if (!row) throw new Cmp014Error('SF-SYS-001');
      await this.emit(
        tx,
        ctx,
        row,
        status === 'REJECTED' ? 'IntelligenceJobRejected' : 'IntelligenceJobFailed',
        { rejection_code: code },
        now,
      );
      return this.view(row, true);
    });
    if (http === 403) throw new Cmp014Error('SF-AUTH-002', detail(code));
    if (http === 503) {
      throw new Cmp014Error(code === 'GATEWAY_TIMEOUT' ? 'SF-AI-001' : 'SF-AI-001', detail(code));
    }
    return view;
  }

  async reviewJob(ctx: TenantContext, jobId: string, input: ReviewInput): Promise<JobView> {
    if (!isUuid(jobId)) throw new Cmp014Error('SF-SYS-003', detail('JOB_ID'));
    await this.external('AUTHZ', () =>
      authorize(this.deps.authorizer, authzInput(ctx, 'DOCINTEL_REVIEW', 'IntelligenceJob')),
    );
    const now = this.deps.clock();
    return this.deps.repo.withTx(ctx, async (tx) => {
      const locked = await tx.lockJob(jobId);
      if (!locked) throw new Cmp014Error('SF-SYS-002');
      if (locked.status !== 'NEEDS_REVIEW') {
        throw new Cmp014Error('SF-APP-001', detail('REVIEW_NOT_APPLICABLE'));
      }
      await tx.updateJob(jobId, {
        status: 'REVIEWED',
        review_decision: input.decision,
        reviewed_by: ctx.actor.id,
        reviewed_at: now.toISOString(),
        now: now.toISOString(),
      });
      const row = await tx.getJob(jobId);
      if (!row) throw new Cmp014Error('SF-SYS-001');
      await this.emit(
        tx,
        ctx,
        row,
        'IntelligenceJobReviewed',
        { review_decision: input.decision, advisory_only: true, statutory_decision: false },
        now,
      );
      await appendAudit(tx, ctx, {
        action: 'DOCINTEL_REVIEWED',
        actionClass: 'WRITE',
        resourceType: 'IntelligenceJob',
        resourceId: jobId,
        result: 'SUCCESS',
        reason: input.decision,
        now,
      });
      return this.view(row, true);
    });
  }

  logRecord(jobId: string, status: string, reason?: string): Record<string, unknown> {
    return logSafe({
      job_id: jobId,
      status,
      reason_code: reason,
      tenant_present: true,
    });
  }
}
