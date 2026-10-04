import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asTenant, closeHarness, OFFICER, setupHarness, T1, type Harness } from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

const modelInsert = `INSERT INTO sf_ai_gateway.model_registry (
  model_entry_id, tenant_id, cell_id, provider_id, model_id, model_version, operations,
  max_data_classification, max_input_chars, max_output_tokens, daily_token_budget, status, registered_by
) VALUES ($1,$2,'cell-01','sim-primary','m1','v1',ARRAY['INVOKE'],'INTERNAL',100,10,1000,'ACTIVE',$3)`;

describe('CMP-039 privilege boundary (ADR-0006)', () => {
  it('runtime is a non-superuser, non-BYPASSRLS sf_app member and not a table owner', async () => {
    const client = await h.rt.connect();
    try {
      const id = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = session_user`,
      );
      expect(id.rows[0]?.rolsuper).toBe(false);
      expect(id.rows[0]?.rolbypassrls).toBe(false);
      const member = await client.query<{ ok: boolean }>(
        "SELECT pg_has_role(session_user, 'sf_app', 'MEMBER') AS ok",
      );
      expect(member.rows[0]?.ok).toBe(true);
      const owners = await client.query<{ ok: boolean }>(
        `SELECT bool_or(pg_has_role(session_user, relowner, 'MEMBER')) AS ok
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_ai_gateway' AND c.relkind = 'r'`,
      );
      expect(owners.rows[0]?.ok).toBe(false);
    } finally {
      client.release();
    }
  });

  it('peer privilege role cannot DML into sf_ai_gateway', async () => {
    await expect(
      asTenant(h.other, T1, OFFICER, async (c) => {
        await c.query(modelInsert, [randomUUID(), T1, OFFICER]);
      }),
    ).rejects.toThrow();
  });

  it('runtime cannot mutate or delete append-only audit metadata or retained registry rows', async () => {
    const id = randomUUID();
    await asTenant(h.rt, T1, OFFICER, async (c) => {
      await c.query(modelInsert, [id, T1, OFFICER]);
    });
    await expect(
      asTenant(h.rt, T1, OFFICER, async (c) => {
        await c.query(`DELETE FROM sf_ai_gateway.model_registry WHERE model_entry_id = $1`, [id]);
      }),
    ).rejects.toThrow();
    await expect(
      asTenant(h.rt, T1, OFFICER, async (c) => {
        await c.query(
          `UPDATE sf_ai_gateway.model_registry SET model_version = 'v2' WHERE model_entry_id = $1`,
          [id],
        );
      }),
    ).rejects.toThrow();
    await expect(
      asTenant(h.rt, T1, OFFICER, async (c) => {
        await c.query(`UPDATE sf_ai_gateway.ai_request_metadata SET outcome = 'COMPLETED'`);
      }),
    ).rejects.toThrow();
    await expect(
      asTenant(h.rt, T1, OFFICER, async (c) => {
        await c.query(`DELETE FROM sf_ai_gateway.ai_request_metadata`);
      }),
    ).rejects.toThrow();
  });

  it('PUBLIC has no access to the schema', async () => {
    const res = await h.admin.query<{ usage: boolean }>(
      `SELECT has_schema_privilege('public', 'sf_ai_gateway', 'USAGE') AS usage`,
    );
    expect(res.rows[0]?.usage).toBe(false);
  });
});
