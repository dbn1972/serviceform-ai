import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

describe('CMP-001 migration round-trip', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('schema exists with FORCE RLS on tenant tables and no prosecdef', async () => {
    const client = await h.admin.connect();
    try {
      const rls = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_catalogue'
            AND c.relkind = 'r'
            AND c.relname IN ('offering','offering_version','offering_binding','idempotency_record')`,
      );
      expect(rls.rowCount).toBe(4);
      for (const row of rls.rows) {
        expect(row.relrowsecurity).toBe(true);
        expect(row.relforcerowsecurity).toBe(true);
      }
      const fn = await client.query(
        `SELECT 1 FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'sf_catalogue' AND p.prosecdef`,
      );
      expect(fn.rowCount).toBe(0);
    } finally {
      client.release();
    }
  });
});
