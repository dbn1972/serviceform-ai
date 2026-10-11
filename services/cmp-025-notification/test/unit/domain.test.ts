import { describe, expect, it } from 'vitest';
import {
  backoffMs,
  canTransition,
  DISPATCH_STATUSES,
  type DeploymentEnvironment,
} from '../../src/domain/model.js';
import { findPii, firstPiiParam, looksLikePiiParamName } from '../../src/domain/pii-guard.js';
import {
  assertBindingPolicy,
  buildSimulationMarker,
  isSimulationMarker,
} from '../../src/domain/simulation.js';
import {
  assertTemplateDefinition,
  extractPlaceholders,
  renderTemplate,
} from '../../src/domain/template.js';
import type { Cmp025Error } from '../../src/errors.js';
import {
  BINDING_SMS,
  realBinding,
  simulatedBinding,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';

const policy = (env: DeploymentEnvironment = 'CI', channel: 'SMS' | 'EMAIL' | 'PUSH' = 'SMS') => ({
  tenantId: TENANT_A,
  channel,
  runtimeEnvironment: env,
});

function refusal(fn: () => unknown): { code: string; detail: string | undefined } {
  try {
    fn();
  } catch (e) {
    const err = e as Cmp025Error;
    return { code: err.code, detail: err.details?.[0]?.code };
  }
  throw new Error('expected refusal');
}

describe('PII guard', () => {
  it.each([
    ['citizen@example.invalid', 'EMAIL'],
    ['+91 98765 43210', 'PHONE_OR_ID_NUMBER'],
    ['9876543210', 'PHONE_OR_ID_NUMBER'],
    ['1234 5678 9012', 'PHONE_OR_ID_NUMBER'],
    ['ABCDE1234F', 'TAX_ID'],
    ['line\nbreak', 'CONTROL_CHARS'],
    ['x'.repeat(201), 'TOO_LONG'],
  ])('refuses %s', (value, kind) => {
    expect(findPii(value)).toBe(kind);
  });

  it.each(['INR 150', 'APP-2026-000123', 'Ward 12', '2026-10-10', 'Receipt 4821'])(
    'allows reference-style value %s',
    (value) => {
      expect(findPii(value)).toBeNull();
    },
  );

  it('reports the first offending parameter by name only', () => {
    expect(firstPiiParam({ a: 'ok', b: 'x@y.invalid' })).toBe('b');
    expect(firstPiiParam({ a: 'ok' })).toBeNull();
  });

  it('refuses PII-shaped parameter names but not look-alikes', () => {
    for (const bad of ['phone_number', 'email', 'aadhaar_no', 'home_address', 'pan_no', 'Bad-Name'])
      expect(looksLikePiiParamName(bad), bad).toBe(true);
    for (const ok of ['panchayat_name', 'amount_text', 'reference_no', 'company_ref'])
      expect(looksLikePiiParamName(ok), ok).toBe(false);
  });
});

describe('template definition and rendering', () => {
  const def = {
    subject_template: 'Update {{reference_no}}',
    body_template: 'Hello, status for {{reference_no}} is {{status_text}}.',
    allowed_params: ['reference_no', 'status_text'],
  };

  it('extracts distinct placeholders', () => {
    expect(extractPlaceholders('{{a}} {{ b }} {{a}}').sort()).toEqual(['a', 'b']);
  });

  it('renders strictly and deterministically without evaluation', () => {
    const out = renderTemplate(def, { reference_no: 'R-1', status_text: '${process.env.X}' });
    expect(out.body).toBe('Hello, status for R-1 is ${process.env.X}.');
    expect(out.subject).toBe('Update R-1');
  });

  it('refuses unknown and missing parameters', () => {
    expect(refusal(() => renderTemplate(def, { reference_no: 'R-1' })).detail).toBe(
      'PARAM_MISSING',
    );
    expect(
      refusal(() => renderTemplate(def, { reference_no: 'a', status_text: 'b', extra: 'c' }))
        .detail,
    ).toBe('PARAM_NOT_ALLOWED');
  });

  it('refuses placeholders outside the allow-list, stray braces and PII parameter names', () => {
    expect(
      refusal(() => assertTemplateDefinition({ ...def, body_template: 'x {{other}}' })).detail,
    ).toBe('PLACEHOLDER_NOT_ALLOWED');
    expect(
      refusal(() => assertTemplateDefinition({ ...def, body_template: 'x {{reference_no}} {{' }))
        .detail,
    ).toBe('MALFORMED_PLACEHOLDER');
    expect(
      refusal(() =>
        assertTemplateDefinition({
          ...def,
          body_template: '{{phone_number}}',
          allowed_params: ['phone_number'],
        }),
      ).detail,
    ).toBe('PII_PARAM_NAME_REFUSED');
    expect(
      refusal(() =>
        assertTemplateDefinition({ ...def, allowed_params: ['reference_no', 'reference_no'] }),
      ).detail,
    ).toBe('DUPLICATE_PARAM');
  });
});

describe('INT-013 binding policy (fail-closed)', () => {
  it('accepts a SIMULATED binding in a simulation environment and mints a valid marker', () => {
    const b = assertBindingPolicy(simulatedBinding(), policy('CI'));
    const marker = buildSimulationMarker(b, 'SMS', 'run-1');
    expect(isSimulationMarker(marker)).toBe(true);
    expect(marker).toMatchObject({
      simulation: true,
      scenario: 'notification_sms',
      environment: 'CI',
    });
  });

  it('returns no marker for REAL and SANDBOX bindings', () => {
    expect(buildSimulationMarker(realBinding(), 'SMS', 'run-1')).toBeNull();
    expect(
      buildSimulationMarker(realBinding({ mode: 'SANDBOX', environment: 'UAT' }), 'SMS', undefined),
    ).toBeNull();
  });

  it('refuses a SIMULATED binding when no test run id is configured', () => {
    expect(refusal(() => buildSimulationMarker(simulatedBinding(), 'SMS', undefined)).detail).toBe(
      'SIMULATION_MARKER_UNAVAILABLE',
    );
  });

  it('refuses any non-REAL critical binding in PRODUCTION', () => {
    for (const mode of ['SIMULATED', 'SANDBOX'] as const) {
      const r = refusal(() =>
        assertBindingPolicy(
          realBinding({ mode, simulator_version: 'sim-1', secret_ref: 'vault://x/y' }),
          policy('PRODUCTION'),
        ),
      );
      expect(r).toEqual({ code: 'SF-INT-001', detail: 'CRITICAL_NON_REAL_IN_PRODUCTION' });
    }
  });

  it.each(['UAT', 'PREPROD', 'PRODUCTION'] as const)(
    'refuses SIMULATED outside simulation environments (%s)',
    (env) => {
      const r = refusal(() =>
        assertBindingPolicy(simulatedBinding({ environment: env, critical: false }), policy(env)),
      );
      expect(r.detail).toBe('SIMULATED_ENVIRONMENT_REFUSED');
    },
  );

  it('refuses REAL or SANDBOX in LOCAL and CI', () => {
    expect(
      refusal(() => assertBindingPolicy(realBinding({ environment: 'CI' }), policy('CI'))).detail,
    ).toBe('NON_SIMULATED_IN_LOCAL_OR_CI_REFUSED');
  });

  it('refuses environment mismatch, tenant mismatch, wrong type, unmapped channel and missing refs', () => {
    expect(
      refusal(() => assertBindingPolicy(simulatedBinding({ environment: 'SIT' }), policy('CI')))
        .detail,
    ).toBe('CONNECTOR_ENVIRONMENT_MISMATCH');
    expect(
      refusal(() => assertBindingPolicy(simulatedBinding({ tenant_id: TENANT_B }), policy('CI'))),
    ).toEqual({ code: 'SF-TEN-002', detail: undefined });
    expect(
      refusal(() =>
        assertBindingPolicy(simulatedBinding({ connector_type: 'EMAIL' }), policy('CI')),
      ).detail,
    ).toBe('CONNECTOR_TYPE_MISMATCH');
    expect(
      refusal(() => assertBindingPolicy(simulatedBinding(), policy('CI', 'PUSH'))).detail,
    ).toBe('CHANNEL_CONNECTOR_UNMAPPED');
    expect(
      refusal(() => assertBindingPolicy(simulatedBinding({ simulator_version: '' }), policy('CI')))
        .detail,
    ).toBe('SIMULATOR_VERSION_REQUIRED');
    expect(
      refusal(() =>
        assertBindingPolicy(realBinding({ environment: 'UAT', secret_ref: null }), policy('UAT')),
      ).detail,
    ).toBe('SECRET_REF_REQUIRED');
    expect(refusal(() => assertBindingPolicy(null, policy('CI'))).detail).toBe(
      'CONNECTOR_BINDING_NOT_FOUND',
    );
  });

  it('allows a platform-wide (tenant_id null) binding and REAL in PRODUCTION', () => {
    expect(
      assertBindingPolicy(simulatedBinding({ tenant_id: null }), policy('CI')).tenant_id,
    ).toBeNull();
    expect(assertBindingPolicy(realBinding(), policy('PRODUCTION')).mode).toBe('REAL');
  });

  it('validates marker shape strictly', () => {
    const ok = {
      simulation: true,
      scenario: 'notification_sms',
      test_run_id: 'r',
      connector_binding_id: BINDING_SMS,
      environment: 'CI',
    };
    expect(isSimulationMarker(ok)).toBe(true);
    expect(isSimulationMarker({ ...ok, environment: 'PRODUCTION' })).toBe(false);
    expect(isSimulationMarker({ ...ok, extra: 1 })).toBe(false);
    expect(isSimulationMarker({ ...ok, simulation: false })).toBe(false);
    expect(isSimulationMarker(null)).toBe(false);
  });
});

describe('dispatch state machine and backoff', () => {
  it('allows only the documented transitions', () => {
    const allowed = new Set([
      'QUEUED>SENDING',
      'SENDING>SENDING',
      'SENDING>QUEUED',
      'SENDING>SENT',
      'SENDING>FAILED',
      'SENT>DELIVERED',
      'SENT>UNDELIVERED',
    ]);
    for (const a of DISPATCH_STATUSES)
      for (const b of DISPATCH_STATUSES)
        expect(canTransition(a, b), `${a}>${b}`).toBe(allowed.has(`${a}>${b}`));
  });

  it('backs off exponentially, capped and deterministic', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(backoffMs(30)).toBe(3_600_000);
    expect(backoffMs(3)).toBe(backoffMs(3));
  });
});
