import type { FastifyInstance } from 'fastify';
import type { RequestContext } from '@serviceform/contracts';
import {
  APPROVE_BODY,
  CREATE_TENANT_BODY,
  PLACEMENT_BODY,
  PROPOSAL_PARAMS,
  UUID_PARAM,
} from '../schemas/http.js';
import { envelopeOf, insertOutbox, TOPIC_DOMAIN } from '../db/outbox.js';
import { Cmp002Error } from '../errors.js';
import { currentBinding, newId } from '../repositories/org.repo.js';
import {
  decide,
  requirePrivileged,
  runCommand,
  withWriteAudit,
  writeDenied,
  type RouteDeps,
} from './helpers.js';

function withTenant(ctx: RequestContext, tenantId: string): RequestContext {
  return { ...ctx, tenant_id: tenantId };
}

export function registerAdminRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post<{
    Body: {
      code: string;
      display_name: string;
      cell_id: string;
      isolation_model: 'POOL' | 'BRIDGE' | 'SILO';
      reason: string;
    };
  }>('/admin/tenants', { schema: { body: CREATE_TENANT_BODY } }, async (request, reply) => {
    const ctx = request.sfContext;
    try {
      requirePrivileged(ctx);
    } catch (err) {
      await writeDenied(deps, ctx, request, 'TENANT_CREATE', 'tenant', ctx.tenant_id);
      throw err;
    }
    const tenantId = newId();
    try {
      await decide(deps, ctx, {
        subject: {
          user_id: ctx.actor.id,
          actor_type: ctx.actor.type,
          tenant_id: ctx.tenant_id,
          roles: ctx.roles,
          jurisdiction_ids: ctx.jurisdiction_ids,
          assurance: ctx.auth_assurance,
        },
        resource: { resource_type: 'Tenant', tenant_id: tenantId, classification: 'TENANT_SCOPED' },
        action: 'TENANT_CREATE',
      });
    } catch (err) {
      await writeDenied(deps, ctx, request, 'TENANT_CREATE', tenantId, tenantId);
      throw err;
    }
    const target = withTenant(ctx, tenantId);
    const result = await runCommand(
      deps,
      request,
      target,
      'POST /v1/admin/tenants',
      undefined,
      async (tx) => {
        const now = deps.clock();
        await tx.query(
          `INSERT INTO sf_tenant_org.tenant (
           tenant_id, code, display_name, status, version, created_at, created_by, updated_at
         ) VALUES ($1,$2,$3,'ACTIVE',1,$4,$5,$4)`,
          [tenantId, request.body.code, request.body.display_name, now.toISOString(), ctx.actor.id],
        );
        const bindingId = newId();
        await tx.query(
          `INSERT INTO sf_tenant_org.tenant_cell_binding (
           binding_id, tenant_id, cell_id, isolation_model, valid_from, seq, reason, requested_by, created_at
         ) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$5)`,
          [
            bindingId,
            tenantId,
            request.body.cell_id,
            request.body.isolation_model,
            now.toISOString(),
            request.body.reason,
            ctx.actor.id,
          ],
        );
        const env = envelopeOf({
          eventType: 'TenantCreated',
          tenantId,
          cellId: request.body.cell_id,
          aggregateType: 'Tenant',
          aggregateId: tenantId,
          aggregateVersion: 1,
          occurredAt: now.toISOString(),
          correlationId: ctx.correlation_id,
          actor: ctx.actor,
          data: {
            tenant_id: tenantId,
            code: request.body.code,
            cell_id: request.body.cell_id,
            isolation_model: request.body.isolation_model,
            valid_from: now.toISOString(),
          },
        });
        await insertOutbox(tx, env, TOPIC_DOMAIN);
        await withWriteAudit(deps, target, tx, {
          action: 'TENANT_CREATE',
          actionClass: 'PRIVILEGED',
          resourceType: 'Tenant',
          resourceId: tenantId,
          result: 'SUCCESS',
          reason: request.body.reason,
          tenantId,
          now,
        });
        return {
          status: 201,
          body: { tenant_id: tenantId, binding_id: bindingId, status: 'ACTIVE' },
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });

  app.post<{
    Params: { id: string };
    Body: {
      cell_id: string;
      isolation_model: 'POOL' | 'BRIDGE' | 'SILO';
      reason: string;
      valid_from?: string;
    };
  }>(
    '/admin/tenants/:id/placement-proposals',
    { schema: { params: UUID_PARAM, body: PLACEMENT_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      const targetId = request.params.id;
      try {
        requirePrivileged(ctx);
      } catch (err) {
        await writeDenied(deps, ctx, request, 'PLACEMENT_PROPOSE', targetId, targetId);
        throw err;
      }
      try {
        await decide(deps, ctx, {
          subject: {
            user_id: ctx.actor.id,
            actor_type: ctx.actor.type,
            tenant_id: ctx.tenant_id,
            roles: ctx.roles,
            jurisdiction_ids: ctx.jurisdiction_ids,
            assurance: ctx.auth_assurance,
          },
          resource: {
            resource_type: 'Tenant',
            tenant_id: targetId,
            classification: 'TENANT_SCOPED',
          },
          action: 'PLACEMENT_PROPOSE',
        });
      } catch (err) {
        await writeDenied(deps, ctx, request, 'PLACEMENT_PROPOSE', targetId, targetId);
        throw err;
      }
      const target = withTenant(ctx, targetId);
      const result = await runCommand(
        deps,
        request,
        target,
        `POST /v1/admin/tenants/${targetId}/placement-proposals`,
        undefined,
        async (tx) => {
          const now = deps.clock();
          const proposalId = newId();
          await tx.query(
            `INSERT INTO sf_tenant_org.tenant_placement_proposal (
               proposal_id, tenant_id, proposed_cell_id, proposed_isolation_model, status, reason, requested_by, valid_from, created_at
             ) VALUES ($1,$2,$3,$4,'PROPOSED',$5,$6,$7,$8)`,
            [
              proposalId,
              targetId,
              request.body.cell_id,
              request.body.isolation_model,
              request.body.reason,
              ctx.actor.id,
              request.body.valid_from ?? now.toISOString(),
              now.toISOString(),
            ],
          );
          await withWriteAudit(deps, target, tx, {
            action: 'PLACEMENT_PROPOSE',
            actionClass: 'PRIVILEGED',
            resourceType: 'Tenant',
            resourceId: proposalId,
            result: 'SUCCESS',
            reason: request.body.reason,
            tenantId: targetId,
            now,
          });
          return { status: 201, body: { proposal_id: proposalId, status: 'PROPOSED' } };
        },
      );
      return reply.code(result.status).send(result.body);
    },
  );

  app.post<{ Params: { id: string; proposalId: string }; Body: { reason: string } }>(
    '/admin/tenants/:id/placement-proposals/:proposalId/approve',
    { schema: { params: PROPOSAL_PARAMS, body: APPROVE_BODY } },
    async (request, reply) => {
      const ctx = request.sfContext;
      const targetId = request.params.id;
      try {
        requirePrivileged(ctx);
      } catch (err) {
        await writeDenied(deps, ctx, request, 'PLACEMENT_APPROVE', targetId, targetId);
        throw err;
      }
      try {
        await decide(deps, ctx, {
          subject: {
            user_id: ctx.actor.id,
            actor_type: ctx.actor.type,
            tenant_id: ctx.tenant_id,
            roles: ctx.roles,
            jurisdiction_ids: ctx.jurisdiction_ids,
            assurance: ctx.auth_assurance,
          },
          resource: {
            resource_type: 'Tenant',
            tenant_id: targetId,
            classification: 'TENANT_SCOPED',
          },
          action: 'PLACEMENT_APPROVE',
        });
      } catch (err) {
        await writeDenied(deps, ctx, request, 'PLACEMENT_APPROVE', targetId, targetId);
        throw err;
      }
      const target = withTenant(ctx, targetId);
      const result = await runCommand(
        deps,
        request,
        target,
        `POST /v1/admin/tenants/${targetId}/placement-proposals/${request.params.proposalId}/approve`,
        undefined,
        async (tx) => {
          const now = deps.clock();
          const current = await currentBinding(tx, targetId, now);
          const updated = await tx.query<{
            proposal_id: string;
            proposed_cell_id: string;
            proposed_isolation_model: 'POOL' | 'BRIDGE' | 'SILO';
            requested_by: string;
            valid_from: Date;
          }>(
            `UPDATE sf_tenant_org.tenant_placement_proposal
                SET status = 'APPROVED', approved_by = $1, approved_at = $2
              WHERE proposal_id = $3 AND tenant_id = $4 AND status = 'PROPOSED'
              RETURNING proposal_id, proposed_cell_id, proposed_isolation_model, requested_by, valid_from`,
            [ctx.actor.id, now.toISOString(), request.params.proposalId, targetId],
          );
          const proposal = updated.rows[0];
          if (!proposal) throw new Cmp002Error('SF-APP-002');
          const seq = current ? Number(current.seq) + 1 : 1;
          const bindingId = newId();
          await tx.query(
            `INSERT INTO sf_tenant_org.tenant_cell_binding (
               binding_id, tenant_id, cell_id, isolation_model, valid_from, seq, reason, requested_by, created_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$5)`,
            [
              bindingId,
              targetId,
              proposal.proposed_cell_id,
              proposal.proposed_isolation_model,
              proposal.valid_from.toISOString(),
              seq,
              request.body.reason,
              ctx.actor.id,
            ],
          );
          const env = envelopeOf({
            eventType: 'TenantPlacementChanged',
            tenantId: targetId,
            cellId: proposal.proposed_cell_id,
            aggregateType: 'Tenant',
            aggregateId: targetId,
            aggregateVersion: seq,
            occurredAt: now.toISOString(),
            correlationId: ctx.correlation_id,
            actor: ctx.actor,
            data: {
              binding_id: bindingId,
              from_model: current?.isolation_model ?? proposal.proposed_isolation_model,
              to_model: proposal.proposed_isolation_model,
              from_cell_id: current?.cell_id ?? proposal.proposed_cell_id,
              to_cell_id: proposal.proposed_cell_id,
              valid_from: proposal.valid_from.toISOString(),
              reason: request.body.reason,
            },
          });
          await insertOutbox(tx, env, TOPIC_DOMAIN);
          await withWriteAudit(deps, target, tx, {
            action: 'PLACEMENT_APPROVE',
            actionClass: 'PRIVILEGED',
            resourceType: 'Tenant',
            resourceId: bindingId,
            result: 'SUCCESS',
            reason: request.body.reason,
            tenantId: targetId,
            now,
          });
          return {
            status: 200,
            body: { binding_id: bindingId, proposal_id: proposal.proposal_id, seq },
          };
        },
      );
      return reply.code(result.status).send(result.body);
    },
  );
}
