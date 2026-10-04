import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHECKER, asTenant, closeHarness, setupHarness, T1, type Harness } from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-051 privilege boundary (ADR-0006)', () => {
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
      const member = await client.query<{ ok: boolean }>(
        "SELECT pg_has_role(session_user, 'sf_app', 'MEMBER') AS ok",
      );
      expect(member.rows[0]?.ok).toBe(true);
      const owners = await client.query<{ ok: boolean }>(
        `SELECT bool_or(pg_has_role(session_user, relowner, 'MEMBER')) AS ok
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_maker_checker' AND c.relkind = 'r'`,
      );
      expect(owners.rows[0]?.ok).toBe(false);
    } finally {
      client.release();
    }
  });

  it('peer privilege role cannot DML into sf_maker_checker', async () => {
    await expect(
      asTenant(h.other, T1, CHECKER, async (c) => {
        await c.query(
          `INSERT INTO sf_maker_checker.publication_request (
             request_id, tenant_id, cell_id, subject_type, subject_id, proposed_hash, status, maker_principal_id
           ) VALUES ($1,$2,'cell-01','TENANT_SERVICE_BINDING',$3,$4,'DRAFT',$5)`,
          [
            'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            T1,
            '33333333-3333-4333-8333-333333333333',
            `sha256:${'ab'.repeat(32)}`,
            CHECKER,
          ],
        );
      }),
    ).rejects.toThrow();
  });
});
