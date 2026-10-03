import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('egress import rule (005-29)', () => {
  it('forbids node:http(s), undici and global fetch outside guarded-fetch', () => {
    const files = [
      ...walk(join(ROOT, 'packages/connector-sdk/src')),
      ...walk(join(ROOT, 'simulators/framework/src')),
    ].filter((f) => !f.endsWith('guarded-fetch.ts'));
    const banned =
      /from ['"]node:http|from ['"]node:https|from ['"]node:net|from ['"]undici|[^a-zA-Z]fetch\(/;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(banned);
    }
  });
});
