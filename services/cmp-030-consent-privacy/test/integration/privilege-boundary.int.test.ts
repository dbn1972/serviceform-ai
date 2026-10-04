import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  ACTOR_OFFICER,
  closeHarness,
  setupHarness,
  T1,
  type Harness,
} from './helpers.js';
import { randomUUID } from 'node:crypto';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-030 privilege boundary (ADR-0006)', () => {
  it('runtime is non-superuser sf_app member and not table owner', async () => {
    const client = await h.rt.connect();
    try {
      const id = await client.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        session_user: string;
      }>(
        `SELECT r.rolsuper, r.rolbypassrls, session_user
           FROM pg_roles r WHERE r.rolname = session_user`,
      );
      expect(id.rows[0]?.rolsuper).toBe(false);
      expect(id.rows[0]?.rolbypassrls).toBe(false);
      expect(id.rows[0]?.session_user).toBe('sf_t030_rt');
      const member = await client.query<{ ok: boolean }>(
        "SELECT pg_has_role(session_user, 'sf_app', 'MEMBER') AS ok",
      );
      expect(member.rows[0]?.ok).toBe(true);
      const owners = await client.query<{ ok: boolean }>(
        `SELECT bool_or(pg_has_role(session_user, relowner, 'MEMBER')) AS ok
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_consent_privacy' AND c.relkind = 'r'`,
      );
      expect(owners.rows[0]?.ok).toBe(false);
    } finally {
      client.release();
    }
  });

  it('own DML succeeds; peer component role cannot DML business tables', async () => {
    await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_consent_privacy.purpose (
           tenant_id, purpose_id, code, label, status, requires_consent, created_by
         ) VALUES ($1,$2,'SVC_APPLY','Service apply','ACTIVE',true,$3)`,
        [T1, randomUUID(), ACTOR_OFFICER],
      );
    });
    await expect(
      asTenant(h.other, T1, ACTOR_OFFICER, async (c) => {
        await c.query(
          `INSERT INTO sf_consent_privacy.purpose (
             tenant_id, purpose_id, code, label, status, requires_consent, created_by
           ) VALUES ($1,$2,'PEER_DENY','Peer','ACTIVE',true,$3)`,
          [T1, randomUUID(), ACTOR_OFFICER],
        );
      }),
    ).rejects.toThrow();
  });

  it('wrong-tenant RLS yields zero rows (no canary leak)', async () => {
    const purposeId = randomUUID();
    await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_consent_privacy.purpose (
           tenant_id, purpose_id, code, label, status, requires_consent, created_by
         ) VALUES ($1,$2,'T1_ONLY','One','ACTIVE',true,$3)
         ON CONFLICT DO NOTHING`,
        [T1, purposeId, ACTOR_OFFICER],
      );
    });
    const rows = await asTenant(h.rt, '22222222-2222-4222-8222-222222222222', ACTOR_OFFICER, async (c) => {
      const res = await c.query(
        `SELECT code FROM sf_consent_privacy.purpose WHERE purpose_id = $1`,
        [purposeId],
      );
      return res.rows;
    });
    expect(rows).toEqual([]);
  });
});
