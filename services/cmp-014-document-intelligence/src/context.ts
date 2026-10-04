import { validate, type RequestContext } from '@serviceform/contracts';
import type { FastifyRequest } from 'fastify';
import { Cmp014Error } from './errors.js';

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
    if (isForbiddenHeaderName(name)) throw new Cmp014Error('SF-TEN-002');
    if (name.toLowerCase() === 'forwarded') {
      const text = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
      if (forwardedCarriesTenant(String(text))) throw new Cmp014Error('SF-TEN-002');
    }
  }
}

export type ContextResolver = (request: FastifyRequest) => Promise<RequestContext | null>;

export function requireTenantContext(value: unknown): RequestContext & { tenant_id: string } {
  if (value === null || value === undefined) throw new Cmp014Error('SF-AUTH-001');
  if (!validate('request-context', value).valid) throw new Cmp014Error('SF-AUTH-001');
  const ctx = value as RequestContext;
  if (ctx.tenant_id === null) throw new Cmp014Error('SF-TEN-001', { statusCode: 401 });
  return ctx as RequestContext & { tenant_id: string };
}
