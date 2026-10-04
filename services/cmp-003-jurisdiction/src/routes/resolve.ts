import type { FastifyInstance } from 'fastify';
import { RESOLVE_BODY } from '../schemas/http.js';
import { currentClient, withContextTx } from '../db/tx.js';
import { Cmp003Error } from '../errors.js';
import { decide, sendPrivate, type RouteDeps } from './helpers.js';

export function registerResolveRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post<{
    Body: { mode: 'BY_ID' | 'BY_CODE' | 'BY_ADDRESS_KEY'; value: string; as_of?: string };
  }>('/jurisdiction/resolve', { schema: { body: RESOLVE_BODY } }, async (request, reply) => {
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
        resource_type: 'Jurisdiction',
        tenant_id: ctx.tenant_id,
        classification: 'TENANT_SCOPED',
      },
      action: 'JURISDICTION_RESOLVE',
    });
    const asOf = request.body.as_of ?? deps.clock().toISOString();
    const resolved = await withContextTx(deps.pool, ctx, async () => {
      const client = currentClient();
      let jurisdictionId: string | null = null;
      if (request.body.mode === 'BY_ID') {
        if (!/^[0-9a-f-]{36}$/i.test(request.body.value)) {
          throw new Cmp003Error('SF-SYS-003', { details: [{ code: 'INVALID_ID' }] });
        }
        const found = await client.query<{ jurisdiction_id: string }>(
          'SELECT jurisdiction_id FROM sf_jurisdiction.jurisdiction WHERE jurisdiction_id = $1',
          [request.body.value],
        );
        jurisdictionId = found.rows[0]?.jurisdiction_id ?? null;
      } else if (request.body.mode === 'BY_CODE') {
        const found = await client.query<{ jurisdiction_id: string }>(
          'SELECT jurisdiction_id FROM sf_jurisdiction.jurisdiction WHERE code = $1',
          [request.body.value],
        );
        jurisdictionId = found.rows[0]?.jurisdiction_id ?? null;
      } else {
        // Opaque address-key adapter — fail closed when unbound. No geocoding / statute invention.
        const found = await client.query<{ jurisdiction_id: string }>(
          `SELECT jurisdiction_id
             FROM sf_jurisdiction.jurisdiction_binding
            WHERE target_type = 'ADDRESS_KEY' AND target_ref = $1 AND status = 'ACTIVE'
              AND valid_from <= $2
            ORDER BY valid_from DESC, version_no DESC
            LIMIT 1`,
          [request.body.value, asOf],
        );
        jurisdictionId = found.rows[0]?.jurisdiction_id ?? null;
        if (!jurisdictionId) {
          throw new Cmp003Error('SF-SYS-002', { details: [{ code: 'UNKNOWN_ADDRESS' }] });
        }
      }
      if (!jurisdictionId) {
        throw new Cmp003Error('SF-SYS-002', { details: [{ code: 'JURISDICTION_NOT_FOUND' }] });
      }
      const detail = await client.query<{
        jurisdiction_id: string;
        code: string;
        name: string;
        type_code: string;
        status: string;
        version_no: string;
        parent_jurisdiction_id: string | null;
      }>(
        `SELECT j.jurisdiction_id, j.code, v.name, t.type_code, v.status, v.version_no,
                r.parent_jurisdiction_id
           FROM sf_jurisdiction.jurisdiction j
           JOIN LATERAL (
             SELECT name, jurisdiction_type_id, status, version_no
               FROM sf_jurisdiction.jurisdiction_version
              WHERE tenant_id = j.tenant_id AND jurisdiction_id = j.jurisdiction_id AND valid_from <= $2
              ORDER BY valid_from DESC, version_no DESC
              LIMIT 1
           ) v ON true
           JOIN sf_jurisdiction.jurisdiction_type t
             ON t.tenant_id = j.tenant_id AND t.jurisdiction_type_id = v.jurisdiction_type_id
           LEFT JOIN LATERAL (
             SELECT parent_jurisdiction_id
               FROM sf_jurisdiction.jurisdiction_relation
              WHERE tenant_id = j.tenant_id AND child_jurisdiction_id = j.jurisdiction_id AND valid_from <= $2
              ORDER BY valid_from DESC, version_no DESC
              LIMIT 1
           ) r ON true
          WHERE j.jurisdiction_id = $1`,
        [jurisdictionId, asOf],
      );
      const row = detail.rows[0];
      if (!row) throw new Cmp003Error('SF-SYS-002', { details: [{ code: 'JURISDICTION_NOT_FOUND' }] });
      return row;
    });
    sendPrivate(reply);
    return {
      mode: request.body.mode,
      jurisdiction_id: resolved.jurisdiction_id,
      code: resolved.code,
      name: resolved.name,
      type_code: resolved.type_code,
      status: resolved.status,
      version_no: Number(resolved.version_no),
      parent_jurisdiction_id: resolved.parent_jurisdiction_id,
      as_of: asOf,
    };
  });
}
