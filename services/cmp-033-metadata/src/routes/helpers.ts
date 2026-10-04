import type { RequestContext } from '@serviceform/contracts';
import type { Pool } from 'pg';
import type { AuthorizationPort } from '../authz.js';
import type { MetadataServiceConfig } from '../config.js';
import { Cmp033Error } from '../errors.js';
import type { SchemaRegistryPort } from '../ports/schema-registry.js';

export interface RouteDeps {
  pool: Pool;
  authorizer: AuthorizationPort;
  registry: SchemaRegistryPort;
  config: MetadataServiceConfig;
  clock: () => Date;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export function tenantId(ctx: RequestContext): string {
  return ctx.tenant_id as string;
}

export function requireIdempotencyKey(header: unknown): string {
  if (typeof header !== 'string' || header.length < 1 || header.length > 128) {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'IDEMPOTENCY_KEY_REQUIRED' }] });
  }
  return header;
}
