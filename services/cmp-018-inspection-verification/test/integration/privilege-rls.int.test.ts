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

const ASSIGN = [uuid(11), uuid(31)];

async function insertInspection(
  c: PgClient,
  tenant: string,
  inspectionId: string,
  node = 'SITE_VISIT',
) {
  await c.query(
    `INSERT INTO sf_inspection.inspection (tenant_id, inspection_id, application_id, workflow_node_id, cell_id,
       inspection_state, role_code, organisation_id, jurisdiction_id, created_by, correlation_id)
     VALUES ($1,$2,$3,$4,'cell-01','REQUESTED','INSPECTION_OFFICER',$5,$6,$7,$8)`,
    [tenant, inspectionId, randomUUID(), node, ...ASSIGN, uuid(104), randomUUID()],
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
  it('own-tenant DML succeeds; cross-tenant read/update see nothing; cross-tenant insert fails', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await asTenant(h.rt, TENANT_A, (c) => insertInspection(c, TENANT_A, a));
    await asTenant(h.rt, TENANT_B, (c) => insertInspection(c, TENANT_B, b));

    const seenByB = await asTenant(h.rt, TENANT_B, (c) =>
      c.query('SELECT inspection_id FROM sf_inspection.inspection'),
    );
    expect(seenByB.rows.map((r) => r['inspection_id'])).toEqual([b]);

    const upd = await asTenant(h.rt, TENANT_B, (c) =>
      c.query(
        `UPDATE sf_inspection.inspection SET inspection_state = 'SCHEDULED', window_start = now(),
           aggregate_version = 2 WHERE inspection_id = $1`,
        [a],
      ),
    );
    expect(upd.rowCount).toBe(0);

    expect(
      await sqlState(
        asTenant(h.rt, TENANT_B, (c) => insertInspection(c, TENANT_A, randomUUID(), 'OTHER')),
      ),
    ).toBe('42501');

    const noTenant = await asTenant(h.rt, null, (c) =>
      c.query('SELECT 1 FROM sf_inspection.inspection'),
    );
    expect(noTenant.rows).toHaveLength(0);
  });
});

describe('component privilege boundary (ADR-0006)', () => {
  it('another component login cannot DML CMP-018 tables', async () => {
    const t = randomUUID();
    await asTenant(h.rt, TENANT_A, (c) => insertInspection(c, TENANT_A, t, 'XCOMP'));
    const statements = [
      'SELECT * FROM sf_inspection.inspection',
      'SELECT * FROM sf_inspection.inspection_history',
      'DELETE FROM sf_inspection.inspection',
    ];
    for (const sql of statements) {
      expect(await sqlState(asTenant(h.other, TENANT_A, (c) => c.query(sql))), sql).toBe('42501');
    }
  });

  it('runtime login is not superuser, not BYPASSRLS, owns no objects', async () => {
    expect(
      await sqlState(asTenant(h.rt, TENANT_A, (c) => c.query('SET LOCAL ROLE sf_cmp048_rw'))),
    ).toBe('42501');
    const me = await h.rt.query(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`,
    );
    expect(me.rows[0]).toMatchObject({ rolbypassrls: false, rolsuper: false });
    const owner = await h.admin.query(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_inspection' AND pg_get_userbyid(c.relowner) = 'sf_t018_rt'`,
    );
    expect(owner.rows[0]?.['n']).toBe(0);
    expect(await sqlState(h.rt.query('CREATE TABLE sf_inspection.rogue (x int)'))).toBe('42501');
    expect(
      await sqlState(h.rt.query('ALTER TABLE sf_inspection.inspection DISABLE ROW LEVEL SECURITY')),
    ).toBe('42501');
  });

  it('CMP-018 login gains nothing beyond sf_app on other component tables', async () => {
    const diffs: string[] = [];
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const r = await h.admin.query(
        `SELECT n.nspname || '.' || c.relname AS tbl
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname LIKE 'sf\\_%' AND n.nspname NOT IN ('sf_inspection', 'sf_platform')
            AND c.relkind IN ('r', 'p')
            AND has_table_privilege('sf_t018_rt', c.oid, $1) AND NOT has_table_privilege('sf_app', c.oid, $1)`,
        [priv],
      );
      diffs.push(...r.rows.map((x) => `${priv} ${String(x['tbl'])}`));
    }
    expect(diffs).toEqual([]);
  });
});

describe('database-enforced inspection invariants', () => {
  it('refuses statutory_effect true, illegal transitions, and identity edits', async () => {
    const t = randomUUID();
    await asTenant(h.rt, TENANT_A, (c) => insertInspection(c, TENANT_A, t, 'INV'));
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query(
            `UPDATE sf_inspection.inspection SET statutory_effect = true, aggregate_version = 2 WHERE inspection_id = $1`,
            [t],
          ),
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query(
            `UPDATE sf_inspection.inspection SET inspection_state = 'COMPLETED', verification_result = 'VERIFIED',
               claimed_principal_id = $2, aggregate_version = 2 WHERE inspection_id = $1`,
            [t, uuid(101)],
          ),
        ),
      ),
    ).toBe('P0001');
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query('DELETE FROM sf_inspection.inspection WHERE inspection_id = $1', [t]),
        ),
      ),
    ).toBe('42501');
  });

  it('history is append-only', async () => {
    const t = randomUUID();
    await asTenant(h.rt, TENANT_A, async (c) => {
      await insertInspection(c, TENANT_A, t, 'HIST');
      await c.query(
        `INSERT INTO sf_inspection.inspection_history (tenant_id, history_id, inspection_id, seq, operation, to_state,
           actor_type, actor_id, role_code, organisation_id, jurisdiction_id, authz_decision_id,
           policy_revision, idempotency_key, correlation_id)
         VALUES ($1,$2,$3,1,'CREATE','REQUESTED','SYSTEM',$4,'INSPECTION_OFFICER',$5,$6,$7,'rev-1','history-key-1',$8)`,
        [TENANT_A, randomUUID(), t, uuid(104), ...ASSIGN, randomUUID(), randomUUID()],
      );
    });
    expect(
      await sqlState(
        asTenant(h.rt, TENANT_A, (c) =>
          c.query(
            `UPDATE sf_inspection.inspection_history SET policy_revision = 'x' WHERE inspection_id = $1`,
            [t],
          ),
        ),
      ),
    ).toBe('42501');
  });
});
