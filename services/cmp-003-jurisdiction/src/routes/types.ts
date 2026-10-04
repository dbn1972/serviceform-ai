import type { FastifyInstance } from 'fastify';
import { CREATE_TYPE_BODY } from '../schemas/http.js';
import { withContextTx } from '../db/tx.js';
import { currentClient } from '../db/tx.js';
import { newId } from '../repositories/jurisdiction.repo.js';
import { decide, runCommand, sendPrivate, withWriteAudit, type RouteDeps } from './helpers.js';

export function registerTypeRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/jurisdiction-types', async (request, reply) => {
    const ctx = request.sfContext;
    await decide(deps, ctx, {
      subject: {
        user_id: ctx.actor.id,
        actor_type: ctx.actor.type,
        tenant_id: ctx.tenant_id,
        roles: ctx.roles,
        jurisdiction_ids: ctx.jurisdiction_ids,
      },
      resource: {
        resource_type: 'JurisdictionType',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'JURISDICTION_TYPE_READ',
    });
    const rows = await withContextTx(deps.pool, ctx, async () => {
      const client = currentClient();
      const result = await client.query<{
        jurisdiction_type_id: string;
        type_code: string;
        display_label: string;
        status: string;
      }>(
        `SELECT jurisdiction_type_id, type_code, display_label, status
           FROM sf_jurisdiction.jurisdiction_type
          WHERE status = 'ACTIVE'
          ORDER BY type_code`,
      );
      return result.rows;
    });
    sendPrivate(reply);
    return { items: rows };
  });

  app.post<{
    Body: { type_code: string; display_label: string };
  }>('/jurisdiction-types', { schema: { body: CREATE_TYPE_BODY } }, async (request, reply) => {
    const ctx = request.sfContext;
    await decide(deps, ctx, {
      subject: {
        user_id: ctx.actor.id,
        actor_type: ctx.actor.type,
        tenant_id: ctx.tenant_id,
        roles: ctx.roles,
        jurisdiction_ids: ctx.jurisdiction_ids,
      },
      resource: {
        resource_type: 'JurisdictionType',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'JURISDICTION_TYPE_CREATE',
    });
    const result = await runCommand(
      deps,
      request,
      ctx,
      'POST /v1/jurisdiction-types',
      async (tx) => {
        const typeId = newId();
        await tx.query(
          `INSERT INTO sf_jurisdiction.jurisdiction_type (
             tenant_id, jurisdiction_type_id, type_code, display_label, status, created_by
           ) VALUES ($1,$2,$3,$4,'ACTIVE',$5)`,
          [
            ctx.tenant_id,
            typeId,
            request.body.type_code,
            request.body.display_label,
            ctx.actor.id,
          ],
        );
        await withWriteAudit(deps, ctx, tx, {
          action: 'JURISDICTION_TYPE_CREATE',
          actionClass: 'WRITE',
          resourceType: 'JurisdictionType',
          resourceId: typeId,
          result: 'SUCCESS',
          now: deps.clock(),
        });
        return {
          status: 201,
          body: {
            jurisdiction_type_id: typeId,
            type_code: request.body.type_code,
            display_label: request.body.display_label,
            status: 'ACTIVE',
          },
        };
      },
    );
    sendPrivate(reply);
    return reply.code(result.status).send(result.body);
  });
}
