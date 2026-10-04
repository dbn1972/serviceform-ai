import type { FastifyInstance } from 'fastify';
import { withContextTx } from '../db/tx.js';
import { Cmp030Error } from '../errors.js';
import { insertPurpose, listPurposes, serializePurpose } from '../repositories/consent.repo.js';
import { CREATE_PURPOSE_BODY } from '../schemas/http.js';
import {
  decide,
  requireTenant,
  runCommand,
  sendPrivate,
  withWriteAudit,
  writeDenied,
  type RouteDeps,
} from './helpers.js';

export function registerPurposeRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post<{ Body: { code: string; label: string; requires_consent?: boolean } }>(
    '/purposes',
    { schema: { body: CREATE_PURPOSE_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      const tenantId = requireTenant(ctx);
      try {
        await decide(deps, ctx, {
          subject: {
            user_id: ctx.actor.id,
            actor_type: ctx.actor.type,
            tenant_id: ctx.tenant_id,
            roles: ctx.roles,
            jurisdiction_ids: ctx.jurisdiction_ids,
          },
          resource: {
            resource_type: 'Purpose',
            tenant_id: ctx.tenant_id,
            classification: 'TENANT_SCOPED',
          },
          action: 'PURPOSE_CREATE',
        });
      } catch (err) {
        if (err instanceof Cmp030Error && err.code === 'SF-AUTH-002') {
          await writeDenied(deps, ctx, request, 'PURPOSE_CREATE', 'Purpose', tenantId);
        }
        throw err;
      }
      const result = await runCommand(deps, request, ctx, 'POST /v1/purposes', async (tx) => {
        const row = await insertPurpose(tx, {
          tenantId,
          code: request.body.code,
          label: request.body.label,
          requiresConsent: request.body.requires_consent ?? true,
          createdBy: ctx.actor.id,
        });
        await withWriteAudit(deps, ctx, tx, {
          action: 'PURPOSE_CREATE',
          actionClass: 'WRITE',
          resourceType: 'Purpose',
          resourceId: row.purpose_id,
          result: 'SUCCESS',
          now: deps.clock(),
        });
        return { status: 201, body: serializePurpose(row) };
      });
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.get('/purposes', async (request, reply) => {
    const ctx = request.sfContext;
    const tenantId = requireTenant(ctx);
    await decide(deps, ctx, {
      subject: {
        user_id: ctx.actor.id,
        actor_type: ctx.actor.type,
        tenant_id: ctx.tenant_id,
        roles: ctx.roles,
        jurisdiction_ids: ctx.jurisdiction_ids,
      },
      resource: {
        resource_type: 'Purpose',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'PURPOSE_READ',
    });
    const rows = await withContextTx(deps.pool, ctx, async (tx) => listPurposes(tx, tenantId));
    sendPrivate(reply);
    return { items: rows.map(serializePurpose) };
  });
}
