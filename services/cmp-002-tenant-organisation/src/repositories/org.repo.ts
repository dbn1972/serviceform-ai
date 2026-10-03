import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Cmp002Error } from '../errors.js';
import { MAX_HIERARCHY_DEPTH, wouldCycle } from '../domain/hierarchy.js';

export async function lockTenant(client: PoolClient, tenantId: string): Promise<void> {
  const found = await client.query(
    'SELECT tenant_id FROM sf_tenant_org.tenant WHERE tenant_id = $1 FOR UPDATE',
    [tenantId],
  );
  if (found.rowCount === 0) throw new Cmp002Error('SF-SYS-002');
}

export async function currentBinding(client: PoolClient, tenantId: string, asOf: Date) {
  const { rows } = await client.query<{
    binding_id: string;
    cell_id: string;
    isolation_model: string;
    valid_from: Date;
    seq: string;
  }>(
    `SELECT binding_id, cell_id, isolation_model, valid_from, seq
       FROM sf_tenant_org.tenant_cell_binding
      WHERE tenant_id = $1 AND valid_from <= $2
      ORDER BY valid_from DESC, seq DESC
      LIMIT 1`,
    [tenantId, asOf.toISOString()],
  );
  return rows[0] ?? null;
}

export async function ancestorsOf(
  client: PoolClient,
  childId: string,
  asOf: Date,
): Promise<{ ids: string[]; depthHitLimit: boolean }> {
  const { rows } = await client.query<{ org_id: string; depth: number }>(
    `WITH RECURSIVE walk AS (
        SELECT $1::uuid AS org_id, 1 AS depth
        UNION ALL
        SELECT r.parent_organisation_id, walk.depth + 1
          FROM walk
          JOIN LATERAL (
            SELECT parent_organisation_id
              FROM sf_tenant_org.organisation_relation
             WHERE child_organisation_id = walk.org_id
               AND valid_from <= $2
             ORDER BY valid_from DESC, version_no DESC
             LIMIT 1
          ) r ON r.parent_organisation_id IS NOT NULL
         WHERE walk.depth < $3
      )
      SELECT org_id::text, depth FROM walk`,
    [childId, asOf.toISOString(), MAX_HIERARCHY_DEPTH],
  );
  const ids = rows.map((r) => r.org_id);
  const depthHitLimit = rows.some((r) => r.depth >= MAX_HIERARCHY_DEPTH);
  return { ids, depthHitLimit };
}

export async function assertNoCycle(
  client: PoolClient,
  childId: string,
  parentId: string | null,
  asOf: Date,
): Promise<void> {
  if (parentId === null) return;
  if (childId === parentId) {
    throw new Cmp002Error('SF-SYS-003', { details: [{ code: 'HIERARCHY_CYCLE' }] });
  }
  await client.query("SET LOCAL statement_timeout = '2s'");
  const walked = await ancestorsOf(client, parentId, asOf);
  const verdict = wouldCycle({
    childId,
    parentId,
    ancestorsOfParent: walked.ids,
    depthHitLimit: walked.depthHitLimit,
  });
  if (verdict.depthExceeded) {
    throw new Cmp002Error('SF-SYS-003', { details: [{ code: 'HIERARCHY_DEPTH' }] });
  }
  if (verdict.cycle) {
    throw new Cmp002Error('SF-SYS-003', { details: [{ code: 'HIERARCHY_CYCLE' }] });
  }
}

export function newId(): string {
  return randomUUID();
}
