import type { FastifyInstance } from 'fastify';
import { envelopeOf, insertOutbox, TOPIC_DOMAIN } from '../db/outbox.js';
import { Cmp030Error } from '../errors.js';
import {
  getPurposeById,
  insertNotice,
  publishNotice,
  serializeNotice,
} from '../repositories/consent.repo.js';
import { CREATE_NOTICE_BODY, UUID_PARAM } from '../schemas/http.js';
import {
  decide,
  requireTenant,
  runCommand,
  sendPrivate,
  withWriteAudit,
  writeDenied,
  type RouteDeps,
} from './helpers.js';

export function registerNoticeRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post<{ Body: { purpose_id: string; content_ref: string; version_no?: number } }>(
    '/privacy/notices',
    { schema: { body: CREATE_NOTICE_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      const tenantId = requireTenant(ctx);
      try {
        await decide(deps, ctx, {
          subject: {
            user_id: ctx.actor.id,
            actor_type: ctx.actor.type,
            tenant_id: ctx.tenant_id,
            roles: ctx.roles,
            jurisdiction_ids: ctx.jurisdiction_ids,
          },
          resource: {
            resource_type: 'PrivacyNotice',
            tenant_id: ctx.tenant_id,
            classification: 'TENANT_SCOPED',
          },
          action: 'NOTICE_CREATE',
        });
      } catch (err) {
        if (err instanceof Cmp030Error && err.code === 'SF-AUTH-002') {
          await writeDenied(deps, ctx, request, 'NOTICE_CREATE', 'PrivacyNotice', tenantId);
        }
        throw err;
      }
      const result = await runCommand(
        deps,
        request,
        ctx,
        'POST /v1/privacy/notices',
        async (tx) => {
          const purpose = await getPurposeById(tx, tenantId, request.body.purpose_id);
          if (!purpose || purpose.status !== 'ACTIVE') throw new Cmp030Error('SF-SYS-002');
          const row = await insertNotice(tx, {
            tenantId,
            purposeId: request.body.purpose_id,
            contentRef: request.body.content_ref,
            versionNo: request.body.version_no ?? 1,
            createdBy: ctx.actor.id,
          });
          await withWriteAudit(deps, ctx, tx, {
            action: 'NOTICE_CREATE',
            actionClass: 'WRITE',
            resourceType: 'PrivacyNotice',
            resourceId: row.notice_id,
            result: 'SUCCESS',
            now: deps.clock(),
          });
          return { status: 201, body: serializeNotice(row) };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/privacy/notices/:id/publish',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const ctx = request.sfContext;
      const tenantId = requireTenant(ctx);
      try {
        await decide(deps, ctx, {
          subject: {
            user_id: ctx.actor.id,
            actor_type: ctx.actor.type,
            tenant_id: ctx.tenant_id,
            roles: ctx.roles,
            jurisdiction_ids: ctx.jurisdiction_ids,
          },
          resource: {
            resource_type: 'PrivacyNotice',
            tenant_id: ctx.tenant_id,
            classification: 'TENANT_SCOPED',
          },
          action: 'NOTICE_PUBLISH',
        });
      } catch (err) {
        if (err instanceof Cmp030Error && err.code === 'SF-AUTH-002') {
          await writeDenied(
            deps,
            ctx,
            request,
            'NOTICE_PUBLISH',
            'PrivacyNotice',
            request.params.id,
          );
        }
        throw err;
      }
      const now = deps.clock();
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/privacy/notices/${request.params.id}/publish`,
        async (tx) => {
          const row = await publishNotice(tx, {
            tenantId,
            noticeId: request.params.id,
            now,
          });
          const env = envelopeOf({
            eventType: 'PrivacyNoticeUpdated',
            tenantId,
            cellId: ctx.cell_id,
            aggregateType: 'PrivacyNotice',
            aggregateId: row.notice_id,
            aggregateVersion: Number(row.version_no),
            occurredAt: now.toISOString(),
            correlationId: ctx.correlation_id,
            actor: ctx.actor,
            data: {
              notice_id: row.notice_id,
              purpose_id: row.purpose_id,
              version_no: Number(row.version_no),
              content_ref: row.content_ref,
              status: row.status,
              published_at: row.published_at?.toISOString() ?? now.toISOString(),
            },
          });
          await insertOutbox(tx, env, TOPIC_DOMAIN);
          await withWriteAudit(deps, ctx, tx, {
            action: 'NOTICE_PUBLISH',
            actionClass: 'WRITE',
            resourceType: 'PrivacyNotice',
            resourceId: row.notice_id,
            result: 'SUCCESS',
            now,
          });
          return { status: 200, body: serializeNotice(row) };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );
}
