import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR_OFFICER,
  CANARY,
  T1,
  T2,
  asTenant,
  closeHarness,
  setupHarness,
  type Harness,
} from './helpers.js';

describe('CMP-003 privilege boundary (ADR-0006)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('own-component DML succeeds; peer-component login is denied', async () => {
    const typeId = randomUUID();
    await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_jurisdiction.jurisdiction_type (
           tenant_id, jurisdiction_type_id, type_code, display_label, status, created_by
         ) VALUES ($1,$2,'LEVEL_A','Level A','ACTIVE',$3)`,
        [T1, typeId, ACTOR_OFFICER],
      );
    });

    await expect(
      asTenant(h.other, T1, ACTOR_OFFICER, async (c) => {
        await c.query(
          `INSERT INTO sf_jurisdiction.jurisdiction_type (
             tenant_id, jurisdiction_type_id, type_code, display_label, status, created_by
           ) VALUES ($1,$2,'LEVEL_B','Level B','ACTIVE',$3)`,
          [T1, randomUUID(), ACTOR_OFFICER],
        );
      }),
    ).rejects.toMatchObject({ code: '42501' });

    await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      const rows = await c.query(
        `SELECT type_code FROM sf_jurisdiction.jurisdiction_type WHERE type_code = 'LEVEL_A'`,
      );
      expect(rows.rowCount).toBe(1);
    });
  });

  it('wrong-tenant RLS returns zero rows and blocks insert leakage', async () => {
    const typeId = randomUUID();
    await asTenant(h.rt, T2, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_jurisdiction.jurisdiction_type (
           tenant_id, jurisdiction_type_id, type_code, display_label, status, created_by
         ) VALUES ($1,$2,'LEVEL_X',$3,'ACTIVE',$4)`,
        [T2, typeId, CANARY, ACTOR_OFFICER],
      );
    });

    await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      const leaked = await c.query(
        `SELECT display_label FROM sf_jurisdiction.jurisdiction_type WHERE tenant_id = $1`,
        [T2],
      );
      expect(leaked.rowCount).toBe(0);
      expect(JSON.stringify(leaked.rows)).not.toContain(CANARY);
    });
  });

  it('runtime login is not table owner and cannot SET ROLE peer rw', async () => {
    const client = await h.rt.connect();
    try {
      const owner = await client.query<{ ok: boolean }>(
        `SELECT pg_has_role(session_user, (
           SELECT relowner FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'sf_jurisdiction' AND c.relname = 'jurisdiction'
         ), 'MEMBER') AS ok`,
      );
      expect(owner.rows[0]?.ok).toBe(false);
      await expect(client.query('SET ROLE sf_cmp048_rw')).rejects.toBeTruthy();
    } finally {
      client.release();
    }
  });
});
