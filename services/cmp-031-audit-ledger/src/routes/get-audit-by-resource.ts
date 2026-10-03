import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@serviceform/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { AuditError } from '../domain/errors.js';
import { appendLedger } from '../domain/ledger-writer.js';
import { auditRouteRateLimitConfig } from '../http/rate-limit.js';
import type { AuthzPort } from '../ports/authz-port.js';
import { queryTenantAudit } from '../repo/query-repo.js';
import { withTenantTx } from '../repo/tx.js';

function requireCtx(ctx: RequestContext | null): RequestContext {
  if (!ctx) throw new AuditError('SF-TEN-001', { statusCode: 401 });
  return ctx;
}

export function registerGetAuditByResource(
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
    '/audit/:resourceType/:id',
    auditRouteRateLimitConfig(deps.rateLimitMax, deps.rateLimitWindowMs),
    async (request, reply) => {
      const ctx = requireCtx(request.ctx);
      const params = request.params as { resourceType: string; id: string };
      if (
        !/^[A-Z][A-Za-z0-9]{1,63}$/.test(params.resourceType) ||
        params.resourceType.includes('..')
      ) {
        throw new AuditError('SF-SYS-003', { details: [{ code: 'INVALID_RESOURCE' }] });
      }
      if (params.id.includes('..') || params.id.includes('%2f') || params.id.includes('%2F')) {
        throw new AuditError('SF-SYS-003', { details: [{ code: 'INVALID_RESOURCE' }] });
      }
      const decision = await deps.authz.decide({
        subject: {
          user_id: ctx.actor.id,
          actor_type: ctx.actor.type,
          tenant_id: ctx.tenant_id,
          roles: ctx.roles,
          jurisdiction_ids: ctx.jurisdiction_ids,
          assurance: ctx.auth_assurance,
        },
        resource: {
          resource_type: params.resourceType,
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'AUDIT_READ',
      });
      if (!decision.allow) throw new AuditError('SF-AUTH-002', { statusCode: 403 });
      if (ctx.tenant_id === null) throw new AuditError('SF-TEN-001', { statusCode: 401 });
      const tenantId = ctx.tenant_id;
      const q = request.query as Record<string, unknown>;
      const from =
        typeof q['from'] === 'string'
          ? q['from']
          : new Date(Date.now() - 30 * 86400000).toISOString();
      const to = typeof q['to'] === 'string' ? q['to'] : new Date().toISOString();
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
          resource_type: params.resourceType,
          resource_id: params.id,
          correlation_id: ctx.correlation_id,
          trace_id: ctx.trace_id,
          result: 'SUCCESS',
          classification: 'TENANT_SCOPED',
        });
        return queryTenantAudit(client, tenantId, {
          from: new Date(from),
          to: new Date(to),
          resource_type: params.resourceType,
          resource_id: params.id,
          limit: deps.queryMaxLimit,
        });
      });
      return reply.code(200).send(page);
    },
  );
}
