import { describe, expect, it } from 'vitest';
import { assertPortAllowed } from '../../../services/cmp-035-search-indexing/src/config.js';

const SIMULATED_PORT = { simulation: 'SIMULATED' };
const REAL_PORT = { simulation: 'REAL' };

function expectDetail(fn: () => void, detail: string): void {
  try {
    fn();
    expect.fail(`expected ${detail}`);
  } catch (err) {
    const e = err as { code?: string; details?: Array<{ code?: string }> };
    expect(e.code).toBe('SF-SYS-003');
    const details = Array.isArray(e.details) ? e.details : [];
    expect(details.some((d) => d.code === detail)).toBe(true);
  }
}

describe('SF-M08-SEC CMP-035 SIMULATED port fail-closed (INT-013)', () => {
  it('refuses a SIMULATED port in PRODUCTION', () => {
    expectDetail(
      () => assertPortAllowed(SIMULATED_PORT, 'PRODUCTION', 'PROJECTION'),
      'PROJECTION_PRODUCTION_SIMULATED_FORBIDDEN',
    );
  });

  it('refuses a SIMULATED port in UAT and PREPROD', () => {
    for (const env of ['UAT', 'PREPROD'] as const) {
      expectDetail(
        () => assertPortAllowed(SIMULATED_PORT, env, 'PROJECTION'),
        'PROJECTION_SIMULATED_ENV_FORBIDDEN',
      );
    }
  });

  it('admits SIMULATED only in simulation environments and REAL everywhere', () => {
    for (const env of ['LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE'] as const) {
      expect(() => assertPortAllowed(SIMULATED_PORT, env, 'PROJECTION')).not.toThrow();
    }
    expect(() => assertPortAllowed(REAL_PORT, 'PRODUCTION', 'PROJECTION')).not.toThrow();
  });
});
