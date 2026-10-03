import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@serviceform/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { AuditError } from '../domain/errors.js';
import { appendLedger } from '../domain/ledger-writer.js';
import { parseAuditQuery } from '../domain/query-filters.js';
import { auditRouteRateLimitConfig } from '../http/rate-limit.js';
import type { AuthzPort } from '../ports/authz-port.js';
import { queryTenantAudit } from '../repo/query-repo.js';
import { withTenantTx } from '../repo/tx.js';

function requireCtx(ctx: RequestContext | null): RequestContext {
  if (!ctx) throw new AuditError('SF-TEN-001', { statusCode: 401 });
  return ctx;
}

async function authorizeRead(authz: AuthzPort, ctx: RequestContext): Promise<void> {
  const decision = await authz.decide({
    subject: {
      user_id: ctx.actor.id,
      actor_type: ctx.actor.type,
      tenant_id: ctx.tenant_id,
      roles: ctx.roles,
      jurisdiction_ids: ctx.jurisdiction_ids,
      assurance: ctx.auth_assurance,
    },
    resource: {
      resource_type: 'AuditEvent',
      tenant_id: ctx.tenant_id,
      classification: 'TENANT_SCOPED',
    },
    action: 'AUDIT_READ',
  });
  if (!decision.allow) throw new AuditError('SF-AUTH-002', { statusCode: 403 });
}

async function denyPlatformRead(pool: Pool, ctx: RequestContext): Promise<void> {
  try {
    await withTenantTx(pool, ctx, (client) =>
      appendLedger(client, ctx, {
        audit_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        tenant_id: null,
        cell_id: ctx.cell_id,
        actor_type: ctx.actor.type,
        actor_id: ctx.actor.id,
        action: 'AUDIT_CROSS_TENANT_READ',
        action_class: 'PRIVILEGED',
        resource_type: 'AuditEvent',
        resource_id: 'audit-query',
        reason: 'w1-privileged-read-denied',
        correlation_id: ctx.correlation_id,
        trace_id: ctx.trace_id,
        result: 'DENIED',
        classification: 'PLATFORM_OPERATIONAL',
      }),
    );
  } catch {
    // still deny
  }
}

export function registerGetAudit(
  app: FastifyInstance,
  deps: {
    pool: Pool;
    authz: AuthzPort;
    queryMaxDays: number;
    queryMaxLimit: number;
    rateLimitMax: number;
    rateLimitWindowMs: number;
  },
): void {
  app.get(
    '/audit',
    auditRouteRateLimitConfig(deps.rateLimitMax, deps.rateLimitWindowMs),
    async (request, reply) => {
      const ctx = requireCtx(request.ctx);
      await authorizeRead(deps.authz, ctx);
      const tenantId = ctx.tenant_id;
      if (tenantId === null) {
        await denyPlatformRead(deps.pool, ctx);
        throw new AuditError('SF-AUTH-002', { statusCode: 403 });
      }
      const filters = parseAuditQuery(
        request.query as Record<string, unknown>,
        deps.queryMaxDays,
        deps.queryMaxLimit,
      );
      const page = await withTenantTx(deps.pool, ctx, async (client) => {
        await appendLedger(client, ctx, {
          audit_id: randomUUID(),
          occurred_at: new Date().toISOString(),
          tenant_id: tenantId,
          cell_id: ctx.cell_id,
          actor_type: ctx.actor.type,
          actor_id: ctx.actor.id,
          action: 'AUDIT_READ',
          action_class: 'READ',
          resource_type: 'AuditEvent',
          resource_id: 'query',
          correlation_id: ctx.correlation_id,
          trace_id: ctx.trace_id,
          result: 'SUCCESS',
          classification: 'TENANT_SCOPED',
        });
        return queryTenantAudit(client, tenantId, filters);
      });
      return reply.code(200).send(page);
    },
  );
}
