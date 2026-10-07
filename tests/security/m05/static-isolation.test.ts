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
  'SF-CON-APPLICATION-CASE-SM',
  'SF-CON-WORKFLOW-MODEL',
  'SF-CON-COMMAND-TRANSITION',
  'SF-CON-HUMAN-TASK',
  'SF-CON-SLA-CLOCK',
  'SF-CON-VERSION-PINNING',
] as const;

const M05_CMP = [
  'cmp-015-application-case',
  'cmp-016-workflow-engine',
  'cmp-017-work-queue-tasks',
  'cmp-018-inspection-verification',
  'cmp-019-deficiency',
  'cmp-027-grievance-feedback',
  'cmp-028-appeal-review',
  'cmp-029-sla-escalation',
] as const;

const OWN_SCHEMA: Record<string, string> = {
  'cmp-015-application-case': 'sf_application_case',
  'cmp-016-workflow-engine': 'sf_workflow',
  'cmp-017-work-queue-tasks': 'sf_tasks',
  'cmp-018-inspection-verification': 'sf_inspection',
  'cmp-019-deficiency': 'sf_deficiency',
  'cmp-027-grievance-feedback': 'sf_grievance',
  'cmp-028-appeal-review': 'sf_appeal',
  'cmp-029-sla-escalation': 'sf_sla',
};

const PEER_SCHEMAS = [
  'sf_application_case',
  'sf_workflow',
  'sf_tasks',
  'sf_inspection',
  'sf_deficiency',
  'sf_grievance',
  'sf_appeal',
  'sf_sla',
  'sf_ai_gateway',
  'sf_rules',
  'sf_evidence',
  'sf_upload',
  'sf_forms',
  'sf_docintel',
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

const MIGRATIONS = [
  'db/migrations/1759540150000_cmp-015-application-case.sql',
  'db/migrations/1759540160000_cmp-016-workflow-engine.sql',
  'db/migrations/1759540170000_cmp-017-work-queue-tasks.sql',
  'db/migrations/1759540180000_cmp-018-inspection-verification.sql',
  'db/migrations/1759541900000_cmp-019-deficiency.sql',
  'db/migrations/1759541900002_cmp-019-reconciliation.sql',
  'db/migrations/1759541270000_cmp-027-grievance-feedback.sql',
  'db/migrations/1759540280000_cmp-028-appeal-review.sql',
  'db/migrations/1759540400000_cmp-029-sla-escalation.sql',
] as const;

const M05_ADMITTED = [
  '@serviceform/cmp-015-application-case',
  '@serviceform/cmp-017-work-queue-tasks',
  '@serviceform/cmp-018-inspection-verification',
  '@serviceform/cmp-019-deficiency',
  '@serviceform/cmp-027-grievance-feedback',
  '@serviceform/cmp-028-appeal-review',
  '@serviceform/cmp-029-sla-escalation',
] as const;

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

describe('SF-M05-SEC static isolation (not CERTIFIED)', () => {
  it('frozen contracts lock is 19/19 MATCH', () => {
    const lockText = readFileSync(join(ROOT, 'orchestrator/contracts-lock.yaml'), 'utf8');
    const ids = [...lockText.matchAll(/^\s+- id: (SF-CON-[A-Z0-9-]+)/gm)].map((m) => m[1]);
    expect(ids.sort()).toEqual([...FROZEN_IDS].sort());
    expect(ids).toHaveLength(19);
    const gate = execFileSync('python3', ['scripts/gates/contracts_lock_gate.py'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(gate).toMatch(/PASS \[contracts-lock\]/);
    const hashes = [...lockText.matchAll(/schema_hash: ([0-9a-f]{64})/g)].map((m) => m[1]);
    expect(hashes).toHaveLength(19);
    const paths = [...lockText.matchAll(/^\s+path: "?([^"\s]+)"?/gm)].map((m) => m[1]);
    expect(paths).toHaveLength(19);
    for (let i = 0; i < paths.length; i += 1) {
      expect(sha256(join(ROOT, paths[i] ?? '')), paths[i]).toBe(hashes[i]);
    }
  });

  it('task envelope stays PLANNING (read-only); uniqueness gate PASS', () => {
    const task = readFileSync(join(ROOT, 'orchestrator/tasks/SF-M05-SEC.yaml'), 'utf8');
    expect(task).toMatch(/^state: PLANNING$/m);
    expect(task).toMatch(/^dispatched: false$/m);
    expect(task).toMatch(/^planning_only: true$/m);
    // Planning base_commit is provenance — must not be rewritten by SEC.
    expect(task).toMatch(/prefix: b286ed95/);
    expect(task).toMatch(/suffix: 6755b936f73bc2856c9db2c68d8ca64c/);
    const out = execFileSync('python3', ['scripts/gates/cg01_path_uniqueness_gate.py'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out).toMatch(/PASS/);
  });

  it('host omits CMP-016 HTTP; CMP-036 registered once; no remount from M05', () => {
    const host = readFileSync(join(ROOT, 'apps/api/src/composition/m05.ts'), 'utf8');
    const app = readFileSync(join(ROOT, 'apps/api/src/app.ts'), 'utf8');
    expect(app.match(/register\(apiGatewayPlugin/g)?.length).toBe(1);
    expect(app).toContain("from '@serviceform/cmp-036-api-gateway'");
    expect(host).not.toMatch(/apiGatewayPlugin|registerApiGateway|cmp-036-api-gateway/);
    expect(host).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b/);
    expect(host).toMatch(/CMP-016 workflow engine has no Fastify\/HTTP/);
    expect(host).not.toMatch(/registerWorkflow|cmp-016-workflow-engine/);
    expect(host).toMatch(/mounted\.push\('CMP-015'\)/);
    expect(host).toMatch(/mounted\.push\('CMP-017'\)/);
    expect(host).toMatch(/mounted\.push\('CMP-018'\)/);
    expect(host).toMatch(/mounted\.push\('CMP-019'\)/);
    expect(host).toMatch(/mounted\.push\('CMP-027'\)/);
    expect(host).toMatch(/mounted\.push\('CMP-028'\)/);
    expect(host).toMatch(/mounted\.push\('CMP-029'\)/);
    expect(host).not.toMatch(/mounted\.push\('CMP-016'\)/);
    expect(host).not.toMatch(/mounted\.push\('CMP-036'\)/);
    // CodeQL 25/26/27 remediation: read-only query pass-through, no dynamic query[key]=
    expect(host).toMatch(/Pass Fastify's already-parsed query through read-only/);
    expect(host).not.toMatch(/query\s*\[\s*[A-Za-z_]+\s*\]\s*=/);
  });

  it('M05 service sources do not run cross-component SQL', () => {
    for (const cmp of M05_CMP) {
      const srcDir = join(ROOT, 'services', cmp, 'src');
      const files = walkTs(srcDir);
      expect(files.length, cmp).toBeGreaterThan(0);
      const own = OWN_SCHEMA[cmp];
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        if (!own) continue;
        for (const peer of PEER_SCHEMAS) {
          if (peer === own) continue;
          expect(mentionsPeerRelation(text, peer), `${file} mentions ${peer}`).toBe(false);
        }
      }
    }
  });

  it('migrations keep FORCE RLS; privilege roles NOLOGIN / NOBYPASSRLS', () => {
    for (const rel of MIGRATIONS) {
      const sql = readFileSync(join(ROOT, rel), 'utf8');
      expect(sql, rel).toMatch(/ENABLE ROW LEVEL SECURITY/);
      expect(sql, rel).toMatch(/FORCE ROW LEVEL SECURITY/);
      expect(sql, rel).not.toMatch(/BYPASSRLS\s*=\s*true/i);
      // Additive REM-001 reconciliation migration reuses sf_cmp019_rw (no new LOGIN role).
      if (!rel.includes('cmp-019-reconciliation')) {
        expect(sql, rel).toMatch(/NOLOGIN/);
        expect(sql, rel).toMatch(/NOBYPASSRLS/);
      } else {
        expect(sql, rel).toMatch(/OWNER TO sf_migrator/);
        expect(sql, rel).toMatch(/GRANT SELECT, INSERT/);
        expect(sql, rel).toMatch(/TO sf_cmp019_rw/);
        expect(sql, rel).not.toMatch(/CREATE ROLE/);
      }
    }
  });

  it('CMP-015 is authoritative vs Temporal; CMP-016 has no case-write port', () => {
    const ports = readFileSync(join(ROOT, 'services/cmp-016-workflow-engine/src/ports.ts'), 'utf8');
    expect(ports).not.toMatch(/CaseCommandPort|writeCase|mutateCase|UPDATE.*application_case/i);
    expect(ports).toMatch(/AuthorizationPort/);
    const adapter = readFileSync(
      join(ROOT, 'services/cmp-016-workflow-engine/src/temporal/adapter.ts'),
      'utf8',
    );
    expect(adapter).toMatch(/DOMAIN_COMMITTED|authoritative|transaction|refuse|commit/i);
    const decision = readFileSync(
      join(ROOT, 'services/cmp-015-application-case/src/domain/decision-boundary.ts'),
      'utf8',
    );
    expect(decision).toMatch(/AI_FINAL_DECISION_FORBIDDEN/);
  });

  it('CMP-019 cannot bypass OPA/tenant/version/CMP-015 (port-only case + SLA)', () => {
    const casePort = readFileSync(
      join(ROOT, 'services/cmp-019-deficiency/src/ports/case-command-port.ts'),
      'utf8',
    );
    expect(casePort).toMatch(/never writes case tables/i);
    expect(casePort).toMatch(/RAISE_DEFICIENCY/);
    expect(casePort).toMatch(/RECORD_CITIZEN_RESPONSE/);
    const slaPort = readFileSync(
      join(ROOT, 'services/cmp-019-deficiency/src/ports/sla-clock-port.ts'),
      'utf8',
    );
    expect(slaPort).toMatch(/pauseForDeficiency|resumeAfterDeficiency/);
    const src = walkTs(join(ROOT, 'services/cmp-019-deficiency/src'));
    for (const file of src) {
      const text = readFileSync(file, 'utf8');
      expect(mentionsPeerRelation(text, 'sf_application_case'), file).toBe(false);
      expect(mentionsPeerRelation(text, 'sf_sla'), file).toBe(false);
    }
    const authz = readFileSync(join(ROOT, 'services/cmp-019-deficiency/src/authz.ts'), 'utf8');
    expect(authz).toMatch(/SF-AUTH-002/);
    expect(authz).toMatch(/PDP_UNAVAILABLE|SF-SYS-004/);
    expect(authz).toMatch(/SF-TEN-002/);
    // REM-001 durable recon: expected state/version authoritative; stale terminal; no network in auth txn.
    const recon = readFileSync(
      join(ROOT, 'services/cmp-019-deficiency/src/service/reconciliation.ts'),
      'utf8',
    );
    expect(recon).toMatch(/STALE_EXPECTED_STATE/);
    expect(recon).toMatch(/FAILED_STALE/);
    expect(recon).toMatch(/NETWORK_IN_TX/);
    expect(recon).toMatch(/expected_state/);
    expect(recon).toMatch(/expected_version/);
    const reconMig = readFileSync(
      join(ROOT, 'db/migrations/1759541900002_cmp-019-reconciliation.sql'),
      'utf8',
    );
    expect(reconMig).toMatch(/reconciliation_intent/);
    expect(reconMig).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(reconMig).toMatch(/case_expected_state/);
    expect(reconMig).toMatch(/case_expected_version/);
  });

  it('CMP-028 original_case_command boundary enforces CMP-015 port only', () => {
    const casePort = readFileSync(
      join(ROOT, 'services/cmp-028-appeal-review/src/ports/case-command.ts'),
      'utf8',
    );
    expect(casePort).toMatch(/never updated by CMP-028 SQL/i);
    expect(casePort).toMatch(/CaseCommandPort/);
    const src = walkTs(join(ROOT, 'services/cmp-028-appeal-review/src'));
    for (const file of src) {
      const text = readFileSync(file, 'utf8');
      expect(mentionsPeerRelation(text, 'sf_application_case'), file).toBe(false);
    }
    const service = readFileSync(
      join(ROOT, 'services/cmp-028-appeal-review/src/service/appeal-service.ts'),
      'utf8',
    );
    expect(service).toMatch(/original_case_command/);
    expect(service).toMatch(/AI_PROTECTED|AI_DECISION_FORBIDDEN/);
  });

  it('OPA authorize ports are fail-closed across M05 PEPs', () => {
    const authzFiles = [
      'services/cmp-015-application-case/src/authz.ts',
      'services/cmp-017-work-queue-tasks/src/authz.ts',
      'services/cmp-018-inspection-verification/src/authz.ts',
      'services/cmp-019-deficiency/src/authz.ts',
      'services/cmp-027-grievance-feedback/src/authz.ts',
      'services/cmp-028-appeal-review/src/authz.ts',
      'services/cmp-029-sla-escalation/src/authz.ts',
    ];
    for (const rel of authzFiles) {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      expect(text, rel).toMatch(/allow/);
      expect(text, rel).toMatch(/PDP_UNAVAILABLE|SF-SYS-004/);
      expect(text, rel).toMatch(/SF-AUTH-002/);
      expect(text, rel).not.toMatch(/allow:\s*true\s*,\s*reason_code:\s*'ALWAYS'/);
    }
    const shared = readFileSync(join(ROOT, 'policy/opa/sf/authz/decision.rego'), 'utf8');
    expect(shared).toMatch(/default\s+allow\s*:=\s*false/);
  });

  it('REM-002 host package admission: seven workspace:*; CMP-016 none; CMP-036 single', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'apps/api/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    for (const name of M05_ADMITTED) {
      expect(pkg.dependencies[name], name).toBe('workspace:*');
    }
    expect(pkg.dependencies['@serviceform/cmp-016-workflow-engine']).toBeUndefined();
    const cmp036 = Object.keys(pkg.dependencies).filter((k) => k.includes('cmp-036'));
    expect(cmp036).toEqual(['@serviceform/cmp-036-api-gateway']);
    // Lockfile importer links under apps/api for seven M05 workspace packages.
    const lock = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');
    const importerIdx = lock.indexOf('importers:\n');
    expect(importerIdx).toBeGreaterThanOrEqual(0);
    const appsApiIdx = lock.indexOf('\n  apps/api:\n', importerIdx);
    expect(appsApiIdx).toBeGreaterThan(importerIdx);
    // Next importer after apps/api is typically another workspace path (two-space key).
    const rest = lock.slice(appsApiIdx + 1);
    const nextMatch = rest.match(/\n {2}(?!apps\/api)[a-zA-Z0-9@/_-]+:\n/);
    const importerSlice = nextMatch?.index
      ? rest.slice(0, nextMatch.index)
      : rest.slice(0, 8000);
    for (const name of M05_ADMITTED) {
      expect(importerSlice.includes(`'${name}':`), name).toBe(true);
      expect(
        importerSlice.includes(
          `'${name}':\n        specifier: workspace:*\n        version: link:`,
        ),
        name,
      ).toBe(true);
    }
    expect(importerSlice).not.toContain('@serviceform/cmp-016-workflow-engine');
  });

  it('REM-002 supply-chain controls remain intact (no relaxation)', () => {
    const workspace = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toMatch(/^blockExoticSubdeps:\s*true$/m);
    expect(workspace).toMatch(/^minimumReleaseAge:\s*10080$/m);
    expect(workspace).toMatch(/^trustPolicy:\s*no-downgrade$/m);
    const npmrc = readFileSync(join(ROOT, '.npmrc'), 'utf8');
    expect(npmrc).toMatch(/^engine-strict=true$/m);
    expect(npmrc).toMatch(/^save-exact=true$/m);
    // CI / security / developer-platform install with frozen-lockfile.
    for (const wf of [
      '.github/workflows/ci.yml',
      '.github/workflows/security.yml',
      '.github/workflows/developer-platform.yml',
    ]) {
      const text = readFileSync(join(ROOT, wf), 'utf8');
      expect(text, wf).toMatch(/pnpm install --frozen-lockfile/);
    }
  });
});
