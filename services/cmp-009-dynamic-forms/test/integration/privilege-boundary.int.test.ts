import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTOR, asTenant, closeHarness, setupHarness, T1, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

const HASH = `sha256:${'ab'.repeat(32)}`;

describe('CMP-009 privilege boundary (ADR-0006)', () => {
  it('runtime is not SUPERUSER, not BYPASSRLS, and not a table owner', async () => {
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
          WHERE n.nspname = 'sf_forms' AND c.relkind = 'r'`,
      );
      expect(owners.rows[0]?.ok).toBe(false);
      const ddl = await client.query<{ ok: boolean }>(
        `SELECT has_schema_privilege(session_user, 'sf_forms', 'CREATE') AS ok`,
      );
      expect(ddl.rows[0]?.ok).toBe(false);
    } finally {
      client.release();
    }
  });

  it('a peer component privilege role cannot DML into sf_forms', async () => {
    await expect(
      asTenant(h.other, T1, ACTOR, (c) =>
        c.query(
          `INSERT INTO sf_forms.form_definition_snapshot (
             snapshot_id, tenant_id, cell_id, form_key, content_hash, payload_digest, payload, created_by
           ) VALUES ($1,$2,'cell-01','peer.form',$3,$3,'{}'::jsonb,$4)`,
          [randomUUID(), T1, HASH, ACTOR],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asTenant(h.other, T1, ACTOR, (c) => c.query('SELECT * FROM sf_forms.form_execution_record')),
    ).rejects.toThrow();
  });

  it('the runtime cannot UPDATE or DELETE immutable records and cannot TRUNCATE', async () => {
    const snapshotId = randomUUID();
    await asTenant(h.rt, T1, ACTOR, (c) =>
      c.query(
        `INSERT INTO sf_forms.form_definition_snapshot (
           snapshot_id, tenant_id, cell_id, form_key, content_hash, payload_digest, payload, created_by
         ) VALUES ($1,$2,'cell-01','immut.form',$3,$3,'{}'::jsonb,$4)`,
        [snapshotId, T1, HASH, ACTOR],
      ),
    );
    await expect(
      asTenant(h.rt, T1, ACTOR, (c) =>
        c.query(
          `UPDATE sf_forms.form_definition_snapshot SET form_key = 'x.changed' WHERE snapshot_id = $1`,
          [snapshotId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asTenant(h.rt, T1, ACTOR, (c) =>
        c.query(`DELETE FROM sf_forms.form_definition_snapshot WHERE snapshot_id = $1`, [
          snapshotId,
        ]),
      ),
    ).rejects.toThrow();
    await expect(
      asTenant(h.rt, T1, ACTOR, (c) => c.query('TRUNCATE sf_forms.form_definition_snapshot')),
    ).rejects.toThrow();
  });
});
