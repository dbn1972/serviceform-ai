import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { validate, type ConnectorBinding } from '@serviceform/contracts';
import { IMPORT_BODY, VERSION_PARAMS } from '../schemas/http.js';
import { envelopeOf, insertOutbox, TOPIC_DOMAIN } from '../db/outbox.js';
import { assertConnectorImportSafe } from '../domain/import-binding.js';
import { Cmp034Error } from '../errors.js';
import type { CodeValueInput } from '../ports/code-list-import.js';
import {
  insertValues,
  lockTenantScope,
  newId,
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

export function registerImportRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post<{
    Params: { id: string; version: string };
    Body: {
      items?: CodeValueInput[];
      connector_binding?: ConnectorBinding;
      scenario?: string;
      test_run_id?: string;
    };
  }>(
    '/code-sets/:id/versions/:version/import',
    { schema: { params: VERSION_PARAMS, body: IMPORT_BODY } },
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
        action: 'CODE_SET_IMPORT',
      });

      let items = request.body.items ?? [];
      let sourceMode: 'INLINE' | 'CONNECTOR' = 'INLINE';
      let connectorId: string | null = null;
      let simulation: unknown = null;

      if (request.body.connector_binding) {
        const binding = assertConnectorImportSafe(request.body.connector_binding, deps.environment);
        const fetched = await deps.importPort.fetch(
          binding,
          request.body.scenario ?? 'code_list_success',
          request.body.test_run_id ?? `md-${randomUUID()}`,
        );
        const marker = validate('simulation-marker', fetched.simulation);
        if (!marker.valid) {
          throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'SIMULATION_MARKER' }] });
        }
        items = fetched.items;
        sourceMode = 'CONNECTOR';
        connectorId = binding.connector_binding_id;
        simulation = fetched.simulation;
      }

      if (items.length === 0) {
        throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'IMPORT_EMPTY' }] });
      }

      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/code-sets/${request.params.id}/versions/${versionNo}/import`,
        async (tx) => {
          const tenantId = ctx.tenant_id as string;
          await lockTenantScope(tx, tenantId);
          await requireDraftVersion(tx, request.params.id, versionNo);
          const count = await insertValues(tx, {
            tenantId,
            codeSetId: request.params.id,
            versionNo,
            actorId: ctx.actor.id,
            items,
          });
          const importId = newId();
          await tx.query(
            `INSERT INTO sf_master_data.import_job (
               tenant_id, import_id, code_set_id, version_no, source_mode, connector_binding_id,
               simulation, item_count, status, created_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'SUCCEEDED',$9)`,
            [
              tenantId,
              importId,
              request.params.id,
              versionNo,
              sourceMode,
              connectorId,
              simulation ? JSON.stringify(simulation) : null,
              count,
              ctx.actor.id,
            ],
          );
          const env = envelopeOf({
            eventType: 'CodeSetImported',
            tenantId,
            cellId: ctx.cell_id,
            aggregateType: 'CodeSet',
            aggregateId: request.params.id,
            aggregateVersion: versionNo,
            occurredAt: deps.clock().toISOString(),
            correlationId: ctx.correlation_id,
            actor: ctx.actor,
            data: {
              code_set_id: request.params.id,
              version_no: versionNo,
              import_id: importId,
              source_mode: sourceMode,
              item_count: count,
            },
          });
          await insertOutbox(tx, env, TOPIC_DOMAIN);
          await withWriteAudit(deps, ctx, tx, {
            action: 'CODE_SET_IMPORT',
            actionClass: 'WRITE',
            resourceType: 'CodeSet',
            resourceId: request.params.id,
            result: 'SUCCESS',
            now: deps.clock(),
          });
          return {
            status: 201,
            body: {
              import_id: importId,
              source_mode: sourceMode,
              item_count: count,
              simulation,
            },
          };
        },
      );
      sendPrivate(reply);
      return reply.code(result.status).send(result.body);
    },
  );
}
