import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const OPA = join(ROOT, 'policy/opa');

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

describe('OPA bundle static (002-16)', () => {
  it('no committed tenant/user/sf_runtime JSON; no http.send; roots sf + system/log', () => {
    const jsons = walk(OPA).filter((f) => f.endsWith('.json'));
    for (const f of jsons) {
      const text = readFileSync(f, 'utf8');
      expect(text).not.toMatch(/sf_runtime/);
      expect(text).not.toMatch(/11111111-1111-4111-8111-111111111111/);
    }
    const regos = walk(OPA).filter((f) => f.endsWith('.rego') && !f.endsWith('_test.rego'));
    for (const f of regos) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/http\.send/);
    }
    const manifest = JSON.parse(readFileSync(join(OPA, '.manifest'), 'utf8')) as {
      roots: string[];
    };
    expect(manifest.roots).toEqual(['sf', 'system/log']);
    execFileSync(process.env['OPA_BIN'] ?? 'opa', ['check', '--strict', OPA]);
  });
});
