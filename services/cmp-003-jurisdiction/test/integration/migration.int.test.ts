import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

let h: Harness;
const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('CMP-003 migration static + live checks', () => {
  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('creates schema, privilege role, FORCE RLS, and sf_migrator ownership', async () => {
    const present = await h.admin.query(
      "SELECT 1 FROM pg_namespace WHERE nspname = 'sf_jurisdiction'",
    );
    expect(present.rowCount).toBe(1);
    const role = await h.admin.query(
      `SELECT rolname, rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = 'sf_cmp003_rw'`,
    );
    expect(role.rows[0]).toMatchObject({
      rolname: 'sf_cmp003_rw',
      rolcanlogin: false,
      rolbypassrls: false,
    });
    const rls = await h.admin.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_jurisdiction'
          AND c.relkind = 'r'
          AND c.relname IN (
            'jurisdiction','jurisdiction_type','jurisdiction_relation','jurisdiction_binding'
          )`,
    );
    expect(rls.rows.length).toBe(4);
    expect(rls.rows.every((r) => r.relforcerowsecurity)).toBe(true);
    const owner = await h.admin.query(
      `SELECT tableowner FROM pg_tables
        WHERE schemaname = 'sf_jurisdiction' AND tablename = 'jurisdiction'`,
    );
    expect(owner.rows[0]?.tableowner).toBe('sf_migrator');
  });

  it('SQL follows ADR-0006 / outbox template rules and avoids hard-coded levels', async () => {
    const a = readFileSync(
      join(root, 'db/migrations/1759500600000_cmp-003-jurisdiction.sql'),
      'utf8',
    );
    const b = readFileSync(join(root, 'db/migrations/1759500600001_cmp-003-outbox.sql'), 'utf8');
    expect(a + b).not.toMatch(/ALTER ROLE sf_app/i);
    expect(a).not.toMatch(/CREATE ROLE\s+\S+\s+IF NOT EXISTS/i);
    expect(a).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'sf_migrator'\)/);
    expect(a).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp003_rw'\)/);
    expect(a).not.toMatch(/DROP ROLE.*sf_migrator/i);
    expect(a).not.toMatch(/GRANT INSERT ON sf_jurisdiction\.jurisdiction TO sf_app/);
    expect(a).not.toMatch(/\b(STATE|DISTRICT|VILLAGE|TALUKA)\b/);
    expect(a).not.toContain('sf_tenant_org');
    expect(b).toMatch(/GRANT INSERT ON sf_jurisdiction.outbox_event TO sf_app/);
    const template = readFileSync(join(root, 'contracts/shared/sql/outbox.template.sql'), 'utf8')
      .replaceAll('{schema}', 'sf_jurisdiction')
      .replaceAll('{cmp}', 'CMP-003')
      .trim();
    expect(b).toContain(template);
    expect(b.indexOf(template)).toBeLessThan(
      b.indexOf('ALTER TABLE sf_jurisdiction.outbox_event OWNER TO sf_migrator'),
    );
  });
});
