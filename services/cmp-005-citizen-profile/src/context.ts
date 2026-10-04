import { validate, type RequestContext } from '@serviceform/contracts';
import type { FastifyRequest } from 'fastify';
import { Cmp005Error } from './errors.js';

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
      throw new Cmp005Error('SF-TEN-002');
    }
    if (name.toLowerCase() === 'forwarded') {
      const text = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
      if (forwardedCarriesTenant(String(text))) throw new Cmp005Error('SF-TEN-002');
    }
  }
}

export type ContextResolver = (request: FastifyRequest) => Promise<RequestContext | null>;

export function requireContext(value: unknown, tenantRequired: boolean): RequestContext {
  if (value === null || value === undefined) {
    throw new Cmp005Error('SF-AUTH-001');
  }
  const result = validate('request-context', value);
  if (!result.valid) throw new Cmp005Error('SF-AUTH-001');
  const ctx = value as RequestContext;
  if (tenantRequired && ctx.tenant_id === null)
    throw new Cmp005Error('SF-TEN-001', { statusCode: 401 });
  return ctx;
}
