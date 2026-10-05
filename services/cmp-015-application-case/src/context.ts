import { Cmp015Error } from './errors.js';
import { isRequestContext, type TenantRequestContext } from './domain/validate.js';

/**
 * Tenant and actor come only from the server-derived RequestContext (Constitution #6; TI v1.0 s6).
 * Any client header that tries to name a tenant, role or actor is refused with SF-TEN-002.
 */
const ROLE_ACTOR_HEADERS = new Set([
  'x-roles',
  'x-org-id',
  'x-actor-type',
  'x-actor-id',
  'x-assurance',
]);

export type HeaderBag = Record<string, string | string[] | undefined>;

export function isForbiddenHeaderName(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes('tenant')) return true;
  if (n.startsWith('x-sf-')) return true;
  return ROLE_ACTOR_HEADERS.has(n);
}

export function assertNoTenantIdentifyingHeaders(headers: HeaderBag): void {
  for (const [name, raw] of Object.entries(headers)) {
    if (isForbiddenHeaderName(name)) throw new Cmp015Error('SF-TEN-002');
    if (name.toLowerCase() === 'forwarded') {
      const text = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
      if (/(?:^|;|,|\s)tenant\s*=/i.test(text)) throw new Cmp015Error('SF-TEN-002');
    }
  }
}

export function requireTenantContext(value: unknown): TenantRequestContext {
  if (value === null || value === undefined) throw new Cmp015Error('SF-AUTH-001');
  if (!isRequestContext(value)) throw new Cmp015Error('SF-AUTH-001');
  if (value.tenant_id === null) throw new Cmp015Error('SF-TEN-001', { statusCode: 401 });
  return value as TenantRequestContext;
}
