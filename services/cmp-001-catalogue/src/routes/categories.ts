import type { FastifyInstance } from 'fastify';
import { CREATE_CATEGORY_BODY } from '../schemas/http.js';
import { withContextTx } from '../db/tx.js';
import { currentClient } from '../db/tx.js';
import { newId } from '../repositories/catalogue.repo.js';
import { rejectClientPin } from '../domain/publication.js';
import {
  decide,
  emitDomain,
  iso,
  requirePrivileged,
  runCommand,
  sendPrivate,
  subject,
  withWriteAudit,
  type RouteDeps,
} from './helpers.js';

export function registerCategoryRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/categories', async (request, reply) => {
    const ctx = request.sfContext;
    await decide(deps, ctx, {
      subject: subject(ctx),
      resource: {
        resource_type: 'ServiceCategory',
        tenant_id: ctx.tenant_id,
        classification: 'GLOBAL',
      },
      action: 'CATALOGUE_CATEGORY_READ',
    });
    const rows = await withContextTx(deps.pool, ctx, async () => {
      const client = currentClient();
      const result = await client.query<{
        category_id: string;
        category_code: string;
        display_label: string;
        parent_category_id: string | null;
        status: string;
      }>(
        `SELECT category_id, category_code, display_label, parent_category_id, status
           FROM sf_catalogue.category
          WHERE status = 'ACTIVE'
          ORDER BY category_code`,
      );
      return result.rows;
    });
    sendPrivate(reply);
    return { items: rows };
  });

  app.post<{
    Body: { category_code: string; display_label: string; parent_category_id?: string };
  }>('/admin/categories', { schema: { body: CREATE_CATEGORY_BODY } }, async (request, reply) => {
    const ctx = request.sfContext;
    rejectClientPin(request.body);
    requirePrivileged(ctx);
    await decide(deps, ctx, {
      subject: subject(ctx),
      resource: {
        resource_type: 'ServiceCategory',
        tenant_id: ctx.tenant_id,
        classification: 'GLOBAL',
      },
      action: 'CATALOGUE_CATEGORY_CREATE',
    });
    const result = await runCommand(deps, request, ctx, 'POST /v1/admin/categories', async (tx) => {
      const categoryId = newId();
      const now = iso(deps.clock);
      await tx.query(
        `INSERT INTO sf_catalogue.category (
             category_id, category_code, display_label, parent_category_id, status, created_by
           ) VALUES ($1,$2,$3,$4,'ACTIVE',$5)`,
        [
          categoryId,
          request.body.category_code,
          request.body.display_label,
          request.body.parent_category_id ?? null,
          ctx.actor.id,
        ],
      );
      await emitDomain(tx, ctx, {
        eventType: 'CanonicalServiceChanged',
        aggregateType: 'ServiceCategory',
        aggregateId: categoryId,
        aggregateVersion: 1,
        occurredAt: now,
        data: {
          change: 'CATEGORY_CREATED',
          category_id: categoryId,
          category_code: request.body.category_code,
        },
      });
      await withWriteAudit(deps, ctx, tx, {
        action: 'CATALOGUE_CATEGORY_CREATE',
        actionClass: 'PRIVILEGED',
        resourceType: 'ServiceCategory',
        resourceId: categoryId,
        result: 'SUCCESS',
        reason: 'CATEGORY_CREATED',
        now: deps.clock(),
        classification: 'GLOBAL',
      });
      return {
        status: 201,
        body: {
          category_id: categoryId,
          category_code: request.body.category_code,
          display_label: request.body.display_label,
          status: 'ACTIVE',
        },
      };
    });
    sendPrivate(reply);
    return reply.code(result.status).send(result.body);
  });
}
