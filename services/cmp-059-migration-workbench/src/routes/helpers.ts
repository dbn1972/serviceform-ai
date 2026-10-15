import type { Pool } from 'pg';
import type { RequestContext } from '@serviceform/contracts';
import type { AuthorizationPort } from '../authz.js';
import type { MigrationConfig } from '../config.js';

export interface RouteDeps {
  pool: Pool;
  authorizer: AuthorizationPort;
  config: MigrationConfig;
  clock: () => Date;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export function tenantId(ctx: RequestContext): string {
  return ctx.tenant_id as string;
}
