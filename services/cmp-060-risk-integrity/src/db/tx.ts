import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient } from 'pg';
import { dbSessionSettings, type RequestContext } from '@serviceform/contracts';
import { Cmp060Error } from '../errors.js';

const txAls = new AsyncLocalStorage<PoolClient>();

export function currentClient(): PoolClient {
  const client = txAls.getStore();
  if (!client) throw new Cmp060Error('SF-SYS-001', { details: [{ code: 'TX_REQUIRED' }] });
  return client;
}

/** Minimal session fields required to apply SF-CON-DB-SESSION-CONTEXT. */
export type TxSessionInput = {
  tenant_id: string;
  cell_id: string;
  actor_type: RequestContext['actor']['type'];
  actor_id: string;
  correlation_id: string;
};

export async function withContextTx<T>(
  pool: Pool,
  session: TxSessionInput,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const settings = dbSessionSettings({
      tenant_id: session.tenant_id,
      cell_id: session.cell_id,
      actor: { type: session.actor_type, id: session.actor_id },
      roles: [],
      jurisdiction_ids: [],
      auth_assurance: 'MFA',
      correlation_id: session.correlation_id,
      trace_id: '0'.repeat(32),
    });
    for (const [key, value] of Object.entries(settings)) {
      if (value == null) continue;
      await client.query('SELECT set_config($1, $2, true)', [key, String(value)]);
    }
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
