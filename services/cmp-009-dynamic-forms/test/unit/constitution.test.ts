import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'evidence') return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const srcFiles = walk(join(root, 'src')).filter((f) => f.endsWith('.ts'));
const srcText = srcFiles.map((f) => [f, readFileSync(f, 'utf8')] as const);

describe('Architecture Constitution guards (static, executed)', () => {
  it('does not import sibling component source or UX4G primitives to fork them', () => {
    for (const [file, text] of srcText) {
      expect(/from\s+'(?:\.\.\/)+(?:services\/)?cmp-0\d\d/.test(text), file).toBe(false);
      expect(/@serviceform\/cmp-0\d\d/.test(text), file).toBe(false);
      expect(/@serviceform\/ui-ux4g/.test(text), file).toBe(false);
    }
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).filter((d) => d.startsWith('@serviceform/cmp-'))).toEqual(
      [],
    );
    expect(pkg.dependencies['@serviceform/ui-ux4g']).toBeUndefined();
  });

  it('contains no named-service, tenant, or legislation branching in domain code', () => {
    const named =
      /(residence|certificate|birth|death|income|ration|licen[sc]e|\bact\s+\d{4}|section\s+\d+|tenant_id\s*===?\s*'|jurisdiction\s*===?\s*')/i;
    for (const [file, text] of srcText) {
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(named.test(stripped), file).toBe(false);
    }
  });

  it('performs no network or localization/form-source work inside the authoritative transaction', () => {
    const route = readFileSync(join(root, 'src/routes/forms.ts'), 'utf8');
    expect(route.indexOf('prepareExecution(')).toBeLessThan(
      route.indexOf('withContextTx(deps.pool'),
    );
    const tx = route.slice(route.indexOf('withContextTx(deps.pool, ctx, async'));
    expect(tx.includes('forms.resolve')).toBe(false);
    expect(tx.includes('localization.resolve')).toBe(false);
    expect(tx.includes('prepareExecution')).toBe(false);
    expect(tx.includes('interpretForm')).toBe(false);
  });

  it('does not log instance field values and has no LLM path', () => {
    const forbidden = /(openai|anthropic|bedrock|langchain|llm|ai-gateway|generative)/i;
    for (const [file, text] of srcText) {
      expect(forbidden.test(text), file).toBe(false);
      expect(/console\./.test(text), file).toBe(false);
    }
    const repo = readFileSync(join(root, 'src/repo/forms-repo.ts'), 'utf8');
    expect(repo).toContain('data_hash');
    expect(/INSERT[\s\S]*\bdata\b/.test(repo.replace(/data_hash|dataHash/g, ''))).toBe(false);
  });

  it('declares JSON Forms as schema/runtime only (no second design system)', () => {
    const ux4g = readFileSync(join(root, 'src/domain/ux4g.ts'), 'utf8');
    expect(ux4g).toContain('Do not fork primitives');
    expect(ux4g).not.toContain('mui');
    expect(ux4g).not.toContain('bootstrap');
    expect(ux4g).not.toContain('tailwind');
  });
});
