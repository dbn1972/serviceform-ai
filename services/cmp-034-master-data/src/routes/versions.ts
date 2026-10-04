import type { FastifyInstance } from 'fastify';
import {
  ADD_VALUES_BODY,
  CREATE_VERSION_BODY,
  PUBLISH_BODY,
  RESOLVE_QUERY,
  UUID_PARAM,
  VERSION_PARAMS,
} from '../schemas/http.js';
import { currentClient, withContextTx } from '../db/tx.js';
import { envelopeOf, insertOutbox, TOPIC_DOMAIN } from '../db/outbox.js';
import { Cmp034Error } from '../errors.js';
import {
  insertValues,
  lockTenantScope,
  requireDraftVersion,
} from '../repositories/master-data.repo.js';
import {
  decide,
  requireVersionParam,
  runCommand,
  sendPrivate,
  withWriteAudit,
  type RouteDeps,
} from './helpers.js';
import type { CodeValueInput } from '../ports/code-list-import.js';

export function registerVersionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get<{ Params: { id: string } }>(
    '/code-sets/:id/versions',
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
      const rows = await withContextTx(deps.pool, ctx, async () => {
        const client = currentClient();
        const set = await client.query(
          'SELECT code_set_id FROM sf_master_data.code_set WHERE code_set_id = $1',
          [request.params.id],
        );
        if (set.rowCount === 0) throw new Cmp034Error('SF-SYS-002');
        const result = await client.query<{
          version_no: string;
          status: string;
          valid_from: Date;
          jurisdiction_ref: string | null;
        }>(
          `SELECT version_no, status, valid_from, jurisdiction_ref
             FROM sf_master_data.code_set_version
            WHERE code_set_id = $1
            ORDER BY version_no`,
          [request.params.id],
        );
        return result.rows;
      });
      sendPrivate(reply);
      return {
        items: rows.map((r) => ({
          version_no: Number(r.version_no),
          status: r.status,
          valid_from: r.valid_from.toISOString(),
          jurisdiction_ref: r.jurisdiction_ref,
        })),
      };
    },
  );

  app.post<{
    Params: { id: string };
    Body: { jurisdiction_ref?: string; reason?: string };
  }>(
    '/code-sets/:id/versions',
    { schema: { params: UUID_PARAM, body: CREATE_VERSION_BODY } },
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
        action: 'CODE_SET_VERSION_CREATE',
      });
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/code-sets/${request.params.id}/versions`,
        async (tx) => {
          const tenantId = ctx.tenant_id as string;
          await lockTenantScope(tx, tenantId);
          const set = await tx.query(
            'SELECT code_set_id FROM sf_master_data.code_set WHERE code_set_id = $1',
            [request.params.id],
          );
          if (set.rowCount === 0) throw new Cmp034Error('SF-SYS-002');
          const latest = await tx.query<{ version_no: string }>(
            `SELECT version_no FROM sf_master_data.code_set_version
              WHERE code_set_id = $1 ORDER BY version_no DESC LIMIT 1`,
            [request.params.id],
          );
          const versionNo = latest.rows[0] ? Number(latest.rows[0].version_no) + 1 : 1;
          const now = new Date(deps.clock().getTime() + versionNo);
          await tx.query(
            `INSERT INTO sf_master_data.code_set_version (
               tenant_id, code_set_id, version_no, status, valid_from, jurisdiction_ref, reason, created_by
             ) VALUES ($1,$2,$3,'DRAFT',$4,$5,$6,$7)`,
            [
              tenantId,
              request.params.id,
              versionNo,
              now.toISOString(),
              request.body.jurisdiction_ref ?? null,
              request.body.reason ?? null,
              ctx.actor.id,
            ],
          );
          await withWriteAudit(deps, ctx, tx, {
            action: 'CODE_SET_VERSION_CREATE',
            actionClass: 'WRITE',
            resourceType: 'CodeSet',
            resourceId: request.params.id,
            result: 'SUCCESS',
            reason: request.body.reason,
            now,
          });
          return {
            status: 201,
            body: {
              code_set_id: request.params.id,
              version_no: versionNo,
              status: 'DRAFT',
              valid_from: now.toISOString(),
            },
          };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Params: { id: string; version: string }; Body: { items: CodeValueInput[] } }>(
    '/code-sets/:id/versions/:version/values',
    { schema: { params: VERSION_PARAMS, body: ADD_VALUES_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      const versionNo = requireVersionParam(request.params.version);
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
        action: 'CODE_VALUE_WRITE',
      });
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/code-sets/${request.params.id}/versions/${versionNo}/values`,
        async (tx) => {
          await requireDraftVersion(tx, request.params.id, versionNo);
          const count = await insertValues(tx, {
            tenantId: ctx.tenant_id as string,
            codeSetId: request.params.id,
            versionNo,
            actorId: ctx.actor.id,
            items: request.body.items,
          });
          await withWriteAudit(deps, ctx, tx, {
            action: 'CODE_VALUE_WRITE',
            actionClass: 'WRITE',
            resourceType: 'CodeSet',
            resourceId: request.params.id,
            result: 'SUCCESS',
            now: deps.clock(),
          });
          return { status: 201, body: { accepted: count, version_no: versionNo } };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Params: { id: string; version: string }; Body: { reason?: string } }>(
    '/code-sets/:id/versions/:version/publish',
    { schema: { params: VERSION_PARAMS, body: PUBLISH_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      const versionNo = requireVersionParam(request.params.version);
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
        action: 'CODE_SET_PUBLISH',
      });
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/code-sets/${request.params.id}/versions/${versionNo}/publish`,
        async (tx) => {
          const tenantId = ctx.tenant_id as string;
          await lockTenantScope(tx, tenantId);
          await requireDraftVersion(tx, request.params.id, versionNo);
          const now = deps.clock();
          await tx.query(
            `UPDATE sf_master_data.code_set_version
                SET status = 'PUBLISHED', reason = COALESCE($1, reason)
              WHERE code_set_id = $2 AND version_no = $3 AND status = 'DRAFT'`,
            [request.body.reason ?? null, request.params.id, versionNo],
          );
          const env = envelopeOf({
            eventType: 'CodeSetVersionPublished',
            tenantId,
            cellId: ctx.cell_id,
            aggregateType: 'CodeSet',
            aggregateId: request.params.id,
            aggregateVersion: versionNo,
            occurredAt: now.toISOString(),
            correlationId: ctx.correlation_id,
            actor: ctx.actor,
            data: {
              code_set_id: request.params.id,
              version_no: versionNo,
              status: 'PUBLISHED',
            },
          });
          await insertOutbox(tx, env, TOPIC_DOMAIN);
          await withWriteAudit(deps, ctx, tx, {
            action: 'CODE_SET_PUBLISH',
            actionClass: 'WRITE',
            resourceType: 'CodeSet',
            resourceId: request.params.id,
            result: 'SUCCESS',
            reason: request.body.reason,
            now,
          });
          return {
            status: 200,
            body: {
              code_set_id: request.params.id,
              version_no: versionNo,
              status: 'PUBLISHED',
            },
          };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { as_of?: string; value_code?: string };
  }>(
    '/code-sets/:id/resolve',
    { schema: { params: UUID_PARAM, querystring: RESOLVE_QUERY } },
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
      const asOf = request.query.as_of ?? new Date(deps.clock().getTime() + 60_000).toISOString();
      const resolved = await withContextTx(deps.pool, ctx, async () => {
        const client = currentClient();
        const version = await client.query<{ version_no: string; status: string }>(
          `SELECT version_no, status
             FROM sf_master_data.code_set_version
            WHERE code_set_id = $1 AND status = 'PUBLISHED' AND valid_from <= $2
            ORDER BY valid_from DESC, version_no DESC
            LIMIT 1`,
          [request.params.id, asOf],
        );
        const ver = version.rows[0];
        if (!ver) throw new Cmp034Error('SF-SYS-002');
        const values = await client.query<{
          value_code: string;
          localization_key: string;
          sort_order: number;
          parent_value_id: string | null;
        }>(
          `SELECT value_code, localization_key, sort_order, parent_value_id
             FROM sf_master_data.code_value
            WHERE code_set_id = $1 AND version_no = $2
              AND ($3::text IS NULL OR value_code = $3)
            ORDER BY sort_order, value_code`,
          [request.params.id, Number(ver.version_no), request.query.value_code ?? null],
        );
        return { version_no: Number(ver.version_no), items: values.rows };
      });
      sendPrivate(reply);
      return resolved;
    },
  );
}
