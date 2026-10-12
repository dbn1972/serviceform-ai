import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import {
  assertBindingPolicy as assertPaymentBinding,
  buildSimulationMarker as buildPaymentMarker,
  type ConnectorBindingView as PaymentBinding,
} from '../../../services/cmp-021-payment/src/domain/simulation.js';
import {
  assertBindingPolicy as assertNotificationBinding,
  buildSimulationMarker as buildNotificationMarker,
  type ConnectorBindingView as NotificationBinding,
} from '../../../services/cmp-025-notification/src/domain/simulation.js';

const BINDING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

function paymentBinding(over: Partial<PaymentBinding> = {}): PaymentBinding {
  return {
    connector_binding_id: BINDING,
    tenant_id: T1,
    connector_type: 'PAYMENT',
    mode: 'SIMULATED',
    environment: 'CI',
    critical: true,
    secret_ref: null,
    simulator_version: 'sim-psp-1',
    ...over,
  };
}

function notificationBinding(over: Partial<NotificationBinding> = {}): NotificationBinding {
  return {
    connector_binding_id: BINDING,
    tenant_id: T1,
    connector_type: 'SMS',
    mode: 'SIMULATED',
    environment: 'CI',
    critical: true,
    secret_ref: null,
    simulator_version: 'sim-sms-1',
    ...over,
  };
}

function expectCode(fn: () => void, code: string, detail?: string): void {
  try {
    fn();
    expect.fail(`expected ${code}`);
  } catch (err) {
    const e = err as { code?: string; details?: Array<{ code?: string }> | { code?: string } };
    expect(e.code).toBe(code);
    if (detail) {
      const details = Array.isArray(e.details) ? e.details : e.details ? [e.details] : [];
      expect(details.some((d) => d.code === detail) || String(err).includes(detail)).toBe(true);
    }
  }
}

describe('INT-013 M06 SIMULATED connector modes (independent re-verify)', () => {
  it('CMP-021 Payment SIMULATED admits CI and refuses PRODUCTION critical non-REAL', () => {
    expect(() =>
      assertPaymentBinding(paymentBinding(), { tenantId: T1, runtimeEnvironment: 'CI' }),
    ).not.toThrow();
    expectCode(
      () =>
        assertPaymentBinding(paymentBinding({ environment: 'PRODUCTION', mode: 'SIMULATED' }), {
          tenantId: T1,
          runtimeEnvironment: 'PRODUCTION',
        }),
      'SF-INT-001',
      'CRITICAL_NON_REAL_IN_PRODUCTION',
    );
  });

  it('CMP-021 Payment cross-tenant binding denied (SF-TEN-002)', () => {
    expectCode(
      () =>
        assertPaymentBinding(paymentBinding({ tenant_id: T2 }), {
          tenantId: T1,
          runtimeEnvironment: 'CI',
        }),
      'SF-TEN-002',
    );
  });

  it('CMP-021 Payment simulation marker validates under CI', () => {
    const binding = assertPaymentBinding(paymentBinding(), {
      tenantId: T1,
      runtimeEnvironment: 'CI',
    });
    const marker = buildPaymentMarker(binding, 'local-m06-int');
    expect(marker).not.toBeNull();
    expect(validate('simulation-marker', marker).valid).toBe(true);
  });

  it('CMP-025 Notification SMS/EMAIL SIMULATED admits CI; refuses PRODUCTION critical', () => {
    expect(() =>
      assertNotificationBinding(notificationBinding(), {
        tenantId: T1,
        channel: 'SMS',
        runtimeEnvironment: 'CI',
      }),
    ).not.toThrow();
    expect(() =>
      assertNotificationBinding(notificationBinding({ connector_type: 'EMAIL' }), {
        tenantId: T1,
        channel: 'EMAIL',
        runtimeEnvironment: 'CI',
      }),
    ).not.toThrow();
    expectCode(
      () =>
        assertNotificationBinding(
          notificationBinding({ environment: 'PRODUCTION', mode: 'SIMULATED' }),
          { tenantId: T1, channel: 'SMS', runtimeEnvironment: 'PRODUCTION' },
        ),
      'SF-INT-001',
      'CRITICAL_NON_REAL_IN_PRODUCTION',
    );
  });

  it('CMP-025 Notification simulation marker validates under CI', () => {
    const binding = assertNotificationBinding(notificationBinding(), {
      tenantId: T1,
      channel: 'SMS',
      runtimeEnvironment: 'CI',
    });
    const marker = buildNotificationMarker(binding, 'SMS', 'local-m06-int');
    expect(marker).not.toBeNull();
    expect(validate('simulation-marker', marker).valid).toBe(true);
  });
});
