import type { FastifyInstance } from 'fastify';
import { BINDING_BODY } from '../schemas/http.js';
import { Cmp034Error } from '../errors.js';
import { lockTenantScope, newId } from '../repositories/master-data.repo.js';
import {
  decide,
  runCommand,
  sendPrivate,
  withWriteAudit,
  type RouteDeps,
} from './helpers.js';

export function registerBindingRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post<{
    Body: {
      code_set_id: string;
      pinned_version_no: number;
      target_type: string;
      target_ref: string;
    };
  }>('/code-set-bindings', { schema: { body: BINDING_BODY } }, async (request, reply) => {
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
      action: 'CODE_SET_BIND',
    });
    const result = await runCommand(
      deps,
      request,
      ctx,
      'POST /v1/code-set-bindings',
      async (tx) => {
        const tenantId = ctx.tenant_id as string;
        await lockTenantScope(tx, tenantId);
        const published = await tx.query<{ status: string }>(
          `SELECT status FROM sf_master_data.code_set_version
            WHERE code_set_id = $1 AND version_no = $2`,
          [request.body.code_set_id, request.body.pinned_version_no],
        );
        if (!published.rows[0]) throw new Cmp034Error('SF-SYS-002');
        if (published.rows[0].status !== 'PUBLISHED') {
          throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'PIN_REQUIRES_PUBLISHED' }] });
        }
        const latest = await tx.query<{ version_no: string }>(
          `SELECT version_no FROM sf_master_data.code_set_binding
            WHERE target_type = $1 AND target_ref = $2
            ORDER BY version_no DESC LIMIT 1`,
          [request.body.target_type, request.body.target_ref],
        );
        const versionNo = latest.rows[0] ? Number(latest.rows[0].version_no) + 1 : 1;
        const now = new Date(deps.clock().getTime() + versionNo);
        const bindingId = newId();
        await tx.query(
          `INSERT INTO sf_master_data.code_set_binding (
             binding_id, tenant_id, code_set_id, pinned_version_no, target_type, target_ref,
             status, valid_from, version_no, created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$8,$9)`,
          [
            bindingId,
            tenantId,
            request.body.code_set_id,
            request.body.pinned_version_no,
            request.body.target_type,
            request.body.target_ref,
            now.toISOString(),
            versionNo,
            ctx.actor.id,
          ],
        );
        await withWriteAudit(deps, ctx, tx, {
          action: 'CODE_SET_BIND',
          actionClass: 'WRITE',
          resourceType: 'CodeSet',
          resourceId: request.body.code_set_id,
          result: 'SUCCESS',
          now,
        });
        return {
          status: 201,
          body: {
            binding_id: bindingId,
            pinned_version_no: request.body.pinned_version_no,
            status: 'ACTIVE',
          },
        };
      },
    );
    sendPrivate(reply);
    return reply.code(result.status).send(result.body);
  });
}
