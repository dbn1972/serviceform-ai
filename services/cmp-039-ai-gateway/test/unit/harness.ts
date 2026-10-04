import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { loadConfig } from '../../src/config.js';
import { registerAiGateway } from '../../src/plugin.js';
import {
  SimulatedPurposeConsentPort,
  SimulatedSourceAclPort,
} from '../../src/ports/policy-ports.js';
import {
  SimulatedModelProvider,
  type ModelProviderPort,
  type SimulatedScenario,
} from '../../src/ports/provider.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures, setFixture } from '../doubles/context-resolver.js';
import { createMemoryPool, emptyStore, type MemoryStore } from './memory-pool.js';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const OFFICER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const TRACE = '0af7651916cd43dd8448eb211c80319c';
export const NOW = new Date('2026-10-04T12:00:00.000Z');

export const EVAL_REF = {
  dataset_id: 'eval-set',
  dataset_version: '1',
  threshold: 0.9,
  result: 'PASSED',
};

export function ctxFor(tenant: string, actor = OFFICER): RequestContext {
  return {
    tenant_id: tenant,
    cell_id: 'cell-01',
    actor: { type: 'OFFICER', id: actor },
    roles: ['AI_OPERATOR'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
  };
}

export interface Harness {
  app: FastifyInstance;
  store: MemoryStore;
  authorizer: ContractAuthorizer;
  consent: SimulatedPurposeConsentPort;
  sources: SimulatedSourceAclPort;
  providers: Map<string, SimulatedModelProvider>;
  call: (
    tenant: string,
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
    key?: string,
  ) => Promise<{ status: number; body: Record<string, unknown> }>;
}

export async function buildHarness(
  scenarios: Record<string, SimulatedScenario> = {},
  options: { store?: MemoryStore; rateLimitMax?: number } = {},
): Promise<Harness> {
  fixtures.clear();
  const store = options.store ?? emptyStore();
  const config = loadConfig({
    SF_ENVIRONMENT: 'CI',
    SF_CMP039_PROVIDER_MODE: 'SIMULATED',
    SF_CMP039_RATE_LIMIT_MAX: String(options.rateLimitMax ?? 1000),
  });
  const providers = new Map<string, SimulatedModelProvider>();
  for (const id of ['sim-primary', 'sim-secondary']) {
    providers.set(id, new SimulatedModelProvider(id, config, scenarios[id] ?? 'advisory_success'));
  }
  const authorizer = new ContractAuthorizer();
  const consent = new SimulatedPurposeConsentPort();
  const sources = new SimulatedSourceAclPort();
  const app = Fastify({ logger: false });
  await registerAiGateway(app, {
    pool: createMemoryPool(store),
    resolveContext: fixtureResolver,
    authorizer,
    providers: providers as ReadonlyMap<string, ModelProviderPort>,
    consent,
    sources,
    config,
    clock: () => NOW,
  });
  let n = 0;
  const call: Harness['call'] = async (tenant, method, url, body, key) => {
    const token = `tok-${tenant}`;
    setFixture(token, ctxFor(tenant));
    n += 1;
    const res = await app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === 'POST' ? { 'idempotency-key': key ?? `key-${n}` } : {}),
      },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  };
  return { app, store, authorizer, consent, sources, providers, call };
}

export const MODEL_BODY = {
  provider_id: 'sim-primary',
  model_id: 'sim-model',
  model_version: '2026-10-01',
  operations: ['INVOKE', 'EMBED'],
  max_data_classification: 'PERSONAL',
  max_input_chars: 5000,
  max_output_tokens: 256,
  daily_token_budget: 100000,
};

export async function seedModel(
  h: Harness,
  tenant: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await h.call(tenant, 'POST', '/v1/ai/admin/models', { ...MODEL_BODY, ...overrides });
  if (res.status !== 201) throw new Error(`seedModel failed ${res.status}`);
  return res.body['model_entry_id'] as string;
}

export function policyBody(modelIds: string[], overrides: Record<string, unknown> = {}) {
  return {
    policy_id: 'draft-reply',
    policy_version: 1,
    task_kind: 'DRAFT',
    template_body: 'Draft a polite reply about: {{subject}}',
    allowed_tools: [
      { tool_id: 'lookup_faq', version: '1', scopes: ['faq:read'], effect: 'READ_ONLY' },
    ],
    model_entry_ids: modelIds,
    max_data_classification: 'PERSONAL',
    max_output_tokens: 128,
    latency_budget_ms: 400,
    fallback_behavior: 'NON_AI_PATH',
    evaluation_ref: EVAL_REF,
    ...overrides,
  };
}

export async function seedPolicy(
  h: Harness,
  tenant: string,
  modelIds: string[],
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const res = await h.call(
    tenant,
    'POST',
    '/v1/ai/admin/policies',
    policyBody(modelIds, overrides),
  );
  if (res.status !== 201)
    throw new Error(`seedPolicy failed ${res.status} ${JSON.stringify(res.body)}`);
}

export const INVOKE_BODY = {
  policy_id: 'draft-reply',
  policy_version: 1,
  purpose: 'officer drafting assistance',
  data_classification: 'INTERNAL',
  variables: { subject: 'office opening hours' },
};
