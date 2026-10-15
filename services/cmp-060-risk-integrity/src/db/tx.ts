import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient } from 'pg';
import { Cmp060Error } from '../errors.js';

const txAls = new AsyncLocalStorage<PoolClient>();

export function currentClient(): PoolClient {
  const client = txAls.getStore();
  if (!client) throw new Cmp060Error('SF-SYS-001', { details: [{ code: 'TX_REQUIRED' }] });
  return client;
}

export async function withContextTx<T>(
  pool: Pool,
  tenantId: string,
  cellId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenantId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.current_cell_id', cellId]);
    const result = await txAls.run(client, () => fn(client));
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
