import { randomUUID } from 'node:crypto';
import type { RequestContext, SimulationMarker } from '@serviceform/contracts';
import type { Pool, PoolClient } from 'pg';
import { appendAudit } from '../audit.js';
import { authorize, authzInput, type AuthorizationPort } from '../authz.js';
import type { AiGatewayConfig } from '../config.js';
import { claimIdempotency, completeIdempotency } from '../db/idempotency.js';
import { envelopeOf, insertOutbox, TOPIC_DOMAIN } from '../db/outbox.js';
import { withContextTx } from '../db/tx.js';
import { exceeds, requiresPurposeCheck } from '../domain/classification.js';
import { estimateTokens, sha256Fingerprint, sha256Hash } from '../domain/ids.js';
import { mergeSummaries, redactText, type RedactionSummary } from '../domain/redaction.js';
import { assertsBindingDecision } from '../domain/statutory-guard.js';
import { Cmp039Error } from '../errors.js';
import type { PurposeConsentPort, SourceAclPort } from '../ports/policy-ports.js';
import type { ModelProviderPort, ProviderRegistry } from '../ports/provider.js';
import { getModelsByIds, getPolicy, type ModelRow, type PolicyRow } from '../repo/registry-repo.js';
import {
  insertRequestMetadata,
  sumCompletedTokensSince,
  type RequestMetadataRow,
} from '../repo/metadata-repo.js';
import { blockedBody, blockSpec, type BlockReason } from './outcomes.js';
import { callProvider } from './provider-call.js';
import type { GatewayRequest, RequestedTool } from './request.js';

export interface GatewayDeps {
  pool: Pool;
  authorizer: AuthorizationPort;
  providers: ProviderRegistry;
  consent: PurposeConsentPort;
  sources: SourceAclPort;
  config: AiGatewayConfig;
  clock: () => Date;
}

export interface ServiceResult {
  status: number;
  body: unknown;
}

interface Trace {
  policy: PolicyRow | undefined;
  promptHash: string | null;
  redaction: RedactionSummary;
  route: ModelRow | undefined;
  tools: { tool_id: string; version: string; scopes: string[] }[];
  citations: { source_id: string }[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  attempts: number;
  fallbackUsed: boolean;
  simulation: SimulationMarker | undefined;
}

interface Plan {
  policy: PolicyRow;
  routes: ModelRow[];
  inputs: string[];
  tools: RequestedTool[];
  maxOutputByRoute: Map<string, number>;
}

type Prepared = { block: BlockReason } | { plan: Plan };

function newTrace(): Trace {
  return {
    policy: undefined,
    promptHash: null,
    redaction: {},
    route: undefined,
    tools: [],
    citations: [],
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    attempts: 0,
    fallbackUsed: false,
    simulation: undefined,
  };
}

const PLACEHOLDER = /\{\{([a-z][a-z0-9_]{0,31})\}\}/g;

function dayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Network-dependent checks run before any database transaction (no network inside DB tx). */
async function preChecks(
  deps: GatewayDeps,
  ctx: RequestContext,
  req: GatewayRequest,
): Promise<BlockReason | undefined> {
  const tenantId = ctx.tenant_id as string;
  try {
    await authorize(
      deps.authorizer,
      authzInput(ctx, req.operation === 'INVOKE' ? 'AI_INVOKE' : 'AI_EMBED', 'AiGateway'),
    );
  } catch (err) {
    if (err instanceof Cmp039Error && err.code === 'SF-AUTH-002') return 'AUTHZ_DENIED';
    throw err;
  }
  for (const source of req.sources) {
    if (source.tenant_id !== tenantId) return 'CROSS_TENANT_SOURCE';
  }
  if (requiresPurposeCheck(req.classification)) {
    let permitted = false;
    try {
      permitted = await deps.consent.permits({
        tenantId,
        actorId: ctx.actor.id,
        purpose: req.purpose,
        classification: req.classification,
      });
    } catch {
      permitted = false;
    }
    if (!permitted) return 'PURPOSE_NOT_PERMITTED';
  }
  for (const source of req.sources) {
    let readable = false;
    try {
      readable = await deps.sources.canRead({
        tenantId,
        actorId: ctx.actor.id,
        sourceId: source.source_id,
      });
    } catch {
      readable = false;
    }
    if (!readable) return 'SOURCE_ACL_DENIED';
  }
  return undefined;
}

async function prepare(
  client: PoolClient,
  deps: GatewayDeps,
  ctx: RequestContext,
  req: GatewayRequest,
  trace: Trace,
): Promise<Prepared> {
  const tenantId = ctx.tenant_id as string;
  const policy = await getPolicy(client, tenantId, req.policyId, req.policyVersion);
  if (!policy) return { block: 'POLICY_NOT_FOUND' };
  trace.policy = policy;
  if (policy.status !== 'ACTIVE') return { block: 'POLICY_NOT_ACTIVE' };
  if (policy.operation !== req.operation) return { block: 'OPERATION_MISMATCH' };
  if (exceeds(req.classification, policy.max_data_classification as never)) {
    return { block: 'DATA_CLASSIFICATION_EXCEEDED' };
  }

  const entries = await getModelsByIds(client, tenantId, policy.model_entry_ids);
  const byId = new Map(entries.map((m) => [m.model_entry_id, m]));
  let routes = policy.model_entry_ids
    .map((id) => byId.get(id))
    .filter(
      (m): m is ModelRow =>
        m !== undefined && m.status === 'ACTIVE' && m.operations.includes(req.operation),
    );
  const pin = req.model;
  if (pin) {
    routes = routes.filter(
      (m) =>
        m.provider_id === pin.provider_id &&
        m.model_id === pin.model_id &&
        m.model_version === pin.model_version,
    );
  }
  if (routes.length === 0) return { block: 'MODEL_NOT_APPROVED' };
  routes = routes.filter((m) => !exceeds(req.classification, m.max_data_classification as never));
  if (routes.length === 0) return { block: 'DATA_CLASSIFICATION_EXCEEDED' };

  const tools: RequestedTool[] = [];
  for (const wanted of req.tools) {
    const allowed = policy.allowed_tools.find(
      (t) => t.tool_id === wanted.tool_id && t.version === wanted.version,
    );
    if (!allowed || !wanted.scopes.every((s) => allowed.scopes.includes(s))) {
      return { block: 'TOOL_NOT_ALLOWED' };
    }
    tools.push(wanted);
  }

  const summaries: RedactionSummary[] = [];
  let inputs: string[];
  if (policy.operation === 'INVOKE') {
    const names = Object.keys(req.variables).sort();
    const expected = [...policy.variable_names].sort();
    if (names.length !== expected.length || names.some((n, i) => n !== expected[i])) {
      return { block: 'VARIABLES_INVALID' };
    }
    const safe: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.variables)) {
      const r = redactText(value);
      summaries.push(r.summary);
      safe[name] = r.text;
    }
    const rendered = (policy.template_body ?? '').replace(
      PLACEHOLDER,
      (_m, name: string) => safe[name] ?? '',
    );
    const final = redactText(rendered);
    summaries.push(final.summary);
    inputs = [final.text];
  } else {
    inputs = req.inputs.map((text) => {
      const r = redactText(text);
      summaries.push(r.summary);
      return r.text;
    });
  }
  trace.redaction = mergeSummaries(...summaries);
  trace.promptHash = sha256Hash(inputs.join('\n---\n'));

  const chars = inputs.reduce((n, t) => n + t.length, 0);
  routes = routes.filter((m) => chars <= m.max_input_chars);
  if (routes.length === 0) return { block: 'INPUT_TOO_LARGE' };

  const since = dayStart(deps.clock());
  const inputEstimate = estimateTokens(inputs.join(''));
  const maxOutputByRoute = new Map<string, number>();
  const withinBudget: ModelRow[] = [];
  for (const route of routes) {
    const maxOut = Math.min(policy.max_output_tokens, route.max_output_tokens);
    const used = await sumCompletedTokensSince(client, {
      tenantId,
      providerId: route.provider_id,
      modelId: route.model_id,
      modelVersion: route.model_version,
      since,
    });
    const projected = used + inputEstimate + (policy.operation === 'INVOKE' ? maxOut : 0);
    if (projected <= Number(route.daily_token_budget)) {
      withinBudget.push(route);
      maxOutputByRoute.set(route.model_entry_id, maxOut);
    }
  }
  if (withinBudget.length === 0) return { block: 'BUDGET_EXCEEDED' };

  const available = withinBudget.filter((m) => deps.providers.has(m.provider_id));
  if (available.length === 0) {
    trace.route = withinBudget[0];
    return { block: 'PROVIDER_UNAVAILABLE' };
  }
  return { plan: { policy, routes: available, inputs, tools, maxOutputByRoute } };
}

interface Outcome {
  reason?: BlockReason;
  response?: Record<string, unknown>;
}

function validateInvokeOutput(
  plan: Plan,
  req: GatewayRequest,
  maxOutput: number,
  out: {
    text: string;
    tool_calls: { tool_id: string; version: string }[];
    citations: { source_id: string }[];
    output_tokens: number;
  },
  trace: Trace,
): Outcome & { text?: string } {
  const redacted = redactText(out.text);
  trace.redaction = mergeSummaries(trace.redaction, redacted.summary);
  if (assertsBindingDecision(redacted.text)) return { reason: 'STATUTORY_DECISION_OUTPUT' };
  if (out.output_tokens > maxOutput) return { reason: 'OUTPUT_TOO_LARGE' };
  for (const call of out.tool_calls) {
    const granted = plan.tools.find(
      (t) => t.tool_id === call.tool_id && t.version === call.version,
    );
    if (!granted) return { reason: 'TOOL_CALL_NOT_ALLOWED' };
    trace.tools.push({
      tool_id: granted.tool_id,
      version: granted.version,
      scopes: granted.scopes,
    });
  }
  const sourceIds = new Set(req.sources.map((s) => s.source_id));
  for (const c of out.citations) {
    if (!sourceIds.has(c.source_id)) return { reason: 'CITATION_NOT_IN_SOURCES' };
  }
  trace.citations = out.citations.map((c) => ({ source_id: c.source_id }));
  return { text: redacted.text };
}

async function runProviders(
  deps: GatewayDeps,
  req: GatewayRequest,
  plan: Plan,
  trace: Trace,
): Promise<Outcome> {
  const started = Date.now();
  let index = 0;
  for (const route of plan.routes) {
    const provider = deps.providers.get(route.provider_id) as ModelProviderPort;
    const maxOutput =
      plan.maxOutputByRoute.get(route.model_entry_id) ?? plan.policy.max_output_tokens;
    const model = {
      provider_id: route.provider_id,
      model_id: route.model_id,
      model_version: route.model_version,
    };
    trace.route = route;
    trace.attempts += 1;
    let result;
    try {
      result = await callProvider(
        provider,
        plan.policy.latency_budget_ms,
        plan.policy.operation === 'INVOKE'
          ? {
              operation: 'INVOKE',
              input: {
                model,
                prompt: plan.inputs[0] ?? '',
                maxOutputTokens: maxOutput,
                tools: plan.tools.map((t) => ({ tool_id: t.tool_id, version: t.version })),
              },
            }
          : { operation: 'EMBED', input: { model, inputs: plan.inputs } },
      );
    } catch {
      index += 1;
      continue;
    }
    trace.latencyMs = Date.now() - started;
    trace.fallbackUsed = index > 0;
    trace.simulation = provider.simulation;
    if (result.kind === 'invoke') {
      trace.inputTokens = result.value.input_tokens;
      trace.outputTokens = result.value.output_tokens;
      const checked = validateInvokeOutput(plan, req, maxOutput, result.value, trace);
      if (checked.reason) return { reason: checked.reason };
      return {
        response: {
          output_text: checked.text,
          tool_calls: trace.tools.map((t) => ({ tool_id: t.tool_id, version: t.version })),
          citations: trace.citations,
        },
      };
    }
    trace.inputTokens = result.value.input_tokens;
    const vectors = result.value.vectors;
    const valid =
      vectors.length === plan.inputs.length &&
      vectors.every((v) => v.length > 0 && v.length <= 4096 && v.every((n) => Number.isFinite(n)));
    if (!valid) return { reason: 'EMBEDDING_INVALID' };
    return { response: { vectors } };
  }
  trace.latencyMs = Date.now() - started;
  return { reason: 'PROVIDER_UNAVAILABLE' };
}

async function persistOutcome(
  client: PoolClient,
  deps: GatewayDeps,
  ctx: RequestContext,
  req: GatewayRequest,
  trace: Trace,
  outcome: Outcome,
  idem: IdemParams,
): Promise<ServiceResult> {
  const tenantId = ctx.tenant_id as string;
  const now = deps.clock();
  const requestId = randomUUID();
  const reason = outcome.reason;
  const spec = reason ? blockSpec(reason) : undefined;
  const status: 'COMPLETED' | 'BLOCKED' | 'FAILED' = spec ? spec.outcome : 'COMPLETED';
  const route = trace.route;
  const row: RequestMetadataRow = {
    request_id: requestId,
    tenant_id: tenantId,
    cell_id: ctx.cell_id,
    actor_type: ctx.actor.type,
    actor_id: ctx.actor.id,
    correlation_id: ctx.correlation_id,
    trace_id: ctx.trace_id,
    operation: req.operation,
    policy_id: req.policyId,
    policy_version: req.policyVersion,
    caller_component: req.callerComponent ?? null,
    policy_hash: trace.policy?.template_hash ?? null,
    prompt_hash: trace.promptHash,
    provider_id: route?.provider_id ?? null,
    model_id: route?.model_id ?? null,
    model_version: route?.model_version ?? null,
    tool_calls: reason ? [] : trace.tools,
    citations: reason ? [] : trace.citations,
    data_classification: req.classification,
    purpose: req.purpose,
    redaction_summary: trace.redaction as Record<string, number>,
    outcome: status,
    reason_code: reason ?? null,
    fallback_used: trace.fallbackUsed,
    attempts: trace.attempts,
    input_tokens: reason ? 0 : trace.inputTokens,
    output_tokens: reason ? 0 : trace.outputTokens,
    latency_ms: trace.latencyMs,
    simulated: trace.simulation !== undefined,
    created_at: now,
  };
  await insertRequestMetadata(client, row);

  const actor = { type: ctx.actor.type, id: ctx.actor.id };
  const base = {
    tenantId,
    cellId: ctx.cell_id,
    aggregateType: 'AiRequest',
    aggregateId: requestId,
    aggregateVersion: 1,
    occurredAt: now.toISOString(),
    correlationId: ctx.correlation_id,
    actor,
  };
  const common = {
    request_id: requestId,
    operation: req.operation,
    policy_id: req.policyId,
    policy_version: req.policyVersion,
  };
  if (reason) {
    await insertOutbox(
      client,
      envelopeOf({
        ...base,
        eventType: 'AIRequestBlocked',
        data: { ...common, reason_code: reason, outcome: status },
      }),
      TOPIC_DOMAIN,
    );
  } else {
    await insertOutbox(
      client,
      envelopeOf({
        ...base,
        eventType: 'AIRequestCompleted',
        data: {
          ...common,
          provider_id: route?.provider_id ?? '',
          model_id: route?.model_id ?? '',
          model_version: route?.model_version ?? '',
          input_tokens: trace.inputTokens,
          output_tokens: trace.outputTokens,
          simulated: trace.simulation !== undefined,
        },
      }),
      TOPIC_DOMAIN,
    );
    if (trace.fallbackUsed) {
      await insertOutbox(
        client,
        envelopeOf({
          ...base,
          eventType: 'AIProviderFallbackUsed',
          data: {
            ...common,
            provider_id: route?.provider_id ?? '',
            attempts: trace.attempts,
          },
        }),
        TOPIC_DOMAIN,
      );
    }
  }
  await appendAudit(client, ctx, {
    action: req.operation === 'INVOKE' ? 'AI_INVOKE' : 'AI_EMBED',
    actionClass: 'WRITE',
    resourceType: 'AiRequest',
    resourceId: requestId,
    result: reason ? (status === 'FAILED' ? 'FAILED' : 'DENIED') : 'SUCCESS',
    ...(reason ? { reason } : {}),
    now,
  });

  let result: ServiceResult;
  if (reason) {
    const blocked = blockedBody(ctx.correlation_id, reason, trace.policy?.fallback_behavior);
    result = { status: blocked.status, body: blocked.body };
  } else {
    result = {
      status: 200,
      body: {
        request_id: requestId,
        operation: req.operation,
        policy_id: req.policyId,
        policy_version: req.policyVersion,
        model: {
          provider_id: route?.provider_id,
          model_id: route?.model_id,
          model_version: route?.model_version,
        },
        ...outcome.response,
        usage: { input_tokens: trace.inputTokens, output_tokens: trace.outputTokens },
        fallback_used: trace.fallbackUsed,
        advisory_only: true,
        statutory_decision: false,
        ...(trace.simulation ? { simulation: trace.simulation } : {}),
      },
    };
  }
  await completeIdempotency(client, {
    tenantId,
    principalId: ctx.actor.id,
    endpoint: idem.endpoint,
    key: idem.key,
    status: result.status,
    body: result.body,
  });
  return result;
}

export interface IdemParams {
  endpoint: string;
  key: string;
}

export function requestFingerprint(req: GatewayRequest): string {
  return sha256Fingerprint([
    req.operation,
    req.policyId,
    String(req.policyVersion),
    req.purpose,
    req.classification,
    JSON.stringify(req.variables),
    JSON.stringify(req.inputs),
    JSON.stringify(req.model ?? null),
    JSON.stringify(req.tools),
    JSON.stringify(req.sources),
    req.callerComponent ?? '',
  ]);
}

/**
 * Single governed entry for every model/provider call. Phases: (0) authz/consent/source ACL,
 * (1) claim + registry resolution in one tenant-scoped tx, (2) provider call with no tx open,
 * (3) audit metadata + outbox + idempotency completion in one tx.
 */
export async function governedCall(
  deps: GatewayDeps,
  ctx: RequestContext,
  req: GatewayRequest,
  idem: IdemParams,
): Promise<ServiceResult> {
  const tenantId = ctx.tenant_id as string;
  const preBlock = await preChecks(deps, ctx, req);
  const trace = newTrace();

  const phase1 = await withContextTx(deps.pool, ctx, async (client) => {
    const claim = await claimIdempotency(client, {
      tenantId,
      principalId: ctx.actor.id,
      endpoint: idem.endpoint,
      key: idem.key,
      fingerprint: requestFingerprint(req),
      now: deps.clock(),
    });
    if (claim !== 'claimed') return { replay: claim };
    if (preBlock) {
      return {
        done: await persistOutcome(client, deps, ctx, req, trace, { reason: preBlock }, idem),
      };
    }
    const prepared = await prepare(client, deps, ctx, req, trace);
    if ('block' in prepared) {
      return {
        done: await persistOutcome(client, deps, ctx, req, trace, { reason: prepared.block }, idem),
      };
    }
    return { plan: prepared.plan };
  });
  if ('replay' in phase1) return { status: phase1.replay.status, body: phase1.replay.body };
  if ('done' in phase1) return phase1.done;

  const outcome = await runProviders(deps, req, phase1.plan, trace);
  return withContextTx(deps.pool, ctx, (client) =>
    persistOutcome(client, deps, ctx, req, trace, outcome, idem),
  );
}
