import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CMP016_ISOLATED_CHAIN,
  MIGRATIONS,
  adminUrl,
  migrate,
  snapshotCombinedCatalog,
  withIsolatedCmp016Database,
  type IsolatedDatabase,
  type PgConnection,
  type PgPool,
} from './helpers.js';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ROOT } from '../fixtures/models.js';

const pg = createRequire(join(ROOT, 'db/package.json'))('pg') as {
  Pool: new (cfg: object) => PgPool;
};
let admin: PgPool;

type Queryable = Pick<PgConnection, 'query'>;

const WORKFLOW_TABLES = 10;
/** PLATFORM_OPERATIONAL (shared outbox contract): no tenant_id, so no tenant RLS policy. */
const PLATFORM_TABLES = ['inbox_event_platform', 'outbox_event_platform'];
const ISOLATED_NAMES = CMP016_ISOLATED_CHAIN.map((f) => f.replace(/\.sql$/, ''));

async function applied(db: Queryable): Promise<string[]> {
  const r = await db.query<{ name: string }>(
    'SELECT name FROM sf_platform.sf_schema_migrations ORDER BY run_on, id',
  );
  return r.rows.map((x) => x.name);
}

async function schemaExists(db: Queryable): Promise<boolean> {
  const r = await db.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_workflow'`);
  return (r.rowCount ?? 0) > 0;
}

async function workflowTables(
  db: Queryable,
): Promise<{ relname: string; rls: boolean; force: boolean; owner: string }[]> {
  const r = await db.query<{ relname: string; rls: boolean; force: boolean; owner: string }>(
    `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
            pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'sf_workflow' AND c.relkind = 'r'
      ORDER BY 1`,
  );
  return r.rows;
}

async function expectReleased(info: IsolatedDatabase | undefined): Promise<void> {
  if (!info) throw new Error('isolated database was never provisioned');
  const r = await admin.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM pg_database WHERE datname = $1',
    [info.name],
  );
  expect(r.rows[0]?.n).toBe(0);
  expect(existsSync(info.migrationsDir)).toBe(false);
}

beforeAll(() => {
  admin = new pg.Pool({ connectionString: adminUrl(), max: 2 });
  migrate('up');
});

afterAll(async () => {
  await admin.end();
});

describe('CMP-016 migrations are reversible and ordered', () => {
  it('combined chain: both CMP-016 migrations are applied in order and sf_workflow exists', async () => {
    const names = await applied(admin);
    const first = names.indexOf(MIGRATIONS[0] as string);
    const second = names.indexOf(MIGRATIONS[1] as string);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    expect(names.indexOf('1759490000000_shared-db-contracts')).toBeLessThan(first);
    expect(await schemaExists(admin)).toBe(true);
    const tables = await workflowTables(admin);
    expect(tables).toHaveLength(WORKFLOW_TABLES);
    for (const t of tables) {
      if (PLATFORM_TABLES.includes(t.relname)) continue;
      expect(t.rls, t.relname).toBe(true);
      expect(t.force, t.relname).toBe(true);
    }
  });

  it('isolated chain: down 2 removes sf_workflow, up re-applies cleanly, combined catalogue unchanged', async () => {
    const before = await snapshotCombinedCatalog(admin);
    let seen: IsolatedDatabase | undefined;

    await withIsolatedCmp016Database(admin, async (iso, migrateIso, info) => {
      seen = info;
      expect(info.name).toMatch(/^sf_cmp016_rev_[0-9a-f]{8}$/);

      migrateIso('up');
      expect(await applied(iso)).toEqual(ISOLATED_NAMES);
      expect(await schemaExists(iso)).toBe(true);
      expect(await workflowTables(iso)).toHaveLength(WORKFLOW_TABLES);

      migrateIso('down', 2);
      expect(await schemaExists(iso)).toBe(false);
      const afterDown = await applied(iso);
      for (const m of MIGRATIONS) expect(afterDown).not.toContain(m);
      expect(afterDown).toEqual(ISOLATED_NAMES.slice(0, 2));
      const role = await iso.query(`SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp016_rw'`);
      expect(role.rowCount).toBe(1);

      migrateIso('up');
      expect(await applied(iso)).toEqual(ISOLATED_NAMES);
      const tables = await workflowTables(iso);
      expect(tables).toHaveLength(WORKFLOW_TABLES);
      for (const t of tables) {
        expect(t.owner, t.relname).toBe('sf_migrator');
        if (PLATFORM_TABLES.includes(t.relname)) continue;
        expect(t.rls, t.relname).toBe(true);
        expect(t.force, t.relname).toBe(true);
      }
      const reapplied = await snapshotCombinedCatalog(iso);
      expect(reapplied.workflowTables.map(({ relname, force }) => ({ relname, force }))).toEqual(
        before.workflowTables.map(({ relname, force }) => ({ relname, force })),
      );
      expect(reapplied.workflowPolicies).toEqual(before.workflowPolicies);
      expect(reapplied.workflowGrants).toEqual(before.workflowGrants);
      expect(reapplied.workflowGrants.some((g) => g.startsWith('sf_cmp016_rw:'))).toBe(true);
      const roleAttrs = await iso.query(
        `SELECT rolcanlogin, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'sf_cmp016_rw'`,
      );
      expect(roleAttrs.rows[0]).toEqual({
        rolcanlogin: false,
        rolbypassrls: false,
        rolsuper: false,
      });
      const publicGrants = await iso.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.role_table_grants
          WHERE table_schema = 'sf_workflow' AND grantee = 'PUBLIC'`,
      );
      expect(publicGrants.rows[0]?.n).toBe(0);
    });

    await expectReleased(seen);
    expect(await snapshotCombinedCatalog(admin)).toEqual(before);

    let failed: IsolatedDatabase | undefined;
    await expect(
      withIsolatedCmp016Database(admin, async (_iso, migrateIso, info) => {
        failed = info;
        migrateIso('up');
        throw new Error('injected isolated failure');
      }),
    ).rejects.toThrow('injected isolated failure');
    await expectReleased(failed);
    const leftovers = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_database WHERE datname LIKE 'sf\\_cmp016\\_rev\\_%'`,
    );
    expect(leftovers.rows[0]?.n).toBe(0);
    expect(await snapshotCombinedCatalog(admin)).toEqual(before);
  });

  it('PUBLIC holds no privilege on sf_workflow tables', async () => {
    const r = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.role_table_grants
        WHERE table_schema = 'sf_workflow' AND grantee = 'PUBLIC'`,
    );
    expect(r.rows[0]?.n).toBe(0);
  });
});
