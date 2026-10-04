import type { FastifyInstance } from 'fastify';
import {
  BINDING_BODY,
  CREATE_OFFERING_BODY,
  OFFERING_QUERY,
  OFFERING_VERSION_BODY,
  UUID_PARAM,
} from '../schemas/http.js';
import { withContextTx } from '../db/tx.js';
import { currentClient } from '../db/tx.js';
import { newId, requireMutableOffering } from '../repositories/catalogue.repo.js';
import { rejectClientPin } from '../domain/publication.js';
import { Cmp001Error } from '../errors.js';
import {
  decide,
  decodeCursor,
  emitDomain,
  encodeCursor,
  iso,
  runCommand,
  sendPrivate,
  subject,
  withWriteAudit,
  type RouteDeps,
} from './helpers.js';

export function registerOfferingRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get<{
    Querystring: {
      tag?: string;
      category_id?: string;
      status?: string;
      cursor?: string;
      limit?: number;
    };
  }>('/offerings', { schema: { querystring: OFFERING_QUERY } }, async (request, reply) => {
    const ctx = request.sfContext;
    await decide(deps, ctx, {
      subject: subject(ctx),
      resource: {
        resource_type: 'ServiceOffering',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'CATALOGUE_OFFERING_READ',
    });
    const after = decodeCursor(request.query.cursor);
    const limit = request.query.limit ?? 50;
    const rows = await withContextTx(deps.pool, ctx, async () => {
      const client = currentClient();
      const result = await client.query(
        `SELECT o.offering_id, o.offering_code, o.canonical_service_id,
                v.version_no, v.local_name, v.status, v.tags, v.published_pin_ref
           FROM sf_catalogue.offering o
           JOIN LATERAL (
             SELECT version_no, local_name, status, tags, published_pin_ref
               FROM sf_catalogue.offering_version
              WHERE offering_id = o.offering_id
              ORDER BY version_no DESC
              LIMIT 1
           ) v ON true
           JOIN sf_catalogue.canonical_service s ON s.canonical_service_id = o.canonical_service_id
          WHERE ($1::uuid IS NULL OR o.offering_id > $1)
            AND ($2::text IS NULL OR v.status = $2)
            AND ($3::text IS NULL OR $3 = ANY (v.tags))
            AND ($4::uuid IS NULL OR s.category_id = $4)
          ORDER BY o.offering_id
          LIMIT $5`,
        [
          after ?? null,
          request.query.status ?? null,
          request.query.tag ?? null,
          request.query.category_id ?? null,
          limit,
        ],
      );
      return result.rows;
    });
    sendPrivate(reply);
    const last = rows[rows.length - 1] as { offering_id?: string } | undefined;
    return {
      items: rows,
      next_cursor:
        rows.length === limit && last?.offering_id ? encodeCursor(last.offering_id) : null,
    };
  });

  app.get<{ Params: { id: string } }>(
    '/offerings/:id',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const ctx = request.sfContext;
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: {
          resource_type: 'ServiceOffering',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'CATALOGUE_OFFERING_READ',
      });
      const row = await withContextTx(deps.pool, ctx, async () => {
        const client = currentClient();
        const result = await client.query(
          `SELECT o.offering_id, o.offering_code, o.canonical_service_id,
                  v.version_no, v.local_name, v.status, v.tags, v.published_pin_ref,
                  v.provider_org_ref, v.provider_office_ref
             FROM sf_catalogue.offering o
             JOIN LATERAL (
               SELECT version_no, local_name, status, tags, published_pin_ref,
                      provider_org_ref, provider_office_ref
                 FROM sf_catalogue.offering_version
                WHERE offering_id = o.offering_id
                ORDER BY version_no DESC
                LIMIT 1
             ) v ON true
            WHERE o.offering_id = $1`,
          [request.params.id],
        );
        return result.rows[0];
      });
      if (!row) throw new Cmp001Error('SF-SYS-002');
      sendPrivate(reply);
      return row;
    },
  );

  app.post<{
    Body: {
      canonical_service_id: string;
      offering_code: string;
      local_name: string;
      provider_org_ref?: string;
      provider_office_ref?: string;
      tags?: string[];
      reason?: string;
    };
  }>('/offerings', { schema: { body: CREATE_OFFERING_BODY } }, async (request, reply) => {
    const ctx = request.sfContext;
    rejectClientPin(request.body);
    await decide(deps, ctx, {
      subject: subject(ctx),
      resource: {
        resource_type: 'ServiceOffering',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'CATALOGUE_OFFERING_CREATE',
    });
    const result = await runCommand(deps, request, ctx, 'POST /v1/offerings', async (tx) => {
      const offeringId = newId();
      const now = iso(deps.clock);
      await tx.query(
        `INSERT INTO sf_catalogue.offering (
           tenant_id, offering_id, canonical_service_id, offering_code, created_by
         ) VALUES ($1,$2,$3,$4,$5)`,
        [
          ctx.tenant_id,
          offeringId,
          request.body.canonical_service_id,
          request.body.offering_code,
          ctx.actor.id,
        ],
      );
      await tx.query(
        `INSERT INTO sf_catalogue.offering_version (
           tenant_id, offering_id, version_no, local_name, status, provider_org_ref,
           provider_office_ref, tags, published_pin_ref, valid_from, reason, created_by
         ) VALUES ($1,$2,1,$3,'DRAFT',$4,$5,$6,NULL,$7,$8,$9)`,
        [
          ctx.tenant_id,
          offeringId,
          request.body.local_name,
          request.body.provider_org_ref ?? null,
          request.body.provider_office_ref ?? null,
          request.body.tags ?? [],
          now,
          request.body.reason ?? null,
          ctx.actor.id,
        ],
      );
      await emitDomain(tx, ctx, {
        eventType: 'ServiceOfferingChanged',
        aggregateType: 'ServiceOffering',
        aggregateId: offeringId,
        aggregateVersion: 1,
        occurredAt: now,
        data: {
          change: 'CREATED',
          offering_id: offeringId,
          offering_code: request.body.offering_code,
          version_no: 1,
        },
      });
      await withWriteAudit(deps, ctx, tx, {
        action: 'CATALOGUE_OFFERING_CREATE',
        actionClass: 'WRITE',
        resourceType: 'ServiceOffering',
        resourceId: offeringId,
        result: 'SUCCESS',
        now: deps.clock(),
        classification: 'TENANT_SCOPED',
      });
      return {
        status: 201,
        body: {
          offering_id: offeringId,
          offering_code: request.body.offering_code,
          status: 'DRAFT',
          version_no: 1,
        },
      };
    });
    sendPrivate(reply);
    return reply.code(result.status).send(result.body);
  });

  app.post<{
    Params: { id: string };
    Body: {
      local_name: string;
      status?: 'DRAFT' | 'READY' | 'RETIRED';
      provider_org_ref?: string;
      provider_office_ref?: string;
      tags?: string[];
      reason?: string;
    };
  }>(
    '/offerings/:id/versions',
    { schema: { params: UUID_PARAM, body: OFFERING_VERSION_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      rejectClientPin(request.body);
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: {
          resource_type: 'ServiceOffering',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'CATALOGUE_OFFERING_VERSION',
      });
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/offerings/${request.params.id}/versions`,
        async (tx) => {
          const latest = await requireMutableOffering(tx, request.params.id);
          const versionNo = Number(latest.version_no) + 1;
          const now = iso(deps.clock);
          const status = request.body.status ?? 'DRAFT';
          await tx.query(
            `INSERT INTO sf_catalogue.offering_version (
               tenant_id, offering_id, version_no, local_name, status, provider_org_ref,
               provider_office_ref, tags, published_pin_ref, valid_from, reason, created_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$10,$11)`,
            [
              ctx.tenant_id,
              request.params.id,
              versionNo,
              request.body.local_name,
              status,
              request.body.provider_org_ref ?? null,
              request.body.provider_office_ref ?? null,
              request.body.tags ?? [],
              now,
              request.body.reason ?? null,
              ctx.actor.id,
            ],
          );
          await emitDomain(tx, ctx, {
            eventType: 'ServiceOfferingChanged',
            aggregateType: 'ServiceOffering',
            aggregateId: request.params.id,
            aggregateVersion: versionNo,
            occurredAt: now,
            data: {
              change: 'VERSIONED',
              offering_id: request.params.id,
              version_no: versionNo,
              status,
            },
          });
          await withWriteAudit(deps, ctx, tx, {
            action: 'CATALOGUE_OFFERING_VERSION',
            actionClass: 'WRITE',
            resourceType: 'ServiceOffering',
            resourceId: request.params.id,
            result: 'SUCCESS',
            now: deps.clock(),
            classification: 'TENANT_SCOPED',
          });
          return {
            status: 201,
            body: { offering_id: request.params.id, version_no: versionNo, status },
          };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      jurisdiction_ref: string;
      target_type: string;
      target_ref: string;
      reason?: string;
    };
  }>(
    '/offerings/:id/bindings',
    { schema: { params: UUID_PARAM, body: BINDING_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      rejectClientPin(request.body);
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: {
          resource_type: 'OfferingBinding',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'CATALOGUE_BINDING_CREATE',
      });
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/offerings/${request.params.id}/bindings`,
        async (tx) => {
          const latest = await requireMutableOffering(tx, request.params.id);
          const bindingId = newId();
          const now = iso(deps.clock);
          await tx.query(
            `INSERT INTO sf_catalogue.offering_binding (
               binding_id, tenant_id, offering_id, version_no, jurisdiction_ref, target_type,
               target_ref, status, valid_from, reason, created_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8,$9,$10)`,
            [
              bindingId,
              ctx.tenant_id,
              request.params.id,
              latest.version_no,
              request.body.jurisdiction_ref,
              request.body.target_type,
              request.body.target_ref,
              now,
              request.body.reason ?? null,
              ctx.actor.id,
            ],
          );
          await emitDomain(tx, ctx, {
            eventType: 'OfferingBindingChanged',
            aggregateType: 'OfferingBinding',
            aggregateId: bindingId,
            aggregateVersion: Number(latest.version_no),
            occurredAt: now,
            data: {
              change: 'CREATED',
              binding_id: bindingId,
              offering_id: request.params.id,
              jurisdiction_ref: request.body.jurisdiction_ref,
              target_type: request.body.target_type,
            },
          });
          await withWriteAudit(deps, ctx, tx, {
            action: 'CATALOGUE_BINDING_CREATE',
            actionClass: 'WRITE',
            resourceType: 'OfferingBinding',
            resourceId: bindingId,
            result: 'SUCCESS',
            now: deps.clock(),
            classification: 'TENANT_SCOPED',
          });
          return {
            status: 201,
            body: {
              binding_id: bindingId,
              offering_id: request.params.id,
              version_no: Number(latest.version_no),
              status: 'ACTIVE',
            },
          };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );
}
