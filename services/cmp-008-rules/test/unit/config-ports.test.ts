import { describe, expect, it } from 'vitest';
import { assertConnectorModeAllowed, buildSimulationMarker, loadConfig } from '../../src/config.js';
import { SimulatedRulePackPort } from '../../src/ports/rule-pack.js';
import { mapPgError } from '../../src/errors.js';
import { denyAllAuthz, authorize, authzInput } from '../../src/authz.js';

describe('CMP-008 configuration (SF-CON-SIMULATION-MARKER, SF-CON-CONNECTOR-BINDING)', () => {
  it('defaults to OFF and refuses REAL, SANDBOX, unknown modes', () => {
    expect(loadConfig({}).packSourceMode).toBe('OFF');
    for (const mode of ['REAL', 'SANDBOX', 'LOCAL', 'x']) {
      expect(() => loadConfig({ SF_CMP008_PACK_SOURCE_MODE: mode })).toThrow();
    }
  });

  it('never admits SIMULATED in PRODUCTION, UAT or PREPROD', () => {
    for (const env of ['PRODUCTION', 'UAT', 'PREPROD']) {
      expect(() =>
        loadConfig({ SF_ENVIRONMENT: env, SF_CMP008_PACK_SOURCE_MODE: 'SIMULATED' }),
      ).toThrow();
    }
    expect(() => assertConnectorModeAllowed('SIMULATED', 'SIT', 'PACK_SOURCE')).not.toThrow();
    expect(() => loadConfig({ SF_ENVIRONMENT: 'MOON' })).toThrow();
  });

  it('refuses a simulated source unless configured SIMULATED, and empty test run ids', () => {
    expect(() => new SimulatedRulePackPort(loadConfig({}))).toThrow();
    expect(() =>
      buildSimulationMarker({
        environment: 'LOCAL',
        scenario: 's_1',
        testRunId: ' ',
        bindingId: 'b',
      }),
    ).toThrow();
    expect(() =>
      buildSimulationMarker({
        environment: 'PRODUCTION',
        scenario: 's_1',
        testRunId: 'r',
        bindingId: 'b',
      }),
    ).toThrow();
  });

  it('reads numeric env limits with safe fallbacks', () => {
    const c = loadConfig({
      SF_CMP008_RATE_LIMIT_MAX: '-3',
      SF_CMP008_EVALUATION_TIMEOUT_MS: '500',
    });
    expect(c.rateLimitMax).toBe(120);
    expect(c.evaluationTimeoutMs).toBe(500);
  });
});

describe('error and authorization helpers', () => {
  it('maps database errors without leaking detail', () => {
    expect(mapPgError({ code: '42501' }).code).toBe('SF-TEN-002');
    expect(mapPgError({ code: '23505' }).code).toBe('SF-APP-002');
    expect(mapPgError({ code: '23503' }).code).toBe('SF-SYS-002');
    expect(mapPgError({ code: '23514' }).code).toBe('SF-SYS-003');
    expect(mapPgError({ code: 'P0001', hint: 'SF_RECORD_IMMUTABLE' }).details?.[0]?.code).toBe(
      'RECORD_IMMUTABLE',
    );
    expect(mapPgError(new Error('boom')).code).toBe('SF-SYS-001');
  });

  it('default-deny authorizer and cross-tenant subject/resource mismatch are refused', async () => {
    const ctx = {
      tenant_id: '11111111-1111-4111-8111-111111111111',
      actor: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', type: 'OFFICER' as const },
      roles: [],
      jurisdiction_ids: [],
      correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
      cell_id: 'cell-01',
    };
    await expect(
      authorize(denyAllAuthz(), authzInput(ctx, 'RULE_EVALUATION_EXECUTE', 'RuleEvaluation')),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    const mismatched = authzInput(ctx, 'RULE_EVALUATION_EXECUTE', 'RuleEvaluation');
    mismatched.resource.tenant_id = '22222222-2222-4222-8222-222222222222';
    await expect(authorize(denyAllAuthz(), mismatched)).rejects.toMatchObject({
      code: 'SF-AUTH-002',
    });
  });
});
