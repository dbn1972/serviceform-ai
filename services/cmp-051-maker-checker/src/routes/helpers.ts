import type { RequestContext } from '@serviceform/contracts';
import type { Pool } from 'pg';
import type { AuthorizationPort } from '../authz.js';
import type { MakerCheckerConfig } from '../config.js';
import { Cmp051Error } from '../errors.js';
import type { AiValidationPort } from '../ports/ai-validation.js';
import type { MetadataPort } from '../ports/metadata.js';
import type { VersioningPort } from '../ports/versioning.js';

export interface RouteDeps {
  pool: Pool;
  authorizer: AuthorizationPort;
  metadata: MetadataPort;
  versioning: VersioningPort;
  ai: AiValidationPort;
  config: MakerCheckerConfig;
  clock: () => Date;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export function tenantId(ctx: RequestContext): string {
  return ctx.tenant_id as string;
}

export function requireIdempotencyKey(header: unknown): string {
  if (typeof header !== 'string' || header.length < 1 || header.length > 128) {
    throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'IDEMPOTENCY_KEY_REQUIRED' }] });
  }
  return header;
}
