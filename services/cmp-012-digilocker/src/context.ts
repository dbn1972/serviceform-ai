import { Cmp012Error } from './errors.js';
import type { RequestContext, TenantContext } from './types.js';

export type ContextResolver = (
  headers: Readonly<Record<string, string | string[] | undefined>>,
) => Promise<RequestContext | null>;

export function requireTenantContext(ctx: RequestContext | null): TenantContext {
  if (ctx === null || ctx.tenant_id === null) {
    throw new Cmp012Error('SF-TEN-001');
  }
  return ctx as TenantContext;
}

/**
 * SF-TEN-002: reject any header that could carry a forged tenant identity.
 * Patterns cover the full peer set — not only three exact names.
 *
 * Prefix patterns (prefix match):
 *   x-tenant-*         forged tenant routing / scoping
 *   x-sf-*             ServiceForm internal hop headers injected by callers
 *   x-forwarded-tenant explicit forwarding shim
 *
 * Exact names (legacy / common bypass names):
 *   x-real-tenant-id, x-bypass-rls, x-override-tenant
 *
 * Structured header:
 *   Forwarded          RFC 7239 — refuse if any token segment contains tenant=
 */
const TENANT_HEADER_PREFIX_PATTERNS: readonly RegExp[] = [
  /^x-tenant-/,
  /^x-sf-/,
  /^x-forwarded-tenant$/,
];

const TENANT_HEADER_EXACT: readonly string[] = [
  'x-real-tenant-id',
  'x-bypass-rls',
  'x-override-tenant',
];

function headerContainsTenantParam(value: string | string[] | undefined): boolean {
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '');
  return /\btenant\s*=/i.test(raw);
}

export function assertNoTenantIdentifyingHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): void {
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (TENANT_HEADER_EXACT.includes(lk)) {
      throw new Cmp012Error('SF-TEN-002');
    }
    if (TENANT_HEADER_PREFIX_PATTERNS.some((re) => re.test(lk))) {
      throw new Cmp012Error('SF-TEN-002');
    }
    if (lk === 'forwarded' && headerContainsTenantParam(v)) {
      throw new Cmp012Error('SF-TEN-002');
    }
  }
}
