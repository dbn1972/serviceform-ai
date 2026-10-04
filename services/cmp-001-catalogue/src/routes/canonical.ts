import type { FastifyInstance } from 'fastify';
import { CANONICAL_VERSION_BODY, CREATE_CANONICAL_BODY, UUID_PARAM } from '../schemas/http.js';
import { withContextTx } from '../db/tx.js';
import { currentClient } from '../db/tx.js';
import { newId } from '../repositories/catalogue.repo.js';
import { rejectClientPin } from '../domain/publication.js';
import { Cmp001Error } from '../errors.js';
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

export function registerCanonicalRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/canonical-services', async (request, reply) => {
    const ctx = request.sfContext;
    await decide(deps, ctx, {
      subject: subject(ctx),
      resource: {
        resource_type: 'CanonicalService',
        tenant_id: ctx.tenant_id,
        classification: 'GLOBAL',
      },
      action: 'CATALOGUE_CANONICAL_READ',
    });
    const rows = await withContextTx(deps.pool, ctx, async () => {
      const client = currentClient();
      const result = await client.query(
        `SELECT s.canonical_service_id, s.service_code, s.category_id, s.status,
                v.version_no, v.title, v.summary, v.tags
           FROM sf_catalogue.canonical_service s
           JOIN LATERAL (
             SELECT version_no, title, summary, tags
               FROM sf_catalogue.canonical_service_version
              WHERE canonical_service_id = s.canonical_service_id
              ORDER BY version_no DESC
              LIMIT 1
           ) v ON true
          WHERE s.status <> 'RETIRED'
          ORDER BY s.service_code`,
      );
      return result.rows;
    });
    sendPrivate(reply);
    return { items: rows };
  });

  app.get<{ Params: { id: string } }>(
    '/canonical-services/:id',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const ctx = request.sfContext;
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: {
          resource_type: 'CanonicalService',
          tenant_id: ctx.tenant_id,
          classification: 'GLOBAL',
        },
        action: 'CATALOGUE_CANONICAL_READ',
      });
      const row = await withContextTx(deps.pool, ctx, async () => {
        const client = currentClient();
        const result = await client.query(
          `SELECT s.canonical_service_id, s.service_code, s.category_id, s.status,
                  v.version_no, v.title, v.summary, v.tags
             FROM sf_catalogue.canonical_service s
             JOIN LATERAL (
               SELECT version_no, title, summary, tags
                 FROM sf_catalogue.canonical_service_version
                WHERE canonical_service_id = s.canonical_service_id
                ORDER BY version_no DESC
                LIMIT 1
             ) v ON true
            WHERE s.canonical_service_id = $1`,
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
      service_code: string;
      category_id: string;
      title: string;
      summary: string;
      tags?: string[];
      reason?: string;
    };
  }>(
    '/admin/canonical-services',
    { schema: { body: CREATE_CANONICAL_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      rejectClientPin(request.body);
      requirePrivileged(ctx);
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: {
          resource_type: 'CanonicalService',
          tenant_id: ctx.tenant_id,
          classification: 'GLOBAL',
        },
        action: 'CATALOGUE_CANONICAL_CREATE',
      });
      const result = await runCommand(
        deps,
        request,
        ctx,
        'POST /v1/admin/canonical-services',
        async (tx) => {
          const id = newId();
          const now = iso(deps.clock);
          await tx.query(
            `INSERT INTO sf_catalogue.canonical_service (
               canonical_service_id, service_code, category_id, status, created_by
             ) VALUES ($1,$2,$3,'DRAFT',$4)`,
            [id, request.body.service_code, request.body.category_id, ctx.actor.id],
          );
          await tx.query(
            `INSERT INTO sf_catalogue.canonical_service_version (
               canonical_service_id, version_no, title, summary, tags, status, valid_from, reason, created_by
             ) VALUES ($1,1,$2,$3,$4,'DRAFT',$5,$6,$7)`,
            [
              id,
              request.body.title,
              request.body.summary,
              request.body.tags ?? [],
              now,
              request.body.reason ?? null,
              ctx.actor.id,
            ],
          );
          await emitDomain(tx, ctx, {
            eventType: 'CanonicalServiceChanged',
            aggregateType: 'CanonicalService',
            aggregateId: id,
            aggregateVersion: 1,
            occurredAt: now,
            data: {
              change: 'CREATED',
              canonical_service_id: id,
              service_code: request.body.service_code,
              version_no: 1,
            },
          });
          await withWriteAudit(deps, ctx, tx, {
            action: 'CATALOGUE_CANONICAL_CREATE',
            actionClass: 'PRIVILEGED',
            resourceType: 'CanonicalService',
            resourceId: id,
            result: 'SUCCESS',
            reason: request.body.reason ?? 'CANONICAL_CREATED',
            now: deps.clock(),
            classification: 'GLOBAL',
          });
          return {
            status: 201,
            body: {
              canonical_service_id: id,
              service_code: request.body.service_code,
              status: 'DRAFT',
              version_no: 1,
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
    Body: {
      title: string;
      summary: string;
      tags?: string[];
      status?: 'DRAFT' | 'ACTIVE' | 'RETIRED';
      reason?: string;
    };
  }>(
    '/admin/canonical-services/:id/versions',
    { schema: { params: UUID_PARAM, body: CANONICAL_VERSION_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      rejectClientPin(request.body);
      requirePrivileged(ctx);
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: {
          resource_type: 'CanonicalService',
          tenant_id: ctx.tenant_id,
          classification: 'GLOBAL',
        },
        action: 'CATALOGUE_CANONICAL_VERSION',
      });
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/admin/canonical-services/${request.params.id}/versions`,
        async (tx) => {
          const latest = await tx.query<{ version_no: string }>(
            `SELECT version_no FROM sf_catalogue.canonical_service_version
              WHERE canonical_service_id = $1 ORDER BY version_no DESC LIMIT 1`,
            [request.params.id],
          );
          if (!latest.rows[0]) throw new Cmp001Error('SF-SYS-002');
          const versionNo = Number(latest.rows[0].version_no) + 1;
          const now = iso(deps.clock);
          const status = request.body.status ?? 'DRAFT';
          await tx.query(
            `INSERT INTO sf_catalogue.canonical_service_version (
               canonical_service_id, version_no, title, summary, tags, status, valid_from, reason, created_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              request.params.id,
              versionNo,
              request.body.title,
              request.body.summary,
              request.body.tags ?? [],
              status,
              now,
              request.body.reason ?? null,
              ctx.actor.id,
            ],
          );
          if (status === 'ACTIVE' || status === 'RETIRED') {
            await tx.query(
              `UPDATE sf_catalogue.canonical_service SET status = $1 WHERE canonical_service_id = $2`,
              [status, request.params.id],
            );
          }
          await emitDomain(tx, ctx, {
            eventType: 'CanonicalServiceChanged',
            aggregateType: 'CanonicalService',
            aggregateId: request.params.id,
            aggregateVersion: versionNo,
            occurredAt: now,
            data: {
              change: 'VERSIONED',
              canonical_service_id: request.params.id,
              version_no: versionNo,
              status,
            },
          });
          await withWriteAudit(deps, ctx, tx, {
            action: 'CATALOGUE_CANONICAL_VERSION',
            actionClass: 'PRIVILEGED',
            resourceType: 'CanonicalService',
            resourceId: request.params.id,
            result: 'SUCCESS',
            reason: request.body.reason ?? 'CANONICAL_VERSIONED',
            now: deps.clock(),
            classification: 'GLOBAL',
          });
          return {
            status: 201,
            body: { canonical_service_id: request.params.id, version_no: versionNo, status },
          };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );
}
