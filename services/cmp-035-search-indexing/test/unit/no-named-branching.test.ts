import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('generic projection: no named service / tenant / source branching', () => {
  const files = walk(ROOT);

  it('source has no service== / department== / scheme== / tenant literal branches', () => {
    const banned =
      /\b(if|else\s+if|switch)\b[\s\S]{0,120}\b(service(_id|_code)?|department|scheme|officer_name|tenant_id)\s*={2,3}\s*['"]/i;
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect({ file: f, hit: banned.test(text) }).toEqual({ file: f, hit: false });
    }
  });

  it('source names no specific source component, topic or event type', () => {
    const named = /'(CMP-0\d\d|sf\.(?!search\.|audit\.)[a-z]+\.events\.v\d|Case[A-Z][a-zA-Z]+)'/;
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect({ file: f, hit: named.exec(text)?.[0] ?? null }).toEqual({ file: f, hit: null });
    }
  });

  it('does not import sibling component code or SQL', () => {
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect({
        file: f,
        hit: /from '(\.\.\/)+(\.\.\/)?services\/|@serviceform\/cmp-/.test(text),
      }).toEqual({
        file: f,
        hit: false,
      });
      expect({ file: f, hit: /\bsf_(?!search\b|platform\b)[a-z_]+\./.test(text) }).toEqual({
        file: f,
        hit: false,
      });
    }
  });
});
