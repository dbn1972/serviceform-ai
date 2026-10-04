import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@serviceform/contracts';
import type { PoolClient } from 'pg';
import { appendAudit } from '../audit.js';
import { exceeds, isDataClassification } from '../domain/classification.js';
import { sha256Hash } from '../domain/ids.js';
import { containsSensitive } from '../domain/redaction.js';
import {
  ALLOWED_TOOL_EFFECTS,
  isAllowedTaskKind,
  isStatutoryDecisionKind,
} from '../domain/statutory-guard.js';
import { Cmp039Error } from '../errors.js';
import {
  getModelsByIds,
  getPolicy,
  insertModel,
  insertPolicy,
  listActiveModels,
  retirePolicy,
  revokeModel,
  type ModelRow,
  type PolicyRow,
  type ToolPolicy,
} from '../repo/registry-repo.js';
import {
  FLOATING_VERSIONS,
  MODEL_ID_RE,
  MODEL_VERSION_RE,
  POLICY_ID_RE,
  PROVIDER_ID_RE,
  SCOPE_RE,
  TOOL_ID_RE,
  isToolVersion,
  VARIABLE_NAME_RE,
} from './request.js';

interface Env {
  ctx: RequestContext;
  now: Date;
}

function bad(code: string, statusCode?: number): Cmp039Error {
  return new Cmp039Error('SF-SYS-003', {
    details: [{ code }],
    ...(statusCode ? { statusCode } : {}),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function intIn(value: unknown, min: number, max: number, code: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw bad(code);
  }
  return value;
}

function onlyKeys(body: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!keys.includes(key)) throw bad('UNKNOWN_FIELD');
  }
}

function modelView(row: ModelRow) {
  return {
    model_entry_id: row.model_entry_id,
    provider_id: row.provider_id,
    model_id: row.model_id,
    model_version: row.model_version,
    operations: row.operations,
    max_data_classification: row.max_data_classification,
    max_input_chars: row.max_input_chars,
    max_output_tokens: row.max_output_tokens,
    daily_token_budget: Number(row.daily_token_budget),
    status: row.status,
  };
}

function policyView(row: PolicyRow) {
  return {
    policy_id: row.policy_id,
    policy_version: row.policy_version,
    task_kind: row.task_kind,
    operation: row.operation,
    template_hash: row.template_hash,
    variable_names: row.variable_names,
    allowed_tools: row.allowed_tools,
    model_entry_ids: row.model_entry_ids,
    max_data_classification: row.max_data_classification,
    max_output_tokens: row.max_output_tokens,
    latency_budget_ms: row.latency_budget_ms,
    fallback_behavior: row.fallback_behavior,
    evaluation_ref: row.evaluation_ref,
    status: row.status,
  };
}

export async function registerModel(
  client: PoolClient,
  env: Env,
  body: unknown,
): Promise<Record<string, unknown>> {
  if (!isRecord(body)) throw bad('BODY_REQUIRED');
  onlyKeys(body, [
    'provider_id',
    'model_id',
    'model_version',
    'operations',
    'max_data_classification',
    'max_input_chars',
    'max_output_tokens',
    'daily_token_budget',
  ]);
  const { provider_id, model_id, model_version, operations, max_data_classification } = body;
  if (typeof provider_id !== 'string' || !PROVIDER_ID_RE.test(provider_id))
    throw bad('PROVIDER_ID_INVALID');
  if (typeof model_id !== 'string' || !MODEL_ID_RE.test(model_id)) throw bad('MODEL_ID_INVALID');
  if (
    typeof model_version !== 'string' ||
    !MODEL_VERSION_RE.test(model_version) ||
    (FLOATING_VERSIONS as readonly string[]).includes(model_version.toLowerCase())
  ) {
    throw bad('MODEL_VERSION_NOT_PINNED');
  }
  if (
    !Array.isArray(operations) ||
    operations.length < 1 ||
    operations.length > 2 ||
    new Set(operations).size !== operations.length ||
    !operations.every((o) => o === 'INVOKE' || o === 'EMBED')
  ) {
    throw bad('OPERATIONS_INVALID');
  }
  if (!isDataClassification(max_data_classification)) throw bad('DATA_CLASSIFICATION_INVALID');
  const row: ModelRow = {
    model_entry_id: randomUUID(),
    tenant_id: env.ctx.tenant_id as string,
    cell_id: env.ctx.cell_id,
    provider_id,
    model_id,
    model_version,
    operations: operations as string[],
    max_data_classification,
    max_input_chars: intIn(body['max_input_chars'], 1, 200_000, 'MAX_INPUT_CHARS_INVALID'),
    max_output_tokens: intIn(body['max_output_tokens'], 1, 32_000, 'MAX_OUTPUT_TOKENS_INVALID'),
    daily_token_budget: intIn(
      body['daily_token_budget'],
      1,
      Number.MAX_SAFE_INTEGER,
      'BUDGET_INVALID',
    ),
    status: 'ACTIVE',
    registered_by: env.ctx.actor.id,
    revoked_by: null,
    revoke_reason: null,
    aggregate_version: 1,
    created_at: env.now,
    revoked_at: null,
  };
  const saved = await insertModel(client, row);
  if (!saved) throw new Cmp039Error('SF-SYS-001');
  await appendAudit(client, env.ctx, {
    action: 'AI_MODEL_REGISTER',
    actionClass: 'WRITE',
    resourceType: 'AiModelRegistryEntry',
    resourceId: saved.model_entry_id,
    result: 'SUCCESS',
    now: env.now,
  });
  return modelView(saved);
}

export async function revokeModelEntry(
  client: PoolClient,
  env: Env,
  modelEntryId: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const reason = isRecord(body) ? body['reason'] : undefined;
  if (typeof reason !== 'string' || reason.length < 1 || reason.length > 1000) {
    throw bad('REVOKE_REASON_REQUIRED');
  }
  const row = await revokeModel(client, {
    tenantId: env.ctx.tenant_id as string,
    modelEntryId,
    actorId: env.ctx.actor.id,
    reason,
    now: env.now,
  });
  if (!row) throw new Cmp039Error('SF-SYS-002');
  await appendAudit(client, env.ctx, {
    action: 'AI_MODEL_REVOKE',
    actionClass: 'WRITE',
    resourceType: 'AiModelRegistryEntry',
    resourceId: row.model_entry_id,
    result: 'SUCCESS',
    reason,
    now: env.now,
  });
  return modelView(row);
}

export async function listCapabilities(
  client: PoolClient,
  ctx: RequestContext,
): Promise<Record<string, unknown>> {
  const rows = await listActiveModels(client, ctx.tenant_id as string);
  return { models: rows.map(modelView) };
}

function parseTools(raw: unknown): ToolPolicy[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 16) throw bad('TOOLS_INVALID');
  const seen = new Set<string>();
  return raw.map((item) => {
    if (!isRecord(item)) throw bad('TOOLS_INVALID');
    onlyKeys(item, ['tool_id', 'version', 'scopes', 'effect']);
    const { tool_id, version, scopes, effect } = item;
    if (typeof tool_id !== 'string' || !TOOL_ID_RE.test(tool_id)) throw bad('TOOLS_INVALID');
    if (typeof version !== 'string' || !isToolVersion(version)) throw bad('TOOLS_INVALID');
    if (
      !Array.isArray(scopes) ||
      scopes.length > 8 ||
      !scopes.every((s) => typeof s === 'string' && SCOPE_RE.test(s))
    ) {
      throw bad('TOOLS_INVALID');
    }
    if (!(ALLOWED_TOOL_EFFECTS as readonly unknown[]).includes(effect)) {
      throw bad('TOOL_EFFECT_FORBIDDEN');
    }
    const key = `${tool_id}@${version}`;
    if (seen.has(key)) throw bad('TOOLS_INVALID');
    seen.add(key);
    return { tool_id, version, scopes: scopes as string[], effect: effect as ToolPolicy['effect'] };
  });
}

function parseEvaluationRef(raw: unknown): Record<string, string | number> {
  if (!isRecord(raw)) throw bad('EVALUATION_REF_REQUIRED');
  onlyKeys(raw, [
    'dataset_id',
    'dataset_version',
    'threshold',
    'result',
    'safety_result',
    'privacy_result',
  ]);
  const out: Record<string, string | number> = {};
  for (const key of ['dataset_id', 'dataset_version', 'result'] as const) {
    const v = raw[key];
    if (typeof v !== 'string' || v.length < 1 || v.length > 128)
      throw bad('EVALUATION_REF_REQUIRED');
    out[key] = v;
  }
  if (out['result'] !== 'PASSED') throw bad('EVALUATION_NOT_PASSED');
  const threshold = raw['threshold'];
  if (typeof threshold !== 'number' || threshold < 0 || threshold > 1)
    throw bad('EVALUATION_REF_REQUIRED');
  out['threshold'] = threshold;
  for (const key of ['safety_result', 'privacy_result'] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    if (v !== 'PASSED') throw bad('EVALUATION_NOT_PASSED');
    out[key] = v;
  }
  return out;
}

export async function registerPolicy(
  client: PoolClient,
  env: Env,
  body: unknown,
): Promise<Record<string, unknown>> {
  if (!isRecord(body)) throw bad('BODY_REQUIRED');
  onlyKeys(body, [
    'policy_id',
    'policy_version',
    'task_kind',
    'template_body',
    'allowed_tools',
    'model_entry_ids',
    'max_data_classification',
    'max_output_tokens',
    'latency_budget_ms',
    'fallback_behavior',
    'evaluation_ref',
  ]);
  const tenantId = env.ctx.tenant_id as string;
  const { policy_id, task_kind, max_data_classification, fallback_behavior } = body;
  if (typeof policy_id !== 'string' || !POLICY_ID_RE.test(policy_id))
    throw bad('POLICY_ID_INVALID');
  if (typeof task_kind !== 'string') throw bad('TASK_KIND_INVALID');
  if (isStatutoryDecisionKind(task_kind)) throw bad('STATUTORY_DECISION_FORBIDDEN');
  if (!isAllowedTaskKind(task_kind)) throw bad('TASK_KIND_INVALID');
  if (!isDataClassification(max_data_classification)) throw bad('DATA_CLASSIFICATION_INVALID');
  if (fallback_behavior !== 'DENY' && fallback_behavior !== 'NON_AI_PATH')
    throw bad('FALLBACK_INVALID');
  const policyVersion = intIn(body['policy_version'], 1, 100_000, 'POLICY_VERSION_INVALID');
  const operation = task_kind === 'EMBED' ? 'EMBED' : 'INVOKE';

  let templateBody: string | null = null;
  let variableNames: string[] = [];
  if (operation === 'INVOKE') {
    const tpl = body['template_body'];
    if (typeof tpl !== 'string' || tpl.length < 1 || tpl.length > 16_000)
      throw bad('TEMPLATE_REQUIRED');
    if (containsSensitive(tpl)) throw bad('TEMPLATE_CONTAINS_SENSITIVE_DATA');
    const names = new Set<string>();
    const stripped = tpl.replace(/\{\{([a-z][a-z0-9_]{0,31})\}\}/g, (_m, n: string) => {
      names.add(n);
      return '';
    });
    if (stripped.includes('{{') || stripped.includes('}}'))
      throw bad('TEMPLATE_PLACEHOLDER_INVALID');
    for (const n of names) if (!VARIABLE_NAME_RE.test(n)) throw bad('TEMPLATE_PLACEHOLDER_INVALID');
    if (names.size > 32) throw bad('TEMPLATE_PLACEHOLDER_INVALID');
    templateBody = tpl;
    variableNames = [...names].sort();
  } else if (body['template_body'] !== undefined) {
    throw bad('TEMPLATE_NOT_ALLOWED_FOR_EMBED');
  }

  const idsRaw = body['model_entry_ids'];
  if (
    !Array.isArray(idsRaw) ||
    idsRaw.length < 1 ||
    idsRaw.length > 5 ||
    new Set(idsRaw).size !== idsRaw.length
  ) {
    throw bad('MODEL_ROUTES_INVALID');
  }
  const ids = idsRaw as string[];
  if (!ids.every((i) => typeof i === 'string')) throw bad('MODEL_ROUTES_INVALID');
  const models = await getModelsByIds(client, tenantId, ids);
  const byId = new Map(models.map((m) => [m.model_entry_id, m]));
  const maxOutput = intIn(body['max_output_tokens'], 1, 32_000, 'MAX_OUTPUT_TOKENS_INVALID');
  for (const id of ids) {
    const m = byId.get(id);
    if (!m || m.status !== 'ACTIVE' || !m.operations.includes(operation)) {
      throw new Cmp039Error('SF-AUTH-002', { details: [{ code: 'MODEL_NOT_APPROVED' }] });
    }
    if (
      exceeds(max_data_classification, m.max_data_classification as never) ||
      maxOutput > m.max_output_tokens
    ) {
      throw bad('POLICY_EXCEEDS_MODEL_LIMITS');
    }
  }

  const row: PolicyRow = {
    tenant_id: tenantId,
    cell_id: env.ctx.cell_id,
    policy_id,
    policy_version: policyVersion,
    task_kind,
    operation,
    template_body: templateBody,
    template_hash: sha256Hash(templateBody ?? `embed:${policy_id}`),
    variable_names: variableNames,
    allowed_tools: operation === 'INVOKE' ? parseTools(body['allowed_tools']) : [],
    model_entry_ids: ids,
    max_data_classification,
    max_output_tokens: maxOutput,
    latency_budget_ms: intIn(body['latency_budget_ms'], 100, 120_000, 'LATENCY_BUDGET_INVALID'),
    fallback_behavior,
    evaluation_ref: parseEvaluationRef(body['evaluation_ref']),
    status: 'ACTIVE',
    registered_by: env.ctx.actor.id,
    aggregate_version: 1,
    created_at: env.now,
    retired_at: null,
  };
  if (operation === 'EMBED' && body['allowed_tools'] !== undefined)
    throw bad('TOOLS_NOT_ALLOWED_FOR_EMBED');
  const saved = await insertPolicy(client, row);
  if (!saved) throw new Cmp039Error('SF-SYS-001');
  await appendAudit(client, env.ctx, {
    action: 'AI_POLICY_REGISTER',
    actionClass: 'WRITE',
    resourceType: 'AiPolicy',
    resourceId: `${saved.policy_id}@${saved.policy_version}`.slice(0, 200),
    result: 'SUCCESS',
    now: env.now,
  });
  return policyView(saved);
}

export async function retirePolicyVersion(
  client: PoolClient,
  env: Env,
  policyId: string,
  version: number,
): Promise<Record<string, unknown>> {
  const existing = await getPolicy(client, env.ctx.tenant_id as string, policyId, version);
  if (!existing) throw new Cmp039Error('SF-SYS-002');
  const row = await retirePolicy(client, {
    tenantId: env.ctx.tenant_id as string,
    policyId,
    version,
    now: env.now,
  });
  if (!row) throw new Cmp039Error('SF-SYS-003', { details: [{ code: 'POLICY_ALREADY_RETIRED' }] });
  await appendAudit(client, env.ctx, {
    action: 'AI_POLICY_RETIRE',
    actionClass: 'WRITE',
    resourceType: 'AiPolicy',
    resourceId: `${policyId}@${version}`.slice(0, 200),
    result: 'SUCCESS',
    now: env.now,
  });
  return policyView(row);
}
