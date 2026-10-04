import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  asTenant,
  ACTOR_OFFICER,
  CANARY,
  closeHarness,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-005 privilege boundary (ADR-0006) / INT-011', () => {
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
      expect(id.rows[0]?.session_user).toBe('sf_t005_rt');
      const member = await client.query<{ ok: boolean }>(
        "SELECT pg_has_role(session_user, 'sf_app', 'MEMBER') AS ok",
      );
      expect(member.rows[0]?.ok).toBe(true);
      const owners = await client.query<{ ok: boolean }>(
        `SELECT bool_or(pg_has_role(session_user, relowner, 'MEMBER')) AS ok
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_citizen_profile' AND c.relkind = 'r'`,
      );
      expect(owners.rows[0]?.ok).toBe(false);
    } finally {
      client.release();
    }
  });

  it('own DML succeeds; peer component role cannot DML or SET ROLE', async () => {
    await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_citizen_profile.citizen_profile (
           tenant_id, profile_id, subject_id, status, created_by
         ) VALUES ($1,$2,$3,'ACTIVE',$4)`,
        [T1, randomUUID(), ACTOR_OFFICER, ACTOR_OFFICER],
      );
    });
    await expect(
      asTenant(h.other, T1, ACTOR_OFFICER, async (c) => {
        await c.query(
          `INSERT INTO sf_citizen_profile.citizen_profile (
             tenant_id, profile_id, subject_id, status, created_by
           ) VALUES ($1,$2,$3,'ACTIVE',$4)`,
          [T1, randomUUID(), randomUUID(), ACTOR_OFFICER],
        );
      }),
    ).rejects.toThrow();
    await expect(
      asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
        await c.query('SET ROLE sf_cmp030_rw');
      }),
    ).rejects.toThrow();
  });

  it('wrong-tenant RLS yields zero rows (CROSS_TENANT_LEAKAGE=0)', async () => {
    const profileId = randomUUID();
    await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_citizen_profile.citizen_profile (
           tenant_id, profile_id, subject_id, status, created_by
         ) VALUES ($1,$2,$3,'ACTIVE',$4)`,
        [T1, profileId, randomUUID(), ACTOR_OFFICER],
      );
    });
    const rows = await asTenant(h.rt, T2, ACTOR_OFFICER, async (c) => {
      const res = await c.query(
        `SELECT profile_id::text AS id FROM sf_citizen_profile.citizen_profile WHERE profile_id = $1`,
        [profileId],
      );
      return res.rows;
    });
    expect(rows).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain(CANARY);
    expect(JSON.stringify(rows)).not.toContain(profileId);
  });

  it('cross-component SQL to consent schema is DENY', async () => {
    await expect(
      asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
        await c.query('SELECT * FROM sf_consent_privacy.purpose');
      }),
    ).rejects.toThrow();
  });
});
