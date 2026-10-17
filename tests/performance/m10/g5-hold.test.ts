/**
 * SF-M10-004 / G5 hold suite — fail-closed until PERF env is authorized.
 * Does not invent SLA/fee/eligibility. Does not claim G5 PASS.
 * Set SF_M10_G5_PERF_READY=1 only when a human-authorized load profile + PERF cell exist.
 */
import { describe, expect, it } from 'vitest';

const G5_READY = process.env['SF_M10_G5_PERF_READY'] === '1';

describe('M10 G5 performance hold (fail-closed)', () => {
  it('refuses to claim G5 PASS when SF_M10_G5_PERF_READY is unset', () => {
    expect(G5_READY).toBe(false);
  });

  it('documents required G5 artifacts before any soak may run', () => {
    const required = [
      'tests/performance/m10/load-profile.yaml (human-authorized targets)',
      'evidence/SF-M10-004 or evidence/SF-M10-PERF with executed soak logs',
      'PERF/SIT cell with REAL or SANDBOX critical connectors as per mode rules',
    ] as const;
    expect(required.length).toBe(3);
    // No invented latency/throughput numbers — targets must come from owner PERF plan.
    expect(process.env['SF_M10_G5_P95_MS']).toBeUndefined();
    expect(process.env['SF_M10_G5_RPS']).toBeUndefined();
  });

  it.skipIf(!G5_READY)(
    'G5 soak execution placeholder — only runs when SF_M10_G5_PERF_READY=1',
    () => {
      // Intentionally empty: real soak is owned by performance_verifier with load infra.
      expect(G5_READY).toBe(true);
    },
  );
});
