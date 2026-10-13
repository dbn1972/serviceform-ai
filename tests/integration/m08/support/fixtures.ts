import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { validate, type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import { loadConfig } from '../../../../apps/api/src/config.js';

/** Synthetic identifiers only. No real tenant, jurisdiction, service or person. */
export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const CANARY = '00000000-0000-4000-8000-000000000099';
export const DOC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const CITIZEN_1 = '55555555-5555-4555-8555-555555555555';
export const CITIZEN_2 = '56565656-5656-4565-8565-565656565656';
export const OFFICER_1 = '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42';

export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`${what} missing`);
  return value;
}

export const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-m08-int',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '1000',
});

export function silentLogger() {
  const destination = new Writable({
    write(_chunk: Buffer, _e, cb) {
      cb();
    },
  });
  return createLogger({ service: 'm08-int', version: 'test', level: 'silent', destination });
}

export function ctxFor(
  tenantId: string,
  actorId: string,
  type: RequestContext['actor']['type'],
): RequestContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-local',
    actor: { type, id: actorId },
    roles: type === 'CITIZEN' ? ['CITIZEN'] : ['SERVICE_CHECKER'],
    jurisdiction_ids: [],
    auth_assurance: type === 'CITIZEN' ? 'OTP' : 'MFA',
    correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
    trace_id: '0af7651916cd43dd8448eb211c80319c',
  };
}

/** Server-side identity holder; the host resolves context from here, never from headers. */
export class ContextState {
  ctx: RequestContext | null;
  constructor(initial: RequestContext | null) {
    this.ctx = initial;
  }
  resolve = async (): Promise<RequestContext | null> => this.ctx;
}

export interface AuthzCall {
  subject: { tenant_id: string | null; actor_type: string };
  resource: { tenant_id: string | null; resource_type: string };
  action: string;
}

export class RecordingAuthorizer {
  readonly calls: AuthzCall[] = [];
  denied = new Set<string>();
  fail = false;
  decide = async (input: AuthzCall) => {
    this.calls.push(structuredClone(input));
    if (this.fail) throw new Error('pdp unavailable');
    const deny = this.denied.has(input.action);
    return {
      allow: !deny,
      reason_code: deny ? 'DENY' : 'ALLOW',
      policy_revision: 'int-rev-1',
      decision_id: '88888888-8888-4888-8888-888888888888',
    };
  };
}

export interface OutboxEnvelope {
  event_type: string;
  tenant_id: string | null;
  data: object;
}

export interface OutboxRow {
  topic: string;
  envelope: OutboxEnvelope;
}

/**
 * Tenant-partitioned key/value transaction store with all-or-nothing commit and a guard that
 * mirrors the "no network inside the authoritative transaction" rule.
 */
export class TenantPartitionedStore<S extends { outbox: OutboxRow[] }> {
  private readonly stores = new Map<string, S>();
  private depth = 0;
  constructor(private readonly empty: () => S) {}

  tenant(tenantId: string): S {
    let s = this.stores.get(tenantId);
    if (!s) {
      s = this.empty();
      this.stores.set(tenantId, s);
    }
    return s;
  }

  tenants(): string[] {
    return [...this.stores.keys()];
  }

  inTransaction(): boolean {
    return this.depth > 0;
  }

  async run<T>(ctx: RequestContext, fn: (s: S) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Error('tenant required');
    if (this.depth > 0) throw new Error('nested transaction');
    const store = this.tenant(ctx.tenant_id);
    const backup = structuredClone(store);
    this.depth += 1;
    try {
      return await fn(store);
    } catch (err) {
      Object.assign(store, backup);
      throw err;
    } finally {
      this.depth -= 1;
    }
  }
}

export interface IdemRow {
  fingerprint: string;
  response?: { status: number; body: unknown };
}

export function claim(
  map: Map<string, IdemRow>,
  p: { principalId: string; endpoint: string; key: string; fingerprint: string },
  conflict: () => Error,
): { status: number; body: unknown } | 'claimed' {
  const id = `${p.principalId}|${p.endpoint}|${p.key}`;
  const existing = map.get(id);
  if (!existing) {
    map.set(id, { fingerprint: p.fingerprint });
    return 'claimed';
  }
  if (existing.fingerprint !== p.fingerprint || !existing.response) throw conflict();
  return structuredClone(existing.response);
}

export function complete(
  map: Map<string, IdemRow>,
  p: { principalId: string; endpoint: string; key: string; status: number; body: unknown },
): void {
  const row = map.get(`${p.principalId}|${p.endpoint}|${p.key}`);
  if (row) row.response = structuredClone({ status: p.status, body: p.body });
}

export async function expectForgedTenantDenied(
  app: FastifyInstance,
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
): Promise<void> {
  for (const headers of [
    { 'x-tenant-id': CANARY },
    { 'X-Tenant-ID': CANARY, 'x-tenant': CANARY },
  ]) {
    const res = await app.inject({
      method,
      url,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    expect(res.statusCode, `${method} ${url}`).toBe(403);
    expect(validate('error-response', res.json()).valid).toBe(true);
    expect(res.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(res.body).not.toContain(CANARY);
  }
}
