import { describe, expect, it } from 'vitest';
import { asOutboxTx, withOutboxTransaction } from '../src/tx.js';
import type { RequestContext } from '@serviceform/contracts';
import type pg from 'pg';

const ctx: RequestContext = {
  tenant_id: '11111111-1111-4111-8111-111111111111',
  cell_id: 'cell-01',
  actor: { type: 'SYSTEM', id: 'bf5c3dae-06c2-4f4e-97bf-e2ad8ec06b3b' },
  roles: [],
  jurisdiction_ids: [],
  auth_assurance: 'WORKLOAD_IDENTITY',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
};

function poolFor(queryImpl: (sql: string) => Promise<unknown>): pg.Pool {
  let released = false;
  const client = {
    query: async (sql: string) => queryImpl(sql),
    release: () => {
      released = true;
    },
  };
  return {
    connect: async () => client,
    _released: () => released,
  } as unknown as pg.Pool;
}

describe('withOutboxTransaction', () => {
  it('commits after applying session settings', async () => {
    const sqls: string[] = [];
    const pool = poolFor(async (sql) => {
      sqls.push(sql);
      return { rows: [], rowCount: 0 };
    });
    const out = await withOutboxTransaction(pool, ctx, async (tx) => {
      expect(asOutboxTx(tx)).toBe(tx);
      return 42;
    });
    expect(out).toBe(42);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.some((s) => s.includes('set_config'))).toBe(true);
    expect(sqls.at(-1)).toBe('COMMIT');
  });

  it('rolls back when the callback throws, even if ROLLBACK fails', async () => {
    const pool = poolFor(async (sql) => {
      if (sql === 'ROLLBACK') throw new Error('rollback-fail');
      if (sql === 'BEGIN') return { rows: [] };
      return { rows: [] };
    });
    await expect(
      withOutboxTransaction(pool, ctx, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow(/boom/);
  });
});
