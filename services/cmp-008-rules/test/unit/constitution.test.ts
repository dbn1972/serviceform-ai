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
  it('has no LLM / AI Gateway / model-client path in eligibility code', () => {
    const forbidden =
      /(openai|anthropic|bedrock|langchain|llm|ai-gateway|cmp-039|generative|embedding|@ai-sdk)/i;
    for (const [file, text] of srcText) expect(forbidden.test(text), file).toBe(false);
    const pkg = readFileSync(join(root, 'package.json'), 'utf8');
    expect(forbidden.test(pkg)).toBe(false);
  });

  it('does not import sibling component source (consumes ports and HTTP contracts only)', () => {
    for (const [file, text] of srcText) {
      expect(/from\s+'(?:\.\.\/)+(?:services\/)?cmp-0\d\d/.test(text), file).toBe(false);
      expect(/@serviceform\/cmp-0\d\d/.test(text), file).toBe(false);
    }
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).filter((d) => d.startsWith('@serviceform/cmp-'))).toEqual(
      [],
    );
  });

  it('keeps eligibility rules out of OPA: authorization is action names only, no Rego', () => {
    expect(walk(root).filter((f) => f.endsWith('.rego'))).toEqual([]);
    const authz = readFileSync(join(root, 'src/authz.ts'), 'utf8');
    expect(authz).toContain('port.decide');
    expect(/\b(eligib|score|threshold|age)\w*/i.test(authz)).toBe(false);
  });

  it('contains no named-service, tenant, or legislation branching in domain code', () => {
    const named =
      /(residence|certificate|birth|death|income|ration|licen[sc]e|\bact\s+\d{4}|section\s+\d+|tenant_id\s*===?\s*'|jurisdiction\s*===?\s*')/i;
    for (const [file, text] of srcText) {
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(named.test(stripped), file).toBe(false);
    }
  });

  it('performs no network or engine work inside the authoritative transaction callback', () => {
    const route = readFileSync(join(root, 'src/routes/evaluations.ts'), 'utf8');
    const tx = route.slice(route.indexOf('withContextTx(deps.pool, ctx, async'));
    const txBody = tx.slice(0, tx.indexOf('return reply.code(result.status)'));
    expect(txBody.includes('rulePacks.resolve')).toBe(false);
    expect(txBody.includes('engine.evaluate')).toBe(false);
    expect(txBody.includes('prepareEvaluation')).toBe(false);
    expect(route.indexOf('prepareEvaluation(')).toBeLessThan(
      route.indexOf('withContextTx(deps.pool'),
    );
  });

  it('does not log or store raw inputs', () => {
    const repo = readFileSync(join(root, 'src/repo/rules-repo.ts'), 'utf8');
    expect(/inputs\b/.test(repo.replace(/input_hash|inputHash/g, ''))).toBe(false);
    for (const [file, text] of srcText) expect(/console\./.test(text), file).toBe(false);
  });
});
