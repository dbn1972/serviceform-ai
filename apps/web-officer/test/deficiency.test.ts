import { describe, expect, it } from 'vitest';
import { SAMPLE_LAB_DEFICIENCY_CATALOGUE } from '@serviceform/m10-sample-lab/deficiency-catalogue';
import { workbenchStatus } from '../lib/portal/cases';

// REQ SF-47: officer Raise Deficiency uses published SAMPLE_LAB catalogue codes only.
describe('SAMPLE_LAB deficiency catalogue (officer)', () => {
  it('exposes published reason and IND-SOC-002 evidence item codes', () => {
    expect(SAMPLE_LAB_DEFICIENCY_CATALOGUE.reasons.map((r) => r.reason_code)).toEqual([
      'MISSING_PROOF',
      'ADDRESS_MISMATCH',
    ]);
    expect(
      SAMPLE_LAB_DEFICIENCY_CATALOGUE.item_codes.some((i) => i.item_code === 'ELECTRICITY_BILL'),
    ).toBe(true);
    for (const reason of SAMPLE_LAB_DEFICIENCY_CATALOGUE.reasons) {
      expect(reason.instruction_ref.startsWith('ref:')).toBe(true);
      expect(reason.default_item_codes.length).toBeGreaterThan(0);
      for (const code of reason.default_item_codes) {
        expect(SAMPLE_LAB_DEFICIENCY_CATALOGUE.item_codes.some((i) => i.item_code === code)).toBe(
          true,
        );
      }
    }
  });
});

describe('workbench status for deficiency path', () => {
  it('surfaces DEFICIENCY_RAISED and CITIZEN_RESPONSE without inventing states', () => {
    expect(workbenchStatus('DEFICIENCY_RAISED')).toBe('DEFICIENCY_RAISED');
    expect(workbenchStatus('CITIZEN_RESPONSE')).toBe('CITIZEN_RESPONSE');
    expect(workbenchStatus('UNDER_SCRUTINY')).toBe('SUBMITTED');
  });
});
