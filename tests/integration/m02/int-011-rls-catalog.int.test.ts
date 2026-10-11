import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR,
  CANARY,
  OFFICER_T1,
  T1,
  T2,
  asTenant,
  createLogin,
  dropRoles,
  ensurePeerGroupRoles,
  migrateUp,
  rolePassword,
  runtimePool,
  withAdmin,
} from './pg-harness.js';

const ROLES = ['sf_m02rls_004', 'sf_m02rls_005', 'sf_m02rls_peer'] as const;

describe('INT-011 M02 LOGIN RLS catalog (independent)', () => {
  const password = rolePassword();
  const leaks: string[] = [];
  let p004: ReturnType<typeof runtimePool>;
  let p005: ReturnType<typeof runtimePool>;
  let peer: ReturnType<typeof runtimePool>;

  beforeAll(async () => {
    await withAdmin(async (c) => {
      await dropRoles(c, ROLES);
    });
    migrateUp();
    await withAdmin(async (c) => {
      await ensurePeerGroupRoles(c);
      await createLogin(c, 'sf_m02rls_004', 'sf_cmp004_rw', password);
      await createLogin(c, 'sf_m02rls_005', 'sf_cmp005_rw', password);
      await createLogin(c, 'sf_m02rls_peer', 'sf_cmp048_rw', password);
    });
    p004 = runtimePool('sf_m02rls_004', password);
    p005 = runtimePool('sf_m02rls_005', password);
    peer = runtimePool('sf_m02rls_peer', password);
  }, 120_000);

  afterAll(async () => {
    await Promise.all([p004.end(), p005.end(), peer.end()]);
    const leakage = leaks.length;
    process.env['CROSS_TENANT_LEAKAGE'] = String(leakage);
    mkdirSync('test-results/m02-int', { recursive: true });
    writeFileSync(
      'test-results/m02-int/cross-tenant.json',
      JSON.stringify(
        {
          CROSS_TENANT_LEAKAGE: leakage,
          leaks,
          commit_sha: process.env['M02_COMMIT_SHA'] ?? '',
        },
        null,
        2,
      ) + '\n',
    );
  });

  it('runtime identities are non-owner, not SUPERUSER, no BYPASSRLS', async () => {
    for (const [pool, expected] of [
      [p004, 'sf_m02rls_004'],
      [p005, 'sf_m02rls_005'],
    ] as const) {
      const client = await pool.connect();
      try {
        const id = await client.query<{
          rolsuper: boolean;
          rolbypassrls: boolean;
          session_user: string;
        }>(
          `SELECT r.rolsuper, r.rolbypassrls, session_user
             FROM pg_roles r WHERE r.rolname = session_user`,
        );
        expect(id.rows[0]?.rolsuper, expected).toBe(false);
        expect(id.rows[0]?.rolbypassrls, expected).toBe(false);
        expect(id.rows[0]?.session_user).toBe(expected);
        const member = await client.query<{ ok: boolean }>(
          "SELECT pg_has_role(session_user, 'sf_app', 'MEMBER') AS ok",
        );
        expect(member.rows[0]?.ok).toBe(true);
      } finally {
        client.release();
      }
    }

    const owners004 = await asTenant(p004, T1, OFFICER_T1, async (c) => {
      const r = await c.query<{ ok: boolean }>(
        `SELECT bool_or(pg_has_role(session_user, relowner, 'MEMBER')) AS ok
           FROM pg_class cl
           JOIN pg_namespace n ON n.oid = cl.relnamespace
          WHERE n.nspname = 'sf_identity' AND cl.relkind = 'r'`,
      );
      return r.rows[0]?.ok;
    });
    expect(owners004).toBe(false);

    const owners005 = await asTenant(p005, T1, OFFICER_T1, async (c) => {
      const r = await c.query<{ ok: boolean }>(
        `SELECT bool_or(pg_has_role(session_user, relowner, 'MEMBER')) AS ok
           FROM pg_class cl
           JOIN pg_namespace n ON n.oid = cl.relnamespace
          WHERE n.nspname = 'sf_citizen_profile' AND cl.relkind = 'r'`,
      );
      return r.rows[0]?.ok;
    });
    expect(owners005).toBe(false);
  });

  it('tenant-scoped M02 tables hide T1 rows from T2 LOGIN sessions', async () => {
    const officerId = randomUUID();
    await asTenant(p004, T1, officerId, async (c) => {
      await c.query(
        `INSERT INTO sf_identity.officer_principal (tenant_id, officer_id, idp_subject_hash, status)
         VALUES ($1,$2,$3,'ACTIVE')
         ON CONFLICT (tenant_id, officer_id) DO NOTHING`,
        [T1, officerId, 'aa'.repeat(32)],
      );
    });
    const seenT2 = await asTenant(p004, T2, officerId, async (c) => {
      const r = await c.query(
        `SELECT officer_id FROM sf_identity.officer_principal WHERE officer_id = $1 AND tenant_id = $2`,
        [officerId, T1],
      );
      return r.rowCount ?? 0;
    });
    if (seenT2 > 0) leaks.push('CMP-004 officer_principal');

    const profileId = randomUUID();
    await asTenant(p005, T1, officerId, async (c) => {
      await c.query(
        `INSERT INTO sf_citizen_profile.citizen_profile (
           tenant_id, profile_id, subject_id, status, created_by
         ) VALUES ($1,$2,$3,'ACTIVE',$4)`,
        [T1, profileId, randomUUID(), officerId],
      );
    });
    const profileT2 = await asTenant(p005, T2, officerId, async (c) => {
      const r = await c.query(
        `SELECT profile_id FROM sf_citizen_profile.citizen_profile WHERE profile_id = $1`,
        [profileId],
      );
      return r.rowCount ?? 0;
    });
    if (profileT2 > 0) leaks.push('CMP-005 citizen_profile');
    const payload = JSON.stringify({ profileId, canary: CANARY, seenT2, profileT2 });
    if (profileT2 > 0 && payload.includes(CANARY)) leaks.push('CMP-005 canary');

    expect(leaks).toEqual([]);
    expect(leaks.length).toBe(0);
  });

  it('privilege boundaries: peer cannot DML; SET ROLE denied; wrong-tenant INSERT is 42501 in a fresh tx', async () => {
    await expect(
      asTenant(peer, T1, ACTOR, async (c) => {
        await c.query('SELECT * FROM sf_identity.officer_principal');
      }),
    ).rejects.toBeTruthy();

    await expect(
      asTenant(peer, T1, ACTOR, async (c) => {
        await c.query('SELECT * FROM sf_citizen_profile.citizen_profile');
      }),
    ).rejects.toBeTruthy();

    await expect(
      asTenant(p004, T1, OFFICER_T1, async (c) => {
        await c.query('SELECT * FROM sf_citizen_profile.citizen_profile');
      }),
    ).rejects.toBeTruthy();

    await expect(
      asTenant(p005, T1, OFFICER_T1, async (c) => {
        await c.query('SELECT * FROM sf_identity.officer_principal');
      }),
    ).rejects.toBeTruthy();

    await expect(
      asTenant(p004, T1, OFFICER_T1, async (c) => {
        await c.query('SET ROLE sf_cmp048_rw');
      }),
    ).rejects.toBeTruthy();

    await expect(
      asTenant(p004, T1, OFFICER_T1, async (c) => {
        await c.query(
          `INSERT INTO sf_identity.officer_principal (tenant_id, officer_id, idp_subject_hash, status)
           VALUES ($1,$2,$3,'ACTIVE')`,
          [T2, randomUUID(), 'bb'.repeat(32)],
        );
      }),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      asTenant(p005, T1, OFFICER_T1, async (c) => {
        await c.query(
          `INSERT INTO sf_citizen_profile.citizen_profile (
             tenant_id, profile_id, subject_id, status, created_by
           ) VALUES ($1,$2,$3,'ACTIVE',$4)`,
          [T2, randomUUID(), randomUUID(), OFFICER_T1],
        );
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
