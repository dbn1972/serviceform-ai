import { AsyncLocalStorage } from 'node:async_hooks';
import { Cmp016Error } from '../errors.js';
import type { WorkflowContext } from '../ports.js';

export interface SqlResult<R> {
  rows: R[];
  rowCount: number | null;
}

/** Structural subset of a node-postgres client, so the domain does not depend on a driver. */
export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<SqlResult<R>>;
}

export interface SqlPoolClient extends SqlClient {
  release(): void;
}

export interface SqlPool {
  connect(): Promise<SqlPoolClient>;
}

const openTx = new AsyncLocalStorage<true>();

/** True while code runs inside an open authoritative PostgreSQL transaction. */
export function inDomainTransaction(): boolean {
  return openTx.getStore() === true;
}

/** SF-CON-DB-SESSION-CONTEXT settings, applied transaction-locally (set_config(..., true)). */
export function sessionSettings(ctx: WorkflowContext): [string, string][] {
  return [
    ['app.tenant_id', ctx.tenant_id],
    ['app.cell_id', ctx.cell_id],
    ['app.actor_type', ctx.actor.type],
    ['app.actor_id', ctx.actor.id],
    ['app.correlation_id', ctx.correlation_id],
  ];
}

export async function withTenantTx<T>(
  pool: SqlPool,
  ctx: WorkflowContext,
  fn: (client: SqlClient) => Promise<T>,
): Promise<T> {
  if (!ctx.tenant_id) throw new Cmp016Error('SF-TEN-001');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of sessionSettings(ctx)) {
      await client.query('SELECT set_config($1, $2, true)', [key, value]);
    }
    const result = await openTx.run(true, () => fn(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already broken; release below */
    }
    throw err;
  } finally {
    client.release();
  }
}
