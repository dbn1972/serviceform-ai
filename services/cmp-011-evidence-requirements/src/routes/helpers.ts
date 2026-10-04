import type { RequestContext } from '@serviceform/contracts';
import { Cmp011Error } from '../errors.js';

export function tenantId(ctx: RequestContext): string {
  return ctx.tenant_id as string;
}

export function requireIdempotencyKey(header: unknown): string {
  if (typeof header !== 'string' || header.length < 1 || header.length > 128) {
    throw new Cmp011Error('SF-SYS-003', { details: [{ code: 'IDEMPOTENCY_KEY_REQUIRED' }] });
  }
  return header;
}
