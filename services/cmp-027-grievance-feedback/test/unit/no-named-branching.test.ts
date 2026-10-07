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

describe('no named-service / department / scheme branching', () => {
  it('source has no service== / department== / scheme== branches', () => {
    const files = walk(ROOT);
    const banned =
      /\b(if|else\s+if|switch)\b[\s\S]{0,120}\b(service(_id)?|department|scheme|officer_name)\s*={2,3}/i;
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect({ file: f, hit: banned.test(text) }).toEqual({ file: f, hit: false });
    }
  });
});
