import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');

const FROZEN_IDS = [
  'SF-CON-COMMON',
  'SF-CON-REQUEST-CONTEXT',
  'SF-CON-AUTHZ-DECISION',
  'SF-CON-ERROR-RESPONSE',
  'SF-CON-ERROR-CATALOGUE',
  'SF-CON-EVENT-ENVELOPE',
  'SF-CON-IDEMPOTENCY',
  'SF-CON-AUDIT-EVENT',
  'SF-CON-ISOLATION-DECLARATION',
  'SF-CON-DB-SESSION-CONTEXT',
  'SF-CON-OUTBOX',
  'SF-CON-CONNECTOR-BINDING',
  'SF-CON-SIMULATION-MARKER',
] as const;

const M03_CMP = [
  'cmp-001-catalogue',
  'cmp-033-metadata',
  'cmp-034-master-data',
  'cmp-050-studio-portal',
  'cmp-051-maker-checker',
  'cmp-052-versioning',
  'cmp-053-localization',
] as const;

const OWN_SCHEMA: Record<string, string> = {
  'cmp-001-catalogue': 'sf_catalogue',
  'cmp-033-metadata': 'sf_metadata',
  'cmp-034-master-data': 'sf_master_data',
  'cmp-051-maker-checker': 'sf_maker_checker',
  'cmp-052-versioning': 'sf_versioning',
  'cmp-053-localization': 'sf_localization',
};

const PEER_SCHEMAS = [
  'sf_catalogue',
  'sf_metadata',
  'sf_master_data',
  'sf_maker_checker',
  'sf_versioning',
  'sf_localization',
  'sf_tenant_org',
  'sf_jurisdiction',
  'sf_consent_privacy',
  'sf_audit',
  'sf_storage',
  'sf_security',
  'sf_event_bus',
  'sf_integration_hub',
];

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walkTs(dir: string, acc: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'test' || ent.name === 'dist') continue;
      walkTs(p, acc);
    } else if (ent.name.endsWith('.ts') || ent.name.endsWith('.sql')) {
      acc.push(p);
    }
  }
  return acc;
}

const IDENT = /[A-Za-z0-9_]/;

/** True when `schema.table` appears as an identifier, without a non-literal RegExp. */
function mentionsPeerRelation(source: string, schema: string): boolean {
  const needle = `${schema}.`;
  let from = 0;
  while (from <= source.length - needle.length) {
    const i = source.indexOf(needle, from);
    if (i < 0) return false;
    const prev = i === 0 ? '' : source.charAt(i - 1);
    const next = source.charAt(i + needle.length);
    if ((prev === '' || !IDENT.test(prev)) && IDENT.test(next)) return true;
    from = i + needle.length;
  }
  return false;
}

describe('SF-M03-SEC static isolation (not CERTIFIED)', () => {
  it('frozen contracts lock is 13/13 MATCH', () => {
    const lockText = readFileSync(join(ROOT, 'orchestrator/contracts-lock.yaml'), 'utf8');
    const ids = [...lockText.matchAll(/^\s+- id: (SF-CON-[A-Z0-9-]+)/gm)].map((m) => m[1]);
    expect(ids.sort()).toEqual([...FROZEN_IDS].sort());
    expect(ids).toHaveLength(13);
    const gate = execFileSync('python3', ['scripts/gates/contracts_lock_gate.py'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(gate).toMatch(/PASS \[contracts-lock\]/);
    const hashes = [...lockText.matchAll(/schema_hash: ([0-9a-f]{64})/g)].map((m) => m[1]);
    expect(hashes).toHaveLength(13);
    const paths = [...lockText.matchAll(/^\s+path: "?([^"\s]+)"?/gm)].map((m) => m[1]);
    expect(paths).toHaveLength(13);
    for (let i = 0; i < paths.length; i += 1) {
      expect(sha256(join(ROOT, paths[i] ?? '')), paths[i]).toBe(hashes[i]);
    }
  });

  it('uniqueness envelope stays READY / dispatched false', () => {
    const handover = readFileSync(join(ROOT, 'orchestrator/handovers/SF-M03-SEC.yaml'), 'utf8');
    const task = readFileSync(join(ROOT, 'orchestrator/tasks/SF-M03-SEC.yaml'), 'utf8');
    expect(handover).toMatch(/^state: READY$/m);
    expect(handover).toMatch(/^dispatched: false$/m);
    expect(task).toMatch(/^state: READY$/m);
    expect(task).toMatch(/^dispatched: false$/m);
    const out = execFileSync('python3', ['scripts/gates/cg01_path_uniqueness_gate.py'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out).toMatch(/PASS/);
  });

  it('CMP-050 is not a Fastify host plugin; CMP-054 is not an API plugin', () => {
    const host = readFileSync(join(ROOT, 'apps/api/src/composition/m03.ts'), 'utf8');
    const app = readFileSync(join(ROOT, 'apps/api/src/app.ts'), 'utf8');
    const registerFn = host.slice(host.indexOf('export async function registerM03Plugins'));
    expect(registerFn).not.toMatch(/registerStudio|cmp-050-studio|ui-ux4g|web-studio|web-admin/);
    expect(registerFn).toMatch(/mounted\.push\('CMP-001'\)/);
    expect(registerFn).not.toMatch(/mounted\.push\('CMP-050'\)/);
    expect(registerFn).not.toMatch(/mounted\.push\('CMP-054'\)/);
    expect(registerFn).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b/);
    expect(app).not.toMatch(/cmp-050-studio/);
    const studioIdx = readFileSync(
      join(ROOT, 'services/cmp-050-studio-portal/src/index.ts'),
      'utf8',
    );
    expect(studioIdx).not.toMatch(/fastify|FastifyPlugin/);
    const ux = readFileSync(join(ROOT, 'packages/ui-ux4g/src/index.ts'), 'utf8');
    expect(ux).not.toMatch(/fastify|registerPlugin/);
    const uxPkg = JSON.parse(readFileSync(join(ROOT, 'packages/ui-ux4g/package.json'), 'utf8')) as {
      name: string;
    };
    expect(uxPkg.name).toBe('@serviceform/ui-ux4g');
  });

  it('M03 service sources do not run cross-component SQL and reject client tenant headers', () => {
    for (const cmp of M03_CMP) {
      const srcDir = join(ROOT, 'services', cmp, 'src');
      const files = walkTs(srcDir);
      expect(files.length).toBeGreaterThan(0);
      const own = OWN_SCHEMA[cmp];
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        if (file.endsWith('headers.ts') || file.endsWith('context.ts')) {
          expect(text, file).toMatch(/isForbiddenHeaderName|assertNoTenantIdentifyingHeaders/);
        }
        if (!own) continue;
        for (const peer of PEER_SCHEMAS) {
          if (peer === own) continue;
          expect(mentionsPeerRelation(text, peer), `${file} mentions ${peer}`).toBe(false);
        }
      }
    }
  });

  it('migrations keep FORCE RLS and published-version guards on M03 tenant tables', () => {
    const migrations = [
      'db/migrations/1759510000000_cmp-001-catalogue.sql',
      'db/migrations/1759500933000_cmp-033-metadata.sql',
      'db/migrations/1759501100000_cmp-034-master-data.sql',
      'db/migrations/1759520510000_cmp-051-maker-checker.sql',
      'db/migrations/1759520520000_cmp-052-versioning.sql',
      'db/migrations/1759500800000_cmp-053-localization.sql',
    ];
    for (const rel of migrations) {
      const sql = readFileSync(join(ROOT, rel), 'utf8');
      expect(sql, rel).toMatch(/ENABLE ROW LEVEL SECURITY/);
      expect(sql, rel).toMatch(/FORCE ROW LEVEL SECURITY/);
      expect(sql, rel).not.toMatch(/BYPASSRLS\s*=\s*true/i);
    }
    const catalogue = readFileSync(
      join(ROOT, 'db/migrations/1759510000000_cmp-001-catalogue.sql'),
      'utf8',
    );
    expect(catalogue).toMatch(/enforce_offering_version_pin/);
    expect(catalogue).toMatch(/offering_version_immutable/);
    const metadata = readFileSync(
      join(ROOT, 'db/migrations/1759500933000_cmp-033-metadata.sql'),
      'utf8',
    );
    expect(metadata).toMatch(/prevent_published_mutation/);
    const versioning = readFileSync(
      join(ROOT, 'db/migrations/1759520520000_cmp-052-versioning.sql'),
      'utf8',
    );
    expect(versioning).toMatch(/prevent_published_binding_mutation/);
  });

  it('OPA authorize ports are wired; plugins do not default-allow', () => {
    const authzFiles = [
      'services/cmp-001-catalogue/src/authz.ts',
      'services/cmp-033-metadata/src/authz.ts',
      'services/cmp-034-master-data/src/authz.ts',
      'services/cmp-051-maker-checker/src/authz.ts',
      'services/cmp-052-versioning/src/authz.ts',
      'services/cmp-053-localization/src/authz.ts',
    ];
    for (const rel of authzFiles) {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      expect(text, rel).toMatch(/allow/);
      expect(text, rel).not.toMatch(/allow:\s*true\s*,\s*reason_code:\s*'ALWAYS'/);
    }
  });
});
