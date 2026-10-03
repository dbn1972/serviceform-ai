import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DIR, databaseUrl, migrate, urlWithUser, withAdmin } from './support/db.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const RT = 'sf_t005_rt';
const PEER = 'sf_t005_peer';
const PASS = randomBytes(12).toString('hex');

describe('CMP-037 integration (RLS, privilege-boundary, outbox, webhook_route)', () => {
  let rt: pg.Pool;
  let peer: pg.Pool;

  beforeAll(async () => {
    migrate('up');
    await withAdmin(async (c) => {
      await c.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp002_rw') THEN
            CREATE ROLE sf_cmp002_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp031_rw') THEN
            CREATE ROLE sf_cmp031_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp038_rw') THEN
            CREATE ROLE sf_cmp038_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp048_rw') THEN
            CREATE ROLE sf_cmp048_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
          END IF;
        END $$;
      `);
      await c.query(`
        DO $cleanup$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_t005_rt') THEN
            EXECUTE 'REVOKE ALL ON DATABASE ' || current_database() || ' FROM sf_t005_rt';
            DROP ROLE sf_t005_rt;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_t005_peer') THEN
            EXECUTE 'REVOKE ALL ON DATABASE ' || current_database() || ' FROM sf_t005_peer';
            DROP ROLE sf_t005_peer;
          END IF;
        END $cleanup$;
      `);
      await c.query(
        "CREATE ROLE sf_t005_rt LOGIN PASSWORD '" +
          PASS.replaceAll("'", "''") +
          "' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS",
      );
      await c.query('GRANT sf_app TO sf_t005_rt');
      await c.query('GRANT sf_cmp037_rw TO sf_t005_rt');
      await c.query(
        "CREATE ROLE sf_t005_peer LOGIN PASSWORD '" +
          PASS.replaceAll("'", "''") +
          "' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS",
      );
      await c.query('GRANT sf_app TO sf_t005_peer');
      await c.query('GRANT sf_cmp002_rw TO sf_t005_peer');
      const db = (await c.query<{ current_database: string }>('SELECT current_database()')).rows[0];
      const dbname = db?.current_database ?? '';
      if (!/^[A-Za-z0-9_]+$/.test(dbname)) throw new Error('unexpected database name');
      await c.query('GRANT CONNECT ON DATABASE ' + dbname + ' TO sf_t005_rt');
      await c.query('GRANT CONNECT ON DATABASE ' + dbname + ' TO sf_t005_peer');
      await c.query(`
        TRUNCATE TABLE
          sf_integration_hub.connector_transaction,
          sf_integration_hub.webhook_route,
          sf_integration_hub.connector_binding_index,
          sf_integration_hub.connector_binding,
          sf_integration_hub.connector_definition
        RESTART IDENTITY CASCADE
      `);
    });
    rt = new pg.Pool({ connectionString: urlWithUser(RT, PASS), max: 1 });
    peer = new pg.Pool({ connectionString: urlWithUser(PEER, PASS), max: 1 });
  }, 120_000);

  afterAll(async () => {
    await rt?.end();
    await peer?.end();
    await withAdmin(async (c) => {
      await c.query(`
        DO $cleanup$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_t005_rt') THEN
            EXECUTE 'REVOKE ALL ON DATABASE ' || current_database() || ' FROM sf_t005_rt';
            DROP ROLE sf_t005_rt;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_t005_peer') THEN
            EXECUTE 'REVOKE ALL ON DATABASE ' || current_database() || ' FROM sf_t005_peer';
            DROP ROLE sf_t005_peer;
          END IF;
        END $cleanup$;
      `);
    }).catch(() => undefined);
  });

  async function asTenant<T>(
    pool: pg.Pool,
    tenant: string | null,
    fn: (q: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (tenant) await client.query(`SELECT set_config($1, $2, true)`, ['app.tenant_id', tenant]);
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  it('005-01/005-34 runtime identity: no superuser, no bypassrls, not owner, only own _rw', async () => {
    const role = await withAdmin(async (c) => {
      const r = await c.query(
        `SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1`,
        [RT],
      );
      const members = await c.query(
        `SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
          JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = $1 ORDER BY 1`,
        [RT],
      );
      const owner = await c.query(
        `SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'sf_integration_hub'`,
      );
      const rw = await c.query(`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'sf_cmp037_rw'`);
      return {
        r: r.rows[0],
        members: members.rows.map((x) => x['rolname']),
        owner: owner.rows,
        rw: rw.rows[0],
      };
    });
    expect(role.r).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: true });
    expect(role.rw).toEqual({ rolcanlogin: false });
    expect(role.members.sort()).toEqual(['sf_app', 'sf_cmp037_rw']);
    expect(role.members).not.toContain('sf_cmp002_rw');
    for (const row of role.owner) {
      expect(row['tableowner']).toBe('sf_migrator');
      expect(row['tableowner']).not.toBe(RT);
    }
  });

  it('005-35 own DML succeeds and 005-36 wrong tenant is empty', async () => {
    const defId = randomUUID();
    const bindId = randomUUID();
    await asTenant(rt, T1, async (q) => {
      await q.query(
        `INSERT INTO sf_integration_hub.connector_definition (
           connector_definition_id, connector_type, adapter_key, display_name, supported_modes, timeout_ms, status
         ) VALUES ($1,'DEPARTMENT_API',$2,'echo',ARRAY['SIMULATED']::text[],1000,'ACTIVE')`,
        [defId, `echo-${defId}`],
      );
      await q.query(
        `INSERT INTO sf_integration_hub.connector_binding (
           connector_binding_id, tenant_id, connector_definition_id, connector_type, mode, environment, critical, secret_ref, simulator_version, enabled
         ) VALUES ($1,$2,$3,'DEPARTMENT_API','SIMULATED','SIT',true,'vault://sim/echo-webhook','echo-1.0.0',true)`,
        [bindId, T1, defId],
      );
      await q.query(
        `INSERT INTO sf_integration_hub.webhook_route (binding_id, tenant_id) VALUES ($1,$2)`,
        [bindId, T1],
      );
    });
    const own = await asTenant(rt, T1, async (q) =>
      q.query(
        `SELECT connector_binding_id FROM sf_integration_hub.connector_binding WHERE connector_binding_id = $1`,
        [bindId],
      ),
    );
    const other = await asTenant(rt, T2, async (q) =>
      q.query(
        `SELECT connector_binding_id FROM sf_integration_hub.connector_binding WHERE connector_binding_id = $1`,
        [bindId],
      ),
    );
    const unset = await asTenant(rt, null, async (q) =>
      q.query(
        `SELECT connector_binding_id FROM sf_integration_hub.connector_binding WHERE connector_binding_id = $1`,
        [bindId],
      ),
    );
    expect(own.rows).toHaveLength(1);
    expect(other.rows).toHaveLength(0);
    expect(unset.rows).toHaveLength(0);
  });

  it('005-04 webhook_route cannot retarget another tenant', async () => {
    const bindId = randomUUID();
    await expect(
      asTenant(rt, T1, async (q) =>
        q.query(
          `INSERT INTO sf_integration_hub.webhook_route (binding_id, tenant_id) VALUES ($1,$2)`,
          [bindId, T2],
        ),
      ),
    ).rejects.toThrow();
  });

  it('005-37/005-38 peer and sf_app-only cannot DML domain tables', async () => {
    await expect(
      asTenant(peer, T1, async (q) =>
        q.query(`SELECT * FROM sf_integration_hub.connector_binding`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asTenant(peer, T1, async (q) =>
        q.query(
          `INSERT INTO sf_integration_hub.webhook_route (binding_id, tenant_id) VALUES ($1,$2)`,
          [randomUUID(), T1],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('005-39 cannot SET ROLE into another component _rw', async () => {
    const client = await rt.connect();
    try {
      await expect(client.query('SET ROLE sf_cmp002_rw')).rejects.toThrow();
      await expect(client.query('SET ROLE sf_cmp031_rw')).rejects.toThrow();
      await expect(client.query('SET ROLE sf_cmp038_rw')).rejects.toThrow();
      await expect(client.query('SET ROLE sf_cmp048_rw')).rejects.toThrow();
    } finally {
      client.release();
    }
  });

  it('005-03/005-40 no SECURITY DEFINER, no PUBLIC grants', async () => {
    const rows = await withAdmin(async (c) => {
      const sec = await c.query(
        `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'sf_integration_hub' AND p.prosecdef`,
      );
      const pub = await c.query(
        `SELECT count(*)::int AS n FROM information_schema.role_table_grants
          WHERE table_schema = 'sf_integration_hub' AND grantee = 'PUBLIC'`,
      );
      return { sec: sec.rows[0]?.['n'], pub: pub.rows[0]?.['n'] };
    });
    expect(rows.sec).toBe(0);
    expect(rows.pub).toBe(0);
  });

  it('005-41 outbox up-migration contains the rendered frozen template', () => {
    const template = readFileSync(
      join(DB_DIR, '..', 'contracts/shared/sql/outbox.template.sql'),
      'utf8',
    )
      .replaceAll('{schema}', 'sf_integration_hub')
      .replaceAll('{cmp}', 'CMP-037');
    const migration = readFileSync(
      join(DB_DIR, 'migrations/1759500510000_cmp-037-integration-hub-outbox.sql'),
      'utf8',
    );
    expect(migration).toContain(template);
  });

  it('creates sf_migrator and sf_cmp037_rw with a guarded DO block, not CREATE ROLE IF NOT EXISTS', () => {
    const schema = readFileSync(
      join(DB_DIR, 'migrations/1759500500000_cmp-037-integration-hub-schema.sql'),
      'utf8',
    );
    const executable = schema.replace(/--[^\n]*/g, '');
    expect(executable).not.toMatch(/CREATE\s+ROLE\s+IF\s+NOT\s+EXISTS/i);
    expect(schema).toMatch(
      /IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'sf_migrator'\)/,
    );
    expect(schema).toMatch(
      /IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp037_rw'\)/,
    );
    expect(schema).toMatch(
      /CREATE ROLE sf_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS/,
    );
    expect(schema).toMatch(
      /CREATE ROLE sf_cmp037_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS/,
    );
    const down = schema.slice(schema.search(/-- Down Migration/i));
    expect(down).toMatch(/DROP ROLE IF EXISTS sf_cmp037_rw/);
    expect(down).not.toMatch(/DROP ROLE IF EXISTS sf_migrator/);
  });

  it('DB CHECK refuses PRODUCTION SIMULATED and inline secrets', async () => {
    const defId = randomUUID();
    await asTenant(rt, T1, async (q) => {
      await q.query(
        `INSERT INTO sf_integration_hub.connector_definition (
           connector_definition_id, connector_type, adapter_key, display_name, supported_modes, timeout_ms, status
         ) VALUES ($1,'DEPARTMENT_API',$2,'x',ARRAY['REAL']::text[],1000,'ACTIVE')`,
        [defId, `real-${defId}`],
      );
    });
    await expect(
      asTenant(rt, T1, async (q) =>
        q.query(
          `INSERT INTO sf_integration_hub.connector_binding (
             connector_binding_id, tenant_id, connector_definition_id, connector_type, mode, environment, critical, secret_ref, enabled
           ) VALUES ($1,$2,$3,'DEPARTMENT_API','SIMULATED','PRODUCTION',true,'vault://x',true)`,
          [randomUUID(), T1, defId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asTenant(rt, T1, async (q) =>
        q.query(
          `INSERT INTO sf_integration_hub.connector_binding (
             connector_binding_id, tenant_id, connector_definition_id, connector_type, mode, environment, critical, secret_ref, enabled
           ) VALUES ($1,$2,$3,'DEPARTMENT_API','REAL','PRODUCTION',true,'sk_live_not_a_handle',true)`,
          [randomUUID(), T1, defId],
        ),
      ),
    ).rejects.toThrow();
  });
});

void databaseUrl;
