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
  join(repoRoot, 'db/migrations/1759540180000_cmp-018-inspection-verification.sql'),
  'utf8',
).split('-- Down Migration')[0] as string;

describe('cross-component direct SQL is rejected', () => {
  it.each([
    'SELECT * FROM sf_application_case.application',
    'UPDATE sf_cases.application SET state = $1',
    'SELECT * FROM sf_evidence.requirement',
    'SELECT * FROM sf_docintel.intelligence_job',
    'SELECT * FROM sf_tasks.human_task',
    'SELECT * FROM sf_inspection.inspection i JOIN sf_application_case.application a ON true',
  ])('guard refuses: %s', (sql) => {
    expect(() => assertOwnSchemaSql(sql)).toThrowError(/Unexpected server error/);
  });

  it('allows the component schema and shared session accessor only', () => {
    expect(() =>
      assertOwnSchemaSql('SELECT * FROM sf_inspection.inspection WHERE tenant_id = $1'),
    ).not.toThrow();
    expect(() => assertOwnSchemaSql('SELECT sf_platform.current_tenant_id()')).not.toThrow();
  });

  it('source never names another schema, imports another component, a driver, CMP-012, or the network', () => {
    for (const f of src) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\b(sf_[a-z0-9_]+)\./g)) {
        expect(['sf_inspection'], `${f}: ${m[1]}`).toContain(m[1]);
      }
      expect(text, f).not.toMatch(/from '[^']*services\/cmp-/);
      expect(text, f).not.toMatch(/services\/cmp-012/);
      expect(text, f).not.toMatch(/from '(pg|fastify|undici|node:https?|node:net)'/);
      expect(text, f).not.toMatch(/\bfetch\(/);
    }
  });

  it('migration references no foreign schema, grants nothing to PUBLIC, and no DML to sf_app', () => {
    const foreign = [...upMigration.matchAll(/\b(sf_[a-z0-9_]+)\./g)].map((m) => m[1]);
    expect(new Set(foreign)).toEqual(new Set(['sf_inspection', 'sf_platform']));
    expect(upMigration).not.toMatch(/GRANT[^;]*\bTO PUBLIC\b/i);
    expect(upMigration).not.toMatch(
      /GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*sf_inspection[^;]*TO sf_app/i,
    );
  });
});

describe('migration safety (ADR-0006)', () => {
  it('uses NOLOGIN, no SUPERUSER/BYPASSRLS, FORCE RLS, runtime is not owner', () => {
    expect(upMigration).toMatch(/CREATE ROLE sf_cmp018_rw NOLOGIN NOSUPERUSER[^;]*NOBYPASSRLS/);
    expect(upMigration).not.toMatch(/(?<!NO)SUPERUSER/);
    expect(upMigration).not.toMatch(/(?<!NO)BYPASSRLS/);
    for (const t of [
      'inspection',
      'inspection_history',
      'checklist_item',
      'observation',
      'evidence_ref',
      'finding',
      'idempotency_record',
    ]) {
      expect(upMigration).toContain(`ALTER TABLE sf_inspection.${t} ENABLE ROW LEVEL SECURITY`);
      expect(upMigration).toContain(`ALTER TABLE sf_inspection.${t} FORCE ROW LEVEL SECURITY`);
      expect(upMigration).toContain(`ALTER TABLE sf_inspection.${t} OWNER TO sf_migrator`);
    }
    expect(upMigration.match(/sf_platform\.current_tenant_id\(\)/g)?.length).toBeGreaterThanOrEqual(
      14,
    );
  });

  it('verification_result cannot be statutory approval and statutory_effect is constrained false', () => {
    expect(upMigration).toContain("'VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE', 'DEFICIENCY_NOTED'");
    expect(upMigration).toContain(
      'statutory_effect boolean NOT NULL DEFAULT false CHECK (statutory_effect = false)',
    );
    expect(upMigration).not.toMatch(/'APPROVED'|RECORD_APPROVED/);
  });
});
