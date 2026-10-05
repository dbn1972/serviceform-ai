import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, adminUrl, migrate, type PgPool } from './helpers.js';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ROOT } from '../fixtures/models.js';

const pg = createRequire(join(ROOT, 'db/package.json'))('pg') as {
  Pool: new (cfg: object) => PgPool;
};
let admin: PgPool;

async function applied(): Promise<string[]> {
  const r = await admin.query<{ name: string }>(
    'SELECT name FROM sf_platform.sf_schema_migrations ORDER BY run_on, id',
  );
  return r.rows.map((x) => x.name);
}

async function schemaExists(): Promise<boolean> {
  const r = await admin.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_workflow'`);
  return (r.rowCount ?? 0) > 0;
}

beforeAll(() => {
  admin = new pg.Pool({ connectionString: adminUrl(), max: 2 });
  migrate('up');
});

afterAll(async () => {
  migrate('up');
  await admin.end();
});

describe('CMP-016 migrations are reversible and ordered', () => {
  it('applies both CMP-016 migrations as the tail of the chain', async () => {
    expect((await applied()).slice(-2)).toEqual(MIGRATIONS);
    expect(await schemaExists()).toBe(true);
  });

  it('down 2 removes sf_workflow completely and up re-applies cleanly', async () => {
    migrate('down', 2);
    expect(await schemaExists()).toBe(false);
    expect(await applied()).not.toContain(MIGRATIONS[0]);
    const role = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp016_rw'`);
    expect(role.rowCount).toBe(1);
    migrate('up');
    expect((await applied()).slice(-2)).toEqual(MIGRATIONS);
    const tables = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'sf_workflow'`,
    );
    expect(tables.rows[0]?.n).toBe(10);
  });

  it('PUBLIC holds no privilege on sf_workflow tables', async () => {
    const r = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.role_table_grants
        WHERE table_schema = 'sf_workflow' AND grantee = 'PUBLIC'`,
    );
    expect(r.rows[0]?.n).toBe(0);
  });
});
