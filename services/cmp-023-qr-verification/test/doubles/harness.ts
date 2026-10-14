import { createQrApi, type ApiResponse } from '../../src/api/handler.js';
import { buildQrVerificationService } from '../../src/index.js';
import type { QrRepository } from '../../src/repo/types.js';
import type { RequestContext, TenantContext } from '../../src/types.js';
import { ctxFor, MutableClock, ScriptedAuthorizer, TENANT_A } from './fixtures.js';
import { MemoryQrRepository } from './memory-repo.js';
import { FakeCredentials, FakeRegistry, TxProbe } from './ports.js';

export interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export function makeHarness(
  repository: QrRepository = new MemoryQrRepository(),
  startIso = '2026-10-14T10:00:00Z',
) {
  const clock = new MutableClock(Date.parse(startIso));
  const authorizer = new ScriptedAuthorizer();
  const probe = new TxProbe();
  probe.repo = repository;
  const registry = new FakeRegistry(probe);
  const credentials = new FakeCredentials(probe);
  const state: { ctx: TenantContext | RequestContext | null } = { ctx: ctxFor(TENANT_A) };
  const service = buildQrVerificationService({
    repository,
    authorizer,
    registry,
    credentials,
    clock: clock.now,
  });
  const api = createQrApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
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

  return {
    repo: repository,
    clock,
    authorizer,
    probe,
    registry,
    credentials,
    state,
    service,
    api,
    call,
  };
}

export type Harness = ReturnType<typeof makeHarness>;
