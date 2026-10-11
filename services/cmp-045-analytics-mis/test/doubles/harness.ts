import { createAnalyticsApi, type ApiResponse } from '../../src/api/handler.js';
import { buildAnalyticsService } from '../../src/index.js';
import type { RequestContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  CONSUMER_ACTOR,
  COUNT_DEFINITION,
  ctxFor,
  eventFor,
  MutableClock,
  SimulatedReplaySource,
  TENANT_A,
} from './fixtures.js';
import { MemoryAnalyticsRepository } from './memory-repo.js';

export interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export function makeHarness(startIso = '2026-10-06T10:00:00Z') {
  const repo = new MemoryAnalyticsRepository();
  const clock = new MutableClock(Date.parse(startIso));
  const authorizer = new AllowAllAuthorizer();
  const replay = new SimulatedReplaySource();
  const state: { ctx: RequestContext | null } = { ctx: ctxFor(TENANT_A) };
  const service = buildAnalyticsService({
    repository: repo,
    authorizer,
    replay,
    clock: clock.now,
    consumerActorId: CONSUMER_ACTOR,
    rebuildBatchSize: 2,
  });
  const api = createAnalyticsApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
  let counter = 0;

  async function call(
    method: string,
    path: string,
    body?: unknown,
    opts: CallOptions = {},
  ): Promise<ApiResponse> {
    counter += 1;
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.key !== null && method !== 'GET') {
      headers['idempotency-key'] = opts.key ?? `test-key-${String(counter).padStart(6, '0')}`;
    }
    return api.handle({
      method,
      path,
      headers,
      ...(opts.query ? { query: opts.query } : {}),
      body,
    });
  }

  async function publish(body: object = COUNT_DEFINITION): Promise<string> {
    const res = await call('POST', '/v1/analytics/metric-definitions', body);
    if (res.status !== 201) throw new Error(`publish failed: ${JSON.stringify(res.body)}`);
    return (res.body as { definition: { definition_id: string } }).definition.definition_id;
  }

  function submitted(
    tenantId: string,
    data: Record<string, unknown>,
    occurredAt = '2026-10-05T09:30:00.000Z',
  ) {
    return eventFor(tenantId, data, { occurred_at: occurredAt });
  }

  return { repo, clock, authorizer, replay, state, service, api, call, publish, submitted };
}

export type Harness = ReturnType<typeof makeHarness>;
