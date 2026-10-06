import { isUuid } from './domain/uuid.js';
import { Cmp029Error } from './errors.js';
import type { RequestContext, TenantContext } from './types.js';

const ROLE_ACTOR_HEADERS = new Set(['x-roles', 'x-org-id', 'x-actor-type', 'x-assurance']);

/** Identity and tenant are server-derived (SF-CON-REQUEST-CONTEXT); callers may not assert them. */
export function isForbiddenHeaderName(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('tenant') || n.startsWith('x-sf-') || ROLE_ACTOR_HEADERS.has(n);
}

export function assertNoTenantIdentifyingHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): void {
  for (const [name, raw] of Object.entries(headers)) {
    if (isForbiddenHeaderName(name)) throw new Cmp029Error('SF-TEN-002');
    if (name.toLowerCase() === 'forwarded') {
      const text = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
      if (/(?:^|;|\s)tenant\s*=/i.test(text)) throw new Cmp029Error('SF-TEN-002');
    }
  }
}

export type ContextResolver = (
  headers: Readonly<Record<string, string | string[] | undefined>>,
) => Promise<RequestContext | null>;

export function requireTenantContext(value: RequestContext | null | undefined): TenantContext {
  if (value === null || value === undefined) throw new Cmp029Error('SF-AUTH-001');
  const ok =
    typeof value.cell_id === 'string' &&
    typeof value.trace_id === 'string' &&
    typeof value.correlation_id === 'string' &&
    isUuid(value.correlation_id) &&
    typeof value.actor?.id === 'string' &&
    isUuid(value.actor.id) &&
    Array.isArray(value.roles) &&
    Array.isArray(value.jurisdiction_ids);
  if (!ok) throw new Cmp029Error('SF-AUTH-001');
  if (value.tenant_id === null || value.tenant_id === undefined || !isUuid(value.tenant_id)) {
    throw new Cmp029Error('SF-TEN-001');
  }
  return value as TenantContext;
}
