import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertOwnSchemaSql } from '../../src/sql.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const repoRoot = join(root, '../..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const src = files(join(root, 'src')).filter((f) => f.endsWith('.ts'));
const upMigration = readFileSync(
  join(repoRoot, 'db/migrations/1759540280000_cmp-028-appeal-review.sql'),
  'utf8',
).split('-- Down Migration')[0] as string;

describe('cross-component direct SQL is rejected', () => {
  it.each([
    'SELECT * FROM sf_application_case.application',
    'UPDATE sf_application_case.application SET state = $1',
    'SELECT * FROM sf_workflow.instance',
    'INSERT INTO sf_audit.audit_ledger VALUES ($1)',
    'SELECT * FROM sf_appeal.appeal t JOIN sf_application_case.application a ON true',
  ])('guard refuses: %s', (sql) => {
    expect(() => assertOwnSchemaSql(sql)).toThrowError(/Unexpected server error/);
  });

  it('allows the component schema and shared session accessor only', () => {
    expect(() =>
      assertOwnSchemaSql('SELECT * FROM sf_appeal.appeal WHERE tenant_id = $1'),
    ).not.toThrow();
    expect(() => assertOwnSchemaSql('SELECT sf_platform.current_tenant_id()')).not.toThrow();
  });

  it('source never names another schema, imports another component, a driver, or the network', () => {
    for (const f of src) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\b(sf_[a-z0-9_]+)\./g)) {
        expect(['sf_appeal'], `${f}: ${m[1]}`).toContain(m[1]);
      }
      expect(text, f).not.toMatch(/from '[^']*services\/cmp-/);
      expect(text, f).not.toMatch(/from '\.\.\/\.\.\/cmp-/);
      expect(text, f).not.toMatch(/from '(pg|fastify|undici|node:https?|node:net)'/);
      expect(text, f).not.toMatch(/\bfetch\(/);
    }
  });

  it('migration references no foreign schema, grants nothing to PUBLIC, and no DML to sf_app', () => {
    const foreign = [...upMigration.matchAll(/\b(sf_[a-z0-9_]+)\./g)].map((m) => m[1]);
    expect(new Set(foreign)).toEqual(new Set(['sf_appeal', 'sf_platform']));
    expect(upMigration).not.toMatch(/GRANT[^;]*\bTO PUBLIC\b/i);
    expect(upMigration).not.toMatch(
      /GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*sf_appeal[^;]*TO sf_app/i,
    );
  });
});

describe('migration safety (ADR-0006)', () => {
  it('uses NOLOGIN, no SUPERUSER/BYPASSRLS, FORCE RLS and policies on current_tenant_id()', () => {
    expect(upMigration).toMatch(/CREATE ROLE sf_cmp028_rw NOLOGIN NOSUPERUSER[^;]*NOBYPASSRLS/);
    expect(upMigration).not.toMatch(/(?<!NO)SUPERUSER/);
    expect(upMigration).not.toMatch(/(?<!NO)BYPASSRLS/);
    for (const t of ['appeal', 'appeal_history', 'assist_note', 'idempotency_record']) {
      expect(upMigration).toContain(`ALTER TABLE sf_appeal.${t} ENABLE ROW LEVEL SECURITY`);
      expect(upMigration).toContain(`ALTER TABLE sf_appeal.${t} FORCE ROW LEVEL SECURITY`);
      expect(upMigration).toContain(`ALTER TABLE sf_appeal.${t} OWNER TO sf_migrator`);
    }
    expect(upMigration.match(/sf_platform\.current_tenant_id\(\)/g)?.length).toBeGreaterThanOrEqual(
      8,
    );
  });
});
