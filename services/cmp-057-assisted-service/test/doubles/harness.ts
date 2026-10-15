import { createAssistedApi, type ApiResponse } from '../../src/api/handler.js';
import { buildAssistedSessionService } from '../../src/index.js';
import type { AssistedRepository } from '../../src/repo/types.js';
import type { RequestContext, TenantContext } from '../../src/types.js';
import {
  ctxFor,
  MutableClock,
  ScriptedAuthorizer,
  ScriptedVerification,
  TENANT_A,
} from './fixtures.js';
import { MemoryAssistedRepository } from './memory-repo.js';

export interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export function makeHarness(
  startIso = '2026-10-15T12:00:00Z',
  repository: AssistedRepository = new MemoryAssistedRepository(),
) {
  const clock = new MutableClock(Date.parse(startIso));
  const authorizer = new ScriptedAuthorizer();
  const verification = new ScriptedVerification();
  const state: { ctx: TenantContext | RequestContext | null } = { ctx: ctxFor(TENANT_A) };
  const service = buildAssistedSessionService({
    repository,
    authorizer,
    verification,
    clock: clock.now,
  });
  const api = createAssistedApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
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

  return { repo: repository, clock, authorizer, verification, state, service, api, call };
}

export type Harness = ReturnType<typeof makeHarness>;
