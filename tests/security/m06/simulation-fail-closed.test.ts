import { describe, expect, it } from 'vitest';
import { assertBindingPolicy as assertPaymentBinding } from '../../../services/cmp-021-payment/src/domain/simulation.js';
import { assertBindingPolicy as assertNotificationBinding } from '../../../services/cmp-025-notification/src/domain/simulation.js';

const BINDING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T1 = '11111111-1111-4111-8111-111111111111';

function expectDetail(fn: () => void, detail: string): void {
  try {
    fn();
    expect.fail(`expected ${detail}`);
  } catch (err) {
    const e = err as { code?: string; details?: Array<{ code?: string }> };
    expect(e.code).toBe('SF-INT-001');
    const details = Array.isArray(e.details) ? e.details : [];
    expect(details.some((d) => d.code === detail)).toBe(true);
  }
}

describe('SF-M06-SEC payment/notification SIMULATED fail-closed', () => {
  it('refuses critical SIMULATED payment binding in PRODUCTION', () => {
    expectDetail(
      () =>
        assertPaymentBinding(
          {
            connector_binding_id: BINDING,
            tenant_id: T1,
            connector_type: 'PAYMENT',
            mode: 'SIMULATED',
            environment: 'PRODUCTION',
            critical: true,
            secret_ref: null,
            simulator_version: 'sim-1',
          },
          { tenantId: T1, runtimeEnvironment: 'PRODUCTION' },
        ),
      'CRITICAL_NON_REAL_IN_PRODUCTION',
    );
  });

  it('refuses critical SIMULATED SMS/EMAIL bindings in PRODUCTION', () => {
    for (const [channel, connector_type] of [
      ['SMS', 'SMS'],
      ['EMAIL', 'EMAIL'],
    ] as const) {
      expectDetail(
        () =>
          assertNotificationBinding(
            {
              connector_binding_id: BINDING,
              tenant_id: T1,
              connector_type,
              mode: 'SIMULATED',
              environment: 'PRODUCTION',
              critical: true,
              secret_ref: null,
              simulator_version: 'sim-1',
            },
            { tenantId: T1, channel, runtimeEnvironment: 'PRODUCTION' },
          ),
        'CRITICAL_NON_REAL_IN_PRODUCTION',
      );
    }
  });

  it('admits SIMULATED payment/SMS in CI', () => {
    expect(() =>
      assertPaymentBinding(
        {
          connector_binding_id: BINDING,
          tenant_id: T1,
          connector_type: 'PAYMENT',
          mode: 'SIMULATED',
          environment: 'CI',
          critical: true,
          secret_ref: null,
          simulator_version: 'sim-1',
        },
        { tenantId: T1, runtimeEnvironment: 'CI' },
      ),
    ).not.toThrow();
    expect(() =>
      assertNotificationBinding(
        {
          connector_binding_id: BINDING,
          tenant_id: T1,
          connector_type: 'SMS',
          mode: 'SIMULATED',
          environment: 'CI',
          critical: true,
          secret_ref: null,
          simulator_version: 'sim-1',
        },
        { tenantId: T1, channel: 'SMS', runtimeEnvironment: 'CI' },
      ),
    ).not.toThrow();
  });
});
