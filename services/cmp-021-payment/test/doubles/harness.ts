import { createPaymentApi, type ApiResponse } from '../../src/api/handler.js';
import { buildPaymentService } from '../../src/index.js';
import type { RequestContext, TenantContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  ctxFor,
  FakeConnectorBindingPort,
  FakeFeeQuotePort,
  MutableClock,
  TENANT_A,
  TEST_RUN_ID,
  TxProbe,
} from './fixtures.js';
import { MemoryPaymentRepository } from './memory-repo.js';
import { SimulatedPspConnector } from '../../src/connectors/simulated-psp.js';
import type { SimulationMarker } from '../../src/domain/simulation.js';
import { buildSimulationMarker } from '../../src/domain/simulation.js';

export interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export function makeHarness(startIso = '2026-10-10T02:00:00Z') {
  const repo = new MemoryPaymentRepository();
  const probe = new TxProbe();
  probe.repo = repo;
  const clock = new MutableClock(Date.parse(startIso));
  const authorizer = new AllowAllAuthorizer();
  const feeQuote = new FakeFeeQuotePort(probe);
  const connectorBinding = new FakeConnectorBindingPort(probe);

  // Build a simulation marker for the default binding
  const defaultBinding = connectorBinding.binding!;
  const marker = buildSimulationMarker(defaultBinding, TEST_RUN_ID) as SimulationMarker;
  const gateway = new SimulatedPspConnector(marker);

  const state: { ctx: TenantContext | RequestContext | null } = { ctx: ctxFor(TENANT_A) };
  const service = buildPaymentService({
    repository: repo,
    authorizer,
    feeQuote,
    connectorBinding,
    gateway,
    runtimeEnvironment: 'LOCAL',
    clock: clock.now,
  });
  const api = createPaymentApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
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

  return {
    repo,
    probe,
    clock,
    authorizer,
    feeQuote,
    connectorBinding,
    gateway,
    state,
    service,
    api,
    call,
  };
}

export type Harness = ReturnType<typeof makeHarness>;
