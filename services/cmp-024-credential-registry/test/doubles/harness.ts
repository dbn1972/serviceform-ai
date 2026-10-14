import { createRegistryApi, type ApiResponse } from '../../src/api/handler.js';
import { buildCredentialRegistryService } from '../../src/index.js';
import type { RegistryRepository } from '../../src/repo/types.js';
import type { RequestContext, TenantContext } from '../../src/types.js';
import {
  ACTOR_OFFICER,
  ctxFor,
  ISSUER_REF,
  MutableClock,
  REASON_REF,
  ScriptedAuthorizer,
  TENANT_A,
} from './fixtures.js';
import { MemoryRegistryRepository } from './memory-repo.js';

export interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export const BASE = '/v1/credential-registry/credentials';
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function makeHarness(
  startIso = '2026-10-14T04:00:00Z',
  repository: RegistryRepository = new MemoryRegistryRepository(),
) {
  const clock = new MutableClock(Date.parse(startIso));
  const authorizer = new ScriptedAuthorizer();
  const state: { ctx: TenantContext | RequestContext | null } = { ctx: ctxFor(TENANT_A) };
  const service = buildCredentialRegistryService({ repository, authorizer, clock: clock.now });
  const api = createRegistryApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
  let counter = 0;

  async function call(
    method: string,
    path: string,
    body?: unknown,
    opts: CallOptions = {},
  ): Promise<ApiResponse & { body: Body }> {
    counter += 1;
    clock.advance(1000);
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (method === 'POST' && opts.key !== null) {
      headers['idempotency-key'] = opts.key ?? `test-key-${String(counter).padStart(6, '0')}`;
    }
    const res = await api.handle({ method, path, headers, query: opts.query ?? {}, body });
    return res as ApiResponse & { body: Body };
  }

  function as(tenant: string, actorId: string, type: RequestContext['actor']['type']): void {
    state.ctx = ctxFor(tenant, actorId, type);
  }

  async function register(credentialId: string, tenant = TENANT_A): Promise<Body> {
    as(tenant, ctxFor(tenant).actor.id, 'SYSTEM');
    const res = await call('POST', BASE, { credential_id: credentialId, issuer_ref: ISSUER_REF });
    if (res.status !== 201) throw new Error(`register failed ${JSON.stringify(res.body)}`);
    return res.body;
  }

  async function transition(
    credentialId: string,
    verb: string,
    expectedVersion: number,
    extra: Record<string, unknown> = {},
  ): Promise<ApiResponse & { body: Body }> {
    return call('POST', `${BASE}/${credentialId}/${verb}`, {
      expected_version: expectedVersion,
      ...extra,
    });
  }

  /** Registers and activates as SYSTEM, then switches to an officer context. */
  async function active(credentialId: string, tenant = TENANT_A): Promise<void> {
    await register(credentialId, tenant);
    const res = await transition(credentialId, 'activate', 1);
    if (res.status !== 200) throw new Error(`activate failed ${JSON.stringify(res.body)}`);
    as(tenant, ACTOR_OFFICER, 'OFFICER');
  }

  return {
    repo: repository,
    clock,
    authorizer,
    state,
    service,
    api,
    call,
    as,
    register,
    transition,
    active,
    reason: { reason_code_ref: REASON_REF },
  };
}

export type Harness = ReturnType<typeof makeHarness>;
