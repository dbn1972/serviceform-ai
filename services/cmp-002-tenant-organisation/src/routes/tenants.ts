import type { FastifyInstance } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import { UUID_PARAM } from '../schemas/http.js';
import { currentClient, withContextTx } from '../db/tx.js';
import { currentBinding } from '../repositories/org.repo.js';
import { assertTenantRouteId } from '../context.js';
import { Cmp002Error } from '../errors.js';
import { decide, sendPrivate, type RouteDeps } from './helpers.js';

export function registerTenantRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get<{ Params: { id: string } }>(
    '/tenants/:id',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const ctx = request.sfContext;
      assertTenantRouteId(ctx, request.params.id);
      await decide(deps, ctx, {
        subject: {
          user_id: ctx.actor.id,
          actor_type: ctx.actor.type,
          tenant_id: ctx.tenant_id,
          roles: ctx.roles,
          jurisdiction_ids: ctx.jurisdiction_ids,
        },
        resource: {
          resource_type: 'Tenant',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'TENANT_READ',
      });
      const body = await withContextTx(deps.pool, ctx, async () => {
        const client = currentClient();
        const tenant = await client.query<{
          tenant_id: string;
          code: string;
          status: string;
          version: string;
          created_at: Date;
          updated_at: Date;
        }>(
          'SELECT tenant_id, code, status, version, created_at, updated_at FROM sf_tenant_org.tenant WHERE tenant_id = $1',
          [request.params.id],
        );
        const row = tenant.rows[0];
        if (!row) throw new Cmp002Error('SF-SYS-002');
        const binding = await currentBinding(client, request.params.id, deps.clock());
        return {
          tenant_id: row.tenant_id,
          code: row.code,
          status: row.status,
          version: Number(row.version),
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
          current_binding: binding
            ? {
                binding_id: binding.binding_id,
                cell_id: binding.cell_id,
                isolation_model: binding.isolation_model,
                valid_from: binding.valid_from.toISOString(),
                seq: Number(binding.seq),
              }
            : null,
        };
      });
      sendPrivate(reply);
      return body;
    },
  );
}

export type { RequestContext };
