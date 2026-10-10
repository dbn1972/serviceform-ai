import { createOpsDashboardApi, type ApiResponse } from '../../src/api/handler.js';
import { VIEW_CODES, type ViewCode } from '../../src/domain/model.js';
import { buildOpsDashboardService } from '../../src/index.js';
import type { RequestContext, TenantContext } from '../../src/types.js';
import { ctxFor, MutableClock, ScriptedAuthorizer, ScriptedPort, TENANT_A } from './fixtures.js';
import { MemoryOpsRepository } from './memory-repo.js';

export interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export function makeHarness(startIso = '2026-10-10T10:00:00Z', portTimeoutMs = 200) {
  const repo = new MemoryOpsRepository();
  const clock = new MutableClock(Date.parse(startIso));
  const authorizer = new ScriptedAuthorizer();
  const ports = Object.fromEntries(VIEW_CODES.map((c) => [c, new ScriptedPort()])) as Record<
    ViewCode,
    ScriptedPort
  >;
  const state: { ctx: TenantContext | RequestContext | null } = { ctx: ctxFor(TENANT_A) };
  const service = buildOpsDashboardService({
    repository: repo,
    authorizer,
    ports,
    clock: clock.now,
    portTimeoutMs,
  });
  const api = createOpsDashboardApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
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

  return { repo, clock, authorizer, ports, state, service, api, call };
}

export type Harness = ReturnType<typeof makeHarness>;
