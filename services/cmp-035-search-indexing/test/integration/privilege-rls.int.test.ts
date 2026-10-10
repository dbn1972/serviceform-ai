import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR,
  asTenant,
  closeHarness,
  CMP035_TABLES,
  documentInsert,
  setupHarness,
  T1,
  T2,
  TABLE_SQL,
  type Harness,
} from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-035 privilege boundary and FORCE RLS (INT-011)', () => {
  it('runtime login is not SUPERUSER, not BYPASSRLS, owns no table', async () => {
    const c = await h.rt.connect();
    try {
      const me = await c.query(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = session_user`,
      );
      expect(me.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
      const owners = await c.query(
        `SELECT bool_or(pg_has_role(session_user, c.relowner, 'MEMBER')) AS owns
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_search' AND c.relkind = 'r'`,
      );
      expect(owners.rows[0]?.['owns']).toBe(false);
    } finally {
      c.release();
    }
  });

  it('sf_cmp035_rw is NOLOGIN, NOSUPERUSER, NOBYPASSRLS; TENANT_SCOPED tables FORCE RLS', async () => {
    const role = await h.admin.query(
      `SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'sf_cmp035_rw'`,
    );
    expect(role.rows[0]).toEqual({ rolcanlogin: false, rolsuper: false, rolbypassrls: false });
    const rls = await h.admin.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_search' AND c.relkind = 'r' ORDER BY 1`,
    );
    const byName = Object.fromEntries(rls.rows.map((r) => [r['relname'], r]));
    for (const t of [...CMP035_TABLES, 'outbox_event', 'inbox_event']) {
      expect({
        t,
        rls: byName[t]?.['relrowsecurity'],
        force: byName[t]?.['relforcerowsecurity'],
      }).toEqual({ t, rls: true, force: true });
    }
  });

  it('own authorized DML succeeds under tenant context', async () => {
    const [sql, values] = documentInsert(T1);
    await asTenant(h.rt, T1, (c) => c.query(sql, values));
    const n = await asTenant(h.rt, T1, (c) =>
      c.query('SELECT count(*)::int AS n FROM sf_search.search_document'),
    );
    expect(Number(n.rows[0]?.['n'])).toBeGreaterThanOrEqual(1);
  });

  it('NEGATIVE: wrong-tenant rows are invisible; cross-tenant insert fails; no tenant sees nothing', async () => {
    const id = randomUUID();
    const [sql, values] = documentInsert(T1, id);
    await asTenant(h.rt, T1, (c) => c.query(sql, values));
    const asT2 = await asTenant(h.rt, T2, (c) =>
      c.query('SELECT * FROM sf_search.search_document WHERE document_id = $1', [id]),
    );
    expect(asT2.rows).toEqual([]);
    const facetProbe = await asTenant(h.rt, T2, (c) =>
      c.query(
        `SELECT count(*)::int AS n FROM sf_search.search_document WHERE facets @> '{}'::jsonb`,
      ),
    );
    expect(Number(facetProbe.rows[0]?.['n'])).toBe(0);
    const [xsql, xvalues] = documentInsert(T1);
    await expect(asTenant(h.rt, T2, (c) => c.query(xsql, xvalues))).rejects.toThrow(
      /row-level security/,
    );
    const none = await asTenant(h.rt, null, (c) =>
      c.query('SELECT count(*)::int AS n FROM sf_search.search_document'),
    );
    expect(Number(none.rows[0]?.['n'])).toBe(0);
  });

  it('NEGATIVE: wrong tenant cannot UPDATE another tenant document', async () => {
    const id = randomUUID();
    const [sql, values] = documentInsert(T1, id);
    await asTenant(h.rt, T1, (c) => c.query(sql, values));
    const res = await asTenant(h.rt, T2, (c) =>
      c.query(
        `UPDATE sf_search.search_document SET source_version = 9, revision = 2 WHERE document_id = $1`,
        [id],
      ),
    );
    expect(res.rowCount).toBe(0);
  });

  it('NEGATIVE: peer component login cannot SELECT/DELETE CMP-035 tables', async () => {
    for (const t of CMP035_TABLES) {
      await expect(asTenant(h.peer, T1, (c) => c.query(TABLE_SQL[t].select1))).rejects.toThrow(
        /permission denied/,
      );
      await expect(asTenant(h.peer, T1, (c) => c.query(TABLE_SQL[t].deleteAll))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('NEGATIVE: sf_app alone holds no DML on the projection table', async () => {
    const [sql, values] = documentInsert(T1);
    await expect(asTenant(h.appOnly, T1, (c) => c.query(sql, values))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('NEGATIVE: runtime cannot SET ROLE into another component role nor DELETE documents', async () => {
    await expect(asTenant(h.rt, T1, (c) => c.query('SET ROLE sf_cmp015_rw'))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asTenant(h.rt, T1, (c) => c.query('DELETE FROM sf_search.search_document')),
    ).rejects.toThrow(/permission denied/);
  });

  it('NEGATIVE: identity columns are not updatable and source version cannot regress', async () => {
    const id = randomUUID();
    const [sql, values] = documentInsert(T1, id);
    await asTenant(h.rt, T1, (c) => c.query(sql, values));
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query('UPDATE sf_search.search_document SET tenant_id = $1 WHERE document_id = $2', [
          T2,
          id,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(
          'UPDATE sf_search.search_document SET source_version = 0, revision = 2 WHERE document_id = $1',
          [id],
        ),
      ),
    ).rejects.toThrow(/newer source version/);
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(
          'UPDATE sf_search.search_document SET source_version = 5, revision = 5 WHERE document_id = $1',
          [id],
        ),
      ),
    ).rejects.toThrow(/revision must advance by exactly one/);
  });

  it('tenant_id is uuid NOT NULL on every TENANT_SCOPED table', async () => {
    const cols = await h.admin.query(
      `SELECT table_name, is_nullable, data_type FROM information_schema.columns
        WHERE table_schema = 'sf_search' AND column_name = 'tenant_id'`,
    );
    expect(cols.rows.length).toBeGreaterThanOrEqual(3);
    for (const row of cols.rows) {
      expect(row['is_nullable']).toBe('NO');
      expect(row['data_type']).toBe('uuid');
    }
    expect(ACTOR).toMatch(/^[0-9a-f-]{36}$/);
  });
});
