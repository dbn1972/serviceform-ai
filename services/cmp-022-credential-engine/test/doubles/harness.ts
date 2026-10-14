import { createCredentialApi, type ApiResponse } from '../../src/api/handler.js';
import type { DeploymentEnvironment } from '../../src/domain/signing.js';
import { buildCredentialService } from '../../src/index.js';
import type { RequestContext, TenantContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  ctxFor,
  FakeCasePins,
  FakeRegistry,
  FakeRenderer,
  FakeSigner,
  MutableClock,
  TENANT_A,
  TxProbe,
} from './fixtures.js';
import { MemoryCredentialRepository } from './memory-repo.js';

export interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export function makeHarness(opts: { environment?: DeploymentEnvironment; startIso?: string } = {}) {
  const repo = new MemoryCredentialRepository();
  const probe = new TxProbe();
  probe.repo = repo;
  const clock = new MutableClock(Date.parse(opts.startIso ?? '2026-10-14T04:00:00Z'));
  const authorizer = new AllowAllAuthorizer();
  const casePins = new FakeCasePins(probe);
  const renderer = new FakeRenderer(probe);
  const signer = new FakeSigner(probe);
  const registry = new FakeRegistry(probe);
  const state: { ctx: TenantContext | RequestContext | null } = { ctx: ctxFor(TENANT_A) };
  const service = buildCredentialService({
    repository: repo,
    authorizer,
    casePins,
    renderer,
    signing: signer,
    registry,
    environment: opts.environment ?? 'CI',
    clock: clock.now,
  });
  const api = createCredentialApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
  let counter = 0;

  async function call(
    method: string,
    path: string,
    body?: unknown,
    callOpts: CallOptions = {},
  ): Promise<ApiResponse> {
    counter += 1;
    const headers: Record<string, string> = { ...(callOpts.headers ?? {}) };
    if (callOpts.key !== null)
      headers['idempotency-key'] = callOpts.key ?? `test-key-${String(counter).padStart(6, '0')}`;
    return api.handle({
      method,
      path,
      headers,
      body,
      ...(callOpts.query ? { query: callOpts.query } : {}),
    });
  }

  return {
    repo,
    probe,
    clock,
    authorizer,
    casePins,
    renderer,
    signer,
    registry,
    state,
    service,
    api,
    call,
  };
}

export type Harness = ReturnType<typeof makeHarness>;
