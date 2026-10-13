import { createDiscoveryApi, type ApiResponse } from '../../src/api/handler.js';
import { buildServiceDiscoveryService } from '../../src/index.js';
import type { DiscoveryRepository } from '../../src/repo/types.js';
import type { RequestContext, TenantContext } from '../../src/types.js';
import { ctxFor, MutableClock, ScriptedAuthorizer, TENANT_A } from './fixtures.js';
import { MemoryDiscoveryRepository } from './memory-repo.js';
import { FakeCatalogue, FakeJurisdictions, FakeLocalization, FakeSearch } from './ports.js';

export interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export function makeHarness(
  repository: DiscoveryRepository = new MemoryDiscoveryRepository(),
  startIso = '2026-10-13T10:00:00Z',
) {
  const clock = new MutableClock(Date.parse(startIso));
  const authorizer = new ScriptedAuthorizer();
  const catalogue = new FakeCatalogue();
  const jurisdictions = new FakeJurisdictions();
  const search = new FakeSearch();
  const localization = new FakeLocalization();
  const state: { ctx: TenantContext | RequestContext | null } = { ctx: ctxFor(TENANT_A) };
  const service = buildServiceDiscoveryService({
    repository,
    authorizer,
    catalogue,
    jurisdictions,
    search,
    localization,
    clock: clock.now,
  });
  const api = createDiscoveryApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
  let counter = 0;

  async function call(
    method: string,
    path: string,
    body?: unknown,
    opts: CallOptions = {},
  ): Promise<ApiResponse> {
    counter += 1;
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (method === 'POST' && path.endsWith('/selections') && opts.key !== null) {
      headers['idempotency-key'] = opts.key ?? `test-key-${String(counter).padStart(6, '0')}`;
    }
    return api.handle({ method, path, headers, query: opts.query ?? {}, body });
  }

  return {
    repo: repository,
    clock,
    authorizer,
    catalogue,
    jurisdictions,
    search,
    localization,
    state,
    service,
    api,
    call,
  };
}

export type Harness = ReturnType<typeof makeHarness>;
