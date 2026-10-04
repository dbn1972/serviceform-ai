import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTOR, asTenant, closeHarness, setupHarness, T1, type Harness } from './helpers.js';

let h: Harness;
const HASH = `sha256:${'ab'.repeat(32)}`;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

function insertPolicy(c: PoolClient, id = randomUUID()) {
  return c.query(
    `INSERT INTO sf_evidence.evidence_policy (policy_id, tenant_id, cell_id, policy_key, status, definition, content_hash, created_by)
     VALUES ($1,$2,'cell-01','priv.key','DRAFT','{}'::jsonb,$3,$4)`,
    [id, T1, HASH, ACTOR],
  );
}

describe('CMP-011 privilege boundary (ADR-0006)', () => {
  it('runtime login is non-superuser, non-BYPASSRLS and owns no sf_evidence table', async () => {
    const client = await h.rt.connect();
    try {
      const id = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = session_user`,
      );
      expect(id.rows[0]?.rolsuper).toBe(false);
      expect(id.rows[0]?.rolbypassrls).toBe(false);
      const owners = await client.query<{ ok: boolean }>(
        `SELECT bool_or(pg_has_role(session_user, relowner, 'MEMBER')) AS ok
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_evidence' AND c.relkind = 'r'`,
      );
      expect(owners.rows[0]?.ok).toBe(false);
    } finally {
      client.release();
    }
  });

  it('runtime cannot weaken RLS or alter tables it does not own', async () => {
    for (const ddl of [
      'ALTER TABLE sf_evidence.evidence_policy DISABLE ROW LEVEL SECURITY',
      'ALTER TABLE sf_evidence.evidence_policy NO FORCE ROW LEVEL SECURITY',
      'DROP TABLE sf_evidence.evidence_resolution',
      'TRUNCATE sf_evidence.evidence_policy',
    ]) {
      await expect(
        asTenant(h.rt, T1, ACTOR, (c) => c.query(ddl)),
        ddl,
      ).rejects.toThrow();
    }
  });

  it('peer privilege role cannot DML into sf_evidence', async () => {
    await expect(asTenant(h.other, T1, ACTOR, (c) => insertPolicy(c))).rejects.toThrow();
    await expect(
      asTenant(h.other, T1, ACTOR, (c) => c.query('SELECT 1 FROM sf_evidence.evidence_policy')),
    ).rejects.toThrow();
  });

  it('runtime cannot DELETE policies or resolutions, or re-home rows by updating tenant_id', async () => {
    const id = randomUUID();
    await asTenant(h.rt, T1, ACTOR, (c) => insertPolicy(c, id));
    await expect(
      asTenant(h.rt, T1, ACTOR, (c) =>
        c.query('DELETE FROM sf_evidence.evidence_policy WHERE policy_id = $1', [id]),
      ),
    ).rejects.toThrow();
    await expect(
      asTenant(h.rt, T1, ACTOR, (c) =>
        c.query(`UPDATE sf_evidence.evidence_policy SET tenant_id = $2 WHERE policy_id = $1`, [
          id,
          randomUUID(),
        ]),
      ),
    ).rejects.toThrow();
    await expect(
      asTenant(h.rt, T1, ACTOR, (c) => c.query('DELETE FROM sf_evidence.evidence_resolution')),
    ).rejects.toThrow();
  });
});
