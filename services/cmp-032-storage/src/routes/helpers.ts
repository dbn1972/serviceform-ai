import type { RequestContext } from '@serviceform/contracts';
import type { ObjectStorePort, StorageKmsPort, StorageSecretsPort } from '@serviceform/storage';
import type { Pool } from 'pg';
import type { AuthorizationPort } from '../authz.js';
import type { StorageServiceConfig } from '../config.js';

export interface RouteDeps {
  pool: Pool;
  authorizer: AuthorizationPort;
  store: ObjectStorePort;
  kms: StorageKmsPort;
  secrets: StorageSecretsPort;
  config: StorageServiceConfig;
  clock: () => Date;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export function tenantId(ctx: RequestContext): string {
  return ctx.tenant_id as string;
}
