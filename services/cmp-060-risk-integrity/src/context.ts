/**
 * INT-011: tenant and actor identity come only from the host-resolved request context.
 * Caller-supplied tenant headers / body tenant_id are rejected.
 */

import { Cmp060Error } from './errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export interface RequestContext {
  tenant_id: string | null;
  cell_id: string;
  correlation_id: string;
  trace_id: string;
  actor: { id: string; type: string };
  roles: string[];
  jurisdiction_ids: string[];
}

export type TenantContext = RequestContext & { tenant_id: string };

const ROLE_ACTOR_HEADERS = new Set(['x-roles', 'x-org-id', 'x-actor-type', 'x-assurance']);

export function isForbiddenHeaderName(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('tenant') || n.startsWith('x-sf-') || ROLE_ACTOR_HEADERS.has(n);
}

export function assertNoTenantIdentifyingHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): void {
  for (const [name, raw] of Object.entries(headers)) {
    if (isForbiddenHeaderName(name)) throw new Cmp060Error('SF-TEN-002');
    if (name.toLowerCase() === 'forwarded') {
      const text = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
      if (/(?:^|;|\s)tenant\s*=/i.test(text)) throw new Cmp060Error('SF-TEN-002');
    }
  }
}

export type ContextResolver = (
  headers: Readonly<Record<string, string | string[] | undefined>>,
) => Promise<RequestContext | null>;

export function requireTenantContext(value: RequestContext | null | undefined): TenantContext {
  if (value === null || value === undefined) {
    throw new Cmp060Error('SF-TEN-001', { details: [{ code: 'AUTH_REQUIRED' }] });
  }
  const ok =
    typeof value.cell_id === 'string' &&
    typeof value.trace_id === 'string' &&
    typeof value.correlation_id === 'string' &&
    isUuid(value.correlation_id) &&
    typeof value.actor?.id === 'string' &&
    isUuid(value.actor.id) &&
    Array.isArray(value.roles) &&
    Array.isArray(value.jurisdiction_ids);
  if (!ok) {
    throw new Cmp060Error('SF-TEN-001', { details: [{ code: 'AUTH_REQUIRED' }] });
  }
  if (value.tenant_id === null || value.tenant_id === undefined || !isUuid(value.tenant_id)) {
    throw new Cmp060Error('SF-TEN-001', { details: [{ code: 'TENANT_REQUIRED' }] });
  }
  return value as TenantContext;
}
