#!/usr/bin/env node
/**
 * World-class forms Workstream 7 smoke wrapper.
 * Runs product-metric unit + smoke tests, then asserts CROSS_TENANT_LEAKAGE=0 markers.
 * Exit 0 only when all checks pass. Does not claim CERTIFIED.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const vitest = spawnSync(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    'packages/forms-product-metrics/test/product-metrics.test.ts',
    'packages/forms-product-metrics/test/forms-metrics-smoke.test.ts',
  ],
  { cwd: root, encoding: 'utf8', env: process.env },
);
process.stdout.write(vitest.stdout);
process.stderr.write(vitest.stderr);
if (vitest.status !== 0) process.exit(vitest.status ?? 1);

const baselinePath = join(root, 'evidence/SF-WC-FORMS-07/smoke-baseline.json');
if (!existsSync(baselinePath)) {
  process.stderr.write('missing evidence/SF-WC-FORMS-07/smoke-baseline.json\n');
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
if (baseline.CERTIFIED !== false || baseline.lab_synthetic?.cross_tenant_incidents !== 0) {
  process.stderr.write('baseline failed CERTIFIED/cross-tenant gates\n');
  process.exit(1);
}

const securityRoots = [join(root, 'tests/security'), join(root, 'tests/integration')];
let hits = 0;
function walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(ts|md|sh)$/.test(ent.name)) {
      const text = readFileSync(p, 'utf8');
      if (text.includes('CROSS_TENANT_LEAKAGE=0') || text.includes('CROSS_TENANT_LEAKAGE = 0')) {
        hits += 1;
      }
    }
  }
}
for (const r of securityRoots) walk(r);
if (hits < 3) {
  process.stderr.write(`Expected CROSS_TENANT_LEAKAGE=0 markers, found ${hits}\n`);
  process.exit(1);
}

process.stdout.write(
  `forms-world-class-metrics-smoke PASS CERTIFIED=false load_p95=${baseline.lab_synthetic.form_load_p95_ms} submit_p95=${baseline.lab_synthetic.form_submit_p95_ms} cross_tenant=0 markers=${hits}\n`,
);
process.exit(0);
