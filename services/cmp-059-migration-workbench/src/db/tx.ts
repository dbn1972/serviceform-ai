import type { Pool, PoolClient } from 'pg';
import type { RequestContext } from '@serviceform/contracts';
import { Cmp059Error } from '../errors.js';

export async function withContextTx<T>(
  pool: Pool,
  ctx: RequestContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const tenantId = ctx.tenant_id;
  if (!tenantId) throw new Cmp059Error('SF-TEN-001', { statusCode: 401 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('sf.tenant_id', $1, true)`, [tenantId]);
    await client.query(`SELECT set_config('sf.actor_id', $1, true)`, [ctx.actor.id]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
