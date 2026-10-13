import { describe, expect, it } from 'vitest';
import {
  assertPortAllowed,
  CONNECTOR_MODES,
  isSearchDocument,
  loadConfig,
  noProjectionRules,
  SearchIndexConsumer,
  SimulatedProjectionRules,
} from '../../../services/cmp-035-search-indexing/src/index.js';
import { UnboundSummaryPort } from '../../../services/cmp-046-operational-dashboard/src/ports/summary-port.js';
import { UnboundReplayPort } from '../../../services/cmp-045-analytics-mis/src/ports/replay-port.js';
import { InMemorySearchStore } from './support/ops-search-doubles.js';
import { T1 } from './support/fixtures.js';

/**
 * INT-013 for M08. The only SIMULATED connector-like port M08 ships is CMP-035
 * SimulatedProjectionRules. Other M08 external dependencies (CMP-045 replay, CMP-046 owner
 * summaries, CMP-007 AI gateway) have no simulator; their unbound defaults must fail closed.
 */
const ACTOR = '44444444-4444-4444-8444-444444444444';
const SIMULATION_ENVS = ['LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE'] as const;
const NON_SIMULATION_ENVS = ['UAT', 'PREPROD', 'PRODUCTION'] as const;

function expectDetail(fn: () => unknown, code: string, detailCode: string): void {
  try {
    fn();
    expect.fail(`expected ${code}/${detailCode}`);
  } catch (err) {
    const e = err as { code?: string; details?: Array<{ code?: string }> };
    expect(e.code).toBe(code);
    expect((e.details ?? []).some((d) => d.code === detailCode)).toBe(true);
  }
}

describe('INT-013 M08 SIMULATED boundaries (CMP-035 projection rules)', () => {
  it('SIMULATED rules admitted only in simulation environments', () => {
    const port = new SimulatedProjectionRules([]);
    for (const env of SIMULATION_ENVS) {
      expect(() => assertPortAllowed(port, env, 'PROJECTION_RULES')).not.toThrow();
    }
  });

  it('PRODUCTION refuses SIMULATED rules (fail-closed SF-SYS-003)', () => {
    expectDetail(
      () => assertPortAllowed(new SimulatedProjectionRules([]), 'PRODUCTION', 'PROJECTION_RULES'),
      'SF-SYS-003',
      'PROJECTION_RULES_PRODUCTION_SIMULATED_FORBIDDEN',
    );
  });

  it('UAT/PREPROD refuse SIMULATED rules', () => {
    for (const env of NON_SIMULATION_ENVS.filter((e) => e !== 'PRODUCTION')) {
      expectDetail(
        () => assertPortAllowed(new SimulatedProjectionRules([]), env, 'PROJECTION_RULES'),
        'SF-SYS-003',
        'PROJECTION_RULES_SIMULATED_ENV_FORBIDDEN',
      );
    }
  });

  it('indexer construction refuses SIMULATED rules in PRODUCTION; non-simulated port allowed', () => {
    const store = new InMemorySearchStore();
    expectDetail(
      () =>
        new SearchIndexConsumer({
          store,
          rules: new SimulatedProjectionRules([]),
          indexerActorId: ACTOR,
          config: { environment: 'PRODUCTION' },
        }),
      'SF-SYS-003',
      'PROJECTION_RULES_PRODUCTION_SIMULATED_FORBIDDEN',
    );
    expect(
      () =>
        new SearchIndexConsumer({
          store,
          rules: noProjectionRules(),
          indexerActorId: ACTOR,
          config: { environment: 'PRODUCTION' },
        }),
    ).not.toThrow();
  });

  it('runtime environment comes from SF_ENVIRONMENT; unknown values are rejected', () => {
    expect(loadConfig({ SF_ENVIRONMENT: 'PRODUCTION' }).environment).toBe('PRODUCTION');
    expectDetail(
      () => loadConfig({ SF_ENVIRONMENT: 'prod' }),
      'SF-SYS-003',
      'SF_ENVIRONMENT_INVALID',
    );
  });

  it('search document connector_mode is restricted to REAL/SANDBOX/SIMULATED', () => {
    expect([...CONNECTOR_MODES]).toEqual(['REAL', 'SANDBOX', 'SIMULATED']);
    const base = {
      contract_id: 'SF-CON-SEARCH-DOCUMENT',
      contract_status: 'FROZEN',
      freeze_status: 'FROZEN',
      tenant_id: T1,
      document_id: 'e2222222-2222-4222-8222-222222222222',
      source_cmp_id: 'CMP-046',
      source_record_id: 'e3333333-3333-4333-8333-333333333333',
      facets: {},
      tenant_scope_required: true,
      cross_tenant_fields_forbidden: true,
    };
    expect(isSearchDocument({ ...base, connector_mode: 'SIMULATED' })).toBe(true);
    expect(isSearchDocument({ ...base, connector_mode: 'MOCK' })).toBe(false);
  });
});

describe('INT-013 M08 unbound external dependencies fail closed (no simulator, no fabrication)', () => {
  it('CMP-045 replay source unbound → SF-INT-001', async () => {
    await expect(new UnboundReplayPort().readBatch()).rejects.toMatchObject({ code: 'SF-INT-001' });
  });

  it('CMP-046 owner summary port unbound → PORT_UNBOUND rejection', async () => {
    await expect(new UnboundSummaryPort('INTEGRATION_HEALTH').fetchSummary()).rejects.toMatchObject(
      {
        code: 'PORT_UNBOUND',
        viewCode: 'INTEGRATION_HEALTH',
      },
    );
  });
});
