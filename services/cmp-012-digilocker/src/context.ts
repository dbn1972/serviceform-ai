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

const TENANT_LEAK_HEADERS = ['x-real-tenant-id', 'x-bypass-rls', 'x-override-tenant'];

export function assertNoTenantIdentifyingHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): void {
  for (const [k] of Object.entries(headers)) {
    if (TENANT_LEAK_HEADERS.includes(k.toLowerCase())) {
      throw new Cmp012Error('SF-TEN-002');
    }
  }
}
