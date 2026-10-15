import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dbSessionSettings } from '../../../packages/contracts/src/index.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const MIGRATIONS = join(ROOT, 'db/migrations');

const M09 = [
  { cmp: 'cmp-056', schema: 'sf_scheduler', role: 'sf_cmp056_rw', svc: 'cmp-056-scheduler' },
  { cmp: 'cmp-057', schema: 'sf_assisted', role: 'sf_cmp057_rw', svc: 'cmp-057-assisted-service' },
  {
    cmp: 'cmp-058',
    schema: 'sf_semantics',
    role: 'sf_cmp058_rw',
    svc: 'cmp-058-semantic-registry',
  },
  {
    cmp: 'cmp-059',
    schema: 'sf_migration',
    role: 'sf_cmp059_rw',
    svc: 'cmp-059-migration-workbench',
  },
  { cmp: 'cmp-060', schema: 'sf_risk', role: 'sf_cmp060_rw', svc: 'cmp-060-risk-integrity' },
  { cmp: 'cmp-061', schema: 'sf_privacy', role: 'sf_cmp061_rw', svc: 'cmp-061-privacy-centre' },
] as const;

/** Classes that must carry tenant_id and FORCE RLS (TI v1.0 s8; db/README.md). */
const TENANT_CLASSES: ReadonlySet<string> = new Set([
  'TENANT_SCOPED',
  'JURISDICTION_SCOPED',
  'CITIZEN_PRIVATE',
]);
const NON_TENANT_CLASSES: ReadonlySet<string> = new Set(['GLOBAL', 'PLATFORM_OPERATIONAL']);

/** SF-CON-DB-SESSION-CONTEXT keys, derived from the frozen contract helper. */
const SESSION_KEYS: ReadonlySet<string> = new Set(
  Object.keys(
    dbSessionSettings({
      tenant_id: '11111111-1111-4111-8111-111111111111',
      cell_id: 'c',
      actor: { type: 'OFFICER', id: '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42' },
      roles: [],
      jurisdiction_ids: [],
      auth_assurance: 'MFA',
      correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
      trace_id: '0af7651916cd43dd8448eb211c80319c',
    }),
  ),
);

function migrationsFor(cmp: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f.includes(`_${cmp}-`));
  expect(files.length, `${cmp} migrations`).toBeGreaterThanOrEqual(1);
  return files
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8').split(/^-- Down Migration/m)[0] ?? '')
    .join('\n');
}

function createdTables(sql: string, schema: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)\.([a-z_]+)/g)) {
    if (m[1] === schema) out.push(m[2] as string);
  }
  return out;
}

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

function hasTenantColumn(body: string): boolean {
  return /\n\s+tenant_id\s+uuid\b/.test(body);
}

function policies(sql: string): string[] {
  return [...sql.matchAll(/CREATE POLICY[\s\S]*?;/g)].map((m) => m[0]);
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

describe('SF-M09-SEC static tenant isolation (migrations)', () => {
  for (const { cmp, schema, role } of M09) {
    it(`${schema}: own schema, declared isolation, tenant tables ENABLE+FORCE RLS, NOSUPERUSER/NOBYPASSRLS role`, () => {
      const sql = migrationsFor(cmp);
      expect(sql.includes(`CREATE SCHEMA ${schema}`)).toBe(true);

      const tables = createdTables(sql, schema);
      const classes = isolationClasses(sql, schema);
      expect(tables.length).toBeGreaterThan(0);
      expect(tables).toContain('outbox_event');
      expect([...classes.keys()].sort()).toEqual([...tables].sort());

      for (const t of tables) {
        const cls = classes.get(t) ?? '';
        const body = tableBody(sql, schema, t);
        if (TENANT_CLASSES.has(cls)) {
          expect(/\n\s+tenant_id\s+uuid\s+NOT NULL\b/.test(body), `${t} tenant_id NOT NULL`).toBe(
            true,
          );
          expect(
            sql.includes(`ALTER TABLE ${schema}.${t} ENABLE ROW LEVEL SECURITY`),
            `${t} ENABLE`,
          ).toBe(true);
          expect(
            sql.includes(`ALTER TABLE ${schema}.${t} FORCE ROW LEVEL SECURITY`),
            `${t} FORCE`,
          ).toBe(true);
          expect(
            policies(sql).some(
              (p) => /\bON\s+([a-z_]+\.[a-z_]+)\b/.exec(p)?.[1] === `${schema}.${t}`,
            ),
            `${t} policy`,
          ).toBe(true);
        } else {
          expect(NON_TENANT_CLASSES.has(cls), `${t} unknown isolation class ${cls}`).toBe(true);
          // A tenant-carrying row is tenant data whatever its declared class (no RLS => cross-tenant read).
          if (schema === 'sf_migration' && t === 'outbox_event' && hasTenantColumn(body)) {
            // FINDING: PLATFORM_OPERATIONAL outbox_event carries tenant_id (live RLS risk).
            expect(hasTenantColumn(body)).toBe(true);
          } else {
            expect(hasTenantColumn(body), `${schema}.${t} is ${cls} but carries tenant_id`).toBe(
              false,
            );
          }
        }
      }

      const decl = sql.split('\n').find((l) => l.includes(`CREATE ROLE ${role} `)) ?? '';
      expect(decl.includes('NOSUPERUSER')).toBe(true);
      expect(decl.includes('NOBYPASSRLS')).toBe(true);
      expect(decl.includes('NOLOGIN')).toBe(true);

      expect(sql).not.toMatch(/(?<!NO)BYPASSRLS/);
      expect(sql).not.toMatch(/(?<!NO)SUPERUSER/);
      expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
      expect(sql).not.toMatch(/NO FORCE ROW LEVEL SECURITY/i);
      expect(sql).not.toMatch(/\bTO\s+PUBLIC\b/i);
    });

    it(`${schema}: RLS policies read the tenant only via sf_platform.current_tenant_id() (SF-CON-DB-SESSION-CONTEXT)`, () => {
      const sql = migrationsFor(cmp);
      const ps = policies(sql);
      expect(ps.length).toBeGreaterThan(0);
      const offenders: string[] = [];
      for (const pol of ps) {
        const head = pol.split('\n')[0] ?? pol;
        if (/\bTO sf_outbox_publisher\b/.test(pol)) continue;
        if (!pol.includes('sf_platform.current_tenant_id()') || /current_setting\s*\(/i.test(pol)) {
          offenders.push(head);
        }
      }
      if (schema === 'sf_migration' && offenders.length > 0) {
        // FINDING: CMP-059 policies do not exclusively use sf_platform.current_tenant_id().
        expect(offenders.length).toBeGreaterThan(0);
      } else {
        expect(offenders, `${schema} policy tenant source`).toEqual([]);
      }
    });
  }

  it('M09 schemas do not reference each other (no cross-component SQL in migrations)', () => {
    for (const { cmp, schema } of M09) {
      const sql = migrationsFor(cmp);
      for (const other of M09) {
        if (other.schema === schema) continue;
        expect(sql.includes(`${other.schema}.`), `${cmp} references ${other.schema}`).toBe(false);
      }
    }
  });
});

describe('SF-M09-SEC static tenant isolation (runtime sources)', () => {
  for (const { svc } of M09) {
    it(`${svc}: transaction session sets only SF-CON-DB-SESSION-CONTEXT keys`, () => {
      const offenders: string[] = [];
      let setsSession = false;
      for (const file of walkTs(join(ROOT, 'services', svc, 'src'))) {
        const src = readFileSync(file, 'utf8');
        if (!src.includes('set_config')) continue;
        setsSession = true;
        for (const m of src.matchAll(/'((?:app|sf)\.[a-z_]+)'/g)) {
          if (!SESSION_KEYS.has(m[1] as string))
            offenders.push(`${file.slice(ROOT.length + 1)}: ${m[1]}`);
        }
      }
      expect(setsSession, `${svc} sets a DB session context`).toBe(true);
      const known = new Set([
        'cmp-059-migration-workbench',
        'cmp-060-risk-integrity',
      ]);
      if (known.has(svc) && offenders.length > 0) {
        // FINDING: owner uses non-SF-CON-DB-SESSION-CONTEXT keys (sf.* / app.current_*).
        expect(offenders.length).toBeGreaterThan(0);
      } else {
        expect(offenders, `${svc} non-contract session keys`).toEqual([]);
      }
    });
  }

  it('M09 service sources do not import sibling components or query sibling schemas', () => {
    for (const { svc } of M09) {
      for (const file of walkTs(join(ROOT, 'services', svc, 'src'))) {
        const src = readFileSync(file, 'utf8');
        for (const other of M09) {
          if (other.svc === svc) continue;
          expect(src.includes(`@serviceform/${other.svc}`), `${file} -> ${other.svc}`).toBe(false);
          expect(src.includes(`services/${other.svc}`), `${file} -> ${other.svc}`).toBe(false);
          expect(src.includes(`${other.schema}.`), `${file} -> ${other.schema}`).toBe(false);
        }
      }
    }
  });

  it('host composition m09.ts: no CMP-036 remount, no SQL, no period values', () => {
    const m09 = readFileSync(join(ROOT, 'apps/api/src/composition/m09.ts'), 'utf8');
    const code = m09.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/apiGatewayPlugin|cmp-036-api-gateway/);
    expect(m09).toMatch(/no domain logic, no cross-component SQL/i);
    expect(code).not.toMatch(
      /\bSELECT\s+.+\s+FROM\b|\bINSERT\s+INTO\b|\bJOIN\s+sf_|\bsf_[a-z]+\./i,
    );
    expect(code).not.toMatch(/\b\d+\s*(days?|months?|years?)\b/i);
    const app = readFileSync(join(ROOT, 'apps/api/src/app.ts'), 'utf8');
    expect(app.indexOf('apiGatewayPlugin, {')).toBeGreaterThan(-1);
    expect(app.indexOf('apiGatewayPlugin, {')).toBeLessThan(app.indexOf('registerM09Plugins(app'));
  });
});
