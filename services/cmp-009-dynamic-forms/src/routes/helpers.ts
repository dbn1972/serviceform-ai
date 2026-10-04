import type { RequestContext } from '@serviceform/contracts';
import type { Pool } from 'pg';
import type { AuthorizationPort } from '../authz.js';
import type { FormsConfig } from '../config.js';
import { Cmp009Error } from '../errors.js';
import type { FormDefinitionPort } from '../ports/form-definition.js';
import type { LocalizationPort } from '../ports/localization.js';

export interface RouteDeps {
  pool: Pool;
  authorizer: AuthorizationPort;
  forms: FormDefinitionPort;
  localization: LocalizationPort;
  config: FormsConfig;
  clock: () => Date;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export function tenantId(ctx: RequestContext): string {
  return ctx.tenant_id as string;
}

export function requireIdempotencyKey(header: unknown): string {
  if (typeof header !== 'string' || header.length < 1 || header.length > 128) {
    throw new Cmp009Error('SF-SYS-003', { details: [{ code: 'IDEMPOTENCY_KEY_REQUIRED' }] });
  }
  return header;
}
