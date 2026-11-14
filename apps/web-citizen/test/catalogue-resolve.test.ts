import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { catalogueIdForCase } from '../lib/portal/catalogue-resolve';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const RESIDENCE_BINDING = '0d15ba00-0002-4000-8000-0d15ba0000d2';
const RESIDENCE_FORM = '0d15ba00-0010-4000-8000-0d15ba000010';
const INCOME_FORM = '7e3a0031-0001-4000-8000-00000000031a';

// REQ CCR-M11-001: portal projection must not hard-code IND-SOC-002.
describe('catalogueIdForCase (M11 reuse)', () => {
  beforeAll(() => {
    process.env['SF_PORTAL_PLACEMENT_FILE'] = join(
      ROOT,
      'fixtures/lab/platform/placement.citizen.json',
    );
  });

  it('resolves Residence from the placement binding id', () => {
    expect(
      catalogueIdForCase({
        pins: {
          tenant_service_binding_id: RESIDENCE_BINDING,
          form_version_id: RESIDENCE_FORM,
        },
      }),
    ).toBe('IND-SOC-002');
  });

  it('resolves Income from the catalogue form version when not in placement', () => {
    expect(
      catalogueIdForCase({
        pins: {
          tenant_service_binding_id: '00000000-0000-4000-8000-000000000099',
          form_version_id: INCOME_FORM,
        },
      }),
    ).toBe('IND-SOC-031');
  });

  it('falls back when pins are missing', () => {
    expect(catalogueIdForCase({})).toBe('IND-SOC-002');
  });
});
