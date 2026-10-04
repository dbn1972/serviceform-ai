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

describe('CMP-001 privilege boundary (ADR-0006) / INT-011', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('own-component DML succeeds; peer-component login is denied', async () => {
    const categoryId = randomUUID();
    await asTenant(h.rt, null, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_catalogue.category (
           category_id, category_code, display_label, status, created_by
         ) VALUES ($1,'FAMILY_A','Family A','ACTIVE',$2)`,
        [categoryId, ACTOR_OFFICER],
      );
    });

    await expect(
      asTenant(h.other, null, ACTOR_OFFICER, async (c) => {
        await c.query(
          `INSERT INTO sf_catalogue.category (
             category_id, category_code, display_label, status, created_by
           ) VALUES ($1,'FAMILY_B','Family B','ACTIVE',$2)`,
          [randomUUID(), ACTOR_OFFICER],
        );
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('wrong-tenant RLS returns zero rows and CROSS_TENANT_LEAKAGE=0', async () => {
    const categoryId = randomUUID();
    const serviceId = randomUUID();
    const offeringId = randomUUID();
    await asTenant(h.rt, null, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_catalogue.category (
           category_id, category_code, display_label, status, created_by
         ) VALUES ($1,'FAMILY_X','Family X','ACTIVE',$2)
         ON CONFLICT (category_code) DO NOTHING`,
        [categoryId, ACTOR_OFFICER],
      );
      const cat = await c.query<{ category_id: string }>(
        `SELECT category_id FROM sf_catalogue.category WHERE category_code = 'FAMILY_X'`,
      );
      const cid = cat.rows[0]?.category_id ?? categoryId;
      await c.query(
        `INSERT INTO sf_catalogue.canonical_service (
           canonical_service_id, service_code, category_id, status, created_by
         ) VALUES ($1,'svc-x',$2,'DRAFT',$3)
         ON CONFLICT (service_code) DO NOTHING`,
        [serviceId, cid, ACTOR_OFFICER],
      );
    });
    const svc = await asTenant(h.rt, null, ACTOR_OFFICER, async (c) => {
      const r = await c.query<{ canonical_service_id: string }>(
        `SELECT canonical_service_id FROM sf_catalogue.canonical_service WHERE service_code = 'svc-x'`,
      );
      const row = r.rows[0];
      if (!row) throw new Error('canonical missing');
      return row.canonical_service_id;
    });
    await asTenant(h.rt, T2, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_catalogue.offering (
           tenant_id, offering_id, canonical_service_id, offering_code, created_by
         ) VALUES ($1,$2,$3,'off-x',$4)`,
        [T2, offeringId, svc, ACTOR_OFFICER],
      );
      await c.query(
        `INSERT INTO sf_catalogue.offering_version (
           tenant_id, offering_id, version_no, local_name, status, tags, valid_from, created_by
         ) VALUES ($1,$2,1,$3,'DRAFT','{}',$4,$5)`,
        [T2, offeringId, CANARY, new Date().toISOString(), ACTOR_OFFICER],
      );
    });

    await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      const leaked = await c.query(
        `SELECT local_name FROM sf_catalogue.offering_version WHERE tenant_id = $1`,
        [T2],
      );
      expect(leaked.rowCount).toBe(0);
      expect(JSON.stringify(leaked.rows)).not.toContain(CANARY);
      const any = await c.query(`SELECT local_name FROM sf_catalogue.offering_version`);
      expect(JSON.stringify(any.rows)).not.toContain(CANARY);
    });
  });

  it('runtime login is not table owner, cannot SET ROLE peer rw, BYPASSRLS false', async () => {
    const client = await h.rt.connect();
    try {
      const owner = await client.query<{ ok: boolean }>(
        `SELECT pg_has_role(session_user, (
           SELECT relowner FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'sf_catalogue' AND c.relname = 'offering'
         ), 'MEMBER') AS ok`,
      );
      expect(owner.rows[0]?.ok).toBe(false);
      await expect(client.query('SET ROLE sf_cmp048_rw')).rejects.toBeTruthy();
      const bypass = await client.query<{ rolbypassrls: boolean }>(
        `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      expect(bypass.rows[0]?.rolbypassrls).toBe(false);
    } finally {
      client.release();
    }
  });

  it('refuses mutation of insert-only offering versions and unpublished pin without marker', async () => {
    const categoryId = randomUUID();
    const serviceId = randomUUID();
    const offeringId = randomUUID();
    await asTenant(h.rt, null, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_catalogue.category (
           category_id, category_code, display_label, status, created_by
         ) VALUES ($1,'FAMILY_Y','Family Y','ACTIVE',$2)`,
        [categoryId, ACTOR_OFFICER],
      );
      await c.query(
        `INSERT INTO sf_catalogue.canonical_service (
           canonical_service_id, service_code, category_id, status, created_by
         ) VALUES ($1,'svc-y',$2,'DRAFT',$3)`,
        [serviceId, categoryId, ACTOR_OFFICER],
      );
    });
    // Transaction A: seed offering + version and COMMIT. A later 42501 must not
    // abort this work or poison the pin-guard INSERT (PostgreSQL 25P02).
    await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_catalogue.offering (
           tenant_id, offering_id, canonical_service_id, offering_code, created_by
         ) VALUES ($1,$2,$3,'off-y',$4)`,
        [T1, offeringId, serviceId, ACTOR_OFFICER],
      );
      await c.query(
        `INSERT INTO sf_catalogue.offering_version (
           tenant_id, offering_id, version_no, local_name, status, tags, valid_from, created_by
         ) VALUES ($1,$2,1,'Name','DRAFT','{}',now(),$3)`,
        [T1, offeringId, ACTOR_OFFICER],
      );
    });

    // Transaction B: immutable UPDATE is rejected; this transaction rolls back.
    await expect(
      asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
        await c.query(`UPDATE sf_catalogue.offering_version SET local_name = 'mutated'`);
      }),
    ).rejects.toMatchObject({ code: '42501' });

    // Transaction C: unpublished pin INSERT without privileged marker; independent 42501.
    await expect(
      asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
        await c.query(
          `INSERT INTO sf_catalogue.offering_version (
             tenant_id, offering_id, version_no, local_name, status, tags, published_pin_ref, valid_from, created_by
           ) VALUES ($1,$2,2,'Name','DRAFT','{}','pin-1',now(),$3)`,
          [T1, offeringId, ACTOR_OFFICER],
        );
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
