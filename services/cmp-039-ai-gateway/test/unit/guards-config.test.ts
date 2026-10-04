import { describe, expect, it } from 'vitest';
import { exceeds, requiresPurposeCheck } from '../../src/domain/classification.js';
import { sha256Hash } from '../../src/domain/ids.js';
import {
  assertsBindingDecision,
  isAllowedTaskKind,
  isStatutoryDecisionKind,
} from '../../src/domain/statutory-guard.js';
import { assertProviderModeAllowed, buildSimulationMarker, loadConfig } from '../../src/config.js';
import { Cmp039Error, mapPgError } from '../../src/errors.js';
import { buildProviderRegistry, SimulatedModelProvider } from '../../src/ports/provider.js';
import { parseGatewayRequest } from '../../src/service/request.js';

describe('statutory decision boundary', () => {
  it('allows only advisory task kinds', () => {
    for (const k of [
      'DRAFT',
      'EXTRACT',
      'SUMMARIZE',
      'EXPLAIN',
      'RECOMMEND_NON_BINDING',
      'EMBED',
    ]) {
      expect(isAllowedTaskKind(k)).toBe(true);
      expect(isStatutoryDecisionKind(k)).toBe(false);
    }
    for (const k of [
      'ELIGIBILITY_DECISION',
      'APPROVE_APPLICATION',
      'REJECTION',
      'PENALTY_ASSESSMENT',
      'ENTITLEMENT_DETERMINATION',
    ]) {
      expect(isStatutoryDecisionKind(k)).toBe(true);
      expect(isAllowedTaskKind(k)).toBe(false);
    }
  });

  it('flags output asserting a binding decision', () => {
    expect(assertsBindingDecision('The application is hereby approved.')).toBe(true);
    expect(assertsBindingDecision('Final decision: the applicant is eligible.')).toBe(true);
    expect(assertsBindingDecision('Draft summary of the submitted documents.')).toBe(false);
  });
});

describe('classification', () => {
  it('orders classes and requires purpose for personal data', () => {
    expect(exceeds('SENSITIVE', 'PERSONAL')).toBe(true);
    expect(exceeds('PUBLIC', 'INTERNAL')).toBe(false);
    expect(requiresPurposeCheck('PERSONAL')).toBe(true);
    expect(requiresPurposeCheck('INTERNAL')).toBe(false);
  });
});

describe('production simulator misuse fails closed (INT-013)', () => {
  it('refuses SIMULATED in PRODUCTION and non-simulation environments', () => {
    expect(() => assertProviderModeAllowed('SIMULATED', 'PRODUCTION')).toThrow(Cmp039Error);
    expect(() => assertProviderModeAllowed('SIMULATED', 'UAT')).toThrow(Cmp039Error);
    expect(() => assertProviderModeAllowed('SIMULATED', 'PREPROD')).toThrow(Cmp039Error);
    expect(() =>
      loadConfig({ SF_ENVIRONMENT: 'PRODUCTION', SF_CMP039_PROVIDER_MODE: 'SIMULATED' }),
    ).toThrow(Cmp039Error);
  });

  it('refuses REAL/SANDBOX (no real adapter in this task) and unknown modes', () => {
    expect(() => assertProviderModeAllowed('REAL', 'LOCAL')).toThrow(Cmp039Error);
    expect(() => assertProviderModeAllowed('SANDBOX', 'CI')).toThrow(Cmp039Error);
    expect(() => assertProviderModeAllowed('bogus', 'LOCAL')).toThrow(Cmp039Error);
    expect(() => loadConfig({ SF_ENVIRONMENT: 'NOWHERE' })).toThrow(Cmp039Error);
  });

  it('defaults to OFF with no providers; SIMULATED builds marked simulators', () => {
    const off = loadConfig({});
    expect(off.providerMode).toBe('OFF');
    expect(buildProviderRegistry(off).size).toBe(0);
    expect(() => new SimulatedModelProvider('sim-x', off)).toThrow(Cmp039Error);
    const sim = loadConfig({ SF_ENVIRONMENT: 'CI', SF_CMP039_PROVIDER_MODE: 'SIMULATED' });
    const reg = buildProviderRegistry(sim);
    expect([...reg.keys()].sort()).toEqual(['sim-primary', 'sim-secondary']);
    expect(reg.get('sim-primary')?.simulation?.simulation).toBe(true);
    expect(sim.rateLimitMax).toBe(60);
  });

  it('rejects simulation markers outside simulation environments', () => {
    const base = {
      scenario: 'advisory_success',
      testRunId: 'r1',
      bindingId: '03903903-1039-4039-8039-039039039039',
    };
    expect(() => buildSimulationMarker({ ...base, environment: 'PRODUCTION' })).toThrow(
      Cmp039Error,
    );
    expect(() => buildSimulationMarker({ ...base, environment: 'LOCAL', testRunId: ' ' })).toThrow(
      Cmp039Error,
    );
    expect(() => buildSimulationMarker({ ...base, environment: 'LOCAL', scenario: 'BAD' })).toThrow(
      Cmp039Error,
    );
    expect(buildSimulationMarker({ ...base, environment: 'LOCAL' }).simulation).toBe(true);
  });
});

describe('error mapping and hashing', () => {
  it('maps database errors without leaking detail', () => {
    expect(mapPgError({ code: '42501' }).code).toBe('SF-TEN-002');
    expect(mapPgError({ code: '23505' }).code).toBe('SF-APP-002');
    expect(mapPgError({ code: '23503' }).code).toBe('SF-SYS-002');
    expect(mapPgError({ code: '23514' }).code).toBe('SF-SYS-003');
    expect(mapPgError({ code: 'P0001', hint: 'SF_PUBLISHED_IMMUTABLE' }).details?.[0]?.code).toBe(
      'PUBLISHED_IMMUTABLE',
    );
    expect(mapPgError(new Error('boom')).code).toBe('SF-SYS-001');
    expect(sha256Hash('x')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('request parsing', () => {
  const ok = {
    policy_id: 'draft-reply',
    policy_version: 1,
    purpose: 'officer assistance',
    data_classification: 'INTERNAL',
    variables: { subject: 'hello' },
  };
  it('accepts a valid invoke request and rejects malformed ones', () => {
    expect(parseGatewayRequest('INVOKE', ok).policyId).toBe('draft-reply');
    const bad: unknown[] = [
      null,
      { ...ok, extra: 1 },
      { ...ok, task_kind: 'ELIGIBILITY_DECISION' },
      { ...ok, policy_id: 'X' },
      { ...ok, policy_version: 0 },
      { ...ok, purpose: '' },
      { ...ok, data_classification: 'SECRET' },
      { ...ok, variables: { Bad: 'x' } },
      { ...ok, variables: 'x' },
      { ...ok, caller_component: 'cmp-14' },
      { ...ok, model: { provider_id: 'sim-primary', model_id: 'm', model_version: 'latest' } },
      { ...ok, model: 'x' },
      { ...ok, tools: [{ tool_id: 'Bad', version: '1' }] },
      { ...ok, tools: [{ tool_id: 'lookup', version: '1', scopes: ['BAD SCOPE'] }] },
      { ...ok, sources: [{ source_id: 'a', tenant_id: 'nope' }] },
      { ...ok, sources: 'x' },
    ];
    for (const b of bad) expect(() => parseGatewayRequest('INVOKE', b)).toThrow(Cmp039Error);
  });
  it('parses embed requests', () => {
    const { variables: _v, ...rest } = ok;
    void _v;
    expect(parseGatewayRequest('EMBED', { ...rest, inputs: ['a', 'b'] }).inputs).toHaveLength(2);
    expect(() => parseGatewayRequest('EMBED', { ...rest, inputs: [] })).toThrow(Cmp039Error);
    expect(() => parseGatewayRequest('EMBED', { ...rest, inputs: [1] })).toThrow(Cmp039Error);
    expect(() => parseGatewayRequest('EMBED', { ...rest, inputs: ['a'], variables: {} })).toThrow(
      Cmp039Error,
    );
  });
});
