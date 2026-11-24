/**
 * G5 PERF harness scaffold — documents runnable path without inventing load numbers.
 * Complements g5-hold.test.ts. Does not claim G5 PASS or G6.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const G5_READY = process.env['SF_M10_G5_PERF_READY'] === '1';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const LOAD_PROFILE = join(HERE, 'load-profile.yaml');
const PERF_HANDOVER = join(ROOT, 'orchestrator/handovers/SF-M10-PERF.yaml');

describe('M10 G5 PERF harness scaffold (fail-closed)', () => {
  it('PERF planning handover remains PLANNING / not READY', () => {
    expect(existsSync(PERF_HANDOVER)).toBe(true);
    const text = readFileSync(PERF_HANDOVER, 'utf8');
    expect(text).toContain('planning_only: true');
    expect(text).toContain('implementation_authorized: false');
    expect(text).toContain('g6: false');
    expect(text).toMatch(/state:\s*PLANNING/);
  });

  it('load-profile stays schema-only until owner fills targets', () => {
    const text = readFileSync(LOAD_PROFILE, 'utf8');
    expect(text).toContain('g5_pass_claimed: false');
    expect(text).toContain('status: OWNER_REQUIRED');
    expect(G5_READY).toBe(false);
  });

  it('documents soak prerequisites for performance_verifier (no invented numbers)', () => {
    const steps = [
      'Owner fills tests/performance/m10/load-profile.yaml numeric targets',
      'Owner authorizes PERF/SIT cell with REAL or SANDBOX critical connectors',
      'Set SF_M10_G5_PERF_READY=1 only after the above',
      'performance_verifier executes soak; evidence under evidence/SF-M10-PERF/',
    ] as const;
    expect(steps.length).toBe(4);
    expect(process.env['SF_M10_G5_P95_MS']).toBeUndefined();
    expect(process.env['SF_M10_G5_RPS']).toBeUndefined();
  });

  it.skipIf(!G5_READY)('G5 soak gate opens only when SF_M10_G5_PERF_READY=1', () => {
    expect(G5_READY).toBe(true);
  });
});
