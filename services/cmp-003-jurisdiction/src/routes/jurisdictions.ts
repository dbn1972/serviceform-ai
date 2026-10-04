import type { FastifyInstance } from 'fastify';
import {
  BINDING_BODY,
  CREATE_JURISDICTION_BODY,
  JURISDICTION_QUERY,
  PUBLISH_BODY,
  RELATION_BODY,
  UUID_PARAM,
} from '../schemas/http.js';
import { currentClient, withContextTx } from '../db/tx.js';
import { envelopeOf, insertOutbox, TOPIC_DOMAIN } from '../db/outbox.js';
import { Cmp003Error } from '../errors.js';
import { assertNoCycle, lockTenantScope, newId } from '../repositories/jurisdiction.repo.js';
import {
  decide,
  decodeCursor,
  encodeCursor,
  runCommand,
  sendPrivate,
  withWriteAudit,
  type RouteDeps,
} from './helpers.js';

export function registerJurisdictionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get<{
    Querystring: {
      as_of?: string;
      parent_id?: string;
      status?: string;
      cursor?: string;
      limit?: number;
    };
  }>('/jurisdictions', { schema: { querystring: JURISDICTION_QUERY } }, async (request, reply) => {
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
        resource_type: 'Jurisdiction',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'JURISDICTION_READ',
    });
    const asOf = request.query.as_of ?? deps.clock().toISOString();
    const limit = request.query.limit ?? 50;
    const after = decodeCursor(request.query.cursor);
    const rows = await withContextTx(deps.pool, ctx, async () => {
      const client = currentClient();
      const result = await client.query<{
        jurisdiction_id: string;
        code: string;
        name: string;
        jurisdiction_type_id: string;
        type_code: string;
        status: string;
        version_no: string;
        valid_from: Date;
        parent_jurisdiction_id: string | null;
      }>(
        `SELECT j.jurisdiction_id, j.code, v.name, v.jurisdiction_type_id, t.type_code, v.status,
                v.version_no, v.valid_from, r.parent_jurisdiction_id
           FROM sf_jurisdiction.jurisdiction j
           JOIN LATERAL (
             SELECT name, jurisdiction_type_id, status, version_no, valid_from
               FROM sf_jurisdiction.jurisdiction_version
              WHERE tenant_id = j.tenant_id AND jurisdiction_id = j.jurisdiction_id AND valid_from <= $1
              ORDER BY valid_from DESC, version_no DESC
              LIMIT 1
           ) v ON true
           JOIN sf_jurisdiction.jurisdiction_type t
             ON t.tenant_id = j.tenant_id AND t.jurisdiction_type_id = v.jurisdiction_type_id
           LEFT JOIN LATERAL (
             SELECT parent_jurisdiction_id
               FROM sf_jurisdiction.jurisdiction_relation
              WHERE tenant_id = j.tenant_id AND child_jurisdiction_id = j.jurisdiction_id AND valid_from <= $1
              ORDER BY valid_from DESC, version_no DESC
              LIMIT 1
           ) r ON true
          WHERE ($2::uuid IS NULL OR r.parent_jurisdiction_id IS NOT DISTINCT FROM $2)
            AND ($3::text IS NULL OR v.status = $3)
            AND ($4::uuid IS NULL OR j.jurisdiction_id > $4)
          ORDER BY j.jurisdiction_id
          LIMIT $5`,
        [asOf, request.query.parent_id ?? null, request.query.status ?? null, after ?? null, limit],
      );
      return result.rows;
    });
    sendPrivate(reply);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((r) => ({
        jurisdiction_id: r.jurisdiction_id,
        code: r.code,
        name: r.name,
        jurisdiction_type_id: r.jurisdiction_type_id,
        type_code: r.type_code,
        status: r.status,
        version_no: Number(r.version_no),
        valid_from: r.valid_from.toISOString(),
        parent_jurisdiction_id: r.parent_jurisdiction_id,
      })),
      cursor: last && rows.length === limit ? encodeCursor(last.jurisdiction_id) : null,
    };
  });

  app.get<{ Params: { id: string }; Querystring: { as_of?: string } }>(
    '/jurisdictions/:id/children',
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
          resource_type: 'Jurisdiction',
          jurisdiction_id: request.params.id,
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'JURISDICTION_READ',
      });
      const asOf = request.query.as_of ?? deps.clock().toISOString();
      const rows = await withContextTx(deps.pool, ctx, async () => {
        const client = currentClient();
        const parent = await client.query(
          'SELECT jurisdiction_id FROM sf_jurisdiction.jurisdiction WHERE jurisdiction_id = $1',
          [request.params.id],
        );
        if (parent.rowCount === 0) throw new Cmp003Error('SF-SYS-002');
        const result = await client.query<{
          jurisdiction_id: string;
          code: string;
          name: string;
          status: string;
          version_no: string;
        }>(
          `SELECT j.jurisdiction_id, j.code, v.name, v.status, v.version_no
             FROM sf_jurisdiction.jurisdiction j
             JOIN LATERAL (
               SELECT name, status, version_no, valid_from
                 FROM sf_jurisdiction.jurisdiction_version
                WHERE tenant_id = j.tenant_id AND jurisdiction_id = j.jurisdiction_id AND valid_from <= $1
                ORDER BY valid_from DESC, version_no DESC
                LIMIT 1
             ) v ON true
             JOIN LATERAL (
               SELECT parent_jurisdiction_id
                 FROM sf_jurisdiction.jurisdiction_relation
                WHERE tenant_id = j.tenant_id AND child_jurisdiction_id = j.jurisdiction_id AND valid_from <= $1
                ORDER BY valid_from DESC, version_no DESC
                LIMIT 1
             ) r ON r.parent_jurisdiction_id = $2
            ORDER BY j.code`,
          [asOf, request.params.id],
        );
        return result.rows;
      });
      sendPrivate(reply);
      return {
        parent_id: request.params.id,
        items: rows.map((r) => ({
          jurisdiction_id: r.jurisdiction_id,
          code: r.code,
          name: r.name,
          status: r.status,
          version_no: Number(r.version_no),
        })),
      };
    },
  );

  app.post<{
    Body: {
      code: string;
      name: string;
      jurisdiction_type_id: string;
      parent_id?: string;
      reason?: string;
    };
  }>('/jurisdictions', { schema: { body: CREATE_JURISDICTION_BODY } }, async (request, reply) => {
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
        resource_type: 'Jurisdiction',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'JURISDICTION_CREATE',
    });
    const result = await runCommand(deps, request, ctx, 'POST /v1/jurisdictions', async (tx) => {
      const tenantId = ctx.tenant_id as string;
      await lockTenantScope(tx, tenantId);
      const type = await tx.query(
        `SELECT jurisdiction_type_id FROM sf_jurisdiction.jurisdiction_type
          WHERE jurisdiction_type_id = $1 AND status = 'ACTIVE'`,
        [request.body.jurisdiction_type_id],
      );
      if (type.rowCount === 0) throw new Cmp003Error('SF-SYS-002');
      if (request.body.parent_id) {
        const parent = await tx.query(
          'SELECT jurisdiction_id FROM sf_jurisdiction.jurisdiction WHERE jurisdiction_id = $1',
          [request.body.parent_id],
        );
        if (parent.rowCount === 0) throw new Cmp003Error('SF-SYS-002');
      }
      const jurId = newId();
      const now = deps.clock();
      await assertNoCycle(tx, jurId, request.body.parent_id ?? null, now);
      await tx.query(
        `INSERT INTO sf_jurisdiction.jurisdiction (tenant_id, jurisdiction_id, code, created_by)
         VALUES ($1,$2,$3,$4)`,
        [tenantId, jurId, request.body.code, ctx.actor.id],
      );
      await tx.query(
        `INSERT INTO sf_jurisdiction.jurisdiction_version (
           tenant_id, jurisdiction_id, version_no, name, jurisdiction_type_id, status, valid_from, reason, created_by
         ) VALUES ($1,$2,1,$3,$4,'DRAFT',$5,$6,$7)`,
        [
          tenantId,
          jurId,
          request.body.name,
          request.body.jurisdiction_type_id,
          now.toISOString(),
          request.body.reason ?? null,
          ctx.actor.id,
        ],
      );
      if (request.body.parent_id) {
        await tx.query(
          `INSERT INTO sf_jurisdiction.jurisdiction_relation (
             relation_id, tenant_id, child_jurisdiction_id, parent_jurisdiction_id,
             relation_type_code, version_no, valid_from, created_by
           ) VALUES ($1,$2,$3,$4,'CONTAINS',1,$5,$6)`,
          [newId(), tenantId, jurId, request.body.parent_id, now.toISOString(), ctx.actor.id],
        );
        const boundary = envelopeOf({
          eventType: 'JurisdictionBoundaryChanged',
          tenantId,
          cellId: ctx.cell_id,
          aggregateType: 'Jurisdiction',
          aggregateId: jurId,
          aggregateVersion: 1,
          occurredAt: now.toISOString(),
          correlationId: ctx.correlation_id,
          actor: ctx.actor,
          data: {
            jurisdiction_id: jurId,
            parent_jurisdiction_id: request.body.parent_id,
            relation_type_code: 'CONTAINS',
            version_no: 1,
            valid_from: now.toISOString(),
          },
        });
        await insertOutbox(tx, boundary, TOPIC_DOMAIN);
      }
      await withWriteAudit(deps, ctx, tx, {
        action: 'JURISDICTION_CREATE',
        actionClass: 'WRITE',
        resourceType: 'Jurisdiction',
        resourceId: jurId,
        result: 'SUCCESS',
        reason: request.body.reason,
        now,
      });
      return {
        status: 201,
        body: {
          jurisdiction_id: jurId,
          code: request.body.code,
          name: request.body.name,
          status: 'DRAFT',
          version_no: 1,
        },
      };
    });
    sendPrivate(reply);
    return reply.code(result.status).send(result.body);
  });

  app.post<{ Params: { id: string }; Body: { name?: string; reason?: string } }>(
    '/jurisdictions/:id/publish',
    { schema: { params: UUID_PARAM, body: PUBLISH_BODY } },
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
          resource_type: 'Jurisdiction',
          jurisdiction_id: request.params.id,
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'JURISDICTION_PUBLISH',
      });
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/jurisdictions/${request.params.id}/publish`,
        async (tx) => {
          const tenantId = ctx.tenant_id as string;
          await lockTenantScope(tx, tenantId);
          const current = await tx.query<{
            version_no: string;
            name: string;
            jurisdiction_type_id: string;
            status: string;
          }>(
            `SELECT version_no, name, jurisdiction_type_id, status
               FROM sf_jurisdiction.jurisdiction_version
              WHERE jurisdiction_id = $1
              ORDER BY version_no DESC
              LIMIT 1`,
            [request.params.id],
          );
          const row = current.rows[0];
          if (!row) throw new Cmp003Error('SF-SYS-002');
          const base = deps.clock();
          const name = request.body.name ?? row.name;
          const versionNo = Number(row.version_no) + 1;
          // Distinct valid_from per version under a fixed/deterministic clock (UNIQUE).
          const now = new Date(base.getTime() + versionNo);
          await tx.query(
            `INSERT INTO sf_jurisdiction.jurisdiction_version (
               tenant_id, jurisdiction_id, version_no, name, jurisdiction_type_id, status, valid_from, reason, created_by
             ) VALUES ($1,$2,$3,$4,$5,'PUBLISHED',$6,$7,$8)`,
            [
              tenantId,
              request.params.id,
              versionNo,
              name,
              row.jurisdiction_type_id,
              now.toISOString(),
              request.body.reason ?? null,
              ctx.actor.id,
            ],
          );
          const env = envelopeOf({
            eventType: 'JurisdictionVersionPublished',
            tenantId,
            cellId: ctx.cell_id,
            aggregateType: 'Jurisdiction',
            aggregateId: request.params.id,
            aggregateVersion: versionNo,
            occurredAt: now.toISOString(),
            correlationId: ctx.correlation_id,
            actor: ctx.actor,
            data: {
              jurisdiction_id: request.params.id,
              version_no: versionNo,
              name,
              status: 'PUBLISHED',
              valid_from: now.toISOString(),
            },
          });
          await insertOutbox(tx, env, TOPIC_DOMAIN);
          await withWriteAudit(deps, ctx, tx, {
            action: 'JURISDICTION_PUBLISH',
            actionClass: 'WRITE',
            resourceType: 'Jurisdiction',
            resourceId: request.params.id,
            result: 'SUCCESS',
            reason: request.body.reason,
            now,
          });
          return {
            status: 200,
            body: {
              jurisdiction_id: request.params.id,
              version_no: versionNo,
              status: 'PUBLISHED',
              name,
              valid_from: now.toISOString(),
            },
          };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{
    Params: { id: string };
    Body: { parent_id: string | null; relation_type_code: string; reason?: string };
  }>(
    '/jurisdictions/:id/relations',
    { schema: { params: UUID_PARAM, body: RELATION_BODY } },
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
          resource_type: 'Jurisdiction',
          jurisdiction_id: request.params.id,
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'JURISDICTION_BOUNDARY_CHANGE',
      });
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/jurisdictions/${request.params.id}/relations`,
        async (tx) => {
          const tenantId = ctx.tenant_id as string;
          await lockTenantScope(tx, tenantId);
          const child = await tx.query(
            'SELECT jurisdiction_id FROM sf_jurisdiction.jurisdiction WHERE jurisdiction_id = $1',
            [request.params.id],
          );
          if (child.rowCount === 0) throw new Cmp003Error('SF-SYS-002');
          if (request.body.parent_id) {
            const parent = await tx.query(
              'SELECT jurisdiction_id FROM sf_jurisdiction.jurisdiction WHERE jurisdiction_id = $1',
              [request.body.parent_id],
            );
            if (parent.rowCount === 0) throw new Cmp003Error('SF-SYS-002');
          }
          const now = deps.clock();
          await assertNoCycle(tx, request.params.id, request.body.parent_id, now);
          const prev = await tx.query<{ version_no: string }>(
            `SELECT version_no FROM sf_jurisdiction.jurisdiction_relation
              WHERE child_jurisdiction_id = $1
              ORDER BY version_no DESC LIMIT 1`,
            [request.params.id],
          );
          const versionNo = Number(prev.rows[0]?.version_no ?? 0) + 1;
          const relationId = newId();
          await tx.query(
            `INSERT INTO sf_jurisdiction.jurisdiction_relation (
               relation_id, tenant_id, child_jurisdiction_id, parent_jurisdiction_id,
               relation_type_code, version_no, valid_from, created_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              relationId,
              tenantId,
              request.params.id,
              request.body.parent_id,
              request.body.relation_type_code,
              versionNo,
              now.toISOString(),
              ctx.actor.id,
            ],
          );
          const env = envelopeOf({
            eventType: 'JurisdictionBoundaryChanged',
            tenantId,
            cellId: ctx.cell_id,
            aggregateType: 'Jurisdiction',
            aggregateId: request.params.id,
            aggregateVersion: versionNo,
            occurredAt: now.toISOString(),
            correlationId: ctx.correlation_id,
            actor: ctx.actor,
            data: {
              jurisdiction_id: request.params.id,
              parent_jurisdiction_id: request.body.parent_id,
              relation_type_code: request.body.relation_type_code,
              version_no: versionNo,
              valid_from: now.toISOString(),
            },
          });
          await insertOutbox(tx, env, TOPIC_DOMAIN);
          await withWriteAudit(deps, ctx, tx, {
            action: 'JURISDICTION_BOUNDARY_CHANGE',
            actionClass: 'WRITE',
            resourceType: 'Jurisdiction',
            resourceId: request.params.id,
            result: 'SUCCESS',
            reason: request.body.reason,
            now,
          });
          return {
            status: 200,
            body: {
              relation_id: relationId,
              jurisdiction_id: request.params.id,
              parent_jurisdiction_id: request.body.parent_id,
              version_no: versionNo,
            },
          };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{
    Body: {
      jurisdiction_id: string;
      target_type: string;
      target_ref: string;
      reason?: string;
    };
  }>('/jurisdiction-bindings', { schema: { body: BINDING_BODY } }, async (request, reply) => {
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
        resource_type: 'JurisdictionBinding',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'JURISDICTION_BINDING_CREATE',
    });
    const result = await runCommand(
      deps,
      request,
      ctx,
      'POST /v1/jurisdiction-bindings',
      async (tx) => {
        const tenantId = ctx.tenant_id as string;
        const jur = await tx.query(
          'SELECT jurisdiction_id FROM sf_jurisdiction.jurisdiction WHERE jurisdiction_id = $1',
          [request.body.jurisdiction_id],
        );
        if (jur.rowCount === 0) throw new Cmp003Error('SF-SYS-002');
        const prev = await tx.query<{ version_no: string }>(
          `SELECT version_no FROM sf_jurisdiction.jurisdiction_binding
            WHERE target_type = $1 AND target_ref = $2
            ORDER BY version_no DESC LIMIT 1`,
          [request.body.target_type, request.body.target_ref],
        );
        const versionNo = Number(prev.rows[0]?.version_no ?? 0) + 1;
        const bindingId = newId();
        const now = deps.clock();
        await tx.query(
          `INSERT INTO sf_jurisdiction.jurisdiction_binding (
             binding_id, tenant_id, jurisdiction_id, target_type, target_ref, status,
             valid_from, version_no, reason, created_by
           ) VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$8,$9)`,
          [
            bindingId,
            tenantId,
            request.body.jurisdiction_id,
            request.body.target_type,
            request.body.target_ref,
            now.toISOString(),
            versionNo,
            request.body.reason ?? null,
            ctx.actor.id,
          ],
        );
        await withWriteAudit(deps, ctx, tx, {
          action: 'JURISDICTION_BINDING_CREATE',
          actionClass: 'WRITE',
          resourceType: 'JurisdictionBinding',
          resourceId: bindingId,
          result: 'SUCCESS',
          reason: request.body.reason,
          now,
        });
        return {
          status: 201,
          body: {
            binding_id: bindingId,
            jurisdiction_id: request.body.jurisdiction_id,
            target_type: request.body.target_type,
            target_ref: request.body.target_ref,
            version_no: versionNo,
            status: 'ACTIVE',
          },
        };
      },
    );
    sendPrivate(reply);
    return reply.code(result.status).send(result.body);
  });
}
