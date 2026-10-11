import { Cmp025Error } from './errors.js';
import type { RequestContext, TenantContext } from './types.js';
import { isUuid } from './domain/uuid.js';

const ROLE_ACTOR_HEADERS = new Set(['x-roles', 'x-org-id', 'x-actor-type', 'x-assurance']);

export function isForbiddenHeaderName(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('tenant') || n.startsWith('x-sf-') || ROLE_ACTOR_HEADERS.has(n);
}

export function assertNoTenantIdentifyingHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): void {
  for (const [name, raw] of Object.entries(headers)) {
    if (isForbiddenHeaderName(name)) throw new Cmp025Error('SF-TEN-002');
    if (name.toLowerCase() === 'forwarded') {
      const text = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
      if (/(?:^|;|\s)tenant\s*=/i.test(text)) throw new Cmp025Error('SF-TEN-002');
    }
  }
}

function isPurposeCode(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value);
}

export type ContextResolver = (
  headers: Readonly<Record<string, string | string[] | undefined>>,
) => Promise<RequestContext | null>;

export function requireTenantContext(value: RequestContext | null | undefined): TenantContext {
  if (value === null || value === undefined) throw new Cmp025Error('SF-AUTH-001');
  const ok =
    typeof value.cell_id === 'string' &&
    typeof value.trace_id === 'string' &&
    typeof value.correlation_id === 'string' &&
    isUuid(value.correlation_id) &&
    typeof value.actor?.id === 'string' &&
    isUuid(value.actor.id) &&
    Array.isArray(value.roles) &&
    Array.isArray(value.jurisdiction_ids);
  if (!ok) throw new Cmp025Error('SF-AUTH-001');
  // SF-CON-REQUEST-CONTEXT: an INTEGRATION actor must declare the purpose its credential is scoped to.
  if (value.actor.type === 'INTEGRATION' && !isPurposeCode(value.purpose)) {
    throw new Cmp025Error('SF-AUTH-001');
  }
  if (value.tenant_id === null || value.tenant_id === undefined || !isUuid(value.tenant_id)) {
    throw new Cmp025Error('SF-TEN-001');
  }
  return value as TenantContext;
}
