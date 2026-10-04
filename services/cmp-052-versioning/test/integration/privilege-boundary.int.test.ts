import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTOR, asTenant, closeHarness, setupHarness, T1, type Harness } from './helpers.js';
import { validPins } from '../fixtures/pins.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-052 privilege boundary (ADR-0006)', () => {
  it('runtime is non-superuser sf_app member and not table owner', async () => {
    const client = await h.rt.connect();
    try {
      const id = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = session_user`,
      );
      expect(id.rows[0]?.rolsuper).toBe(false);
      expect(id.rows[0]?.rolbypassrls).toBe(false);
      const owners = await client.query<{ ok: boolean }>(
        `SELECT bool_or(pg_has_role(session_user, relowner, 'MEMBER')) AS ok
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_versioning' AND c.relkind = 'r'`,
      );
      expect(owners.rows[0]?.ok).toBe(false);
    } finally {
      client.release();
    }
  });

  it('peer privilege role cannot DML into sf_versioning', async () => {
    await expect(
      asTenant(h.other, T1, ACTOR, async (c) => {
        await c.query(
          `INSERT INTO sf_versioning.tenant_service_binding (
             binding_id, tenant_id, cell_id, binding_key, offering_ref, metadata_bundle_ref,
             pins, dependency_graph, artifact_hash, status, created_by
           ) VALUES ($1,$2,'cell-01','peer.key','off','bun','{}'::jsonb,'[]'::jsonb,$3,'DRAFT',$4)`,
          ['dddddddd-dddd-4ddd-8ddd-dddddddddddd', T1, `sha256:${'ab'.repeat(32)}`, ACTOR],
        );
      }),
    ).rejects.toThrow();
    void validPins;
  });
});
