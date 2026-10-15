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

describe('CMP-058 privilege boundary (ADR-0006 / INT-011)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 180_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('sf_cmp058_rw is NOLOGIN NOSUPERUSER NOBYPASSRLS; tables owned by sf_migrator', async () => {
    await asTenant(h.admin, null, ACTOR_OFFICER, async (c) => {
      const role = await c.query<{
        rolcanlogin: boolean;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(`SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'sf_cmp058_rw'`);
      expect(role.rows[0]?.rolcanlogin).toBe(false);
      expect(role.rows[0]?.rolsuper).toBe(false);
      expect(role.rows[0]?.rolbypassrls).toBe(false);

      const owner = await c.query<{ owner: string }>(
        `SELECT pg_get_userbyid(c.relowner) AS owner
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_semantics' AND c.relname = 'semantic_element'`,
      );
      expect(owner.rows[0]?.owner).toBe('sf_migrator');
    });
  });

  it('own-component DML succeeds; peer-component login is denied', async () => {
    const elementId = randomUUID();
    await asTenant(h.rt, null, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_semantics.semantic_element (
           element_id, version, element_code, lifecycle_status, privacy_classification,
           idempotency_key, correlation_id
         ) VALUES ($1, 1, 'semantic.priv.ref', 'DRAFT', 'PUBLIC', 'idem-priv-0001', $2)`,
        [elementId, randomUUID()],
      );
    });

    await expect(
      asTenant(h.other, null, ACTOR_OFFICER, async (c) => {
        await c.query(
          `INSERT INTO sf_semantics.semantic_element (
             element_id, version, element_code, lifecycle_status, privacy_classification,
             idempotency_key, correlation_id
           ) VALUES ($1, 1, 'semantic.peer.ref', 'DRAFT', 'PUBLIC', 'idem-peer-0001', $2)`,
          [randomUUID(), randomUUID()],
        );
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('FORCE RLS on field_binding: wrong-tenant returns zero rows', async () => {
    const elementId = randomUUID();
    const bindingId = randomUUID();
    await asTenant(h.rt, null, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_semantics.semantic_element (
           element_id, version, element_code, lifecycle_status, privacy_classification,
           idempotency_key, correlation_id, published_at
         ) VALUES ($1, 1, 'semantic.rls.ref', 'PUBLISHED', 'PII', 'idem-rls-el01', $2, now())`,
        [elementId, randomUUID()],
      );
    });
    await asTenant(h.rt, T2, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_semantics.field_binding (
           tenant_id, binding_id, offering_id, field_path, element_id, element_version,
           idempotency_key, correlation_id
         ) VALUES ($1, $2, $3, $4, $5, 1, 'idem-rls-b001', $6)`,
        [T2, bindingId, randomUUID(), CANARY, elementId, randomUUID()],
      );
    });

    await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      const leaked = await c.query(
        `SELECT field_path FROM sf_semantics.field_binding WHERE tenant_id = $1`,
        [T2],
      );
      expect(leaked.rowCount).toBe(0);
      expect(JSON.stringify(leaked.rows)).not.toContain(CANARY);
    });
  });

  it('published semantic element payload fields are immutable', async () => {
    const elementId = randomUUID();
    await asTenant(h.rt, null, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_semantics.semantic_element (
           element_id, version, element_code, lifecycle_status, privacy_classification,
           idempotency_key, correlation_id, published_at
         ) VALUES ($1, 1, 'semantic.imm.ref', 'PUBLISHED', 'PUBLIC', 'idem-imm-0001', $2, now())`,
        [elementId, randomUUID()],
      );
      await expect(
        c.query(
          `UPDATE sf_semantics.semantic_element
              SET element_code = 'semantic.mutated.ref'
            WHERE element_id = $1 AND version = 1`,
          [elementId],
        ),
      ).rejects.toMatchObject({ code: '23001' });
    });
  });

  it('runtime login cannot SET ROLE peer rw and has no BYPASSRLS', async () => {
    const client = await h.rt.connect();
    try {
      await expect(client.query('SET ROLE sf_cmp059_rw')).rejects.toBeTruthy();
      const bypass = await client.query<{ v: boolean }>(
        `SELECT rolbypassrls AS v FROM pg_roles WHERE rolname = current_user`,
      );
      expect(bypass.rows[0]?.v).toBe(false);
    } finally {
      client.release();
    }
  });
});
