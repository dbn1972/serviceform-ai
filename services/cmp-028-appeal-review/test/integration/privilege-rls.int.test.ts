import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  closeHarness,
  pgCode,
  setupHarness,
  type Harness,
  type PgClient,
} from './helpers.js';
import { TENANT_A, TENANT_B, uuid } from '../doubles/fixtures.js';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => closeHarness(h));

async function insertAppeal(c: PgClient, tenant: string, appealId: string) {
  await c.query(
    `INSERT INTO sf_appeal.appeal (
       tenant_id, appeal_id, original_application_id, cell_id, appeal_state, grounds_code,
       admissibility_code, role_code, organisation_id, jurisdiction_id, created_by, correlation_id
     ) VALUES ($1,$2,$3,'cell-01','FILED','PROCEDURAL_ERROR','PENDING','APPELLATE_AUTHORITY',$4,$5,$6,$7)`,
    [tenant, appealId, randomUUID(), uuid(11), uuid(31), uuid(104), randomUUID()],
  );
}

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    return pgCode(err);
  }
  return undefined;
}

describe('tenant isolation (FORCE RLS)', () => {
  it('own-tenant DML succeeds; cross-tenant is invisible; insert as other tenant fails', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await asTenant(h.rt, TENANT_A, (c) => insertAppeal(c, TENANT_A, a));
    await asTenant(h.rt, TENANT_B, (c) => insertAppeal(c, TENANT_B, b));
    const seenByB = await asTenant(h.rt, TENANT_B, (c) =>
      c.query('SELECT appeal_id FROM sf_appeal.appeal'),
    );
    expect(seenByB.rows.map((r) => r['appeal_id'])).toEqual([b]);
    const upd = await asTenant(h.rt, TENANT_B, (c) =>
      c.query(`UPDATE sf_appeal.appeal SET appeal_state = 'WITHDRAWN' WHERE appeal_id = $1`, [a]),
    );
    expect(upd.rowCount).toBe(0);
    expect(
      await sqlState(asTenant(h.rt, TENANT_B, (c) => insertAppeal(c, TENANT_A, randomUUID()))),
    ).toBe('42501');
    const noTenant = await asTenant(h.rt, null, (c) => c.query('SELECT 1 FROM sf_appeal.appeal'));
    expect(noTenant.rows).toHaveLength(0);
  });
});

describe('component privilege boundary (ADR-0006)', () => {
  it('another component login cannot DML CMP-028 tables', async () => {
    const t = randomUUID();
    await asTenant(h.rt, TENANT_A, (c) => insertAppeal(c, TENANT_A, t));
    for (const sql of [
      'SELECT * FROM sf_appeal.appeal',
      'SELECT * FROM sf_appeal.appeal_history',
      'DELETE FROM sf_appeal.appeal',
    ]) {
      expect(await sqlState(asTenant(h.other, TENANT_A, (c) => c.query(sql))), sql).toBe('42501');
    }
  });

  it('CMP-028 login gains nothing beyond sf_app on other component tables', async () => {
    const diffs: string[] = [];
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      const r = await h.admin.query(
        `SELECT n.nspname || '.' || c.relname AS tbl
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname LIKE 'sf\\_%' AND n.nspname NOT IN ('sf_appeal', 'sf_platform') AND c.relkind IN ('r', 'p')
            AND has_table_privilege('sf_t028_rt', c.oid, $1) AND NOT has_table_privilege('sf_app', c.oid, $1)`,
        [priv],
      );
      diffs.push(...r.rows.map((x) => `${priv} ${String(x['tbl'])}`));
    }
    expect(diffs).toEqual([]);
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query(`UPDATE sf_application_case.application_case SET state = 'APPROVED'`),
        ),
      ),
    ).toBe('42501');
  });

  it('no SET ROLE into peer rw; no BYPASSRLS; not owner', async () => {
    expect(
      await sqlState(asTenant(h.rt, TENANT_A, (c) => c.query('SET LOCAL ROLE sf_cmp048_rw'))),
    ).toBe('42501');
    const me = await h.rt.query(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`,
    );
    expect(me.rows[0]).toMatchObject({ rolbypassrls: false, rolsuper: false });
    const owner = await h.admin.query(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_appeal' AND pg_get_userbyid(c.relowner) = 'sf_t028_rt'`,
    );
    expect(owner.rows[0]?.['n']).toBe(0);
    expect(await sqlState(h.rt.query('CREATE TABLE sf_appeal.rogue (x int)'))).toBe('42501');
    expect(
      await sqlState(h.rt.query('ALTER TABLE sf_appeal.appeal DISABLE ROW LEVEL SECURITY')),
    ).toBe('42501');
  });
});

describe('database-enforced appeal invariants', () => {
  it('terminal appeals are immutable; history is insert-only; no named_officer column', async () => {
    const t = randomUUID();
    await asTenant(h.rt, TENANT_A, (c) => insertAppeal(c, TENANT_A, t));
    await asTenant(h.rt, TENANT_A, (c) =>
      c.query(
        `UPDATE sf_appeal.appeal SET appeal_state = 'WITHDRAWN', aggregate_version = 2 WHERE appeal_id = $1`,
        [t],
      ),
    );
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query(
            `UPDATE sf_appeal.appeal SET appeal_state = 'FILED', aggregate_version = 3 WHERE appeal_id = $1`,
            [t],
          ),
        ),
      ),
    ).toBe('P0001');
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query('DELETE FROM sf_appeal.appeal WHERE appeal_id = $1', [t]),
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query(`INSERT INTO sf_appeal.appeal (tenant_id, named_officer) VALUES ($1, 'x')`, [
            TENANT_A,
          ]),
        ),
      ),
    ).toBe('42703');
  });
});
