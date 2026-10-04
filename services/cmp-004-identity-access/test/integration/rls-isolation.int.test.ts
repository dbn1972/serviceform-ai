import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacHex } from '../../src/hashing.js';
import { mintSimulatedIdpAssertion } from '../../src/adapters/idp.js';
import {
  ACTOR_OFFICER,
  asTenant,
  CANARY,
  closeHarness,
  PEPPER,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

let h: Harness;
let leakage = 0;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('INT-011 CMP-004 tenant isolation', () => {
  it('FORCE RLS on tenant-owned officer tables; CROSS_TENANT_LEAKAGE=0', async () => {
    const forced = await h.admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_identity' AND c.relkind = 'r'
          AND c.relname IN ('officer_principal','officer_session','idempotency_record','inbox_event','outbox_event')`,
    );
    expect(forced.rows.length).toBe(5);
    for (const r of forced.rows) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.relforcerowsecurity, r.relname).toBe(true);
    }

    const hash1 = hmacHex(PEPPER, 'idp:t1');
    const hash2 = hmacHex(PEPPER, `idp:${CANARY}`);
    await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_identity.officer_principal (tenant_id, officer_id, idp_subject_hash, status)
         VALUES ($1,$2,$3,'ACTIVE')`,
        [T1, ACTOR_OFFICER, hash1],
      );
    });
    await asTenant(h.rt, T2, ACTOR_OFFICER, async (c) => {
      await c.query(
        `INSERT INTO sf_identity.officer_principal (tenant_id, officer_id, idp_subject_hash, status)
         VALUES ($1,$2,$3,'ACTIVE')`,
        [T2, ACTOR_OFFICER, hash2],
      );
    });

    const seen = await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      return (
        await c.query<{ idp_subject_hash: string }>(
          'SELECT idp_subject_hash FROM sf_identity.officer_principal',
        )
      ).rows;
    });
    const payload = JSON.stringify(seen);
    if (payload.includes(CANARY) || payload.includes(hash2)) leakage += 1;
    expect(seen.every((r) => r.idp_subject_hash === hash1)).toBe(true);

    const otherCount = await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      return (
        await c.query(
          `SELECT count(*)::int AS n FROM sf_identity.officer_principal WHERE tenant_id = $1`,
          [T2],
        )
      ).rows[0]?.n;
    });
    if (Number(otherCount) !== 0) leakage += 1;
    expect(Number(otherCount)).toBe(0);

    await expect(
      asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
        await c.query(
          `INSERT INTO sf_identity.officer_principal (tenant_id, officer_id, idp_subject_hash, status)
           VALUES ($1,$2,$3,'ACTIVE')`,
          [T2, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', hmacHex(PEPPER, 'x')],
        );
      }),
    ).rejects.toBeTruthy();

    expect(leakage, 'CROSS_TENANT_LEAKAGE').toBe(0);
  });

  it('wrong-component login cannot SELECT/INSERT identity tables', async () => {
    await expect(
      asTenant(h.other, T1, ACTOR_OFFICER, async (c) => {
        await c.query('SELECT * FROM sf_identity.officer_principal');
      }),
    ).rejects.toBeTruthy();
    const bypass = await h.admin.query<{ rolbypassrls: boolean }>(
      "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'sf_t004_rt'",
    );
    expect(bypass.rows[0]?.rolbypassrls).toBe(false);
  });

  it('simulated IdP assertion encodes tenant from IdP not from the client', () => {
    const assertion = mintSimulatedIdpAssertion(PEPPER, {
      sub: 's',
      tenant_id: T2,
      officer_id: ACTOR_OFFICER,
      roles: ['SERVICE_CHECKER'],
    });
    expect(assertion.startsWith('simidp.')).toBe(true);
    expect(assertion).not.toContain('x-tenant-id');
  });
});
