import type { RequestContext } from '@serviceform/contracts';
import type { Pool } from 'pg';
import type { AuthorizationPort } from '../authz.js';
import type { RulesConfig } from '../config.js';
import { Cmp008Error } from '../errors.js';
import type { RuleEngine } from '../domain/engine.js';
import type { RulePackPort } from '../ports/rule-pack.js';

export interface RouteDeps {
  pool: Pool;
  authorizer: AuthorizationPort;
  rulePacks: RulePackPort;
  engine: RuleEngine;
  config: RulesConfig;
  clock: () => Date;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export function tenantId(ctx: RequestContext): string {
  return ctx.tenant_id as string;
}

export function requireIdempotencyKey(header: unknown): string {
  if (typeof header !== 'string' || header.length < 1 || header.length > 128) {
    throw new Cmp008Error('SF-SYS-003', { details: [{ code: 'IDEMPOTENCY_KEY_REQUIRED' }] });
  }
  return header;
}
