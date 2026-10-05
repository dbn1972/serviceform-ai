import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../fixtures/models.js';

const SERVICE = join(ROOT, 'services/cmp-016-workflow-engine');
const SRC = join(SERVICE, 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const sources = files(SRC).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));

function sqlLiterals(text: string): string[] {
  return [...text.matchAll(/`([^`]*)`|'([^'\n]*)'/g)]
    .map((m) => m[1] ?? m[2] ?? '')
    .filter((s) => /\b(SELECT|INSERT|UPDATE|DELETE|FROM|INTO)\b/.test(s));
}

describe('Architecture Constitution guards for CMP-016 (static)', () => {
  it('NEGATIVE: no cross-component authoritative SQL - every schema reference is sf_workflow', () => {
    const offenders: string[] = [];
    for (const f of sources) {
      for (const sql of sqlLiterals(f.text)) {
        for (const m of sql.matchAll(/\b(sf_[a-z0-9_]+)\.[a-z_]+/g)) {
          if (m[1] !== 'sf_workflow') offenders.push(`${f.path}: ${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('NEGATIVE: no import of a sibling component, the API host or a database driver', () => {
    for (const f of sources) {
      const imports = [...f.text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] as string);
      for (const spec of imports) {
        expect(spec.startsWith('.') || spec.startsWith('node:'), `${f.path} imports ${spec}`).toBe(
          true,
        );
        expect(spec).not.toMatch(/services\/|apps\/|cmp-0(?!16)\d\d/);
      }
    }
  });

  it('NEGATIVE: Temporal cannot update CMP-015 state - no port or effect can write case state', () => {
    const ports = sources.find((f) => f.path.endsWith('src/ports.ts'))?.text ?? '';
    const methods = [...ports.matchAll(/^\s{2}([a-zA-Z]+)\(/gm)].map((m) => m[1]);
    expect(methods.sort()).toEqual(
      [
        'authorize',
        'cancelClose',
        'create',
        'durationMs',
        'evaluate',
        'invoke',
        'invoke',
        'signal',
        'start',
        'verify',
      ].sort(),
    );
    const interpreter = sources.find((f) => f.path.endsWith('domain/interpreter.ts'))?.text ?? '';
    const effects = [...interpreter.matchAll(/type: '([A-Z_]+)'/g)].map((m) => m[1]);
    for (const e of effects) expect(e).not.toMatch(/CASE|APPLICATION_STATE|TRANSITION/);
    for (const f of sources) {
      expect(f.text, f.path).not.toMatch(
        /application_state|case_state|UPDATE\s+sf_case|setCaseState/i,
      );
    }
  });

  it('NEGATIVE: no named-officer, jurisdiction, tenant or service branching in source', () => {
    for (const f of sources) {
      expect(f.text, f.path).not.toMatch(/officer_name|officerName|named_officer_id/);
      expect(f.text, f.path).not.toMatch(/residence certificate|income certificate/i);
    }
  });

  it('no LLM / AI gateway path and no BPMN execution engine dependency', () => {
    for (const f of sources) {
      expect(f.text, f.path).not.toMatch(/openai|anthropic|ai-gateway|\bllm\b/i);
    }
    const pkg = JSON.parse(readFileSync(join(SERVICE, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(pkg['dependencies']).toBeUndefined();
  });

  it('migrations: FORCE RLS on every tenant table, NOLOGIN role, no SUPERUSER/BYPASSRLS grant', () => {
    const dir = join(ROOT, 'db/migrations');
    const mine = readdirSync(dir).filter((n) => n.includes('_cmp-016-'));
    expect(mine.sort()).toEqual([
      '1759540160000_cmp-016-workflow-engine.sql',
      '1759540160001_cmp-016-outbox.sql',
    ]);
    for (const n of mine) {
      const sql = readFileSync(join(dir, n), 'utf8');
      const up = sql.slice(0, sql.indexOf('-- Down Migration'));
      const code = up.replace(/--[^\n]*/g, '');
      expect(code).not.toMatch(
        /\bSUPERUSER\b(?<!NOSUPERUSER)|(?<!NO)BYPASSRLS|DISABLE ROW LEVEL SECURITY/,
      );
      for (const m of up.matchAll(/sf:isolation (\S+) TENANT_SCOPED/g)) {
        expect(code).toContain(`ALTER TABLE ${m[1]} FORCE ROW LEVEL SECURITY`);
      }
      expect(code).not.toMatch(
        /\bsf_(?!workflow\b|platform\b|app\b|migrator\b|outbox_publisher\b|cmp016_rw\b)[a-z0-9_]+\./,
      );
    }
    const main = readFileSync(join(dir, mine[0] as string), 'utf8');
    expect(main).toMatch(
      /CREATE ROLE sf_cmp016_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/,
    );
  });
});
