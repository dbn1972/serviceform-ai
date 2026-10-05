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

const M04_CMP = [
  'cmp-039-ai-gateway',
  'cmp-008-rules',
  'cmp-011-evidence-requirements',
  'cmp-013-document-upload',
  'cmp-009-dynamic-forms',
  'cmp-014-document-intelligence',
] as const;

const OWN_SCHEMA: Record<string, string> = {
  'cmp-039-ai-gateway': 'sf_ai_gateway',
  'cmp-008-rules': 'sf_rules',
  'cmp-011-evidence-requirements': 'sf_evidence',
  'cmp-013-document-upload': 'sf_upload',
  'cmp-009-dynamic-forms': 'sf_forms',
  'cmp-014-document-intelligence': 'sf_docintel',
};

const PEER_SCHEMAS = [
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

const PROVIDER_SDK =
  /openai|anthropic|bedrock|vertexai|@ai-sdk|openai-node|@google\/generative-ai|cohere-ai/i;

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

describe('SF-M04-SEC static isolation (not CERTIFIED)', () => {
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
    const handover = readFileSync(join(ROOT, 'orchestrator/handovers/SF-M04-SEC.yaml'), 'utf8');
    const task = readFileSync(join(ROOT, 'orchestrator/tasks/SF-M04-SEC.yaml'), 'utf8');
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

  it('host registers CMP-036 exactly once and does not remount it from M04', () => {
    const host = readFileSync(join(ROOT, 'apps/api/src/composition/m04.ts'), 'utf8');
    const app = readFileSync(join(ROOT, 'apps/api/src/app.ts'), 'utf8');
    expect(app.match(/register\(apiGatewayPlugin/g)?.length).toBe(1);
    expect(app).toContain("from '@serviceform/cmp-036-api-gateway'");
    expect(host).not.toMatch(/apiGatewayPlugin|registerApiGateway|cmp-036-api-gateway/);
    expect(host).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b/);
    expect(host).toMatch(/AiGatewayPort/);
    expect(host).not.toMatch(PROVIDER_SDK);
    expect(host).toMatch(/mounted\.push\('CMP-039'\)/);
    expect(host).toMatch(/mounted\.push\('CMP-008'\)/);
    expect(host).toMatch(/mounted\.push\('CMP-011'\)/);
    expect(host).toMatch(/mounted\.push\('CMP-013'\)/);
    expect(host).toMatch(/mounted\.push\('CMP-009'\)/);
    expect(host).toMatch(/mounted\.push\('CMP-014'\)/);
    expect(host).not.toMatch(/mounted\.push\('CMP-036'\)/);
  });

  it('M04 service sources do not run cross-component SQL and reject client tenant headers', () => {
    for (const cmp of M04_CMP) {
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

  it('migrations keep FORCE RLS; AI/docintel forbid statutory decisions', () => {
    const migrations = [
      'db/migrations/1759530039000_cmp-039-ai-gateway.sql',
      'db/migrations/1759530200000_cmp-008-rules.sql',
      'db/migrations/1759530110000_cmp-011-evidence.sql',
      'db/migrations/1759530400000_cmp-013-document-upload.sql',
      'db/migrations/1759530500000_cmp-009-forms.sql',
      'db/migrations/1759530600000_cmp-014-document-intelligence.sql',
    ];
    for (const rel of migrations) {
      const sql = readFileSync(join(ROOT, rel), 'utf8');
      expect(sql, rel).toMatch(/ENABLE ROW LEVEL SECURITY/);
      expect(sql, rel).toMatch(/FORCE ROW LEVEL SECURITY/);
      expect(sql, rel).not.toMatch(/BYPASSRLS\s*=\s*true/i);
      expect(sql, rel).toMatch(/NOLOGIN/);
    }
    const ai = readFileSync(
      join(ROOT, 'db/migrations/1759530039000_cmp-039-ai-gateway.sql'),
      'utf8',
    );
    expect(ai).toMatch(/CHECK \(NOT statutory_decision\)/);
    expect(ai).toMatch(/CHECK \(advisory_only\)/);
    expect(ai).toMatch(/task_kind IN \(/);
    expect(ai).toMatch(/eligibility\/approval\/rejection|statutory eligibility/i);
    expect(ai).not.toMatch(/'ELIGIBILITY_DECISION'/);
    expect(ai).not.toMatch(/'APPROVE'/);
    expect(ai).not.toMatch(/'REJECT'/);
    const docintel = readFileSync(
      join(ROOT, 'db/migrations/1759530600000_cmp-014-document-intelligence.sql'),
      'utf8',
    );
    expect(docintel).toMatch(/CHECK \(NOT statutory_decision\)/);
    expect(docintel).toMatch(/CHECK \(NOT evidence_satisfied\)/);
    expect(docintel).toMatch(/CHECK \(NOT entitlement_issued\)/);
    expect(docintel).toMatch(/CHECK \(advisory_only\)/);
    const upload = readFileSync(
      join(ROOT, 'db/migrations/1759530400000_cmp-013-document-upload.sql'),
      'utf8',
    );
    expect(upload).toMatch(/object_ref ~/);
    expect(upload).toMatch(/A-Za-z0-9_-/);
    expect(upload).toMatch(
      /AVAILABLE only after a CLEAN scan|cannot become AVAILABLE without a CLEAN scan/i,
    );
  });

  it('OPA authorize ports are fail-closed; CMP-014 has gateway port only', () => {
    const authzFiles = [
      'services/cmp-039-ai-gateway/src/authz.ts',
      'services/cmp-008-rules/src/authz.ts',
      'services/cmp-011-evidence-requirements/src/authz.ts',
      'services/cmp-013-document-upload/src/authz.ts',
      'services/cmp-009-dynamic-forms/src/authz.ts',
      'services/cmp-014-document-intelligence/src/authz.ts',
    ];
    for (const rel of authzFiles) {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      expect(text, rel).toMatch(/allow/);
      expect(text, rel).toMatch(/PDP_UNAVAILABLE|SF-SYS-004/);
      expect(text, rel).not.toMatch(/allow:\s*true\s*,\s*reason_code:\s*'ALWAYS'/);
    }
    const gatewayPort = readFileSync(
      join(ROOT, 'services/cmp-014-document-intelligence/src/ports/gateway-port.ts'),
      'utf8',
    );
    expect(gatewayPort).toMatch(/AiGatewayPort/);
    expect(gatewayPort).toMatch(/never provider SDKs/);
    expect(gatewayPort).not.toMatch(PROVIDER_SDK);
    const docintelSrc = walkTs(join(ROOT, 'services/cmp-014-document-intelligence/src'));
    for (const file of docintelSrc) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(PROVIDER_SDK);
    }
    const statutory = readFileSync(
      join(ROOT, 'services/cmp-039-ai-gateway/src/domain/statutory-guard.ts'),
      'utf8',
    );
    expect(statutory).toMatch(/ALLOWED_TASK_KINDS/);
    expect(statutory).toMatch(/isStatutoryDecisionKind/);
    expect(statutory).toMatch(/assertsBindingDecision/);
  });

  it('CMP-039 defaults deny purpose/consent and source ACL; redaction exists', () => {
    const ports = readFileSync(
      join(ROOT, 'services/cmp-039-ai-gateway/src/ports/policy-ports.ts'),
      'utf8',
    );
    expect(ports).toMatch(/denyAllPurposeConsent/);
    expect(ports).toMatch(/denyAllSourceAcl/);
    expect(ports).toMatch(/permits: async \(\) => false/);
    expect(ports).toMatch(/canRead: async \(\) => false/);
    const redaction = readFileSync(
      join(ROOT, 'services/cmp-039-ai-gateway/src/domain/redaction.ts'),
      'utf8',
    );
    expect(redaction).toMatch(/redactText|RedactionSummary/);
    const audit = readFileSync(join(ROOT, 'services/cmp-039-ai-gateway/src/audit.ts'), 'utf8');
    expect(audit).not.toMatch(/prompt_body|raw_prompt|output_text|api_key|secret_ref/);
  });
});
