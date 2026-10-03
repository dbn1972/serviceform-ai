import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

let h: Harness;
const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('migration static checks (001-42/43)', () => {
  beforeAll(async () => {
    h = await setupHarness();
  });
  afterAll(async () => {
    await closeHarness(h);
  });

  it('SQL does not alter sf_app membership and does not grant business DML to sf_app', async () => {
    const present = await h.admin.query(
      "SELECT 1 FROM pg_namespace WHERE nspname = 'sf_tenant_org'",
    );
    expect(present.rowCount).toBe(1);
    const a = readFileSync(
      join(root, 'db/migrations/1759500100000_cmp-002-tenant-organisation.sql'),
      'utf8',
    );
    const b = readFileSync(join(root, 'db/migrations/1759500100001_cmp-002-outbox.sql'), 'utf8');
    expect(a + b).not.toMatch(/ALTER ROLE sf_app/i);
    expect(a).not.toMatch(/CREATE ROLE\s+\S+\s+IF NOT EXISTS/i);
    expect(a).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'sf_migrator'\)/);
    expect(a).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp002_rw'\)/);
    expect(a).not.toMatch(/DROP ROLE.*sf_migrator/i);
    expect(a).not.toMatch(/GRANT INSERT ON sf_tenant_org\.tenant TO sf_app/);
    expect(b).toMatch(/GRANT INSERT ON sf_tenant_org.outbox_event TO sf_app/);
    const srcDir = join(root, 'services/cmp-002-tenant-organisation/src');
    const { readdirSync } = await import('node:fs');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      );
    const src = walk(srcDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    expect(src).not.toMatch(/set_config\([^)]*,\s*false\s*\)/);
    expect(src).not.toMatch(/SET\s+app\./i);
    const fns = await h.admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_proc p
         JOIN pg_namespace ns ON ns.oid = p.pronamespace
        WHERE ns.nspname = 'sf_tenant_org'
          AND (p.proconfig IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%'
          ))`,
    );
    expect(fns.rows[0]?.n).toBe(0);
  });
});
