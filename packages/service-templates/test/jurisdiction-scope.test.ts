import { describe, expect, it } from 'vitest';
import {
  SAMPLE_LAB_LGD_DISTRICTS,
  SAMPLE_LAB_LGD_MUNICIPALITIES,
  SAMPLE_LAB_LGD_STATES,
  applyJurisdictionScopeToFormSchema,
  parseLgdCodeList,
  resolveJurisdictionScope,
  validateFormDataAgainstJurisdictionScope,
} from '../src/jurisdiction-scope';
import { lgdPostalAddress, postalAddress } from '../src/fields';

describe('jurisdiction scope (all offerings)', () => {
  it('parses LGD code lists and rejects empty outside SAMPLE_LAB', () => {
    expect(parseLgdCodeList('lgd-s-01, LGD-S-02\nLGD-S-01')).toEqual(['LGD-S-01', 'LGD-S-02']);
    expect(() =>
      resolveJurisdictionScope(
        { jurisdiction: { allowed_states: [], allowed_districts: [], allowed_municipalities: [] } },
        'PRODUCTION',
      ),
    ).toThrow(/fail-closed/);
    const lab = resolveJurisdictionScope(
      { jurisdiction: { allowed_states: [], allowed_districts: [], allowed_municipalities: [] } },
      'SAMPLE_LAB',
    );
    expect(lab.allowed_states).toEqual([...SAMPLE_LAB_LGD_STATES]);
    expect(lab.allowed_districts).toEqual([...SAMPLE_LAB_LGD_DISTRICTS]);
    expect(lab.allowed_municipalities).toEqual([...SAMPLE_LAB_LGD_MUNICIPALITIES]);
  });

  it('constrains address enums including municipality/ULB and validates submissions', () => {
    const schema = {
      type: 'object' as const,
      properties: { applicant_address: lgdPostalAddress('Address') },
    };
    const scope = {
      allowed_states: ['LGD-S-01', 'LGD-S-02'],
      allowed_districts: ['LGD-D-0101', 'LGD-D-0102'],
      allowed_municipalities: ['LGD-U-010101', 'LGD-U-010102'],
    };
    const constrained = applyJurisdictionScopeToFormSchema(schema, scope);
    expect(constrained.properties?.['applicant_address']?.properties?.['state_code']?.enum).toEqual(
      scope.allowed_states,
    );
    expect(
      constrained.properties?.['applicant_address']?.properties?.['municipality_code']?.enum,
    ).toEqual(scope.allowed_municipalities);
    const ok = validateFormDataAgainstJurisdictionScope(
      schema,
      {
        applicant_address: {
          state_code: 'LGD-S-01',
          district: 'LGD-D-0101',
          municipality_code: 'LGD-U-010101',
        },
      },
      scope,
    );
    expect(ok).toEqual([]);
    const bad = validateFormDataAgainstJurisdictionScope(
      schema,
      {
        applicant_address: {
          state_code: 'LGD-S-01',
          district: 'LGD-D-0101',
          municipality_code: 'LGD-U-999999',
        },
      },
      scope,
    );
    expect(bad[0]?.code).toBe('JURISDICTION_OUT_OF_SCOPE');
    expect(bad[0]?.message).toMatch(/Municipality/);
  });

  it('preserves Residence PUBLISHED OD/XX enum and skips free-text district', () => {
    const schema = {
      type: 'object' as const,
      properties: { residence_address: postalAddress('Residence address') },
    };
    const scope = {
      allowed_states: [...SAMPLE_LAB_LGD_STATES],
      allowed_districts: [...SAMPLE_LAB_LGD_DISTRICTS],
      allowed_municipalities: [...SAMPLE_LAB_LGD_MUNICIPALITIES],
    };
    const constrained = applyJurisdictionScopeToFormSchema(schema, scope);
    expect(constrained.properties?.['residence_address']?.properties?.['state_code']?.enum).toEqual(
      ['OD', 'XX'],
    );
    expect(
      constrained.properties?.['residence_address']?.properties?.['district']?.enum,
    ).toBeUndefined();
    expect(
      constrained.properties?.['residence_address']?.properties?.['municipality_code'],
    ).toBeUndefined();
    expect(
      validateFormDataAgainstJurisdictionScope(
        schema,
        {
          residence_address: { state_code: 'OD', district: 'SAMPLE District' },
        },
        scope,
      ),
    ).toEqual([]);
    expect(
      validateFormDataAgainstJurisdictionScope(
        schema,
        {
          residence_address: { state_code: 'LGD-S-01', district: 'SAMPLE District' },
        },
        scope,
      )[0]?.code,
    ).toBe('JURISDICTION_OUT_OF_SCOPE');
  });
});
