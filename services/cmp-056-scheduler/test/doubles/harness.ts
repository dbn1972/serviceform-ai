import { createSchedulerApi, type ApiResponse } from '../../src/api/handler.js';
import { buildSchedulerService } from '../../src/index.js';
import type { RequestContext, TenantContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  ctxFor,
  MutableClock,
  slotInput,
  START_ISO,
  TENANT_A,
} from './fixtures.js';
import { MemorySchedulerRepository } from './memory-repo.js';

export interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function makeHarness(opts: { startIso?: string } = {}) {
  const repo = new MemorySchedulerRepository();
  const clock = new MutableClock(Date.parse(opts.startIso ?? START_ISO));
  const authorizer = new AllowAllAuthorizer();
  authorizer.repo = repo;
  const state: { ctx: TenantContext | RequestContext | null } = { ctx: ctxFor(TENANT_A) };
  const service = buildSchedulerService({ repository: repo, authorizer, clock: clock.now });
  const api = createSchedulerApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
  let counter = 0;

  async function call(
    method: string,
    path: string,
    body?: unknown,
    callOpts: CallOptions = {},
  ): Promise<ApiResponse> {
    counter += 1;
    const headers: Record<string, string> = { ...(callOpts.headers ?? {}) };
    const key =
      callOpts.key === undefined ? `test-key-${String(counter).padStart(6, '0')}` : callOpts.key;
    if (key !== null && method === 'POST') headers['idempotency-key'] = key;
    return api.handle({
      method,
      path,
      headers,
      body,
      ...(callOpts.query ? { query: callOpts.query } : {}),
    });
  }

  /** Publishes a slot as SYSTEM in the current tenant and restores the caller context. */
  async function publish(slotRef: string, overrides: Record<string, unknown> = {}): Promise<Body> {
    const saved = state.ctx;
    const tenant = saved?.tenant_id ?? TENANT_A;
    state.ctx = ctxFor(tenant);
    const res = await call('POST', '/v1/appointment-slots', slotInput(slotRef, overrides));
    state.ctx = saved;
    if (res.status !== 201) throw new Error(`publish failed: ${JSON.stringify(res.body)}`);
    return res.body as Body;
  }

  async function book(slotRef: string, extra: Record<string, unknown> = {}): Promise<ApiResponse> {
    return call('POST', '/v1/appointments', { slot_ref: slotRef, ...extra });
  }

  return { repo, clock, authorizer, state, service, api, call, publish, book };
}

export type Harness = ReturnType<typeof makeHarness>;
