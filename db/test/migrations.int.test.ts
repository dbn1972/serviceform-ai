import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DB_DIR, migrate, withClient } from './helpers.js';

const files = readdirSync(join(DB_DIR, 'migrations')).filter((f) => f.endsWith('.sql'));

async function reset() {
  await withClient(async (c) => {
    await c.query('DROP SCHEMA IF EXISTS sf_platform CASCADE');
    await c.query(
      "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sf_app') THEN DROP OWNED BY sf_app; DROP ROLE sf_app; END IF; END $$",
    );
  });
}

describe('migration framework (REQ: AWS v1.7 s17 M0; Eng v1.4 s9.1 G2 migration evidence)', () => {
  beforeAll(reset);

  it('applies every migration from an empty database', async () => {
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

  it('creates the application group role without BYPASSRLS (TI v1.0 s8.1)', async () => {
    const role = await withClient(
      async (c) =>
        (
          await c.query(
            'SELECT rolbypassrls, rolsuper, rolcanlogin FROM pg_roles WHERE rolname = $1',
            ['sf_app'],
          )
        ).rows[0],
    );
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false, rolcanlogin: false });
  });

  it('removes CREATE on public from PUBLIC', async () => {
    const canCreate = await withClient(
      async (c) =>
        (await c.query("SELECT has_schema_privilege('sf_app', 'public', 'CREATE') AS ok")).rows[0]
          .ok,
    );
    expect(canCreate).toBe(false);
  });

  it('rolls every migration back and re-applies cleanly', async () => {
    migrate('down', files.length);
    const roleAfterDown = await withClient(
      async (c) => (await c.query("SELECT 1 FROM pg_roles WHERE rolname='sf_app'")).rowCount,
    );
    expect(roleAfterDown).toBe(0);
    migrate('up');
    const count = await withClient(
      async (c) =>
        (await c.query('SELECT count(*)::int AS n FROM sf_platform.sf_schema_migrations')).rows[0]
          .n,
    );
    expect(count).toBe(files.length);
  });

  it('is idempotent when re-run with nothing pending', () => {
    expect(migrate('up')).toMatch(/No migrations to run/);
  });
});
