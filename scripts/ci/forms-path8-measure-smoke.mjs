#!/usr/bin/env node
/**
 * Path-to-8 P8-1 Measure smoke.
 * Durable KPI series + OTLP export + CROSS_TENANT_LEAKAGE=0 CI markers.
 * CERTIFIED remains false. DigiLocker out of scope.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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
    'packages/forms-product-metrics/test/durable-kpi.test.ts',
    'packages/forms-product-metrics/test/server-product-metrics.test.ts',
  ],
  { cwd: root, encoding: 'utf8', env: process.env },
);
process.stdout.write(vitest.stdout);
process.stderr.write(vitest.stderr);
if (vitest.status !== 0) process.exit(vitest.status ?? 1);

const snapPath = join(root, 'evidence/SF-P8-MEASURE/durable-kpi-snapshot.json');
const otlpPath = join(root, 'evidence/SF-P8-MEASURE/otlp-export-sample.json');
if (!existsSync(snapPath) || !existsSync(otlpPath)) {
  process.stderr.write('missing evidence/SF-P8-MEASURE durable or otlp artifacts\n');
  process.exit(1);
}
const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
if (
  snap.CERTIFIED !== false ||
  snap.g6_issued !== false ||
  snap.self_certified !== false ||
  snap.source !== 'lab_host_series' ||
  snap.snapshot?.cross_tenant?.incident_count !== 0 ||
  !(snap.window_count >= 6) ||
  !(snap.snapshot?.form_load?.sample_size > 40)
) {
  process.stderr.write('durable snapshot failed P8-1 gates\n');
  process.exit(1);
}
const otlp = JSON.parse(readFileSync(otlpPath, 'utf8'));
if (otlp.CERTIFIED !== false || !otlp.raw_pii_payload_forbidden) {
  process.stderr.write('otlp export failed CERTIFIED/PII gates\n');
  process.exit(1);
}
const otlpBlob = JSON.stringify(otlp);
if (/\b(mobile|aadhaar|email|password|otp|form_data)\b/i.test(otlpBlob)) {
  process.stderr.write('otlp export contains forbidden PII keys\n');
  process.exit(1);
}

const securityRoots = [join(root, 'tests/security'), join(root, 'tests/integration')];
let hits = 0;
function walk(dir) {
  if (!existsSync(dir)) return;
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

const studioPkg = JSON.parse(readFileSync(join(root, 'apps/web-studio/package.json'), 'utf8'));
const adminPkg = JSON.parse(readFileSync(join(root, 'apps/web-admin/package.json'), 'utf8'));
const citizenPkg = JSON.parse(readFileSync(join(root, 'apps/web-citizen/package.json'), 'utf8'));
for (const [name, pkg] of [
  ['web-studio', studioPkg],
  ['web-admin', adminPkg],
  ['web-citizen', citizenPkg],
]) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['@serviceform/observability']) {
    process.stderr.write(`${name} must not depend on @serviceform/observability\n`);
    process.exit(1);
  }
}
if (!adminPkg.dependencies['@serviceform/forms-product-metrics']) {
  process.stderr.write('web-admin missing forms-product-metrics dependency\n');
  process.exit(1);
}
if (!studioPkg.dependencies['@serviceform/forms-product-metrics']) {
  process.stderr.write('web-studio missing forms-product-metrics dependency\n');
  process.exit(1);
}

process.stdout.write(
  `forms-path8-measure-smoke PASS CERTIFIED=false source=lab_host_series windows=${snap.window_count} load_p95=${snap.snapshot.form_load.p95_ms} submit_p95=${snap.snapshot.form_submit.p95_ms} completes=${snap.snapshot.funnel.completes} abandons=${snap.snapshot.funnel.abandons} cross_tenant=0 markers=${hits}\n`,
);
process.exit(0);
