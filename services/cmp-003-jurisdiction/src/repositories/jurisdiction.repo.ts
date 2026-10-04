import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Cmp003Error } from '../errors.js';
import { MAX_HIERARCHY_DEPTH, wouldCycle } from '../domain/hierarchy.js';

export function newId(): string {
  return randomUUID();
}

/** Tenant-scoped advisory lock — no dependency on CMP-002 tenant table. */
export async function lockTenantScope(client: PoolClient, tenantId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [tenantId]);
}

export async function ancestorsOf(
  client: PoolClient,
  childId: string,
  asOf: Date,
): Promise<{ ids: string[]; depthHitLimit: boolean }> {
  const { rows } = await client.query<{ jur_id: string; depth: number }>(
    `WITH RECURSIVE walk AS (
        SELECT $1::uuid AS jur_id, 1 AS depth
        UNION ALL
        SELECT r.parent_jurisdiction_id, walk.depth + 1
          FROM walk
          JOIN LATERAL (
            SELECT parent_jurisdiction_id
              FROM sf_jurisdiction.jurisdiction_relation
             WHERE child_jurisdiction_id = walk.jur_id
               AND valid_from <= $2
             ORDER BY valid_from DESC, version_no DESC
             LIMIT 1
          ) r ON r.parent_jurisdiction_id IS NOT NULL
         WHERE walk.depth < $3
      )
      SELECT jur_id::text, depth FROM walk`,
    [childId, asOf.toISOString(), MAX_HIERARCHY_DEPTH],
  );
  const ids = rows.map((r) => r.jur_id);
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
    throw new Cmp003Error('SF-SYS-003', { details: [{ code: 'HIERARCHY_CYCLE' }] });
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
    throw new Cmp003Error('SF-SYS-003', { details: [{ code: 'HIERARCHY_DEPTH' }] });
  }
  if (verdict.cycle) {
    throw new Cmp003Error('SF-SYS-003', { details: [{ code: 'HIERARCHY_CYCLE' }] });
  }
}
