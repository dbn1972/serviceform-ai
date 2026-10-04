import type { FastifyInstance } from 'fastify';
import { CREATE_SET_BODY, LIST_QUERY, UUID_PARAM } from '../schemas/http.js';
import { currentClient, withContextTx } from '../db/tx.js';
import { Cmp034Error } from '../errors.js';
import { newId } from '../repositories/master-data.repo.js';
import {
  decide,
  decodeCursor,
  encodeCursor,
  runCommand,
  sendPrivate,
  withWriteAudit,
  type RouteDeps,
} from './helpers.js';

export function registerCodeSetRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    '/code-sets',
    { schema: { querystring: LIST_QUERY } },
    async (request, reply) => {
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
          resource_type: 'CodeSet',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'CODE_SET_READ',
      });
      const limit = request.query.limit ?? 50;
      const after = decodeCursor(request.query.cursor);
      const rows = await withContextTx(deps.pool, ctx, async () => {
        const client = currentClient();
        const result = await client.query<{
          code_set_id: string;
          set_code: string;
          localization_key: string;
          status: string;
        }>(
          `SELECT code_set_id, set_code, localization_key, status
             FROM sf_master_data.code_set
            WHERE ($1::uuid IS NULL OR code_set_id > $1)
            ORDER BY code_set_id
            LIMIT $2`,
          [after ?? null, limit],
        );
        return result.rows;
      });
      sendPrivate(reply);
      const last = rows[rows.length - 1];
      return {
        items: rows,
        cursor: last && rows.length === limit ? encodeCursor(last.code_set_id) : null,
      };
    },
  );

  app.post<{ Body: { set_code: string; localization_key: string } }>(
    '/code-sets',
    { schema: { body: CREATE_SET_BODY } },
    async (request, reply) => {
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
          resource_type: 'CodeSet',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'CODE_SET_CREATE',
      });
      const result = await runCommand(deps, request, ctx, 'POST /v1/code-sets', async (tx) => {
        const id = newId();
        await tx.query(
          `INSERT INTO sf_master_data.code_set (
             tenant_id, code_set_id, set_code, localization_key, status, created_by
           ) VALUES ($1,$2,$3,$4,'ACTIVE',$5)`,
          [ctx.tenant_id, id, request.body.set_code, request.body.localization_key, ctx.actor.id],
        );
        await withWriteAudit(deps, ctx, tx, {
          action: 'CODE_SET_CREATE',
          actionClass: 'WRITE',
          resourceType: 'CodeSet',
          resourceId: id,
          result: 'SUCCESS',
          now: deps.clock(),
        });
        return {
          status: 201,
          body: {
            code_set_id: id,
            set_code: request.body.set_code,
            localization_key: request.body.localization_key,
            status: 'ACTIVE',
          },
        };
      });
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/code-sets/:id',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
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
          resource_type: 'CodeSet',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'CODE_SET_READ',
      });
      const row = await withContextTx(deps.pool, ctx, async () => {
        const client = currentClient();
        const result = await client.query<{
          code_set_id: string;
          set_code: string;
          localization_key: string;
          status: string;
        }>(
          `SELECT code_set_id, set_code, localization_key, status
             FROM sf_master_data.code_set WHERE code_set_id = $1`,
          [request.params.id],
        );
        return result.rows[0] ?? null;
      });
      if (!row) throw new Cmp034Error('SF-SYS-002');
      sendPrivate(reply);
      return row;
    },
  );
}
