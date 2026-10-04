import { dbSessionSettings, type RequestContext } from '@serviceform/contracts';
import type { Pool, PoolClient } from 'pg';

export async function withTenantTx<T>(
  pool: Pool,
  ctx: RequestContext,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const settings = dbSessionSettings(ctx);
    for (const [key, value] of Object.entries(settings)) {
      await c.query('SELECT set_config($1, $2, true)', [key, value]);
    }
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await c.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    c.release();
  }
}
