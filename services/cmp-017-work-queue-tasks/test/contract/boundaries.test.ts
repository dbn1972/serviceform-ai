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
  join(repoRoot, 'db/migrations/1759540170000_cmp-017-work-queue-tasks.sql'),
  'utf8',
).split('-- Down Migration')[0] as string;

describe('cross-component direct SQL is rejected', () => {
  it.each([
    'SELECT * FROM sf_workflow.instance',
    'UPDATE sf_cases.application SET state = $1',
    'INSERT INTO sf_audit.audit_ledger VALUES ($1)',
    'SELECT 1 FROM sf_tenant_org.tenant',
    'select * from SF_Docintel.intelligence_job',
    'SELECT * FROM sf_tasks.human_task t JOIN sf_workflow.node n ON true',
  ])('guard refuses: %s', (sql) => {
    expect(() => assertOwnSchemaSql(sql)).toThrowError(/Unexpected server error/);
  });

  it('allows the component schema and shared session accessor only', () => {
    expect(() =>
      assertOwnSchemaSql('SELECT * FROM sf_tasks.human_task WHERE tenant_id = $1'),
    ).not.toThrow();
    expect(() => assertOwnSchemaSql('SELECT sf_platform.current_tenant_id()')).not.toThrow();
    expect(() => assertOwnSchemaSql('SELECT set_config($1, $2, true)')).not.toThrow();
  });

  it('source never names another schema, imports another component, a driver, or the network', () => {
    for (const f of src) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\b(sf_[a-z0-9_]+)\./g)) {
        expect(['sf_tasks'], `${f}: ${m[1]}`).toContain(m[1]);
      }
      expect(text, f).not.toMatch(/from '[^']*services\/cmp-/);
      expect(text, f).not.toMatch(/from '\.\.\/\.\.\/cmp-/);
      expect(text, f).not.toMatch(/from '(pg|fastify|undici|node:https?|node:net)'/);
      expect(text, f).not.toMatch(/\bfetch\(/);
    }
  });

  it('migration references no foreign schema, grants nothing to PUBLIC, and no DML to sf_app', () => {
    const foreign = [...upMigration.matchAll(/\b(sf_[a-z0-9_]+)\./g)].map((m) => m[1]);
    expect(new Set(foreign)).toEqual(new Set(['sf_tasks', 'sf_platform']));
    expect(upMigration).not.toMatch(/GRANT[^;]*\bTO PUBLIC\b/i);
    expect(upMigration).not.toMatch(
      /GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*sf_tasks[^;]*TO sf_app/i,
    );
    expect(upMigration).not.toMatch(/REFERENCES\s+(?!sf_tasks\.)sf_[a-z_]+\./i);
  });
});

describe('migration safety (ADR-0006, Constitution #6, #19)', () => {
  it('uses NOLOGIN, no SUPERUSER/BYPASSRLS, FORCE RLS and policies on current_tenant_id()', () => {
    expect(upMigration).toMatch(/CREATE ROLE sf_cmp017_rw NOLOGIN NOSUPERUSER[^;]*NOBYPASSRLS/);
    expect(upMigration).not.toMatch(/(?<!NO)SUPERUSER/);
    expect(upMigration).not.toMatch(/(?<!NO)BYPASSRLS/);
    expect(upMigration).not.toMatch(/\bLOGIN\b(?<!NOLOGIN)/);
    for (const t of ['human_task', 'task_history', 'idempotency_record']) {
      expect(upMigration).toContain(`ALTER TABLE sf_tasks.${t} ENABLE ROW LEVEL SECURITY`);
      expect(upMigration).toContain(`ALTER TABLE sf_tasks.${t} FORCE ROW LEVEL SECURITY`);
      expect(upMigration).toContain(`ALTER TABLE sf_tasks.${t} OWNER TO sf_migrator`);
    }
    expect(upMigration.match(/sf_platform\.current_tenant_id\(\)/g)?.length).toBeGreaterThanOrEqual(
      6,
    );
    expect(upMigration).not.toMatch(/current_setting\s*\(/i);
  });

  it('has no column that can hold a named officer in published assignment metadata', () => {
    const columns = [
      ...upMigration.matchAll(
        /^\s{2}([a-z_]+) (?:uuid|text|integer|bigint|timestamptz|jsonb|boolean)/gm,
      ),
    ].map((m) => m[1] as string);
    const personLike = columns.filter((c) =>
      /(officer|assignee|employee|staff|person|user|email|phone|name)/.test(c),
    );
    expect(personLike).toEqual([]);
    expect(columns.filter((c) => /principal/.test(c)).sort()).toEqual([
      'claimed_principal_id',
      'claimed_principal_id',
      'principal_id',
    ]);
  });

  it('service tests and fixtures stay free of secrets and personal data', () => {
    for (const f of [...src, ...files(join(root, 'test'))]) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
      expect(text, f).not.toMatch(/\b\d{4}\s\d{4}\s\d{4}\b/);
      expect(text, f).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
    }
  });
});
