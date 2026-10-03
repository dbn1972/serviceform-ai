import type { FastifyInstance } from 'fastify';
import {
  ACTIVATE_OFFICE_BODY,
  CREATE_OFFICE_BODY,
  OFFICE_QUERY,
  UUID_PARAM,
} from '../schemas/http.js';
import { currentClient, withContextTx } from '../db/tx.js';
import { envelopeOf, insertOutbox, TOPIC_DOMAIN } from '../db/outbox.js';
import { Cmp002Error } from '../errors.js';
import { newId } from '../repositories/org.repo.js';
import { decide, runCommand, sendPrivate, withWriteAudit, type RouteDeps } from './helpers.js';

export function registerOfficeRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get<{
    Querystring: { organisation_id?: string; status?: string; cursor?: string; limit?: number };
  }>('/offices', { schema: { querystring: OFFICE_QUERY } }, async (request, reply) => {
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
        resource_type: 'Office',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'OFFICE_READ',
    });
    const limit = request.query.limit ?? 50;
    const rows = await withContextTx(deps.pool, ctx, async () => {
      const client = currentClient();
      const result = await client.query<{
        office_id: string;
        organisation_id: string;
        code: string;
        name: string;
        status: string;
        version: string;
        activated_at: Date | null;
      }>(
        `SELECT office_id, organisation_id, code, name, status, version, activated_at
           FROM sf_tenant_org.office
          WHERE ($1::uuid IS NULL OR organisation_id = $1)
            AND ($2::text IS NULL OR status = $2)
          ORDER BY office_id
          LIMIT $3`,
        [request.query.organisation_id ?? null, request.query.status ?? null, limit],
      );
      return result.rows;
    });
    sendPrivate(reply);
    return {
      items: rows.map((r) => ({
        office_id: r.office_id,
        organisation_id: r.organisation_id,
        code: r.code,
        name: r.name,
        status: r.status,
        version: Number(r.version),
        activated_at: r.activated_at ? r.activated_at.toISOString() : null,
      })),
    };
  });

  app.post<{ Body: { organisation_id: string; code: string; name: string } }>(
    '/offices',
    { schema: { body: CREATE_OFFICE_BODY } },
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
          resource_type: 'Office',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'OFFICE_CREATE',
      });
      const result = await runCommand(
        deps,
        request,
        ctx,
        'POST /v1/offices',
        undefined,
        async (tx) => {
          const org = await tx.query(
            'SELECT organisation_id FROM sf_tenant_org.organisation WHERE organisation_id = $1',
            [request.body.organisation_id],
          );
          if (org.rowCount === 0) throw new Cmp002Error('SF-SYS-002');
          const officeId = newId();
          const now = deps.clock();
          await tx.query(
            `INSERT INTO sf_tenant_org.office (
             tenant_id, office_id, organisation_id, code, name, status, version, created_at, created_by
           ) VALUES ($1,$2,$3,$4,$5,'DRAFT',1,$6,$7)`,
            [
              ctx.tenant_id,
              officeId,
              request.body.organisation_id,
              request.body.code,
              request.body.name,
              now.toISOString(),
              ctx.actor.id,
            ],
          );
          await withWriteAudit(deps, ctx, tx, {
            action: 'OFFICE_CREATE',
            actionClass: 'WRITE',
            resourceType: 'Office',
            resourceId: officeId,
            result: 'SUCCESS',
            now,
          });
          return { status: 201, body: { office_id: officeId, status: 'DRAFT', version: 1 } };
        },
      );
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Params: { id: string }; Body: { version?: number } }>(
    '/offices/:id/activate',
    { schema: { params: UUID_PARAM, body: ACTIVATE_OFFICE_BODY } },
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
          resource_type: 'Office',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'OFFICE_ACTIVATE',
      });
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/offices/${request.params.id}/activate`,
        undefined,
        async (tx) => {
          const found = await tx.query<{
            office_id: string;
            organisation_id: string;
            status: string;
            version: string;
            activated_at: Date | null;
          }>(
            'SELECT office_id, organisation_id, status, version, activated_at FROM sf_tenant_org.office WHERE office_id = $1',
            [request.params.id],
          );
          const row = found.rows[0];
          if (!row) throw new Cmp002Error('SF-SYS-002');
          if (request.body.version !== undefined && Number(row.version) !== request.body.version) {
            throw new Cmp002Error('SF-APP-001');
          }
          const now = deps.clock();
          if (row.status === 'ACTIVE') {
            return {
              status: 200,
              body: {
                office_id: row.office_id,
                status: 'ACTIVE',
                activated_at: row.activated_at?.toISOString() ?? now.toISOString(),
              },
            };
          }
          const updated = await tx.query(
            `UPDATE sf_tenant_org.office
                SET status = 'ACTIVE', version = version + 1, activated_at = $1
              WHERE office_id = $2 AND status = 'DRAFT'
              RETURNING version, activated_at`,
            [now.toISOString(), request.params.id],
          );
          if (updated.rowCount === 0) throw new Cmp002Error('SF-APP-001');
          const env = envelopeOf({
            eventType: 'OfficeActivated',
            tenantId: ctx.tenant_id,
            cellId: ctx.cell_id,
            aggregateType: 'Office',
            aggregateId: request.params.id,
            aggregateVersion: Number(updated.rows[0]?.version ?? 2),
            occurredAt: now.toISOString(),
            correlationId: ctx.correlation_id,
            actor: ctx.actor,
            data: {
              office_id: request.params.id,
              organisation_id: row.organisation_id,
              activated_at: now.toISOString(),
            },
          });
          await insertOutbox(tx, env, TOPIC_DOMAIN);
          await withWriteAudit(deps, ctx, tx, {
            action: 'OFFICE_ACTIVATE',
            actionClass: 'WRITE',
            resourceType: 'Office',
            resourceId: request.params.id,
            result: 'SUCCESS',
            now,
          });
          return {
            status: 200,
            body: {
              office_id: request.params.id,
              status: 'ACTIVE',
              activated_at: now.toISOString(),
            },
          };
        },
      );
      return reply.code(result.status).send(result.body);
    },
  );
}
