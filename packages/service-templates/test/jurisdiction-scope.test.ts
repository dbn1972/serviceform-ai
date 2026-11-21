import { describe, expect, it } from 'vitest';
import {
  SAMPLE_LAB_LGD_DISTRICTS,
  SAMPLE_LAB_LGD_STATES,
  applyJurisdictionScopeToFormSchema,
  parseLgdCodeList,
  resolveJurisdictionScope,
  validateFormDataAgainstJurisdictionScope,
} from '../src/jurisdiction-scope';
import { lgdPostalAddress } from '../src/fields';

describe('jurisdiction scope (all offerings)', () => {
  it('parses LGD code lists and rejects empty outside SAMPLE_LAB', () => {
    expect(parseLgdCodeList('lgd-s-01, LGD-S-02\nLGD-S-01')).toEqual(['LGD-S-01', 'LGD-S-02']);
    expect(() =>
      resolveJurisdictionScope(
        { jurisdiction: { allowed_states: [], allowed_districts: [] } },
        'PRODUCTION',
      ),
    ).toThrow(/fail-closed/);
    const lab = resolveJurisdictionScope(
      { jurisdiction: { allowed_states: [], allowed_districts: [] } },
      'SAMPLE_LAB',
    );
    expect(lab.allowed_states).toEqual([...SAMPLE_LAB_LGD_STATES]);
    expect(lab.allowed_districts).toEqual([...SAMPLE_LAB_LGD_DISTRICTS]);
  });

  it('constrains address enums and validates submissions', () => {
    const schema = {
      type: 'object' as const,
      properties: { applicant_address: lgdPostalAddress('Address') },
    };
    const scope = {
      allowed_states: ['LGD-S-01', 'LGD-S-02'],
      allowed_districts: ['LGD-D-0101', 'LGD-D-0102'],
    };
    const constrained = applyJurisdictionScopeToFormSchema(schema, scope);
    expect(constrained.properties?.['applicant_address']?.properties?.['state_code']?.enum).toEqual(
      scope.allowed_states,
    );
    const ok = validateFormDataAgainstJurisdictionScope(
      schema,
      {
        applicant_address: {
          state_code: 'LGD-S-01',
          district: 'LGD-D-0101',
        },
      },
      scope,
    );
    expect(ok).toEqual([]);
    const bad = validateFormDataAgainstJurisdictionScope(
      schema,
      {
        applicant_address: {
          state_code: 'LGD-S-99',
          district: 'LGD-D-0101',
        },
      },
      scope,
    );
    expect(bad[0]?.code).toBe('JURISDICTION_OUT_OF_SCOPE');
  });
});
