import type { RequestContext } from '@serviceform/contracts';
import { dbSessionSettings } from '@serviceform/contracts';
import type pg from 'pg';

/** Branded client that already holds an open transaction with session settings applied. */
export type OutboxTx = pg.PoolClient & { readonly __outboxTx: unique symbol };

export function asOutboxTx(client: pg.PoolClient): OutboxTx {
  return client as OutboxTx;
}

export async function withOutboxTransaction<T>(
  pool: pg.Pool,
  ctx: RequestContext,
  fn: (tx: OutboxTx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const settings = dbSessionSettings(ctx);
    for (const [key, value] of Object.entries(settings)) {
      await client.query('SELECT set_config($1, $2, true)', [key, value]);
    }
    const result = await fn(asOutboxTx(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // keep original error
    }
    throw err;
  } finally {
    client.release();
  }
}
