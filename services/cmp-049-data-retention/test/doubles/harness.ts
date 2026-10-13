import { createRetentionApi, type ApiResponse } from '../../src/api/handler.js';
import { buildDataRetentionService } from '../../src/index.js';
import type { RetentionRepository } from '../../src/repo/types.js';
import type { RequestContext, TenantContext } from '../../src/types.js';
import { ctxFor, MutableClock, ScriptedAuthorizer, TENANT_A } from './fixtures.js';
import { MemoryRetentionRepository } from './memory-repo.js';

export interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export function makeHarness(
  startIso = '2026-10-10T10:00:00Z',
  repository: RetentionRepository = new MemoryRetentionRepository(),
) {
  const clock = new MutableClock(Date.parse(startIso));
  const authorizer = new ScriptedAuthorizer();
  const state: { ctx: TenantContext | RequestContext | null } = { ctx: ctxFor(TENANT_A) };
  const service = buildDataRetentionService({ repository, authorizer, clock: clock.now });
  const api = createRetentionApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
  let counter = 0;

  async function call(
    method: string,
    path: string,
    body?: unknown,
    opts: CallOptions = {},
  ): Promise<ApiResponse> {
    counter += 1;
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (method === 'POST' && opts.key !== null) {
      headers['idempotency-key'] = opts.key ?? `test-key-${String(counter).padStart(6, '0')}`;
    }
    return api.handle({ method, path, headers, query: opts.query ?? {}, body });
  }

  return { repo: repository, clock, authorizer, state, service, api, call };
}

export type Harness = ReturnType<typeof makeHarness>;
