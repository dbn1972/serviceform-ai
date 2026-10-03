import type { FastifyInstance } from 'fastify';
import { CREATE_ORG_BODY, ORG_QUERY, ORG_VERSION_BODY, UUID_PARAM } from '../schemas/http.js';
import { currentClient } from '../db/tx.js';
import { withContextTx } from '../db/tx.js';
import { envelopeOf, insertOutbox, TOPIC_DOMAIN } from '../db/outbox.js';
import { Cmp002Error } from '../errors.js';
import { assertNoCycle, lockTenant, newId } from '../repositories/org.repo.js';
import { decide, runCommand, sendPrivate, withWriteAudit, type RouteDeps } from './helpers.js';

function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      last?: unknown;
    };
    if (typeof parsed.last !== 'string' || !/^[0-9a-f-]{36}$/i.test(parsed.last)) {
      throw new Error('bad');
    }
    return parsed.last;
  } catch {
    throw new Cmp002Error('SF-SYS-003', { details: [{ code: 'CURSOR' }] });
  }
}

function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ last: id }), 'utf8').toString('base64url');
}

export function registerOrganisationRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get<{
    Querystring: { as_of?: string; parent_id?: string; cursor?: string; limit?: number };
  }>('/organisations', { schema: { querystring: ORG_QUERY } }, async (request, reply) => {
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
        resource_type: 'Organisation',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'ORGANISATION_READ',
    });
    const asOf = request.query.as_of ?? deps.clock().toISOString();
    const limit = request.query.limit ?? 50;
    const after = decodeCursor(request.query.cursor);
    const rows = await withContextTx(deps.pool, ctx, async () => {
      const client = currentClient();
      const result = await client.query<{
        organisation_id: string;
        code: string;
        name: string;
        organisation_type_code: string;
        status: string;
        version_no: string;
        valid_from: Date;
        parent_organisation_id: string | null;
      }>(
        `SELECT o.organisation_id, o.code, v.name, v.organisation_type_code, v.status, v.version_no, v.valid_from,
                r.parent_organisation_id
           FROM sf_tenant_org.organisation o
           JOIN LATERAL (
             SELECT name, organisation_type_code, status, version_no, valid_from
               FROM sf_tenant_org.organisation_version
              WHERE tenant_id = o.tenant_id AND organisation_id = o.organisation_id AND valid_from <= $1
              ORDER BY valid_from DESC, version_no DESC
              LIMIT 1
           ) v ON true
           LEFT JOIN LATERAL (
             SELECT parent_organisation_id
               FROM sf_tenant_org.organisation_relation
              WHERE tenant_id = o.tenant_id AND child_organisation_id = o.organisation_id AND valid_from <= $1
              ORDER BY valid_from DESC, version_no DESC
              LIMIT 1
           ) r ON true
          WHERE ($2::uuid IS NULL OR r.parent_organisation_id IS NOT DISTINCT FROM $2)
            AND ($3::uuid IS NULL OR o.organisation_id > $3)
          ORDER BY o.organisation_id
          LIMIT $4`,
        [asOf, request.query.parent_id ?? null, after ?? null, limit],
      );
      return result.rows;
    });
    sendPrivate(reply);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((r) => ({
        organisation_id: r.organisation_id,
        code: r.code,
        name: r.name,
        organisation_type_code: r.organisation_type_code,
        status: r.status,
        version_no: Number(r.version_no),
        valid_from: r.valid_from.toISOString(),
        parent_organisation_id: r.parent_organisation_id,
      })),
      cursor: last && rows.length === limit ? encodeCursor(last.organisation_id) : null,
    };
  });

  app.post<{
    Body: {
      code: string;
      name: string;
      organisation_type_code: string;
      parent_id?: string;
      reason?: string;
    };
  }>('/organisations', { schema: { body: CREATE_ORG_BODY } }, async (request, reply) => {
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
        resource_type: 'Organisation',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'ORGANISATION_CREATE',
    });
    const result = await runCommand(
      deps,
      request,
      ctx,
      'POST /v1/organisations',
      undefined,
      async (tx) => {
        const tenantId = ctx.tenant_id as string;
        await lockTenant(tx, tenantId);
        if (request.body.parent_id) {
          const parent = await tx.query(
            'SELECT organisation_id FROM sf_tenant_org.organisation WHERE organisation_id = $1',
            [request.body.parent_id],
          );
          if (parent.rowCount === 0) throw new Cmp002Error('SF-SYS-002');
        }
        const orgId = newId();
        const now = deps.clock();
        await assertNoCycle(tx, orgId, request.body.parent_id ?? null, now);
        await tx.query(
          'INSERT INTO sf_tenant_org.organisation (tenant_id, organisation_id, code, created_at, created_by) VALUES ($1,$2,$3,$4,$5)',
          [tenantId, orgId, request.body.code, now.toISOString(), ctx.actor.id],
        );
        await tx.query(
          `INSERT INTO sf_tenant_org.organisation_version (
           tenant_id, organisation_id, version_no, name, organisation_type_code, status, valid_from, reason, created_by, created_at
         ) VALUES ($1,$2,1,$3,$4,'ACTIVE',$5,$6,$7,$5)`,
          [
            tenantId,
            orgId,
            request.body.name,
            request.body.organisation_type_code,
            now.toISOString(),
            request.body.reason ?? 'CREATED',
            ctx.actor.id,
          ],
        );
        await tx.query(
          `INSERT INTO sf_tenant_org.organisation_relation (
           relation_id, tenant_id, child_organisation_id, parent_organisation_id, relation_type_code, version_no, valid_from, created_by, created_at
         ) VALUES ($1,$2,$3,$4,'PARENT',1,$5,$6,$5)`,
          [
            newId(),
            tenantId,
            orgId,
            request.body.parent_id ?? null,
            now.toISOString(),
            ctx.actor.id,
          ],
        );
        const env = envelopeOf({
          eventType: 'OrganisationChanged',
          tenantId,
          cellId: ctx.cell_id,
          aggregateType: 'Organisation',
          aggregateId: orgId,
          aggregateVersion: 1,
          occurredAt: now.toISOString(),
          correlationId: ctx.correlation_id,
          actor: ctx.actor,
          data: {
            organisation_id: orgId,
            change: 'CREATED',
            version_no: 1,
            valid_from: now.toISOString(),
            parent_organisation_id: request.body.parent_id ?? null,
            organisation_type_code: request.body.organisation_type_code,
          },
        });
        await insertOutbox(tx, env, TOPIC_DOMAIN);
        await withWriteAudit(deps, ctx, tx, {
          action: 'ORGANISATION_CREATE',
          actionClass: 'WRITE',
          resourceType: 'Organisation',
          resourceId: orgId,
          result: 'SUCCESS',
          now,
        });
        return {
          status: 201,
          body: { organisation_id: orgId, version_no: 1, valid_from: now.toISOString() },
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });

  app.post<{
    Params: { id: string };
    Body: {
      name?: string;
      organisation_type_code?: string;
      status?: 'ACTIVE' | 'DISSOLVED';
      parent_id?: string | null;
      reason?: string;
    };
  }>(
    '/organisations/:id/versions',
    { schema: { params: UUID_PARAM, body: ORG_VERSION_BODY } },
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
          resource_type: 'Organisation',
          tenant_id: ctx.tenant_id,
          organisation_id: request.params.id,
          classification: 'TENANT_SCOPED',
        },
        action: 'ORGANISATION_VERSION',
      });
      const result = await runCommand(
        deps,
        request,
        ctx,
        `POST /v1/organisations/${request.params.id}/versions`,
        undefined,
        async (tx) => {
          const tenantId = ctx.tenant_id as string;
          await lockTenant(tx, tenantId);
          const existing = await tx.query<{ organisation_id: string }>(
            'SELECT organisation_id FROM sf_tenant_org.organisation WHERE organisation_id = $1',
            [request.params.id],
          );
          if (existing.rowCount === 0) throw new Cmp002Error('SF-SYS-002');
          const now = deps.clock();
          if (request.body.parent_id !== undefined) {
            if (request.body.parent_id) {
              const parent = await tx.query(
                'SELECT organisation_id FROM sf_tenant_org.organisation WHERE organisation_id = $1',
                [request.body.parent_id],
              );
              if (parent.rowCount === 0) throw new Cmp002Error('SF-SYS-002');
            }
            await assertNoCycle(tx, request.params.id, request.body.parent_id, now);
            const lastRel = await tx.query<{ version_no: string }>(
              'SELECT version_no FROM sf_tenant_org.organisation_relation WHERE child_organisation_id = $1 ORDER BY version_no DESC LIMIT 1',
              [request.params.id],
            );
            const nextRel = Number(lastRel.rows[0]?.version_no ?? '0') + 1;
            await tx.query(
              `INSERT INTO sf_tenant_org.organisation_relation (
               relation_id, tenant_id, child_organisation_id, parent_organisation_id, relation_type_code, version_no, valid_from, created_by, created_at
             ) VALUES ($1,$2,$3,$4,'PARENT',$5,$6,$7,$6)`,
              [
                newId(),
                tenantId,
                request.params.id,
                request.body.parent_id,
                nextRel,
                now.toISOString(),
                ctx.actor.id,
              ],
            );
          }
          const lastVer = await tx.query<{
            version_no: string;
            name: string;
            organisation_type_code: string;
            status: string;
          }>(
            'SELECT version_no, name, organisation_type_code, status FROM sf_tenant_org.organisation_version WHERE organisation_id = $1 ORDER BY version_no DESC LIMIT 1',
            [request.params.id],
          );
          const prev = lastVer.rows[0];
          if (!prev) throw new Cmp002Error('SF-SYS-002');
          const nextVer = Number(prev.version_no) + 1;
          await tx.query(
            `INSERT INTO sf_tenant_org.organisation_version (
             tenant_id, organisation_id, version_no, name, organisation_type_code, status, valid_from, reason, created_by, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7)`,
            [
              tenantId,
              request.params.id,
              nextVer,
              request.body.name ?? prev.name,
              request.body.organisation_type_code ?? prev.organisation_type_code,
              request.body.status ?? prev.status,
              now.toISOString(),
              request.body.reason ?? 'VERSIONED',
              ctx.actor.id,
            ],
          );
          const change = request.body.parent_id !== undefined ? 'RELATION_CHANGED' : 'VERSIONED';
          const env = envelopeOf({
            eventType: 'OrganisationChanged',
            tenantId,
            cellId: ctx.cell_id,
            aggregateType: 'Organisation',
            aggregateId: request.params.id,
            aggregateVersion: nextVer,
            occurredAt: now.toISOString(),
            correlationId: ctx.correlation_id,
            actor: ctx.actor,
            data: {
              organisation_id: request.params.id,
              change,
              version_no: nextVer,
              valid_from: now.toISOString(),
              parent_organisation_id: request.body.parent_id ?? null,
              organisation_type_code:
                request.body.organisation_type_code ?? prev.organisation_type_code,
            },
          });
          await insertOutbox(tx, env, TOPIC_DOMAIN);
          await withWriteAudit(deps, ctx, tx, {
            action: 'ORGANISATION_VERSION',
            actionClass: 'WRITE',
            resourceType: 'Organisation',
            resourceId: request.params.id,
            result: 'SUCCESS',
            now,
          });
          return { status: 201, body: { organisation_id: request.params.id, version_no: nextVer } };
        },
      );
      return reply.code(result.status).send(result.body);
    },
  );
}
