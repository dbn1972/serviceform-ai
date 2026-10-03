import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, withClient } from './helpers.js';

/**
 * Self-test of the tenant-isolation test harness that every M01+ component reuses
 * (TI v1.0 s8 and constitution #4-#7, #17). Uses a throwaway schema; no business table.
 */
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

describe('RLS harness self-test (REQ: TI v1.0 s8, s8.1; Constitution #6)', () => {
  beforeAll(async () => {
    migrate('up');
    await withClient(async (c) => {
      await c.query(`
        DROP SCHEMA IF EXISTS sf_harness CASCADE;
        CREATE SCHEMA sf_harness;
        CREATE TABLE sf_harness.example_record (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL,
          label text NOT NULL
        );
        ALTER TABLE sf_harness.example_record ENABLE ROW LEVEL SECURITY;
        ALTER TABLE sf_harness.example_record FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON sf_harness.example_record
          USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
          WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
        GRANT USAGE ON SCHEMA sf_harness TO sf_app;
        GRANT SELECT, INSERT ON sf_harness.example_record TO sf_app;
      `);
      for (const [t, label] of [
        [T1, 'one'],
        [T2, 'two'],
      ] as const) {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE sf_app');
        await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [t]);
        await c.query('INSERT INTO sf_harness.example_record (tenant_id, label) VALUES ($1, $2)', [
          t,
          label,
        ]);
        await c.query('COMMIT');
      }
    });
  });

  afterAll(async () => {
    await withClient((c) => c.query('DROP SCHEMA IF EXISTS sf_harness CASCADE'));
  });

  async function asTenant<T extends pg.QueryResultRow>(
    tenant: string | null,
    fn: (q: (sql: string, p?: unknown[]) => Promise<pg.QueryResult<T>>) => Promise<unknown>,
  ) {
    return withClient(async (c) => {
      await c.query('BEGIN');
      try {
        await c.query('SET LOCAL ROLE sf_app');
        if (tenant) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
        return await fn((sql, p) => c.query<T>(sql, p));
      } finally {
        await c.query('ROLLBACK');
      }
    });
  }

  it('returns only the current tenant rows', async () => {
    const rows = await asTenant<{ label: string }>(
      T1,
      async (q) => (await q('SELECT label FROM sf_harness.example_record')).rows,
    );
    expect(rows).toEqual([{ label: 'one' }]);
  });

  it('returns nothing without tenant context (fail closed)', async () => {
    const rows = await asTenant<{ label: string }>(
      null,
      async (q) => (await q('SELECT label FROM sf_harness.example_record')).rows,
    );
    expect(rows).toEqual([]);
  });

  it('refuses a cross-tenant insert', async () => {
    await expect(
      asTenant(T1, (q) =>
        q('INSERT INTO sf_harness.example_record (tenant_id, label) VALUES ($1, $2)', [T2, 'x']),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot read another tenant row by id (IDOR negative)', async () => {
    const t2Id = await asTenant<{ id: string }>(
      T2,
      async (q) => (await q('SELECT id FROM sf_harness.example_record')).rows[0]?.id,
    );
    const rows = await asTenant(
      T1,
      async (q) => (await q('SELECT * FROM sf_harness.example_record WHERE id = $1', [t2Id])).rows,
    );
    expect(rows).toEqual([]);
  });
});
