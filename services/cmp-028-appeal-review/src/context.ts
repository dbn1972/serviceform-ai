import { validate, type RequestContext } from './contracts.js';
import { Cmp028Error } from './errors.js';

const ROLE_ACTOR_HEADERS = new Set(['x-roles', 'x-org-id', 'x-actor-type', 'x-assurance']);

export type HeaderMap = Readonly<Record<string, string | string[] | undefined>>;

export function isForbiddenHeaderName(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes('tenant')) return true;
  if (n.startsWith('x-sf-')) return true;
  return ROLE_ACTOR_HEADERS.has(n);
}

export function forwardedCarriesTenant(value: string): boolean {
  return /(?:^|;|\s)tenant\s*=/i.test(value);
}

/** Tenant, role and actor identity are server-derived; a client-supplied hint is a hard refusal. */
export function assertNoTenantIdentifyingHeaders(headers: HeaderMap): void {
  for (const [name, raw] of Object.entries(headers)) {
    if (isForbiddenHeaderName(name)) throw new Cmp028Error('SF-TEN-002');
    if (name.toLowerCase() === 'forwarded') {
      const text = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
      if (forwardedCarriesTenant(String(text))) throw new Cmp028Error('SF-TEN-002');
    }
  }
}

export type TenantContext = RequestContext & { tenant_id: string };

export function requireTenantContext(value: unknown): TenantContext {
  if (value === null || value === undefined) throw new Cmp028Error('SF-AUTH-001');
  if (!validate('request-context', value).valid) throw new Cmp028Error('SF-AUTH-001');
  const ctx = value as RequestContext;
  if (ctx.tenant_id === null) throw new Cmp028Error('SF-TEN-001', { statusCode: 401 });
  return ctx as TenantContext;
}
