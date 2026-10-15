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
export const OFFICER_2 = '3d8b5f2c-8e4a-4b7c-9f3d-6a2b0c4e8f53';
export const ADMIN_1 = '4e7c6a3d-9f5b-4c8d-8a4e-7b3c1d5f9a64';

export const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-m09-int',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '1000',
});

export function silentLogger() {
  const destination = new Writable({
    write(_chunk: Buffer, _e, cb) {
      cb();
    },
  });
  return createLogger({ service: 'm09-int', version: 'test', level: 'silent', destination });
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
  denyAll = false;
  fail = false;
  decide = async (input: AuthzCall) => {
    this.calls.push(structuredClone(input));
    if (this.fail) throw new Error('pdp unavailable');
    const deny = this.denyAll || this.denied.has(input.action);
    return {
      allow: !deny,
      reason_code: deny ? 'DENY' : 'ALLOW',
      policy_revision: 'int-rev-1',
      decision_id: '88888888-8888-4888-8888-888888888888',
    };
  };
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

export function idemHeaders(key: string): Record<string, string> {
  return { 'idempotency-key': key };
}
