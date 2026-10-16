import type { Pool, PoolClient } from 'pg';
import { dbSessionSettings, type RequestContext } from '@serviceform/contracts';
import { Cmp059Error } from '../errors.js';

export async function withContextTx<T>(
  pool: Pool,
  ctx: RequestContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!ctx.tenant_id) throw new Cmp059Error('SF-TEN-001', { statusCode: 401 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const settings = dbSessionSettings(ctx);
    for (const [key, value] of Object.entries(settings)) {
      if (value == null) continue;
      await client.query('SELECT set_config($1, $2, true)', [key, String(value)]);
    }
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
