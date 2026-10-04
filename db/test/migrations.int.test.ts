import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  COMPONENT_SCHEMAS,
  DB_DIR,
  SERVICEFORM_ROLES,
  dropServiceformCatalog,
  listSfSchemas,
  migrate,
  withClient,
} from './helpers.js';

const files = readdirSync(join(DB_DIR, 'migrations')).filter((f) => f.endsWith('.sql'));

describe('migration framework (REQ: AWS v1.7 s17 M0; Eng v1.4 s9.1 G2 migration evidence)', () => {
  beforeAll(async () => {
    // GitHub PR #21: shared-db-contracts and rls-harness migrate UP first. The previous
    // reset dropped only sf_platform (tracking) and left sf_tenant_org, so empty-DB UP
    // hit 42P06. Teardown every sf_% schema in this database. Do not make CREATE SCHEMA
    // idempotent. maxWorkers=1 so this cannot race sibling files.
    await dropServiceformCatalog();
    expect(await listSfSchemas()).toEqual([]);
  });

  it('applies every migration from an empty database', async () => {
    expect(await listSfSchemas()).toEqual([]);
    migrate('up');
    const applied = await withClient(async (c) =>
      (
        await c.query<{ name: string }>(
          'SELECT name FROM sf_platform.sf_schema_migrations ORDER BY run_on, id',
        )
      ).rows.map((r) => r.name),
    );
    expect(applied).toEqual(files.map((f) => f.replace(/\.sql$/, '')).sort());
  });

  it('creates required privilege roles without BYPASSRLS or LOGIN (ADR-0006, TI v1.0 s8.1)', async () => {
    const roles = await withClient(async (c) => {
      const { rows } = await c.query<{
        rolname: string;
        rolbypassrls: boolean;
        rolsuper: boolean;
        rolcanlogin: boolean;
      }>(
        `SELECT rolname, rolbypassrls, rolsuper, rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[])`,
        [SERVICEFORM_ROLES],
      );
      return rows;
    });
    expect(roles.map((r) => r.rolname).sort()).toEqual([...SERVICEFORM_ROLES].sort());
    for (const role of roles) {
      expect({ role: role.rolname, rolbypassrls: role.rolbypassrls }).toEqual({
        role: role.rolname,
        rolbypassrls: false,
      });
      expect({ role: role.rolname, rolsuper: role.rolsuper }).toEqual({
        role: role.rolname,
        rolsuper: false,
      });
      expect({ role: role.rolname, rolcanlogin: role.rolcanlogin }).toEqual({
        role: role.rolname,
        rolcanlogin: false,
      });
    }
  });

  it('removes CREATE on public from PUBLIC', async () => {
    const canCreate = await withClient(
      async (c) =>
        (await c.query("SELECT has_schema_privilege('sf_app', 'public', 'CREATE') AS ok")).rows[0]
          .ok,
    );
    expect(canCreate).toBe(false);
  });

  it('FORCE ROW LEVEL SECURITY on tenant-scoped component tables', async () => {
    const rows = await withClient(async (c) => {
      const { rows: found } = await c.query<{ nspname: string; relname: string; forced: boolean }>(
        `SELECT n.nspname, c.relname, c.relforcerowsecurity AS forced
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = ANY($1::text[])
           AND c.relkind = 'r'
           AND c.relrowsecurity
         ORDER BY 1, 2`,
        [COMPONENT_SCHEMAS],
      );
      return found;
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.forced).toBe(true);
    }
  });

  it('is a no-op when re-run with nothing pending', () => {
    expect(migrate('up')).toMatch(/No migrations to run/);
  });

  it('rolls every migration back, leaves no component schema, and re-applies cleanly', async () => {
    migrate('down', files.length);
    const afterDown = await listSfSchemas();
    expect(afterDown.filter((s) => (COMPONENT_SCHEMAS as readonly string[]).includes(s))).toEqual(
      [],
    );
    migrate('up');
    const count = await withClient(
      async (c) =>
        (await c.query('SELECT count(*)::int AS n FROM sf_platform.sf_schema_migrations')).rows[0]
          .n,
    );
    expect(count).toBe(files.length);
    for (const schema of COMPONENT_SCHEMAS) {
      expect(await listSfSchemas()).toContain(schema);
    }
  });
});
