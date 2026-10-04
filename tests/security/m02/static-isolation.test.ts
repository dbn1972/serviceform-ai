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

const M02_CMP = ['cmp-004-identity-access', 'cmp-005-citizen-profile'] as const;

const OWN_SCHEMA: Record<string, string> = {
  'cmp-004-identity-access': 'sf_identity',
  'cmp-005-citizen-profile': 'sf_citizen_profile',
};

const PEER_SCHEMAS = [
  'sf_identity',
  'sf_citizen_profile',
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

describe('SF-M02-SEC static isolation (not CERTIFIED)', () => {
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
    const handover = readFileSync(join(ROOT, 'orchestrator/handovers/SF-M02-SEC.yaml'), 'utf8');
    const task = readFileSync(join(ROOT, 'orchestrator/tasks/SF-M02-SEC.yaml'), 'utf8');
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

  it('M02 host composition has no SQL and mounts only CMP-004/005', () => {
    const host = readFileSync(join(ROOT, 'apps/api/src/composition/m02.ts'), 'utf8');
    expect(host).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b/);
    expect(host).toMatch(/mounted\.push\('CMP-004'\)/);
    expect(host).toMatch(/mounted\.push\('CMP-005'\)/);
    expect(host).not.toMatch(/mounted\.push\('CMP-001'\)/);
    expect(host).not.toMatch(/from '@serviceform\/cmp-004/);
    expect(host).not.toMatch(/from '@serviceform\/cmp-005/);
  });

  it('M02 service sources do not run cross-component SQL and reject client tenant headers', () => {
    for (const cmp of M02_CMP) {
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

  it('migrations keep FORCE RLS on M02 tenant tables and no BYPASSRLS', () => {
    const migrations = [
      'db/migrations/1759500800000_cmp-004-identity-access.sql',
      'db/migrations/1759500800001_cmp-004-outbox.sql',
      'db/migrations/1759500800000_cmp-005-citizen-profile.sql',
      'db/migrations/1759500800001_cmp-005-outbox.sql',
    ];
    for (const rel of migrations) {
      const sql = readFileSync(join(ROOT, rel), 'utf8');
      expect(sql, rel).toMatch(/ENABLE ROW LEVEL SECURITY/);
      expect(sql, rel).toMatch(/FORCE ROW LEVEL SECURITY/);
      expect(sql, rel).not.toMatch(/BYPASSRLS\s*=\s*true/i);
    }
    const identity = readFileSync(
      join(ROOT, 'db/migrations/1759500800000_cmp-004-identity-access.sql'),
      'utf8',
    );
    expect(identity).toMatch(/officer_principal_isolation/);
    expect(identity).toMatch(/officer_session_isolation/);
    const profile = readFileSync(
      join(ROOT, 'db/migrations/1759500800000_cmp-005-citizen-profile.sql'),
      'utf8',
    );
    expect(profile).toMatch(/citizen_profile_isolation/);
    expect(profile).toMatch(/profile_claim_isolation/);
  });

  it('OPA authorize ports are wired; plugins do not default-allow', () => {
    const authzFiles = [
      'services/cmp-004-identity-access/src/authz.ts',
      'services/cmp-005-citizen-profile/src/authz.ts',
    ];
    for (const rel of authzFiles) {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      expect(text, rel).toMatch(/allow/);
      expect(text, rel).not.toMatch(/allow:\s*true\s*,\s*reason_code:\s*'ALWAYS'/);
      expect(text, rel).toMatch(/DEFAULT_DENY|allow !== true/);
    }
  });
});
