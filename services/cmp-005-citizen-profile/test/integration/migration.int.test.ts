import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

let h: Harness;
const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('CMP-005 migration static checks', () => {
  beforeAll(async () => {
    h = await setupHarness();
  });
  afterAll(async () => {
    await closeHarness(h);
  });

  it('creates schema/role with FORCE RLS and ADR-0006 grants', async () => {
    const present = await h.admin.query(
      "SELECT 1 FROM pg_namespace WHERE nspname = 'sf_citizen_profile'",
    );
    expect(present.rowCount).toBe(1);
    const role = await h.admin.query(
      `SELECT rolname, rolcanlogin, rolbypassrls, rolsuper
         FROM pg_roles WHERE rolname = 'sf_cmp005_rw'`,
    );
    expect(role.rows[0]).toMatchObject({
      rolcanlogin: false,
      rolbypassrls: false,
      rolsuper: false,
    });
    const tables = await h.admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_citizen_profile' AND c.relkind = 'r'
          AND c.relname IN (
            'citizen_profile','profile_claim','idempotency_record','outbox_event','inbox_event'
          )`,
    );
    expect(tables.rowCount).toBe(5);
    for (const r of tables.rows) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.relforcerowsecurity, r.relname).toBe(true);
    }
  });

  it('SQL keeps frozen outbox grants and guarded role creates', () => {
    const a = readFileSync(
      join(root, 'db/migrations/1759500800000_cmp-005-citizen-profile.sql'),
      'utf8',
    );
    const b = readFileSync(join(root, 'db/migrations/1759500800001_cmp-005-outbox.sql'), 'utf8');
    expect(a + b).not.toMatch(/ALTER ROLE sf_app/i);
    expect(a).not.toMatch(/CREATE ROLE\s+\S+\s+IF NOT EXISTS/i);
    expect(a).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'sf_migrator'\)/);
    expect(a).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp005_rw'\)/);
    expect(a).not.toMatch(/DROP ROLE.*sf_migrator/i);
    expect(a).not.toMatch(/GRANT INSERT ON sf_citizen_profile\.citizen_profile TO sf_app/);
    expect(b).toMatch(/GRANT INSERT ON sf_citizen_profile.outbox_event TO sf_app/);
    const template = readFileSync(join(root, 'contracts/shared/sql/outbox.template.sql'), 'utf8')
      .replaceAll('{schema}', 'sf_citizen_profile')
      .replaceAll('{cmp}', 'CMP-005')
      .trim();
    expect(b).toContain(template);
  });
});
