import { describe, expect, it } from 'vitest';
import {
  requiresLabPayment,
  SAMPLE_LAB_FEE_CATALOGUE,
  SAMPLE_LAB_FEE_DEFAULTS,
} from '@serviceform/m10-sample-lab/fee-catalogue';
import { portalStatus } from '../lib/portal/applications';
import { applicationStatus } from '../lib/ind-soc-002';

describe('SAMPLE_LAB fee>0 payment portal helpers (SF-56)', () => {
  it('maps PAYMENT_PENDING → PAYMENT_REQUIRED portal status', () => {
    expect(portalStatus('PAYMENT_PENDING')).toBe('PAYMENT_REQUIRED');
    expect(portalStatus('SUBMITTED')).toBe('SUBMITTED');
  });

  it('labels PAYMENT_REQUIRED as SAMPLE_LAB DUMMY fee due', () => {
    const status = applicationStatus({
      status: 'PAYMENT_REQUIRED',
      digilocker: { status: 'NOT_REQUESTED' },
    });
    expect(status.label).toMatch(/SAMPLE_LAB DUMMY/i);
  });

  it('requiresLabPayment only for fee>0 SAMPLE_LAB DUMMY overlays', () => {
    expect(requiresLabPayment('IND-EDU-004', SAMPLE_LAB_FEE_CATALOGUE)).toBe(true);
    expect(requiresLabPayment('IND-SOC-002', SAMPLE_LAB_FEE_CATALOGUE)).toBe(false);
    expect(SAMPLE_LAB_FEE_DEFAULTS.amount_minor).toBe(999);
    expect(SAMPLE_LAB_FEE_DEFAULTS.amount_display).toMatch(/SAMPLE_LAB DUMMY/);
  });
});
