import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  ACTOR_OFFICER,
  closeHarness,
  seedTenants,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

let h: Harness;
let pid = 0;

beforeAll(async () => {
  h = await setupHarness();
  await seedTenants(h);
});
afterAll(async () => closeHarness(h));

describe('pool reuse and outbox (001-13, 001-37, 001-38)', () => {
  it('reused backend without context sees zero rows', async () => {
    const c = await h.rt2.connect();
    try {
      const p1 = await c.query<{ pg_backend_pid: number }>('SELECT pg_backend_pid()');
      pid = p1.rows[0]?.pg_backend_pid ?? 0;
      await c.query('BEGIN');
      await c.query('SELECT set_config($1,$2,true)', ['app.tenant_id', T1]);
      const t1 = await c.query('SELECT code FROM sf_tenant_org.tenant');
      expect(t1.rows).toEqual([{ code: 'tenant-one' }]);
      await c.query('COMMIT');
      await c.query('BEGIN');
      const unset = await c.query('SELECT code FROM sf_tenant_org.tenant');
      expect(unset.rows).toEqual([]);
      await c.query('COMMIT');
      await c.query('BEGIN');
      await c.query('SELECT set_config($1,$2,true)', ['app.tenant_id', T2]);
      const t2 = await c.query('SELECT code FROM sf_tenant_org.tenant');
      expect(t2.rows).toEqual([{ code: 'tenant-two' }]);
      await c.query('COMMIT');
      const p2 = await c.query<{ pg_backend_pid: number }>('SELECT pg_backend_pid()');
      expect(p2.rows[0]?.pg_backend_pid).toBe(pid);
    } finally {
      c.release();
    }
  });

  it('producers cannot select or update outbox; cross-tenant envelope insert is refused', async () => {
    await expect(
      asTenant(h.rt, T1, ACTOR_OFFICER, (c) => c.query('SELECT * FROM sf_tenant_org.outbox_event')),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asTenant(h.rt, T1, ACTOR_OFFICER, (c) =>
        c.query("UPDATE sf_tenant_org.outbox_event SET status = 'PUBLISHED'"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asTenant(h.rt, T1, ACTOR_OFFICER, (c) =>
        c.query('DELETE FROM sf_tenant_org.outbox_event_platform'),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('001-14 failed transaction does not leak tenant context on reuse', async () => {
    const c = await h.rt2.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config($1,$2,true)', ['app.tenant_id', T1]);
      await expect(
        c.query(
          "INSERT INTO sf_tenant_org.tenant (tenant_id, code, display_name, status, created_by) VALUES ($1,'bad','x','NOPE',$1)",
          [T1],
        ),
      ).rejects.toThrow();
      await c.query('ROLLBACK');
      const setting = await c.query<{ v: string | null }>(
        "SELECT current_setting('app.tenant_id', true) AS v",
      );
      expect(['', null]).toContain(setting.rows[0]?.v ?? '');
      await c.query('BEGIN');
      const rows = await c.query('SELECT code FROM sf_tenant_org.tenant');
      expect(rows.rows).toEqual([]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });
});
