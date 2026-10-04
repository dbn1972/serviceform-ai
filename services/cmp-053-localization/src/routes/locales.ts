import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { currentClient, withContextTx } from '../db/tx.js';
import { isLocaleTag, isSkeleton } from '../domain/locale.js';
import { Cmp053Error } from '../errors.js';
import { CREATE_LOCALE_BODY, FORMAT_BODY, UUID_PARAM } from '../schemas/http.js';
import {
  decide,
  runCommand,
  sendPrivate,
  subjectOf,
  withWriteAudit,
  type RouteDeps,
} from './helpers.js';

export function registerLocaleRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/locales', async (request, reply) => {
    const ctx = request.sfContext;
    await decide(deps, ctx, {
      subject: subjectOf(ctx),
      resource: {
        resource_type: 'Locale',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'LOCALE_READ',
    });
    const rows = await withContextTx(deps.pool, ctx, async () => {
      const client = currentClient();
      const result = await client.query<{
        locale_id: string;
        locale_tag: string;
        fallback_tag: string | null;
        is_default: boolean;
        status: string;
      }>(
        `SELECT locale_id, locale_tag, fallback_tag, is_default, status
           FROM sf_localization.locale
          WHERE status = 'ACTIVE'
          ORDER BY locale_tag`,
      );
      return result.rows;
    });
    sendPrivate(reply);
    return { items: rows };
  });

  app.post<{
    Body: { locale_tag: string; fallback_tag?: string | null; is_default?: boolean };
  }>('/locales', { schema: { body: CREATE_LOCALE_BODY } }, async (request, reply) => {
    const ctx = request.sfContext;
    await decide(deps, ctx, {
      subject: subjectOf(ctx),
      resource: {
        resource_type: 'Locale',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'LOCALE_WRITE',
    });
    if (!isLocaleTag(request.body.locale_tag)) {
      throw new Cmp053Error('SF-SYS-003', { details: [{ code: 'LOCALE_TAG' }] });
    }
    if (request.body.fallback_tag && !isLocaleTag(request.body.fallback_tag)) {
      throw new Cmp053Error('SF-SYS-003', { details: [{ code: 'FALLBACK_TAG' }] });
    }
    const result = await runCommand(deps, request, ctx, 'POST /v1/locales', async (tx) => {
      const localeId = randomUUID();
      await tx.query(
        `INSERT INTO sf_localization.locale (
           tenant_id, locale_id, locale_tag, fallback_tag, is_default, status, created_by
         ) VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6)`,
        [
          ctx.tenant_id,
          localeId,
          request.body.locale_tag,
          request.body.fallback_tag ?? null,
          request.body.is_default === true,
          ctx.actor.id,
        ],
      );
      await withWriteAudit(deps, ctx, tx, {
        action: 'LOCALE_WRITE',
        actionClass: 'WRITE',
        resourceType: 'Locale',
        resourceId: localeId,
        result: 'SUCCESS',
        now: deps.clock(),
      });
      return {
        status: 201,
        body: {
          locale_id: localeId,
          locale_tag: request.body.locale_tag,
          status: 'ACTIVE',
        },
      };
    });
    sendPrivate(reply);
    return reply.code(result.status).send(result.body);
  });

  app.put<{
    Params: { id: string };
    Body: {
      date_skeleton: string;
      time_skeleton: string;
      decimal_separator: string;
      group_separator: string;
    };
  }>(
    '/locales/:id/format-profile',
    { schema: { params: UUID_PARAM, body: FORMAT_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      await decide(deps, ctx, {
        subject: subjectOf(ctx),
        resource: {
          resource_type: 'FormatProfile',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'LOCALE_WRITE',
      });
      if (!isSkeleton(request.body.date_skeleton) || !isSkeleton(request.body.time_skeleton)) {
        throw new Cmp053Error('SF-SYS-003', { details: [{ code: 'SKELETON' }] });
      }
      const result = await runCommand(
        deps,
        request,
        ctx,
        `PUT /v1/locales/${request.params.id}/format-profile`,
        async (tx) => {
          const exists = await tx.query(
            `SELECT 1 FROM sf_localization.locale WHERE locale_id = $1`,
            [request.params.id],
          );
          if ((exists.rowCount ?? 0) === 0) throw new Cmp053Error('SF-SYS-002');
          await tx.query(
            `INSERT INTO sf_localization.format_profile (
             tenant_id, locale_id, date_skeleton, time_skeleton, decimal_separator, group_separator, created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (tenant_id, locale_id) DO UPDATE
             SET date_skeleton = EXCLUDED.date_skeleton,
                 time_skeleton = EXCLUDED.time_skeleton,
                 decimal_separator = EXCLUDED.decimal_separator,
                 group_separator = EXCLUDED.group_separator,
                 updated_at = now()`,
            [
              ctx.tenant_id,
              request.params.id,
              request.body.date_skeleton,
              request.body.time_skeleton,
              request.body.decimal_separator,
              request.body.group_separator,
              ctx.actor.id,
            ],
          );
          await withWriteAudit(deps, ctx, tx, {
            action: 'FORMAT_PROFILE_WRITE',
            actionClass: 'WRITE',
            resourceType: 'FormatProfile',
            resourceId: request.params.id,
            result: 'SUCCESS',
            now: deps.clock(),
          });
          return { status: 200, body: { locale_id: request.params.id, ...request.body } };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );
}
