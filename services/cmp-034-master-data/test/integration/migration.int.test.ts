import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

let h: Harness;
const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('CMP-034 migration static + live checks', () => {
  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('creates schema, privilege role, FORCE RLS, and sf_migrator ownership', async () => {
    const present = await h.admin.query(
      "SELECT 1 FROM pg_namespace WHERE nspname = 'sf_master_data'",
    );
    expect(present.rowCount).toBe(1);
    const role = await h.admin.query(
      `SELECT rolname, rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = 'sf_cmp034_rw'`,
    );
    expect(role.rows[0]).toMatchObject({
      rolname: 'sf_cmp034_rw',
      rolcanlogin: false,
      rolbypassrls: false,
    });
    const rls = await h.admin.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_master_data'
          AND c.relkind = 'r'
          AND c.relname IN (
            'code_set','code_set_version','code_value','code_set_binding'
          )`,
    );
    expect(rls.rows.length).toBe(4);
    expect(rls.rows.every((r) => r.relforcerowsecurity)).toBe(true);
    const owner = await h.admin.query(
      `SELECT tableowner FROM pg_tables
        WHERE schemaname = 'sf_master_data' AND tablename = 'code_set'`,
    );
    expect(owner.rows[0]?.tableowner).toBe('sf_migrator');
  });

  it('SQL follows ADR-0006 / outbox template rules', async () => {
    const a = readFileSync(
      join(root, 'db/migrations/1759501100000_cmp-034-master-data.sql'),
      'utf8',
    );
    const b = readFileSync(join(root, 'db/migrations/1759501100001_cmp-034-outbox.sql'), 'utf8');
    expect(a + b).not.toMatch(/ALTER ROLE sf_app/i);
    expect(a).not.toMatch(/CREATE ROLE\s+\S+\s+IF NOT EXISTS/i);
    expect(a).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'sf_migrator'\)/);
    expect(a).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp034_rw'\)/);
    expect(a).not.toMatch(/DROP ROLE.*sf_migrator/i);
    expect(a).not.toMatch(/GRANT INSERT ON sf_master_data\.code_set TO sf_app/);
    expect(a).not.toContain('sf_jurisdiction');
    expect(b).toMatch(/GRANT INSERT ON sf_master_data.outbox_event TO sf_app/);
    const template = readFileSync(join(root, 'contracts/shared/sql/outbox.template.sql'), 'utf8')
      .replaceAll('{schema}', 'sf_master_data')
      .replaceAll('{cmp}', 'CMP-034')
      .trim();
    expect(b).toContain(template);
  });
});
