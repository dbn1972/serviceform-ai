import { AsyncLocalStorage } from 'node:async_hooks';
import { dbSessionSettings, type RequestContext } from '@serviceform/contracts';
import type { Pool, PoolClient } from 'pg';
import { runWithTxnFlag } from '../domain/txn-guard.js';

const txAls = new AsyncLocalStorage<PoolClient>();

export async function withContextTx<T>(
  pool: Pool,
  ctx: RequestContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const settings = dbSessionSettings(ctx);
    for (const [key, value] of Object.entries(settings)) {
      await client.query('SELECT set_config($1, $2, true)', [key, value]);
    }
    const result = await runWithTxnFlag(() => txAls.run(client, () => fn(client)));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}
