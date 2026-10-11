import { randomUUID } from 'node:crypto';
import { errorEntry, type RequestContext } from '@serviceform/contracts';
import { appendAudit } from '../audit.js';
import { authzInput, authorize, type AuthorizationPort } from '../authz.js';
import { namesBindingOutcome, isValidReasonCode, isValidSignalCode } from '../domain/guard.js';
import { parseGatewayOutput } from '../domain/parse-output.js';
import type { Disposition, RecommendationStatus } from '../domain/states.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp007Error, detail } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN, type DomainEventType } from '../outbox.js';
import type { CataloguePort, CatalogueCandidate } from '../ports/catalogue-port.js';
import type { ConsentPort } from '../ports/consent-port.js';
import type { AiGatewayPort, GatewayInvokeResult } from '../ports/gateway-port.js';
import type { ProfileSignalPort } from '../ports/profile-port.js';
import type {
  CandidateSnapshot,
  RecommendationItem,
  RecommendationPolicy,
  RecommendationRepository,
  RecommendationRow,
  RecommendationTx,
} from '../repo/types.js';

export type TenantContext = RequestContext & { tenant_id: string };

export interface RecommendationServiceDeps {
  repo: RecommendationRepository;
  authorizer: AuthorizationPort;
  catalogue: CataloguePort;
  consent: ConsentPort;
  profile: ProfileSignalPort;
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
  consent_purpose_code: string;
  gateway_policy_id: string;
  gateway_policy_version: number;
  model_route_ref: string;
  allowed_reason_codes: string[];
  allowed_signal_codes?: string[];
  max_candidates: number;
  max_results: number;
  latency_budget_ms: number;
  status?: 'ACTIVE' | 'RETIRED';
}

export interface RecommendationInput {
  policy_code: string;
  application_id?: string;
  candidate_service_ids?: string[];
  context_signals?: string[];
}

export interface DispositionInput {
  decision: 'SELECT' | 'DISMISS';
  service_id?: string;
}

export interface RecommendationContractDoc {
  contract_id: 'SF-CON-RECOMMENDATION';
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  tenant_id: string;
  recommendation_id: string;
  application_id?: string;
  non_authoritative: true;
  authoritative: false;
  reason_codes: string[];
  model_route_ref: string;
  ai_gateway_cmp: 'CMP-039';
  consent_purpose_code: string;
  consent_recorded: true;
  correlation_id: string;
}

export interface RecommendationView {
  recommendation_id: string;
  status: RecommendationStatus;
  application_id: string | null;
  items: RecommendationItem[];
  recommendation: RecommendationContractDoc | null;
  model: { provider_id: string; model_id: string; model_version: string } | null;
  prompt: { policy_id: string; policy_version: number; template_hash: string } | null;
  gateway_request_id: string | null;
  rejection_code: string | null;
  fallback: 'NON_AI_DISCOVERY' | null;
  disposition: Disposition | null;
  selected_service_id: string | null;
  ai_gateway_cmp: 'CMP-039';
  non_authoritative: true;
  authoritative: false;
  statutory_decision: false;
}

export interface ServiceResult {
  status: number;
  body: unknown;
}

const MAX_SIGNALS = 32;
const SAFE_LOG_KEYS = new Set([
  'recommendation_id',
  'status',
  'reason_code',
  'gateway_request_id',
  'tenant_present',
]);

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function errorBody(ctx: RequestContext, code: string, reason: string): unknown {
  const entry = errorEntry(code);
  return {
    error_code: code,
    message: entry.message,
    correlation_id: ctx.correlation_id,
    details: [{ code: reason }],
  };
}

function httpOf(code: string): number {
  return errorEntry(code).http[0] ?? 500;
}

function failureOf(result: Extract<GatewayInvokeResult, { ok: false }>): {
  reason: string;
  code: string;
} {
  if (result.kind === 'DENIED') return { reason: 'GATEWAY_DENIED', code: 'SF-AUTH-002' };
  if (result.kind === 'TIMEOUT') return { reason: 'GATEWAY_TIMEOUT', code: 'SF-AI-001' };
  if (result.kind === 'UNSAFE') return { reason: 'UNSAFE_OUTPUT', code: 'SF-AI-001' };
  return { reason: 'GATEWAY_UNAVAILABLE', code: 'SF-AI-001' };
}

export class RecommendationService {
  constructor(private readonly deps: RecommendationServiceDeps) {}

  private external<T>(op: string, fn: () => Promise<T>): Promise<T> {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp007Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }, { code: op }] });
    }
    return fn();
  }

  view(row: RecommendationRow): RecommendationView {
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
    const generated = ['GENERATED', 'SELECTED', 'DISMISSED'].includes(row.status);
    let recommendation: RecommendationContractDoc | null = null;
    if (generated) {
      recommendation = {
        contract_id: 'SF-CON-RECOMMENDATION',
        contract_status: 'FROZEN',
        freeze_status: 'FROZEN',
        tenant_id: row.tenant_id,
        recommendation_id: row.recommendation_id,
        non_authoritative: true,
        authoritative: false,
        reason_codes: row.reason_codes,
        model_route_ref: row.model_route_ref,
        ai_gateway_cmp: 'CMP-039',
        consent_purpose_code: row.consent_purpose_code,
        consent_recorded: true,
        correlation_id: row.correlation_id,
      };
      if (row.application_id) recommendation.application_id = row.application_id;
    }
    return {
      recommendation_id: row.recommendation_id,
      status: row.status,
      application_id: row.application_id,
      items: row.items,
      recommendation,
      model,
      prompt,
      gateway_request_id: row.gateway_request_id,
      rejection_code: row.rejection_code,
      fallback: row.status === 'FAILED' ? 'NON_AI_DISCOVERY' : null,
      disposition: row.disposition,
      selected_service_id: row.selected_service_id,
      ai_gateway_cmp: 'CMP-039',
      non_authoritative: true,
      authoritative: false,
      statutory_decision: false,
    };
  }

  logRecord(recommendationId: string, status: string, reason?: string): Record<string, unknown> {
    const record: Record<string, unknown> = {
      recommendation_id: recommendationId,
      status,
      tenant_present: true,
    };
    if (reason !== undefined) record['reason_code'] = reason;
    return Object.fromEntries(Object.entries(record).filter(([k]) => SAFE_LOG_KEYS.has(k)));
  }

  private async emit(
    tx: RecommendationTx,
    ctx: TenantContext,
    row: RecommendationRow,
    type: DomainEventType,
    extra: Record<string, unknown>,
    now: Date,
  ): Promise<void> {
    const env = envelopeOf({
      eventType: type,
      tenantId: ctx.tenant_id,
      cellId: ctx.cell_id,
      aggregateType: 'Recommendation',
      aggregateId: row.recommendation_id,
      aggregateVersion: row.aggregate_version,
      occurredAt: now.toISOString(),
      correlationId: ctx.correlation_id,
      actor: ctx.actor,
      data: {
        recommendation_id: row.recommendation_id,
        status: row.status,
        non_authoritative: true,
        authoritative: false,
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
  ): Promise<ServiceResult> {
    await this.external('AUTHZ', () =>
      authorize(
        this.deps.authorizer,
        authzInput(ctx, 'RECOMMENDATION_POLICY', 'RecommendationPolicy'),
      ),
    );
    const signals = input.allowed_signal_codes ?? [];
    for (const code of input.allowed_reason_codes) {
      if (!isValidReasonCode(code)) {
        throw new Cmp007Error('SF-SYS-003', detail('REASON_CODE_NAMES_BINDING_OUTCOME'));
      }
    }
    for (const code of signals) {
      if (!isValidSignalCode(code)) {
        throw new Cmp007Error('SF-SYS-003', detail('SIGNAL_CODE_NAMES_BINDING_OUTCOME'));
      }
    }
    if (namesBindingOutcome(input.consent_purpose_code)) {
      throw new Cmp007Error('SF-SYS-003', detail('PURPOSE_NAMES_BINDING_OUTCOME'));
    }
    if (input.max_results > input.max_candidates) {
      throw new Cmp007Error('SF-SYS-003', detail('MAX_RESULTS_EXCEEDS_CANDIDATES'));
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
      const policy: RecommendationPolicy = {
        policy_id: randomUUID(),
        policy_code: input.policy_code,
        version_no,
        status: input.status ?? 'ACTIVE',
        consent_purpose_code: input.consent_purpose_code,
        gateway_policy_id: input.gateway_policy_id,
        gateway_policy_version: input.gateway_policy_version,
        model_route_ref: input.model_route_ref,
        allowed_reason_codes: input.allowed_reason_codes,
        allowed_signal_codes: signals,
        max_candidates: input.max_candidates,
        max_results: input.max_results,
        latency_budget_ms: input.latency_budget_ms,
      };
      await tx.insertPolicy({ ...policy, created_by: ctx.actor.id });
      await appendAudit(tx, ctx, {
        action: 'RECOMMENDATION_POLICY_CREATED',
        actionClass: 'WRITE',
        resourceType: 'RecommendationPolicy',
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

  private async resolveCandidates(
    ctx: TenantContext,
    policy: RecommendationPolicy,
    requested: string[] | undefined,
  ): Promise<CatalogueCandidate[]> {
    if (requested) {
      if (requested.length > policy.max_candidates) {
        throw new Cmp007Error('SF-SYS-003', detail('TOO_MANY_CANDIDATES'));
      }
      const found = await this.external('CATALOGUE', () =>
        this.deps.catalogue.resolve({ tenantId: ctx.tenant_id, serviceIds: requested }),
      );
      const byId = new Map(
        found
          .filter((c) => c.tenantId === ctx.tenant_id && c.status === 'PUBLISHED')
          .map((c) => [c.serviceId, c]),
      );
      const ordered: CatalogueCandidate[] = [];
      for (const id of requested) {
        const candidate = byId.get(id);
        if (!candidate) throw new Cmp007Error('SF-SYS-003', detail('CANDIDATE_UNAVAILABLE'));
        ordered.push(candidate);
      }
      return ordered;
    }
    const listed = await this.external('CATALOGUE', () =>
      this.deps.catalogue.listPublished({ tenantId: ctx.tenant_id, limit: policy.max_candidates }),
    );
    const usable = listed
      .filter((c) => c.tenantId === ctx.tenant_id && c.status === 'PUBLISHED')
      .slice(0, policy.max_candidates);
    if (usable.length === 0) throw new Cmp007Error('SF-SYS-003', detail('NO_CANDIDATES'));
    return usable;
  }

  private async profileSignals(
    ctx: TenantContext,
    policy: RecommendationPolicy,
  ): Promise<string[]> {
    try {
      const raw = await this.external('PROFILE', () =>
        this.deps.profile.signals({
          tenantId: ctx.tenant_id,
          subjectId: ctx.actor.id,
          purposeCode: policy.consent_purpose_code,
        }),
      );
      return raw.filter((s) => policy.allowed_signal_codes.includes(s));
    } catch (err) {
      if (err instanceof Cmp007Error) throw err;
      return [];
    }
  }

  async createRecommendation(
    ctx: TenantContext,
    input: RecommendationInput,
    idem: Idempotency,
  ): Promise<ServiceResult> {
    await this.external('AUTHZ', () =>
      authorize(
        this.deps.authorizer,
        authzInput(ctx, 'RECOMMENDATION_CREATE', 'Recommendation', {
          owner_id: ctx.actor.id,
          ...(input.application_id ? { application_id: input.application_id } : {}),
        }),
      ),
    );
    const policy = await this.deps.repo.withTx(ctx, (tx) => tx.latestPolicy(input.policy_code));
    if (!policy || policy.status !== 'ACTIVE') {
      throw new Cmp007Error('SF-SYS-003', detail('RECOMMENDATION_POLICY_UNAVAILABLE'));
    }
    const requestSignals = input.context_signals ?? [];
    for (const s of requestSignals) {
      if (!policy.allowed_signal_codes.includes(s) || !isValidSignalCode(s)) {
        throw new Cmp007Error('SF-SYS-003', detail('SIGNAL_NOT_ALLOWED'));
      }
    }

    let consent;
    try {
      consent = await this.external('CONSENT', () =>
        this.deps.consent.check({
          tenantId: ctx.tenant_id,
          subjectId: ctx.actor.id,
          purposeCode: policy.consent_purpose_code,
        }),
      );
    } catch (err) {
      if (err instanceof Cmp007Error) throw err;
      throw new Cmp007Error('SF-SYS-004', { details: [{ code: 'CONSENT_UNAVAILABLE' }] });
    }
    if (!consent.granted) {
      const deniedAt = this.deps.clock();
      await this.deps.repo.withTx(ctx, (tx) =>
        appendAudit(tx, ctx, {
          action: 'RECOMMENDATION_CONSENT_DENIED',
          actionClass: 'WRITE',
          resourceType: 'Recommendation',
          resourceId: randomUUID(),
          result: 'DENIED',
          reason: 'CONSENT_REQUIRED',
          now: deniedAt,
        }),
      );
      throw new Cmp007Error('SF-AUTH-002', detail('CONSENT_REQUIRED'));
    }

    const catalogue = await this.resolveCandidates(ctx, policy, input.candidate_service_ids);
    const signals = unique([...requestSignals, ...(await this.profileSignals(ctx, policy))]).slice(
      0,
      MAX_SIGNALS,
    );
    const candidates: CandidateSnapshot[] = catalogue.map((c, i) => ({
      alias: `c${i + 1}`,
      service_id: c.serviceId,
      service_code: c.serviceCode,
      category_code: c.categoryCode,
      published_version_ref: c.publishedVersionRef,
    }));

    const now = this.deps.clock();
    const recommendationId = randomUUID();
    const started = await this.deps.repo.withTx(ctx, async (tx) => {
      const claimed = await tx.claimIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        fingerprint: idem.fingerprint,
        now,
      });
      if (claimed !== 'claimed') return claimed;
      await tx.insertRecommendation({
        recommendation_id: recommendationId,
        cell_id: ctx.cell_id,
        subject_id: ctx.actor.id,
        application_id: input.application_id ?? null,
        policy_id: policy.policy_id,
        consent_purpose_code: policy.consent_purpose_code,
        consent_ref: consent.consentRef ?? null,
        candidates,
        signals,
        model_route_ref: policy.model_route_ref,
        correlation_id: ctx.correlation_id,
        now: now.toISOString(),
      });
      const row = await tx.getRecommendation(recommendationId);
      if (!row) throw new Cmp007Error('SF-SYS-001');
      await this.emit(
        tx,
        ctx,
        row,
        'RecommendationRequested',
        { candidate_count: candidates.length, signal_count: signals.length },
        now,
      );
      await appendAudit(tx, ctx, {
        action: 'RECOMMENDATION_REQUESTED',
        actionClass: 'WRITE',
        resourceType: 'Recommendation',
        resourceId: recommendationId,
        result: 'SUCCESS',
        now,
      });
      return 'started' as const;
    });
    if (started !== 'started') return started;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.latency_budget_ms);
    let gw: GatewayInvokeResult;
    try {
      gw = await this.external('GATEWAY', () =>
        this.deps.gateway.invoke(
          ctx,
          {
            policy_id: policy.gateway_policy_id,
            policy_version: policy.gateway_policy_version,
            purpose: policy.consent_purpose_code,
            data_classification: 'PERSONAL',
            caller_component: 'CMP-007',
            variables: {
              candidates: JSON.stringify(
                candidates.map((c) => ({
                  candidate: c.alias,
                  service_code: c.service_code,
                  category_code: c.category_code,
                })),
              ),
              signals: signals.join(','),
              allowed_reason_codes: policy.allowed_reason_codes.join(','),
              max_results: String(policy.max_results),
            },
            sources: [],
          },
          controller.signal,
        ),
      );
    } catch (err) {
      if (err instanceof Cmp007Error) throw err;
      gw = { ok: false, kind: 'UNAVAILABLE', reason_code: 'GATEWAY_UNAVAILABLE' };
    } finally {
      clearTimeout(timer);
    }

    if (!gw.ok) {
      const failure = failureOf(gw);
      return this.fail(ctx, recommendationId, idem, failure.reason, failure.code);
    }
    if (gw.advisory_only !== true || gw.statutory_decision !== false) {
      return this.fail(ctx, recommendationId, idem, 'UNSAFE_OUTPUT', 'SF-AI-001');
    }
    const parsed = parseGatewayOutput(gw.output_text, {
      aliases: candidates.map((c) => c.alias),
      allowedReasonCodes: policy.allowed_reason_codes,
      maxResults: policy.max_results,
    });
    if (!parsed.ok) {
      return this.fail(ctx, recommendationId, idem, parsed.code, 'SF-AI-001');
    }
    const byAlias = new Map(candidates.map((c) => [c.alias, c]));
    const items: RecommendationItem[] = parsed.items.map((p, i) => {
      const c = byAlias.get(p.alias) as CandidateSnapshot;
      return {
        rank: i + 1,
        service_id: c.service_id,
        published_version_ref: c.published_version_ref,
        reason_codes: p.reason_codes,
      };
    });
    const reasonCodes = unique(items.flatMap((i) => i.reason_codes));
    const finished = this.deps.clock();
    const model = gw.model;

    return this.deps.repo.withTx(ctx, async (tx) => {
      const locked = await tx.lockRecommendation(recommendationId);
      if (!locked) throw new Cmp007Error('SF-SYS-002');
      if (locked.status !== 'REQUESTED') return { status: 201, body: this.view(locked) };
      await tx.updateRecommendation(recommendationId, {
        status: 'GENERATED',
        items,
        reason_codes: reasonCodes,
        provider_id: model.provider_id,
        model_id: model.model_id,
        model_version: model.model_version,
        prompt_id: policy.gateway_policy_id,
        prompt_version: policy.gateway_policy_version,
        prompt_hash: gw.prompt_hash,
        gateway_request_id: gw.request_id,
        now: finished.toISOString(),
      });
      const row = await tx.getRecommendation(recommendationId);
      if (!row) throw new Cmp007Error('SF-SYS-001');
      await this.emit(
        tx,
        ctx,
        row,
        'RecommendationGenerated',
        {
          item_count: items.length,
          reason_codes: reasonCodes,
          items: items.map((i) => ({
            rank: i.rank,
            service_id: i.service_id,
            reason_codes: i.reason_codes,
          })),
          model_route_ref: row.model_route_ref,
          model_id: model.model_id,
          model_version: model.model_version,
          prompt_id: policy.gateway_policy_id,
          prompt_version: policy.gateway_policy_version,
          prompt_hash: gw.prompt_hash,
          ...(row.application_id ? { application_id: row.application_id } : {}),
        },
        finished,
      );
      await appendAudit(tx, ctx, {
        action: 'RECOMMENDATION_GENERATED',
        actionClass: 'WRITE',
        resourceType: 'Recommendation',
        resourceId: recommendationId,
        result: 'SUCCESS',
        now: finished,
      });
      const body = this.view(row);
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

  private async fail(
    ctx: TenantContext,
    recommendationId: string,
    idem: Idempotency,
    reason: string,
    code: string,
  ): Promise<ServiceResult> {
    const now = this.deps.clock();
    const status = httpOf(code);
    const body = errorBody(ctx, code, reason);
    return this.deps.repo.withTx(ctx, async (tx) => {
      const locked = await tx.lockRecommendation(recommendationId);
      if (!locked) throw new Cmp007Error('SF-SYS-002');
      if (locked.status === 'REQUESTED') {
        await tx.updateRecommendation(recommendationId, {
          status: 'FAILED',
          rejection_code: reason,
          now: now.toISOString(),
        });
        const row = await tx.getRecommendation(recommendationId);
        if (!row) throw new Cmp007Error('SF-SYS-001');
        await this.emit(
          tx,
          ctx,
          row,
          'RecommendationFailed',
          { rejection_code: reason, fallback: 'NON_AI_DISCOVERY' },
          now,
        );
        await appendAudit(tx, ctx, {
          action: 'RECOMMENDATION_FAILED',
          actionClass: 'WRITE',
          resourceType: 'Recommendation',
          resourceId: recommendationId,
          result: 'FAILED',
          reason,
          now,
        });
      }
      await tx.completeIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        status,
        body,
      });
      return { status, body };
    });
  }

  private async loadVisible(
    ctx: TenantContext,
    tx: RecommendationTx,
    id: string,
    lock: boolean,
  ): Promise<RecommendationRow> {
    const row = lock ? await tx.lockRecommendation(id) : await tx.getRecommendation(id);
    if (!row) throw new Cmp007Error('SF-SYS-002');
    if (ctx.actor.type === 'CITIZEN' && row.subject_id !== ctx.actor.id) {
      throw new Cmp007Error('SF-SYS-002');
    }
    return row;
  }

  async getRecommendation(ctx: TenantContext, id: string): Promise<RecommendationView> {
    if (!isUuid(id)) throw new Cmp007Error('SF-SYS-003', detail('RECOMMENDATION_ID'));
    await this.external('AUTHZ', () =>
      authorize(
        this.deps.authorizer,
        authzInput(
          ctx,
          ctx.actor.type === 'CITIZEN' ? 'RECOMMENDATION_READ' : 'RECOMMENDATION_READ_ANY',
          'Recommendation',
          ctx.actor.type === 'CITIZEN' ? { owner_id: ctx.actor.id } : {},
        ),
      ),
    );
    return this.deps.repo.withTx(ctx, async (tx) =>
      this.view(await this.loadVisible(ctx, tx, id, false)),
    );
  }

  async dispose(
    ctx: TenantContext,
    id: string,
    input: DispositionInput,
  ): Promise<RecommendationView> {
    if (!isUuid(id)) throw new Cmp007Error('SF-SYS-003', detail('RECOMMENDATION_ID'));
    if (input.decision === 'SELECT' && !(input.service_id && isUuid(input.service_id))) {
      throw new Cmp007Error('SF-SYS-003', detail('SERVICE_ID_REQUIRED'));
    }
    if (input.decision === 'DISMISS' && input.service_id !== undefined) {
      throw new Cmp007Error('SF-SYS-003', detail('SERVICE_ID_NOT_ALLOWED'));
    }
    await this.external('AUTHZ', () =>
      authorize(
        this.deps.authorizer,
        authzInput(ctx, 'RECOMMENDATION_DISPOSE', 'Recommendation', { owner_id: ctx.actor.id }),
      ),
    );
    const now = this.deps.clock();
    return this.deps.repo.withTx(ctx, async (tx) => {
      const locked = await tx.lockRecommendation(id);
      if (!locked || locked.subject_id !== ctx.actor.id) throw new Cmp007Error('SF-SYS-002');
      if (locked.status !== 'GENERATED') {
        throw new Cmp007Error('SF-APP-001', detail('DISPOSITION_NOT_APPLICABLE'));
      }
      let selected: RecommendationItem | undefined;
      if (input.decision === 'SELECT') {
        selected = locked.items.find((i) => i.service_id === input.service_id);
        if (!selected) throw new Cmp007Error('SF-SYS-003', detail('SERVICE_NOT_RECOMMENDED'));
      }
      const status: Disposition = input.decision === 'SELECT' ? 'SELECTED' : 'DISMISSED';
      await tx.updateRecommendation(id, {
        status,
        disposition: status,
        selected_service_id: selected?.service_id ?? null,
        disposed_by: ctx.actor.id,
        disposed_at: now.toISOString(),
        now: now.toISOString(),
      });
      const row = await tx.getRecommendation(id);
      if (!row) throw new Cmp007Error('SF-SYS-001');
      await this.emit(
        tx,
        ctx,
        row,
        status === 'SELECTED' ? 'RecommendationSelected' : 'RecommendationDismissed',
        {
          disposition: status,
          ...(selected
            ? {
                selected_service_id: selected.service_id,
                published_version_ref: selected.published_version_ref,
              }
            : {}),
          ...(row.application_id ? { application_id: row.application_id } : {}),
        },
        now,
      );
      await appendAudit(tx, ctx, {
        action: status === 'SELECTED' ? 'RECOMMENDATION_SELECTED' : 'RECOMMENDATION_DISMISSED',
        actionClass: 'WRITE',
        resourceType: 'Recommendation',
        resourceId: id,
        result: 'SUCCESS',
        now,
      });
      return this.view(row);
    });
  }
}
