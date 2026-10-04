import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { envelopeOf, insertOutbox, TOPIC_DOMAIN } from '../db/outbox.js';
import { currentClient, withContextTx } from '../db/tx.js';
import { contentHash } from '../domain/fingerprint.js';
import { isLocaleTag, isMessageKey } from '../domain/locale.js';
import { Cmp053Error } from '../errors.js';
import {
  CREATE_CATALOG_BODY,
  PUBLISH_BODY,
  UPSERT_MESSAGES_BODY,
  UUID_PARAM,
  VERSION_PARAMS,
} from '../schemas/http.js';
import {
  decide,
  runCommand,
  sendPrivate,
  subjectOf,
  withWriteAudit,
  type RouteDeps,
} from './helpers.js';

export function registerCatalogRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/catalogs', async (request, reply) => {
    const ctx = request.sfContext;
    await decide(deps, ctx, {
      subject: subjectOf(ctx),
      resource: {
        resource_type: 'LocalizationCatalog',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'CATALOG_READ',
    });
    const rows = await withContextTx(deps.pool, ctx, async () => {
      const client = currentClient();
      const result = await client.query<{
        catalog_id: string;
        catalog_code: string;
        latest_published: string | null;
      }>(
        `SELECT c.catalog_id, c.catalog_code,
                (SELECT max(v.version_no)::text FROM sf_localization.catalog_version v
                  WHERE v.tenant_id = c.tenant_id AND v.catalog_id = c.catalog_id AND v.status = 'PUBLISHED')
                  AS latest_published
           FROM sf_localization.catalog c
          ORDER BY c.catalog_code`,
      );
      return result.rows;
    });
    sendPrivate(reply);
    return {
      items: rows.map((r) => ({
        catalog_id: r.catalog_id,
        catalog_code: r.catalog_code,
        latest_published_version: r.latest_published ? Number(r.latest_published) : null,
      })),
    };
  });

  app.post<{ Body: { catalog_code: string } }>(
    '/catalogs',
    { schema: { body: CREATE_CATALOG_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      await decide(deps, ctx, {
        subject: subjectOf(ctx),
        resource: {
          resource_type: 'LocalizationCatalog',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'CATALOG_WRITE',
      });
      const result = await runCommand(deps, request, ctx, 'POST /v1/catalogs', async (tx) => {
        const catalogId = randomUUID();
        await tx.query(
          `INSERT INTO sf_localization.catalog (tenant_id, catalog_id, catalog_code, created_by)
           VALUES ($1,$2,$3,$4)`,
          [ctx.tenant_id, catalogId, request.body.catalog_code, ctx.actor.id],
        );
        await tx.query(
          `INSERT INTO sf_localization.catalog_version (
             tenant_id, catalog_id, version_no, status, created_by
           ) VALUES ($1,$2,1,'DRAFT',$3)`,
          [ctx.tenant_id, catalogId, ctx.actor.id],
        );
        await withWriteAudit(deps, ctx, tx, {
          action: 'CATALOG_WRITE',
          actionClass: 'WRITE',
          resourceType: 'LocalizationCatalog',
          resourceId: catalogId,
          result: 'SUCCESS',
          now: deps.clock(),
        });
        return {
          status: 201,
          body: { catalog_id: catalogId, catalog_code: request.body.catalog_code, version_no: 1 },
        };
      });
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/catalogs/:id/versions',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const ctx = request.sfContext;
      await decide(deps, ctx, {
        subject: subjectOf(ctx),
        resource: {
          resource_type: 'LocalizationCatalog',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'CATALOG_WRITE',
      });
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/catalogs/${request.params.id}/versions`,
        async (tx) => {
          await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [
            `${ctx.tenant_id}:${request.params.id}`,
          ]);
          const head = await tx.query<{ version_no: string }>(
            `SELECT version_no::text FROM sf_localization.catalog_version
              WHERE catalog_id = $1 ORDER BY version_no DESC LIMIT 1`,
            [request.params.id],
          );
          if (!head.rows[0]) throw new Cmp053Error('SF-SYS-002');
          const versionNo = Number(head.rows[0].version_no) + 1;
          await tx.query(
            `INSERT INTO sf_localization.catalog_version (
               tenant_id, catalog_id, version_no, status, created_by
             ) VALUES ($1,$2,$3,'DRAFT',$4)`,
            [ctx.tenant_id, request.params.id, versionNo, ctx.actor.id],
          );
          await withWriteAudit(deps, ctx, tx, {
            action: 'CATALOG_VERSION_CREATE',
            actionClass: 'WRITE',
            resourceType: 'LocalizationCatalog',
            resourceId: request.params.id,
            result: 'SUCCESS',
            now: deps.clock(),
          });
          return { status: 201, body: { catalog_id: request.params.id, version_no: versionNo } };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.put<{
    Params: { id: string; version_no: string };
    Body: { locale_tag: string; messages: { key: string; text: string }[] };
  }>(
    '/catalogs/:id/versions/:version_no/messages',
    { schema: { params: VERSION_PARAMS, body: UPSERT_MESSAGES_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      await decide(deps, ctx, {
        subject: subjectOf(ctx),
        resource: {
          resource_type: 'LocalizationCatalog',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'CATALOG_WRITE',
      });
      if (!isLocaleTag(request.body.locale_tag)) {
        throw new Cmp053Error('SF-SYS-003', { details: [{ code: 'LOCALE_TAG' }] });
      }
      for (const msg of request.body.messages) {
        if (!isMessageKey(msg.key)) {
          throw new Cmp053Error('SF-SYS-003', { details: [{ code: 'MESSAGE_KEY' }] });
        }
      }
      const versionNo = Number(request.params.version_no);
      const result = await runCommand(
        deps,
        request,
        ctx,
        `PUT /v1/catalogs/${request.params.id}/versions/${versionNo}/messages`,
        async (tx) => {
          const version = await tx.query<{ status: string }>(
            `SELECT status FROM sf_localization.catalog_version
              WHERE catalog_id = $1 AND version_no = $2`,
            [request.params.id, versionNo],
          );
          const status = version.rows[0]?.status;
          if (!status) throw new Cmp053Error('SF-SYS-002');
          if (status !== 'DRAFT') {
            throw new Cmp053Error('SF-SYS-003', { details: [{ code: 'PUBLISHED_IMMUTABLE' }] });
          }
          const locale = await tx.query<{ locale_id: string }>(
            `SELECT locale_id FROM sf_localization.locale WHERE locale_tag = $1 AND status = 'ACTIVE'`,
            [request.body.locale_tag],
          );
          const localeId = locale.rows[0]?.locale_id;
          if (!localeId) throw new Cmp053Error('SF-SYS-002', { details: [{ code: 'LOCALE' }] });
          for (const msg of request.body.messages) {
            await tx.query(
              `INSERT INTO sf_localization.message (
                 tenant_id, catalog_id, version_no, locale_id, message_key, message_text, created_by
               ) VALUES ($1,$2,$3,$4,$5,$6,$7)
               ON CONFLICT (tenant_id, catalog_id, version_no, locale_id, message_key)
               DO UPDATE SET message_text = EXCLUDED.message_text, updated_at = now()`,
              [
                ctx.tenant_id,
                request.params.id,
                versionNo,
                localeId,
                msg.key,
                msg.text,
                ctx.actor.id,
              ],
            );
          }
          await withWriteAudit(deps, ctx, tx, {
            action: 'CATALOG_MESSAGE_WRITE',
            actionClass: 'WRITE',
            resourceType: 'LocalizationCatalog',
            resourceId: request.params.id,
            result: 'SUCCESS',
            now: deps.clock(),
          });
          return {
            status: 200,
            body: {
              catalog_id: request.params.id,
              version_no: versionNo,
              upserted: request.body.messages.length,
            },
          };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Params: { id: string; version_no: string }; Body: { reason?: string } }>(
    '/catalogs/:id/versions/:version_no/publish',
    { schema: { params: VERSION_PARAMS, body: PUBLISH_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      await decide(deps, ctx, {
        subject: subjectOf(ctx),
        resource: {
          resource_type: 'LocalizationCatalog',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'CATALOG_PUBLISH',
      });
      const versionNo = Number(request.params.version_no);
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/catalogs/${request.params.id}/versions/${versionNo}/publish`,
        async (tx) => {
          await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [
            `${ctx.tenant_id}:${request.params.id}`,
          ]);
          const version = await tx.query<{ status: string }>(
            `SELECT status FROM sf_localization.catalog_version
              WHERE catalog_id = $1 AND version_no = $2`,
            [request.params.id, versionNo],
          );
          if (!version.rows[0]) throw new Cmp053Error('SF-SYS-002');
          if (version.rows[0].status !== 'DRAFT') {
            throw new Cmp053Error('SF-SYS-003', { details: [{ code: 'PUBLISHED_IMMUTABLE' }] });
          }
          const messages = await tx.query<{
            locale_id: string;
            message_key: string;
            message_text: string;
          }>(
            `SELECT locale_id, message_key, message_text
               FROM sf_localization.message
              WHERE catalog_id = $1 AND version_no = $2
              ORDER BY locale_id, message_key`,
            [request.params.id, versionNo],
          );
          if (messages.rowCount === 0) {
            throw new Cmp053Error('SF-SYS-003', { details: [{ code: 'EMPTY_CATALOG' }] });
          }
          const hash = contentHash(
            messages.rows.map((r) => ({
              locale_id: r.locale_id,
              key: r.message_key,
              text: r.message_text,
            })),
          );
          const now = deps.clock();
          await tx.query(
            `UPDATE sf_localization.catalog_version
                SET status = 'PUBLISHED', content_hash = $1, published_at = $2
              WHERE catalog_id = $3 AND version_no = $4`,
            [hash, now.toISOString(), request.params.id, versionNo],
          );
          const env = envelopeOf({
            eventType: 'LocalizationCatalogPublished',
            tenantId: ctx.tenant_id,
            cellId: ctx.cell_id,
            aggregateType: 'LocalizationCatalog',
            aggregateId: request.params.id,
            aggregateVersion: versionNo,
            occurredAt: now.toISOString(),
            correlationId: ctx.correlation_id,
            actor: ctx.actor,
            data: {
              catalog_id: request.params.id,
              version_no: versionNo,
              status: 'PUBLISHED',
              content_hash: hash,
            },
          });
          await insertOutbox(tx, env, TOPIC_DOMAIN);
          await withWriteAudit(deps, ctx, tx, {
            action: 'CATALOG_PUBLISH',
            actionClass: 'WRITE',
            resourceType: 'LocalizationCatalog',
            resourceId: request.params.id,
            result: 'SUCCESS',
            reason: request.body.reason,
            now,
          });
          return {
            status: 200,
            body: {
              catalog_id: request.params.id,
              version_no: versionNo,
              status: 'PUBLISHED',
              content_hash: hash,
            },
          };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Params: { id: string; version_no: string }; Body: { reason?: string } }>(
    '/catalogs/:id/versions/:version_no/retire',
    { schema: { params: VERSION_PARAMS, body: PUBLISH_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      await decide(deps, ctx, {
        subject: subjectOf(ctx),
        resource: {
          resource_type: 'LocalizationCatalog',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'CATALOG_PUBLISH',
      });
      const versionNo = Number(request.params.version_no);
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/catalogs/${request.params.id}/versions/${versionNo}/retire`,
        async (tx) => {
          const version = await tx.query<{ status: string; content_hash: string | null }>(
            `SELECT status, content_hash FROM sf_localization.catalog_version
              WHERE catalog_id = $1 AND version_no = $2`,
            [request.params.id, versionNo],
          );
          if (!version.rows[0]) throw new Cmp053Error('SF-SYS-002');
          if (version.rows[0].status !== 'PUBLISHED') {
            throw new Cmp053Error('SF-SYS-003', { details: [{ code: 'NOT_PUBLISHED' }] });
          }
          const now = deps.clock();
          await tx.query(
            `UPDATE sf_localization.catalog_version
                SET status = 'RETIRED'
              WHERE catalog_id = $1 AND version_no = $2`,
            [request.params.id, versionNo],
          );
          const env = envelopeOf({
            eventType: 'LocalizationCatalogRetired',
            tenantId: ctx.tenant_id,
            cellId: ctx.cell_id,
            aggregateType: 'LocalizationCatalog',
            aggregateId: request.params.id,
            aggregateVersion: versionNo,
            occurredAt: now.toISOString(),
            correlationId: ctx.correlation_id,
            actor: ctx.actor,
            data: {
              catalog_id: request.params.id,
              version_no: versionNo,
              status: 'RETIRED',
            },
          });
          await insertOutbox(tx, env, TOPIC_DOMAIN);
          await withWriteAudit(deps, ctx, tx, {
            action: 'CATALOG_RETIRE',
            actionClass: 'WRITE',
            resourceType: 'LocalizationCatalog',
            resourceId: request.params.id,
            result: 'SUCCESS',
            reason: request.body.reason,
            now,
          });
          return {
            status: 200,
            body: {
              catalog_id: request.params.id,
              version_no: versionNo,
              status: 'RETIRED',
            },
          };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );
}
