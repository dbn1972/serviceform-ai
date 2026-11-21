import { describe, expect, it } from 'vitest';
import {
  SAMPLE_LAB_FEE_CATALOGUE,
  SAMPLE_LAB_FEE_DEFAULTS,
  feePolicyForCatalogue,
  requiresLabPayment,
} from '../src/fee-catalogue.js';

describe('SAMPLE_LAB fee catalogue (SF-56)', () => {
  it('exposes IND-EDU-004 SAMPLE_LAB DUMMY fee>0 and skips Residence', () => {
    expect(feePolicyForCatalogue(SAMPLE_LAB_FEE_CATALOGUE, 'IND-EDU-004')?.amount_minor).toBe(999);
    expect(feePolicyForCatalogue(SAMPLE_LAB_FEE_CATALOGUE, 'IND-SOC-002')).toBeNull();
    expect(requiresLabPayment('IND-EDU-004')).toBe(true);
    expect(requiresLabPayment('IND-SOC-002')).toBe(false);
  });

  it('keeps SIMULATED connector + non-certification stamps', () => {
    expect(SAMPLE_LAB_FEE_CATALOGUE.connector.mode).toBe('SIMULATED');
    expect(SAMPLE_LAB_FEE_DEFAULTS.amount_display).toMatch(/SAMPLE_LAB DUMMY/);
    expect(SAMPLE_LAB_FEE_CATALOGUE.policy_kind).toBe('SAMPLE_LAB_DUMMY');
  });
});
