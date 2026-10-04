import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTOR, asTenant, closeHarness, setupHarness, T1, type Harness } from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-033 privilege boundary (ADR-0006)', () => {
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
          WHERE n.nspname = 'sf_metadata' AND c.relkind = 'r'`,
      );
      expect(owners.rows[0]?.ok).toBe(false);
    } finally {
      client.release();
    }
  });

  it('peer privilege role cannot DML into sf_metadata', async () => {
    await expect(
      asTenant(h.other, T1, ACTOR, async (c) => {
        await c.query(
          `INSERT INTO sf_metadata.metadata_document (
             document_id, tenant_id, cell_id, document_key, kind, schema_id, payload, payload_hash,
             status, created_by
           ) VALUES ($1,$2,'cell-01','peer.key','SERVICE','sf.metadata.kind.service.v1','{}'::jsonb,
             $4,'DRAFT',$3)`,
          [
            'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            T1,
            ACTOR,
            `sha256:${'ab'.repeat(32)}`,
          ],
        );
      }),
    ).rejects.toThrow();
  });
});
