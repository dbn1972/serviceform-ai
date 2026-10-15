import { createSchedulerApi, type ApiResponse } from '../../src/api/handler.js';
import { buildSchedulerService } from '../../src/index.js';
import type { SchedulerRepository } from '../../src/repo/types.js';
import type { RequestContext, TenantContext } from '../../src/types.js';
import {
  ctxFor,
  MutableClock,
  ScriptedAuthorizer,
  ScriptedNotifier,
  TENANT_A,
} from './fixtures.js';
import { MemorySchedulerRepository } from './memory-repo.js';

export interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export function makeHarness(
  startIso = '2026-10-10T10:00:00Z',
  repository: SchedulerRepository = new MemorySchedulerRepository(),
) {
  const clock = new MutableClock(Date.parse(startIso));
  const authorizer = new ScriptedAuthorizer();
  const notifier = new ScriptedNotifier();
  const state: { ctx: TenantContext | RequestContext | null } = { ctx: ctxFor(TENANT_A) };
  const service = buildSchedulerService({
    repository,
    authorizer,
    notifier,
    clock: clock.now,
  });
  const api = createSchedulerApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
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

  return { repo: repository, clock, authorizer, notifier, state, service, api, call };
}

export type Harness = ReturnType<typeof makeHarness>;
