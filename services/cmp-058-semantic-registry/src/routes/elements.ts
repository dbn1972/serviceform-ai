import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withContextTx } from '../db/tx.js';
import { currentClient } from '../db/tx.js';
import { Cmp058Error } from '../errors.js';
import {
  CREATE_ELEMENT_BODY,
  PUBLISH_ELEMENT_BODY,
  UUID_PAIR_PARAM,
  UUID_PARAM,
} from '../schemas/http.js';
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

interface ElementRow {
  element_id: string;
  version: number;
  element_code: string;
  lifecycle_status: string;
  privacy_classification: string;
  code_list_binding_ref: string | null;
  created_at: string;
  published_at: string | null;
}

export function registerElementRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/elements', async (request, reply) => {
    const ctx = request.sfContext;
    await decide(deps, ctx, {
      subject: subject(ctx),
      resource: { resource_type: 'SemanticElement', tenant_id: null, classification: 'GLOBAL' },
      action: 'SEMANTIC_ELEMENT_READ',
    });
    const rows = await withContextTx(deps.pool, ctx, async () => {
      const client = currentClient();
      const result = await client.query<ElementRow>(
        `SELECT DISTINCT ON (element_id) element_id, version, element_code, lifecycle_status,
                privacy_classification, code_list_binding_ref, created_at, published_at
           FROM sf_semantics.semantic_element
          ORDER BY element_id, version DESC`,
      );
      return result.rows;
    });
    sendPrivate(reply);
    return { items: rows };
  });

  app.get<{ Params: { id: string } }>(
    '/elements/:id',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const ctx = request.sfContext;
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: { resource_type: 'SemanticElement', tenant_id: null, classification: 'GLOBAL' },
        action: 'SEMANTIC_ELEMENT_READ',
      });
      const row = await withContextTx(deps.pool, ctx, async () => {
        const client = currentClient();
        const result = await client.query<ElementRow>(
          `SELECT element_id, version, element_code, lifecycle_status,
                  privacy_classification, code_list_binding_ref, created_at, published_at
             FROM sf_semantics.semantic_element
            WHERE element_id = $1
            ORDER BY version DESC
            LIMIT 1`,
          [request.params.id],
        );
        return result.rows[0] ?? null;
      });
      if (!row) throw new Cmp058Error('SF-SYS-002');
      sendPrivate(reply);
      return row;
    },
  );

  app.get<{ Params: { id: string; version: number } }>(
    '/elements/:id/versions/:version',
    { schema: { params: UUID_PAIR_PARAM } },
    async (request, reply) => {
      const ctx = request.sfContext;
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: { resource_type: 'SemanticElement', tenant_id: null, classification: 'GLOBAL' },
        action: 'SEMANTIC_ELEMENT_READ',
      });
      const row = await withContextTx(deps.pool, ctx, async () => {
        const client = currentClient();
        const result = await client.query<ElementRow>(
          `SELECT element_id, version, element_code, lifecycle_status,
                  privacy_classification, code_list_binding_ref, created_at, published_at
             FROM sf_semantics.semantic_element
            WHERE element_id = $1 AND version = $2`,
          [request.params.id, request.params.version],
        );
        return result.rows[0] ?? null;
      });
      if (!row) throw new Cmp058Error('SF-SYS-002');
      sendPrivate(reply);
      return row;
    },
  );

  app.post<{ Body: typeof CREATE_ELEMENT_BODY }>(
    '/elements',
    { schema: { body: CREATE_ELEMENT_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      requirePrivileged(ctx);
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: { resource_type: 'SemanticElement', tenant_id: null, classification: 'GLOBAL' },
        action: 'SEMANTIC_ELEMENT_CREATE',
      });
      const body = request.body as unknown as {
        element_id: string;
        element_code: string;
        privacy_classification: string;
        code_list_binding_ref?: string | null;
        idempotency_key: string;
      };
      const result = await runCommand(deps, request, ctx, 'POST /v1/elements', async (tx) => {
        const now = deps.clock();
        const nowIso = now.toISOString();
        await tx.query(
          `INSERT INTO sf_semantics.semantic_element
             (element_id, version, element_code, lifecycle_status, privacy_classification,
              code_list_binding_ref, idempotency_key, correlation_id, created_at)
           VALUES ($1, 1, $2, 'DRAFT', $3, $4, $5, $6, $7)`,
          [
            body.element_id,
            body.element_code,
            body.privacy_classification,
            body.code_list_binding_ref ?? null,
            body.idempotency_key,
            ctx.correlation_id,
            nowIso,
          ],
        );
        await withWriteAudit(deps, ctx, tx, {
          action: 'SEMANTIC_ELEMENT_CREATE',
          actionClass: 'WRITE',
          resourceType: 'SemanticElement',
          resourceId: body.element_id,
          result: 'SUCCESS',
          now,
          classification: 'GLOBAL',
        });
        await emitDomain(tx, ctx, {
          eventType: 'SemanticElementDraftCreated',
          aggregateType: 'SemanticElement',
          aggregateId: body.element_id,
          aggregateVersion: 1,
          occurredAt: nowIso,
          tenantId: null,
          data: {
            element_id: body.element_id,
            version: 1,
            element_code: body.element_code,
            privacy_classification: body.privacy_classification,
          },
        });
        const created: ElementRow = {
          element_id: body.element_id,
          version: 1,
          element_code: body.element_code,
          lifecycle_status: 'DRAFT',
          privacy_classification: body.privacy_classification,
          code_list_binding_ref: body.code_list_binding_ref ?? null,
          created_at: nowIso,
          published_at: null,
        };
        return { status: 201, body: created };
      });
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Params: { id: string }; Body: typeof PUBLISH_ELEMENT_BODY }>(
    '/elements/:id/publish',
    { schema: { params: UUID_PARAM, body: PUBLISH_ELEMENT_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      requirePrivileged(ctx);
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: { resource_type: 'SemanticElement', tenant_id: null, classification: 'GLOBAL' },
        action: 'SEMANTIC_ELEMENT_PUBLISH',
      });
      const body = request.body as unknown as { idempotency_key: string };
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/elements/${request.params.id}/publish`,
        async (tx) => {
          const now = deps.clock();
          const nowIso = now.toISOString();
          const existing = await tx.query<ElementRow>(
            `SELECT element_id, version, lifecycle_status
               FROM sf_semantics.semantic_element
              WHERE element_id = $1
              ORDER BY version DESC
              LIMIT 1`,
            [request.params.id],
          );
          const row = existing.rows[0];
          if (!row) throw new Cmp058Error('SF-SYS-002');
          if (row.lifecycle_status !== 'DRAFT') {
            throw new Cmp058Error('SF-APP-002', {
              details: [{ code: 'LIFECYCLE_TRANSITION_INVALID' }],
            });
          }
          await tx.query(
            `UPDATE sf_semantics.semantic_element
                SET lifecycle_status = 'PUBLISHED', published_at = $1
              WHERE element_id = $2 AND version = $3`,
            [nowIso, request.params.id, row.version],
          );
          await withWriteAudit(deps, ctx, tx, {
            action: 'SEMANTIC_ELEMENT_PUBLISH',
            actionClass: 'WRITE',
            resourceType: 'SemanticElement',
            resourceId: request.params.id,
            result: 'SUCCESS',
            now,
            classification: 'GLOBAL',
          });
          await emitDomain(tx, ctx, {
            eventType: 'SemanticElementPublished',
            aggregateType: 'SemanticElement',
            aggregateId: request.params.id,
            aggregateVersion: row.version,
            occurredAt: nowIso,
            tenantId: null,
            data: {
              element_id: request.params.id,
              version: row.version,
            },
          });
          return {
            status: 200,
            body: { element_id: request.params.id, version: row.version, lifecycle_status: 'PUBLISHED', published_at: nowIso },
          };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Params: { id: string }; Body: typeof PUBLISH_ELEMENT_BODY }>(
    '/elements/:id/deprecate',
    { schema: { params: UUID_PARAM, body: PUBLISH_ELEMENT_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      requirePrivileged(ctx);
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: { resource_type: 'SemanticElement', tenant_id: null, classification: 'GLOBAL' },
        action: 'SEMANTIC_ELEMENT_DEPRECATE',
      });
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/elements/${request.params.id}/deprecate`,
        async (tx) => {
          const now = deps.clock();
          const nowIso = now.toISOString();
          const existing = await tx.query<ElementRow>(
            `SELECT element_id, version, lifecycle_status
               FROM sf_semantics.semantic_element
              WHERE element_id = $1
              ORDER BY version DESC
              LIMIT 1`,
            [request.params.id],
          );
          const row = existing.rows[0];
          if (!row) throw new Cmp058Error('SF-SYS-002');
          if (row.lifecycle_status !== 'PUBLISHED') {
            throw new Cmp058Error('SF-APP-002', {
              details: [{ code: 'LIFECYCLE_TRANSITION_INVALID' }],
            });
          }
          await tx.query(
            `UPDATE sf_semantics.semantic_element
                SET lifecycle_status = 'DEPRECATED', deprecated_at = $1
              WHERE element_id = $2 AND version = $3`,
            [nowIso, request.params.id, row.version],
          );
          await withWriteAudit(deps, ctx, tx, {
            action: 'SEMANTIC_ELEMENT_DEPRECATE',
            actionClass: 'WRITE',
            resourceType: 'SemanticElement',
            resourceId: request.params.id,
            result: 'SUCCESS',
            now,
            classification: 'GLOBAL',
          });
          await emitDomain(tx, ctx, {
            eventType: 'SemanticElementDeprecated',
            aggregateType: 'SemanticElement',
            aggregateId: request.params.id,
            aggregateVersion: row.version,
            occurredAt: nowIso,
            tenantId: null,
            data: { element_id: request.params.id, version: row.version },
          });
          return {
            status: 200,
            body: { element_id: request.params.id, version: row.version, lifecycle_status: 'DEPRECATED', deprecated_at: nowIso },
          };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );
}
