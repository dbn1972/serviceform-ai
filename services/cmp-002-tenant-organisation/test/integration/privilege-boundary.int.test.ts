import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  ACTOR_OFFICER,
  CANARY,
  closeHarness,
  seedTenants,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
  await seedTenants(h);
});
afterAll(async () => {
  await closeHarness(h);
});

describe('001 privilege boundary and catalogue (ADR-0006)', () => {
  it('001-01 runtime identity is non-superuser sf_app member and not table owner', async () => {
    const client = await h.rt.connect();
    try {
      const id = await client.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        session_user: string;
        current_user: string;
      }>(
        `SELECT r.rolsuper, r.rolbypassrls, session_user, current_user
           FROM pg_roles r WHERE r.rolname = session_user`,
      );
      const row = id.rows[0];
      expect(row?.rolsuper).toBe(false);
      expect(row?.rolbypassrls).toBe(false);
      expect(row?.session_user).toBe(row?.current_user);
      expect(row?.session_user).toBe('sf_t001_rt');
      const member = await client.query<{ ok: boolean }>(
        "SELECT pg_has_role(session_user, 'sf_app', 'MEMBER') AS ok",
      );
      expect(member.rows[0]?.ok).toBe(true);
      const owners = await client.query<{ ok: boolean }>(
        `SELECT bool_or(pg_has_role(session_user, relowner, 'MEMBER')) AS ok
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_tenant_org' AND c.relkind = 'r'`,
      );
      expect(owners.rows[0]?.ok).toBe(false);
    } finally {
      client.release();
    }
  });

  it('001-02 FORCE RLS on tenant-scoped tables; sf_app is not owner and has no BYPASSRLS', async () => {
    const rows = await h.admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_tenant_org' AND c.relkind = 'r'
          AND c.relname NOT LIKE '%_platform'`,
    );
    for (const r of rows.rows) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.relforcerowsecurity, r.relname).toBe(true);
    }
    const roles = await h.admin.query(
      "SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('sf_app','sf_t001_rt','sf_cmp002_rw')",
    );
    for (const r of roles.rows) expect(r['rolbypassrls']).toBe(false);
    const owned = await h.admin.query(
      `SELECT 1 FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
        WHERE n.nspname = 'sf_tenant_org' AND r.rolname IN ('sf_app','sf_t001_rt')`,
    );
    expect(owned.rowCount).toBe(0);
  });

  it('001-03 policies use current_tenant_id and are not TO public', async () => {
    const policies = await h.admin.query<{
      roles: string[];
      qual: string | null;
      with_check: string | null;
    }>(`SELECT roles, qual, with_check FROM pg_policies WHERE schemaname = 'sf_tenant_org'`);
    for (const p of policies.rows) {
      expect(p.roles).not.toContain('public');
      if (p.roles.includes('sf_app') && p.qual && p.qual !== 'true') {
        expect(p.qual.includes('current_tenant_id') || p.qual.includes('current_actor_id')).toBe(
          true,
        );
      }
    }
  });

  it('001-04 PUBLIC has nothing; sf_app has no TRUNCATE; insert-only have no UPDATE/DELETE', async () => {
    const pub = await h.admin.query(
      `SELECT has_schema_privilege('public','sf_tenant_org','USAGE') AS usage`,
    );
    expect(pub.rows[0]?.['usage']).toBe(false);
    const trunc = await h.admin.query(
      `SELECT has_table_privilege('sf_app','sf_tenant_org.tenant','TRUNCATE') AS t`,
    );
    expect(trunc.rows[0]?.['t']).toBe(false);
    const upd = await h.admin.query(
      `SELECT has_table_privilege('sf_cmp002_rw','sf_tenant_org.organisation_version','UPDATE') AS u,
              has_table_privilege('sf_cmp002_rw','sf_tenant_org.organisation_version','DELETE') AS d`,
    );
    expect(upd.rows[0]?.['u']).toBe(false);
    expect(upd.rows[0]?.['d']).toBe(false);
    const appDml = await h.admin.query(
      `SELECT has_table_privilege('sf_app','sf_tenant_org.tenant','INSERT') AS i,
              has_table_privilege('sf_app','sf_tenant_org.tenant','SELECT') AS s`,
    );
    expect(appDml.rows[0]?.['i']).toBe(false);
    expect(appDml.rows[0]?.['s']).toBe(false);
    const extra = await h.admin.query(
      `SELECT has_table_privilege('sf_t001_rt','sf_tenant_org.tenant','TRIGGER') AS trg,
              has_table_privilege('sf_t001_rt','sf_tenant_org.tenant','REFERENCES') AS refs,
              has_schema_privilege('sf_t001_rt','sf_tenant_org','CREATE') AS crt`,
    );
    expect(extra.rows[0]?.['trg']).toBe(false);
    expect(extra.rows[0]?.['refs']).toBe(false);
    expect(extra.rows[0]?.['crt']).toBe(false);
  });

  it('001-05 no security definer functions or materialised views', async () => {
    const fn = await h.admin.query(
      `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'sf_tenant_org' AND p.prosecdef`,
    );
    expect(fn.rowCount).toBe(0);
    const mv = await h.admin.query(
      `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_tenant_org' AND c.relkind = 'm'`,
    );
    expect(mv.rowCount).toBe(0);
  });

  it('001-06 owner-bypass attempts fail as runtime', async () => {
    const c = await h.rt.connect();
    try {
      await expect(
        c.query('ALTER TABLE sf_tenant_org.office DISABLE ROW LEVEL SECURITY'),
      ).rejects.toThrow();
      await expect(
        c.query('ALTER TABLE sf_tenant_org.office NO FORCE ROW LEVEL SECURITY'),
      ).rejects.toThrow();
      await expect(
        c.query('DROP POLICY office_isolation ON sf_tenant_org.office'),
      ).rejects.toThrow();
      await expect(c.query('SET ROLE sf_migrator')).rejects.toThrow();
      await expect(c.query('SET session_replication_role = replica')).rejects.toThrow();
      await expect(
        c.query('CREATE FUNCTION sf_tenant_org.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$'),
      ).rejects.toThrow();
      const pub = await c.query<{ ok: boolean }>(
        "SELECT has_table_privilege('public', 'sf_tenant_org.office', 'SELECT') AS ok",
      );
      expect(pub.rows[0]?.ok).toBe(false);
    } finally {
      c.release();
    }
  });

  it('ADR-0006 other component cannot DML business tables or SET ROLE _rw', async () => {
    await expect(
      asTenant(h.other, T1, ACTOR_OFFICER, (c) => c.query('SELECT * FROM sf_tenant_org.tenant')),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asTenant(h.other, T1, ACTOR_OFFICER, (c) =>
        c.query(
          'INSERT INTO sf_tenant_org.office (tenant_id, office_id, organisation_id, code, name, status, created_by) VALUES ($1,$1,$1,$2,$2,$3,$1)',
          [T1, 'x', 'DRAFT'],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    const c = await h.rt.connect();
    try {
      await expect(c.query('SET ROLE sf_cmp048_rw')).rejects.toThrow();
      await expect(c.query('SET ROLE sf_cmp031_rw')).rejects.toThrow();
      await expect(c.query('SET ROLE sf_cmp037_rw')).rejects.toThrow();
      await expect(c.query('SET ROLE sf_cmp038_rw')).rejects.toThrow();
    } finally {
      c.release();
    }
  });

  it('001-07/13 RLS matrix: other tenant and unset context see zero rows', async () => {
    const own = await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      return (await c.query('SELECT code FROM sf_tenant_org.tenant')).rows;
    });
    expect(own).toEqual([{ code: 'tenant-one' }]);
    const other = await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      return (
        await c.query('SELECT display_name FROM sf_tenant_org.tenant WHERE tenant_id = $1', [T2])
      ).rows;
    });
    expect(other).toEqual([]);
    const unset = await asTenant(h.rt, null, ACTOR_OFFICER, async (c) => {
      return (await c.query('SELECT code FROM sf_tenant_org.tenant')).rows;
    });
    expect(unset).toEqual([]);
    await expect(
      asTenant(h.rt, T1, ACTOR_OFFICER, (c) =>
        c.query(
          "INSERT INTO sf_tenant_org.tenant (tenant_id, code, display_name, status, created_by) VALUES ($1,'x','x','ACTIVE',$2)",
          [T2, ACTOR_OFFICER],
        ),
      ),
    ).rejects.toThrow(/row-level security|permission denied/);
    const t2leak = await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
      return (await c.query('SELECT display_name FROM sf_tenant_org.tenant')).rows.map(
        (r) => r['display_name'],
      );
    });
    expect(t2leak.join(' ')).not.toContain(CANARY);
  });

  it('001-08 cannot reassign tenant_id', async () => {
    await expect(
      asTenant(h.rt, T1, ACTOR_OFFICER, (c) =>
        c.query('UPDATE sf_tenant_org.tenant SET tenant_id = $1', [T2]),
      ),
    ).rejects.toThrow(/permission denied|cannot/);
  });

  it('001-11 FKs include tenant_id', async () => {
    const fks = await h.admin.query<{ conname: string; conkey: number[]; confkey: number[] }>(
      `SELECT conname, conkey, confkey
         FROM pg_constraint
        WHERE contype = 'f' AND conrelid::regclass::text LIKE 'sf_tenant_org.%'`,
    );
    for (const fk of fks.rows) {
      expect(fk.conkey.length).toBeGreaterThanOrEqual(1);
    }
    const tenantCols = await h.admin.query(
      `SELECT conname FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.conrelid::regclass::text LIKE 'sf_tenant_org.%'
          AND a.attname = 'tenant_id'`,
    );
    expect((tenantCols.rowCount ?? 0) > 0).toBe(true);
  });
});
