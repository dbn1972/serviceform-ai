import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  T1,
  T2,
  U1,
  U2,
  asTenant,
  createLogins,
  dropLogins,
  expectPgError,
  migrate,
} from './helpers.js';
import type pg from 'pg';

function insertSql(): { sql: string; params: unknown[] } {
  const id = randomUUID();
  return {
    sql: `INSERT INTO sf_security.privileged_access_record (
      id, tenant_id, grantee_user_id, grantee_actor_type, access_kind, purpose_code, justification,
      scope_actions, scope_resource_types, requested_by, status, starts_at, expires_at
    ) VALUES ($1,$2,$3,'OFFICER','BREAK_GLASS','SUPPORT', 'synthetic justification',
      ARRAY['VIEW'], ARRAY['ExampleAggregate'], $4, 'REQUESTED', now(), now() + interval '1 hour')`,
    params: [id, T1, U1, U2],
  };
}

describe('ADR-0006 privilege-boundary (PB-01..PB-15)', () => {
  let rt: pg.Pool;
  let other: pg.Pool;

  beforeAll(async () => {
    migrate('up');
    const logins = await createLogins();
    rt = logins.rt;
    other = logins.other;
  });

  afterAll(async () => {
    if (rt && other) await dropLogins(rt, other);
  });

  it('PB-01..04 catalogue: NOLOGIN, membership, no bypass, owner sf_migrator', async () => {
    const c = await rt.connect();
    try {
      const me = await c.query(
        `SELECT current_user, session_user, rolsuper, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`,
      );
      expect(me.rows[0].current_user).toBe('sf_cmp048_rt');
      expect(me.rows[0].session_user).toBe('sf_cmp048_rt');
      expect(me.rows[0].rolsuper).toBe(false);
      expect(me.rows[0].rolbypassrls).toBe(false);
      const roles = await c.query(
        `SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles
         WHERE rolname IN ('sf_cmp048_rw','sf_app')`,
      );
      const rw = roles.rows.find((r: { rolname: string }) => r.rolname === 'sf_cmp048_rw');
      expect(rw.rolcanlogin).toBe(false);
      expect(rw.rolsuper).toBe(false);
      expect(rw.rolbypassrls).toBe(false);
      const mem = await c.query(
        `SELECT pg_has_role(session_user, 'sf_app', 'MEMBER') AS app,
                pg_has_role(session_user, 'sf_cmp048_rw', 'MEMBER') AS own,
                pg_has_role(session_user, 'sf_cmp002_rw', 'MEMBER') AS c002,
                pg_has_role(session_user, 'sf_cmp031_rw', 'MEMBER') AS c031,
                pg_has_role(session_user, 'sf_cmp037_rw', 'MEMBER') AS c037,
                pg_has_role(session_user, 'sf_cmp038_rw', 'MEMBER') AS c038,
                pg_has_role(session_user, 'sf_migrator', 'MEMBER') AS migrator`,
      );
      expect(mem.rows[0]).toMatchObject({
        app: true,
        own: true,
        c002: false,
        c031: false,
        c037: false,
        c038: false,
        migrator: false,
      });
      const owners = await c.query(
        `SELECT c.relname, r.rolname AS owner
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
         WHERE n.nspname = 'sf_security' AND c.relkind IN ('r','S')`,
      );
      for (const row of owners.rows) {
        expect(row.owner).toBe('sf_migrator');
        expect(row.owner).not.toBe('sf_cmp048_rt');
      }
    } finally {
      c.release();
    }
  });

  it('PB-05 own authorized INSERT/SELECT succeeds', async () => {
    await asTenant(rt, T1, U2, async (c) => {
      const { sql, params } = insertSql();
      await c.query(sql, params);
      const rows = await c.query(
        'SELECT id FROM sf_security.privileged_access_record WHERE id = $1',
        [params[0]],
      );
      expect(rows.rowCount).toBe(1);
    });
  });

  it('PB-06 wrong tenant / unset is isolated on one backend', async () => {
    const c = await rt.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.tenant_id', T1]);
      await c.query('SELECT set_config($1, $2, true)', ['app.actor_id', U2]);
      await c.query('SELECT set_config($1, $2, true)', ['app.cell_id', 'cell-01']);
      await c.query('SELECT set_config($1, $2, true)', ['app.actor_type', 'OFFICER']);
      await c.query('SELECT set_config($1, $2, true)', [
        'app.correlation_id',
        '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
      ]);
      const { sql, params } = insertSql();
      await c.query(sql, params);
      const own = await c.query(
        'SELECT id FROM sf_security.privileged_access_record WHERE id = $1',
        [params[0]],
      );
      expect(own.rowCount).toBe(1);

      await c.query('SELECT set_config($1, $2, true)', ['app.tenant_id', T2]);
      const t2 = await c.query('SELECT id FROM sf_security.privileged_access_record');
      expect(t2.rowCount).toBe(0);

      await c.query('SELECT set_config($1, $2, true)', ['app.tenant_id', '']);
      const empty = await c.query('SELECT id FROM sf_security.privileged_access_record');
      expect(empty.rowCount).toBe(0);

      await c.query('SELECT set_config($1, $2, true)', ['app.tenant_id', T2]);
      await c.query('SAVEPOINT pb06');
      await expect(c.query(sql, params)).rejects.toThrow();
      await c.query('ROLLBACK TO pb06');
      await c.query('ROLLBACK');
    } catch (err) {
      try {
        await c.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      c.release();
    }
  });

  it('PB-07/11 peer sf_app-only login is denied DML on authoritative tables', async () => {
    await asTenant(other, T1, U2, async (c) => {
      const sel = await expectPgError(c, () =>
        c.query('SELECT id FROM sf_security.privileged_access_record'),
      );
      expect(sel.code).toBe('42501');
      const meta = await expectPgError(c, () =>
        c.query('SELECT id FROM sf_security.security_policy_metadata'),
      );
      expect(meta.code).toBe('42501');
      const idem = await expectPgError(c, () =>
        c.query('SELECT 1 FROM sf_security.idempotency_record'),
      );
      expect(idem.code).toBe('42501');
      const plat = await expectPgError(c, () =>
        c.query('SELECT 1 FROM sf_security.idempotency_record_platform'),
      );
      expect(plat.code).toBe('42501');
      const { sql, params } = insertSql();
      const ins = await expectPgError(c, () => c.query(sql, params));
      expect(ins.code).toBe('42501');
    });
  });

  it('PB-08/09 SET ROLE into other _rw roles fails', async () => {
    const c = await rt.connect();
    try {
      await expect(c.query('SET ROLE sf_cmp002_rw')).rejects.toThrow();
      await expect(c.query('SET ROLE sf_cmp031_rw')).rejects.toThrow();
      await expect(c.query('SET ROLE sf_cmp037_rw')).rejects.toThrow();
      await expect(c.query('SET ROLE sf_cmp038_rw')).rejects.toThrow();
    } finally {
      c.release();
    }
    const o = await other.connect();
    try {
      await expect(o.query('SET ROLE sf_cmp048_rw')).rejects.toThrow();
    } finally {
      o.release();
    }
  });

  it('PB-10 GRANT sibling role as runtime fails', async () => {
    const c = await rt.connect();
    try {
      await expect(c.query('GRANT sf_cmp031_rw TO sf_cmp048_rt')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      c.release();
    }
  });

  it('PB-12/13 PUBLIC empty; sf_app has no DML on authoritative tables', async () => {
    const c = await rt.connect();
    try {
      const pub = await c.query(
        `SELECT has_schema_privilege('public', 'sf_security', 'USAGE') AS u`,
      );
      expect(pub.rows[0].u).toBe(false);
      const app = await c.query(`
        SELECT table_name,
               has_table_privilege('sf_app', 'sf_security.' || table_name, 'INSERT') AS ins,
               has_table_privilege('sf_app', 'sf_security.' || table_name, 'UPDATE') AS upd,
               has_table_privilege('sf_app', 'sf_security.' || table_name, 'DELETE') AS del
        FROM information_schema.tables
        WHERE table_schema = 'sf_security'
          AND table_name IN ('privileged_access_record','security_policy_metadata','idempotency_record','idempotency_record_platform')`);
      for (const row of app.rows) {
        expect(row.ins).toBe(false);
        expect(row.upd).toBe(false);
        expect(row.del).toBe(false);
      }
    } finally {
      c.release();
    }
  });

  it('PB-15 runtime cannot own or disable RLS', async () => {
    const c = await rt.connect();
    try {
      await expect(
        c.query('ALTER TABLE sf_security.privileged_access_record OWNER TO sf_cmp048_rt'),
      ).rejects.toThrow();
      await expect(
        c.query('ALTER TABLE sf_security.privileged_access_record NO FORCE ROW LEVEL SECURITY'),
      ).rejects.toThrow();
      await expect(
        c.query('DROP POLICY privileged_access_tenant ON sf_security.privileged_access_record'),
      ).rejects.toThrow();
    } finally {
      c.release();
    }
  });
});
