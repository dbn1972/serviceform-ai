import type { FastifyInstance } from 'fastify';
import { withContextTx, currentClient } from '../db/tx.js';
import { Cmp058Error } from '../errors.js';
import { CREATE_BINDING_BODY, VALIDATE_MAPPING_BODY, UUID_PARAM } from '../schemas/http.js';
import {
  decide,
  emitDomain,
  runCommand,
  sendPrivate,
  subject,
  withWriteAudit,
  type RouteDeps,
} from './helpers.js';

interface BindingRow {
  tenant_id: string;
  binding_id: string;
  offering_id: string;
  field_path: string;
  element_id: string;
  element_version: number;
  created_at: string;
}

export function registerBindingRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/bindings', async (request, reply) => {
    const ctx = request.sfContext;
    if (!ctx.tenant_id) throw new Cmp058Error('SF-TEN-001', { statusCode: 401 });
    await decide(deps, ctx, {
      subject: subject(ctx),
      resource: {
        resource_type: 'SemanticFieldBinding',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'SEMANTIC_BINDING_READ',
    });
    const rows = await withContextTx(deps.pool, ctx, async () => {
      const client = currentClient();
      const result = await client.query<BindingRow>(
        `SELECT binding_id, offering_id, field_path, element_id, element_version, created_at
           FROM sf_semantics.field_binding
          WHERE tenant_id = $1
          ORDER BY offering_id, field_path`,
        [ctx.tenant_id],
      );
      return result.rows;
    });
    sendPrivate(reply);
    return { items: rows };
  });

  app.get<{ Params: { id: string } }>(
    '/bindings/:id',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const ctx = request.sfContext;
      if (!ctx.tenant_id) throw new Cmp058Error('SF-TEN-001', { statusCode: 401 });
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: {
          resource_type: 'SemanticFieldBinding',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'SEMANTIC_BINDING_READ',
      });
      const row = await withContextTx(deps.pool, ctx, async () => {
        const client = currentClient();
        const result = await client.query<BindingRow>(
          `SELECT binding_id, offering_id, field_path, element_id, element_version, created_at
             FROM sf_semantics.field_binding
            WHERE tenant_id = $1 AND binding_id = $2`,
          [ctx.tenant_id, request.params.id],
        );
        return result.rows[0] ?? null;
      });
      if (!row) throw new Cmp058Error('SF-SYS-002');
      sendPrivate(reply);
      return row;
    },
  );

  app.post<{ Body: typeof CREATE_BINDING_BODY }>(
    '/bindings',
    { schema: { body: CREATE_BINDING_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      if (!ctx.tenant_id) throw new Cmp058Error('SF-TEN-001', { statusCode: 401 });
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: {
          resource_type: 'SemanticFieldBinding',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'SEMANTIC_BINDING_CREATE',
      });
      const body = request.body as unknown as {
        binding_id: string;
        offering_id: string;
        field_path: string;
        element_id: string;
        element_version: number;
        idempotency_key: string;
      };
      const result = await runCommand(deps, request, ctx, 'POST /v1/bindings', async (tx) => {
        const now = deps.clock();
        const nowIso = now.toISOString();
        const elCheck = await tx.query<{ lifecycle_status: string }>(
          `SELECT lifecycle_status FROM sf_semantics.semantic_element
            WHERE element_id = $1 AND version = $2`,
          [body.element_id, body.element_version],
        );
        const el = elCheck.rows[0];
        if (!el) throw new Cmp058Error('SF-SYS-002', { details: [{ code: 'ELEMENT_NOT_FOUND' }] });
        if (el.lifecycle_status !== 'PUBLISHED') {
          throw new Cmp058Error('SF-APP-002', { details: [{ code: 'ELEMENT_NOT_PUBLISHED' }] });
        }
        await tx.query(
          `INSERT INTO sf_semantics.field_binding
             (tenant_id, binding_id, offering_id, field_path, element_id, element_version,
              idempotency_key, correlation_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            ctx.tenant_id,
            body.binding_id,
            body.offering_id,
            body.field_path,
            body.element_id,
            body.element_version,
            body.idempotency_key,
            ctx.correlation_id,
            nowIso,
          ],
        );
        await withWriteAudit(deps, ctx, tx, {
          action: 'SEMANTIC_BINDING_CREATE',
          actionClass: 'WRITE',
          resourceType: 'SemanticFieldBinding',
          resourceId: body.binding_id,
          result: 'SUCCESS',
          now,
        });
        await emitDomain(tx, ctx, {
          eventType: 'SemanticFieldBindingCreated',
          aggregateType: 'SemanticFieldBinding',
          aggregateId: body.binding_id,
          aggregateVersion: 1,
          occurredAt: nowIso,
          data: {
            binding_id: body.binding_id,
            tenant_id: ctx.tenant_id,
            offering_id: body.offering_id,
            field_path: body.field_path,
            element_id: body.element_id,
            element_version: body.element_version,
          },
        });
        const created: BindingRow = {
          tenant_id: ctx.tenant_id!,
          binding_id: body.binding_id,
          offering_id: body.offering_id,
          field_path: body.field_path,
          element_id: body.element_id,
          element_version: body.element_version,
          created_at: nowIso,
        };
        return { status: 201, body: created };
      });
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/bindings/:id',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const ctx = request.sfContext;
      if (!ctx.tenant_id) throw new Cmp058Error('SF-TEN-001', { statusCode: 401 });
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: {
          resource_type: 'SemanticFieldBinding',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'SEMANTIC_BINDING_DELETE',
      });
      await withContextTx(deps.pool, ctx, async (tx) => {
        const now = deps.clock();
        const result = await tx.query(
          `DELETE FROM sf_semantics.field_binding
            WHERE tenant_id = $1 AND binding_id = $2`,
          [ctx.tenant_id, request.params.id],
        );
        if ((result.rowCount ?? 0) === 0) throw new Cmp058Error('SF-SYS-002');
        await withWriteAudit(deps, ctx, tx, {
          action: 'SEMANTIC_BINDING_DELETE',
          actionClass: 'WRITE',
          resourceType: 'SemanticFieldBinding',
          resourceId: request.params.id,
          result: 'SUCCESS',
          now,
        });
      });
      return reply.code(204).send();
    },
  );

  app.post<{
    Body: { element_id: string; element_version: number; field_path?: string };
  }>(
    '/mappings/validate',
    { schema: { body: VALIDATE_MAPPING_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: { resource_type: 'SemanticElement', tenant_id: null, classification: 'GLOBAL' },
        action: 'SEMANTIC_MAPPING_VALIDATE',
      });
      const body = request.body;
      const row = await withContextTx(deps.pool, ctx, async () => {
        const client = currentClient();
        const result = await client.query<{
          element_id: string;
          version: number;
          lifecycle_status: string;
          element_code: string;
        }>(
          `SELECT element_id, version, lifecycle_status, element_code
             FROM sf_semantics.semantic_element
            WHERE element_id = $1 AND version = $2`,
          [body.element_id, body.element_version],
        );
        return result.rows[0] ?? null;
      });
      sendPrivate(reply);
      if (!row) {
        return {
          valid: false,
          reason_code: 'ELEMENT_NOT_FOUND',
          element_id: body.element_id,
          element_version: body.element_version,
        };
      }
      if (row.lifecycle_status !== 'PUBLISHED') {
        return {
          valid: false,
          reason_code: 'ELEMENT_NOT_PUBLISHED',
          element_id: row.element_id,
          element_version: row.version,
          lifecycle_status: row.lifecycle_status,
        };
      }
      // Opaque refs only — no field meaning / statutory interpretation.
      return {
        valid: true,
        invented_statutory_policy_forbidden: true,
        element_id: row.element_id,
        element_version: row.version,
        element_code: row.element_code,
        lifecycle_status: row.lifecycle_status,
        field_path: body.field_path ?? null,
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/usage/:id',
    { schema: { params: UUID_PARAM } },
    async (request, reply) => {
      const ctx = request.sfContext;
      if (!ctx.tenant_id) throw new Cmp058Error('SF-TEN-001', { statusCode: 401 });
      await decide(deps, ctx, {
        subject: subject(ctx),
        resource: {
          resource_type: 'SemanticFieldBinding',
          tenant_id: ctx.tenant_id,
          classification: 'TENANT_SCOPED',
        },
        action: 'SEMANTIC_USAGE_READ',
      });
      const usage = await withContextTx(deps.pool, ctx, async () => {
        const client = currentClient();
        const result = await client.query<{
          binding_id: string;
          offering_id: string;
          field_path: string;
          element_version: number;
        }>(
          `SELECT binding_id, offering_id, field_path, element_version
             FROM sf_semantics.field_binding
            WHERE tenant_id = $1 AND element_id = $2
            ORDER BY offering_id, field_path`,
          [ctx.tenant_id, request.params.id],
        );
        return result.rows;
      });
      sendPrivate(reply);
      return {
        element_id: request.params.id,
        tenant_id: ctx.tenant_id,
        binding_count: usage.length,
        bindings: usage,
      };
    },
  );
}
