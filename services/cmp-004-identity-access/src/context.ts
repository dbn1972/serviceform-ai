import { validate, type RequestContext } from '@serviceform/contracts';
import type { FastifyRequest } from 'fastify';
import { Cmp004Error } from './errors.js';

const ROLE_ACTOR_HEADERS = new Set(['x-roles', 'x-org-id', 'x-actor-type', 'x-assurance']);

export function isForbiddenHeaderName(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes('tenant')) return true;
  if (n.startsWith('x-sf-')) return true;
  return ROLE_ACTOR_HEADERS.has(n);
}

export function forwardedCarriesTenant(value: string): boolean {
  return /(?:^|;|\s)tenant\s*=/i.test(value);
}

export function assertNoTenantIdentifyingHeaders(request: FastifyRequest): void {
  for (const [name, raw] of Object.entries(request.headers)) {
    if (isForbiddenHeaderName(name)) {
      throw new Cmp004Error('SF-TEN-002');
    }
    if (name.toLowerCase() === 'forwarded') {
      const text = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
      if (forwardedCarriesTenant(String(text))) throw new Cmp004Error('SF-TEN-002');
    }
  }
}

export type ContextResolver = (request: FastifyRequest) => Promise<RequestContext | null>;

export function requireContext(value: unknown, tenantRequired: boolean): RequestContext {
  if (value === null || value === undefined) {
    throw new Cmp004Error('SF-AUTH-001');
  }
  const result = validate('request-context', value);
  if (!result.valid) throw new Cmp004Error('SF-AUTH-001');
  const ctx = value as RequestContext;
  if (tenantRequired && ctx.tenant_id === null) {
    throw new Cmp004Error('SF-TEN-001', { statusCode: 401 });
  }
  return ctx;
}

export function assertTenantRouteId(ctx: RequestContext, id: string): void {
  if (ctx.tenant_id !== id) throw new Cmp004Error('SF-TEN-002');
}

export const PLATFORM_SYSTEM_ACTOR = 'bf5c3dae-06c2-4f4e-97bf-e2ad8ec06b3b';

export function platformContext(
  cellId: string,
  correlationId: string,
  traceId: string,
): RequestContext {
  return {
    tenant_id: null,
    cell_id: cellId,
    actor: { type: 'SYSTEM', id: PLATFORM_SYSTEM_ACTOR },
    roles: [],
    jurisdiction_ids: [],
    auth_assurance: 'NONE',
    correlation_id: correlationId,
    trace_id: traceId,
  };
}
