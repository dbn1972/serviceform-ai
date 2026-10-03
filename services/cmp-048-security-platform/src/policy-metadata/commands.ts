import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@serviceform/contracts';
import { SecurityError } from '@serviceform/security';
import type { Pool, PoolClient } from 'pg';
import { withTenantTx } from '../db/tx.js';
import { envelope } from '../events/envelopes.js';
import { writeOutbox } from '../events/outbox-writer.js';

export async function registerPolicy(
  pool: Pool,
  ctx: RequestContext,
  body: {
    bundle_name: string;
    revision: string;
    content_sha256: string;
    roots: string[];
    test_report_sha256: string;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  await withTenantTx(pool, ctx, async (c) => {
    await c.query(
      `INSERT INTO sf_security.security_policy_metadata
        (id, bundle_name, revision, content_sha256, roots, status, published_by, test_report_sha256)
       VALUES ($1,$2,$3,$4,$5,'VALIDATED',$6,$7)`,
      [
        id,
        body.bundle_name,
        body.revision,
        body.content_sha256,
        body.roots,
        ctx.actor.id,
        body.test_report_sha256,
      ],
    );
  });
  return { id };
}

export async function activatePolicy(pool: Pool, ctx: RequestContext, id: string): Promise<void> {
  await withTenantTx(pool, ctx, async (c: PoolClient) => {
    const cur = await c.query(
      'SELECT bundle_name, published_by, revision, content_sha256 FROM sf_security.security_policy_metadata WHERE id = $1',
      [id],
    );
    const row = cur.rows[0] as
      | { bundle_name: string; published_by: string; revision: string; content_sha256: string }
      | undefined;
    if (!row) throw new SecurityError('SF-SYS-002', { statusCode: 404 });
    await c.query(
      `UPDATE sf_security.security_policy_metadata SET status = 'SUPERSEDED' WHERE bundle_name = $1 AND status = 'ACTIVE'`,
      [row.bundle_name],
    );
    await c.query(
      `UPDATE sf_security.security_policy_metadata
       SET status = 'ACTIVE', approved_by = $2, activated_at = now() WHERE id = $1`,
      [id, ctx.actor.id],
    );
    const ev = envelope(ctx, {
      event_type: 'SecurityPolicyPublished',
      aggregate_type: 'SecurityPolicy',
      aggregate_id: id,
      aggregate_version: 1,
      tenant_id: null,
      data: {
        bundle_name: row.bundle_name,
        revision: row.revision,
        content_sha256: row.content_sha256,
        activated_at: new Date().toISOString(),
      },
    });
    await writeOutbox(c, ev, 'sf.security.events.v1');
  });
}
