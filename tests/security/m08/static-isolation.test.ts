import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const MIGRATIONS = join(ROOT, 'db/migrations');

const M08 = [
  { cmp: 'cmp-006', schema: 'sf_discovery', role: 'sf_cmp006_rw' },
  { cmp: 'cmp-007', schema: 'sf_recommendation', role: 'sf_cmp007_rw' },
  { cmp: 'cmp-035', schema: 'sf_search', role: 'sf_cmp035_rw' },
  { cmp: 'cmp-045', schema: 'sf_analytics', role: 'sf_cmp045_rw' },
  { cmp: 'cmp-046', schema: 'sf_ops_dashboard', role: 'sf_cmp046_rw' },
  { cmp: 'cmp-049', schema: 'sf_retention', role: 'sf_cmp049_rw' },
] as const;

const M08_SERVICES = [
  'cmp-006-service-discovery',
  'cmp-007-recommendation',
  'cmp-035-search-indexing',
  'cmp-045-analytics-mis',
  'cmp-046-operational-dashboard',
  'cmp-049-data-retention',
] as const;

function migrationsFor(cmp: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f.includes(`_${cmp}-`));
  expect(files.length, `${cmp} migrations`).toBeGreaterThanOrEqual(2);
  return files.map((f) => readFileSync(join(MIGRATIONS, f), 'utf8')).join('\n');
}

function createdTables(sql: string, schema: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)\.([a-z_]+)/g)) {
    if (m[1] === schema) out.push(m[2] as string);
  }
  return out;
}

/** `-- sf:isolation <schema>.<table> <CLASS> owner=<CMP>` declarations (SF-CON-ISOLATION-DECLARATION). */
function isolationClasses(sql: string, schema: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of sql.split('\n')) {
    if (!line.startsWith('-- sf:isolation ')) continue;
    const [, , qualified, cls] = line.split(' ');
    if (qualified?.startsWith(`${schema}.`) && cls)
      out.set(qualified.slice(schema.length + 1), cls);
  }
  return out;
}

function tableBody(sql: string, schema: string, table: string): string {
  const start = sql.indexOf(`CREATE TABLE ${schema}.${table} (`);
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf('\n);', start));
}

const PLATFORM_TABLES: ReadonlySet<string> = new Set([
  'outbox_event_platform',
  'inbox_event_platform',
]);

function roleDeclaration(sql: string, role: string): string {
  const line = sql.split('\n').find((l) => l.includes(`CREATE ROLE ${role} `));
  return line ?? '';
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('SF-M08-SEC static tenant isolation (migrations)', () => {
  for (const { cmp, schema, role } of M08) {
    it(`${schema}: own schema, declared isolation, ENABLE+FORCE RLS on tenant tables, NOSUPERUSER/NOBYPASSRLS role`, () => {
      const sql = migrationsFor(cmp);
      expect(sql.includes(`CREATE SCHEMA ${schema}`)).toBe(true);

      const tables = createdTables(sql, schema);
      const classes = isolationClasses(sql, schema);
      expect(tables.length).toBeGreaterThan(0);
      expect(tables).toContain('outbox_event');
      expect(tables).toContain('inbox_event');
      expect([...classes.keys()].sort()).toEqual([...tables].sort());

      for (const t of tables) {
        const cls = classes.get(t);
        if (cls === 'TENANT_SCOPED') {
          expect(
            tableBody(sql, schema, t).includes('\n  tenant_id uuid NOT NULL'),
            `${t} tenant_id`,
          ).toBe(true);
          expect(
            sql.includes(`ALTER TABLE ${schema}.${t} ENABLE ROW LEVEL SECURITY`),
            `${t} ENABLE`,
          ).toBe(true);
          expect(
            sql.includes(`ALTER TABLE ${schema}.${t} FORCE ROW LEVEL SECURITY`),
            `${t} FORCE`,
          ).toBe(true);
          expect(sql.includes(` ON ${schema}.${t} TO `), `${t} policy`).toBe(true);
        } else {
          // Only the frozen outbox template's null-tenant tables may be platform-scoped.
          expect(cls, `${t} isolation class`).toBe('PLATFORM_OPERATIONAL');
          expect(PLATFORM_TABLES.has(t), `${t} unexpected PLATFORM_OPERATIONAL`).toBe(true);
          expect(tableBody(sql, schema, t).includes('\n  tenant_id '), `${t} has tenant_id`).toBe(
            false,
          );
        }
      }

      const decl = roleDeclaration(sql, role);
      expect(decl.includes('NOSUPERUSER')).toBe(true);
      expect(decl.includes('NOBYPASSRLS')).toBe(true);
      expect(decl.includes('NOLOGIN')).toBe(true);

      expect(sql).not.toMatch(/(?<!NO)BYPASSRLS/);
      expect(sql).not.toMatch(/(?<!NO)SUPERUSER/);
      expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
      expect(sql).not.toMatch(/NO FORCE ROW LEVEL SECURITY/i);
      expect(sql).not.toMatch(/\bTO\s+PUBLIC\b/i);
    });
  }

  it('M08 schemas do not reference each other (no cross-component SQL in migrations)', () => {
    for (const { cmp, schema } of M08) {
      const sql = migrationsFor(cmp);
      for (const other of M08) {
        if (other.schema === schema) continue;
        expect(sql.includes(`${other.schema}.`), `${cmp} references ${other.schema}`).toBe(false);
      }
    }
  });

  it('M08 service sources do not import sibling components', () => {
    for (const svc of M08_SERVICES) {
      for (const file of walkTs(join(ROOT, 'services', svc, 'src'))) {
        const src = readFileSync(file, 'utf8');
        for (const other of M08_SERVICES) {
          if (other === svc) continue;
          expect(src.includes(`@serviceform/${other}`), `${file} -> ${other}`).toBe(false);
          expect(src.includes(`services/${other}`), `${file} -> ${other}`).toBe(false);
        }
      }
    }
  });

  it('host composition: no CMP-036 remount, no SQL, no retention period values', () => {
    const m08 = readFileSync(join(ROOT, 'apps/api/src/composition/m08.ts'), 'utf8');
    expect(m08).not.toMatch(/apiGatewayPlugin|cmp-036-api-gateway/);
    expect(m08).toMatch(/No domain logic, no cross-component SQL/);
    expect(m08).not.toMatch(/\bSELECT\s+.+\s+FROM\b|\bINSERT\s+INTO\b|\bJOIN\s+sf_/i);
    expect(m08).not.toMatch(/\b\d+\s*(days?|months?|years?)\b/i);
  });
});
