import { createFeeApi, type ApiResponse } from '../../src/api/handler.js';
import { buildFeeService } from '../../src/index.js';
import type { RequestContext, TenantContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  ctxFor,
  FakeApplicationPins,
  FakeFeePolicy,
  FakeFeeRules,
  MutableClock,
  TENANT_A,
  TxProbe,
} from './fixtures.js';
import { MemoryFeeRepository } from './memory-repo.js';

export interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export function makeHarness(startIso = '2026-10-10T02:00:00Z') {
  const repo = new MemoryFeeRepository();
  const probe = new TxProbe();
  probe.repo = repo;
  const clock = new MutableClock(Date.parse(startIso));
  const authorizer = new AllowAllAuthorizer();
  const pins = new FakeApplicationPins(probe);
  const policies = new FakeFeePolicy(probe);
  const rules = new FakeFeeRules(probe);
  const state: { ctx: TenantContext | RequestContext | null } = { ctx: ctxFor(TENANT_A) };
  const service = buildFeeService({
    repository: repo,
    authorizer,
    applicationPins: pins,
    feePolicy: policies,
    feeRules: rules,
    clock: clock.now,
  });
  const api = createFeeApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
  let counter = 0;

  async function call(
    method: string,
    path: string,
    body?: unknown,
    opts: CallOptions = {},
  ): Promise<ApiResponse> {
    counter += 1;
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.key !== null)
      headers['idempotency-key'] = opts.key ?? `test-key-${String(counter).padStart(6, '0')}`;
    return api.handle({
      method,
      path,
      headers,
      body,
      ...(opts.query ? { query: opts.query } : {}),
    });
  }

  return { repo, probe, clock, authorizer, pins, policies, rules, state, service, api, call };
}

export type Harness = ReturnType<typeof makeHarness>;
